//! SyncService: synchronizes the Vault with a GitHub repository by running the
//! system `git` CLI (reimplementing rebase/merge is out of scope, see PLAN.md).
//! The Personal Access Token is never stored in `.git/config` or on disk: it is
//! read from the OS keychain and injected only into the URL passed to each
//! fetch/push.

mod credentials;
mod detect;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::vault::WorktreeLock;

// Re-exported for the Tauri commands added at the end of Phase 2.
#[allow(unused_imports)]
pub use credentials::{clear_pat, get_pat, set_pat};
#[allow(unused_imports)]
pub use detect::{detect_git_info, DetectedGitInfo};

/// Authentication mechanism used with GitHub.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    #[default]
    None,
    Pat,
    Ssh,
}

impl AuthMethod {
    /// Parses a stored value; anything unknown behaves like `None`, as in Go.
    pub fn parse(s: &str) -> AuthMethod {
        match s {
            "pat" => AuthMethod::Pat,
            "ssh" => AuthMethod::Ssh,
            _ => AuthMethod::None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            AuthMethod::None => "none",
            AuthMethod::Pat => "pat",
            AuthMethod::Ssh => "ssh",
        }
    }

    /// SSH for `git@` / `ssh://` remotes, PAT for other URLs, none without one.
    pub fn for_url(url: &str) -> AuthMethod {
        let lower = url.to_lowercase();
        if lower.is_empty() {
            AuthMethod::None
        } else if lower.starts_with("git@") || lower.starts_with("ssh://") {
            AuthMethod::Ssh
        } else {
            AuthMethod::Pat
        }
    }
}

/// Sync state shown in the status bar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Status {
    /// not_configured | idle | syncing | conflict | offline | error
    pub state: String,
    pub message: String,
}

pub type OnStatus = Arc<dyn Fn(Status) + Send + Sync>;

#[derive(Debug, Clone, Default)]
struct Settings {
    root: PathBuf,
    repo_url: String,
    branch: String,
    auth: AuthMethod,
    configured: bool,
}

pub struct SyncService {
    settings: Mutex<Settings>,
    status: Mutex<Status>,
    on_status: OnStatus,
    /// Sender that stops the periodic sync thread when dropped or signalled.
    periodic: Mutex<Option<mpsc::Sender<()>>>,
    /// Serializes whole sync runs: startup, periodic, manual and shutdown syncs
    /// never run git concurrently.
    run: Mutex<()>,
    /// Held (when set) while committing local changes and merging, so app
    /// writes (auto-save, renames, ...) cannot interleave with git.
    worktree: Mutex<Option<WorktreeLock>>,
    #[cfg(test)]
    before_worktree_lock: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now(format: &str) -> String {
    chrono::Local::now().format(format).to_string()
}

fn rfc3339_now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Hides the console window git would otherwise flash on Windows.
pub(crate) fn prepare_command(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

impl SyncService {
    /// Creates a service; `on_status` is called on every status change.
    pub fn new(on_status: OnStatus) -> Self {
        SyncService {
            settings: Mutex::default(),
            status: Mutex::new(Status {
                state: "not_configured".into(),
                message: String::new(),
            }),
            on_status,
            periodic: Mutex::new(None),
            run: Mutex::new(()),
            worktree: Mutex::new(None),
            #[cfg(test)]
            before_worktree_lock: Mutex::new(None),
        }
    }

    /// Sets the Vault root, repository, branch and auth method, then makes sure
    /// the local repository exists (git init + origin remote if needed).
    pub fn configure(
        &self,
        root: &Path,
        repo_url: &str,
        branch: &str,
        auth: AuthMethod,
    ) -> Result<()> {
        let branch = if branch.is_empty() { "main" } else { branch };
        let configured = !repo_url.is_empty();
        *lock(&self.settings) = Settings {
            root: root.to_path_buf(),
            repo_url: repo_url.to_string(),
            branch: branch.to_string(),
            auth,
            configured,
        };

        if !configured {
            self.set_status("not_configured", "Chưa cấu hình đồng bộ GitHub");
            return Ok(());
        }
        if let Err(e) = self.ensure_repo(&self.settings()) {
            self.set_status("error", &e.to_string());
            return Err(e);
        }
        self.set_status("idle", "Sẵn sàng đồng bộ");
        Ok(())
    }

    /// Registers the Vault's worktree lock. Sync holds it only for the local
    /// commit/merge phase; fetch and push run without it.
    pub fn set_worktree_lock(&self, worktree: WorktreeLock) {
        *lock(&self.worktree) = Some(worktree);
    }

    fn worktree_lock(&self) -> Option<WorktreeLock> {
        #[cfg(test)]
        if let Some(hook) = lock(&self.before_worktree_lock).take() {
            hook();
        }
        lock(&self.worktree).clone()
    }

    fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    pub fn is_configured(&self) -> bool {
        lock(&self.settings).configured
    }

    pub fn status(&self) -> Status {
        lock(&self.status).clone()
    }

    fn set_status(&self, state: &str, message: &str) {
        let status = Status {
            state: state.to_string(),
            message: message.to_string(),
        };
        *lock(&self.status) = status.clone();
        (self.on_status)(status);
    }

    /// Runs [`sync`](Self::sync) every `interval` on a background thread until
    /// [`stop`](Self::stop). Periodic sync errors are only reported via status.
    pub fn start_periodic(self: &Arc<Self>, interval: Duration) {
        self.stop();
        let (tx, rx) = mpsc::channel::<()>();
        let service = Arc::downgrade(self);
        thread::spawn(move || loop {
            match rx.recv_timeout(interval) {
                Err(RecvTimeoutError::Timeout) => match service.upgrade() {
                    Some(s) => {
                        let _ = s.sync();
                    }
                    None => return,
                },
                _ => return,
            }
        });
        *lock(&self.periodic) = Some(tx);
    }

    /// Stops the periodic sync loop, if running.
    pub fn stop(&self) {
        lock(&self.periodic).take();
    }

    /// Runs git in the Vault root and returns stdout. `secret` (the PAT, when
    /// injected into a URL argument) is scrubbed from error messages so it never
    /// reaches the status bar or logs.
    fn run(&self, s: &Settings, args: &[&str], secret: Option<&str>) -> Result<String> {
        let mut cmd = Command::new("git");
        cmd.args(args).current_dir(&s.root);
        prepare_command(&mut cmd);
        let scrub = |text: String| match secret {
            Some(secret) if !secret.is_empty() => text.replace(secret, "<REDACTED>"),
            _ => text,
        };
        let out = cmd
            .output()
            .map_err(|e| Error::msg(scrub(format!("git {}: {e}", args.join(" ")))))?;
        if !out.status.success() {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            return Err(Error::msg(scrub(format!(
                "git {}: {}: {}",
                args.join(" "),
                out.status,
                combined.trim()
            ))));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// Remote URL to pass to fetch/push, with the PAT injected for PAT auth.
    /// Returns the URL and the secret to scrub from errors.
    fn authed_url(&self, s: &Settings) -> Result<(String, Option<String>)> {
        if s.auth != AuthMethod::Pat {
            return Ok((s.repo_url.clone(), None));
        }
        let pat = get_pat()?
            .filter(|p| !p.is_empty())
            .ok_or_else(|| Error::msg("chưa cấu hình GitHub Personal Access Token"))?;
        Ok((url_with_pat(&s.repo_url, &pat)?, Some(pat)))
    }

    /// Initializes the local repo when the Vault has no `.git` and points
    /// `origin` at the repository URL (without credentials).
    fn ensure_repo(&self, s: &Settings) -> Result<()> {
        if !s.root.join(".git").exists() {
            self.run(s, &["init"], None)?;
            let _ = self.run(s, &["checkout", "-B", &s.branch], None);
            let _ = self.run(s, &["config", "user.name", "Logledge"], None);
            let _ = self.run(s, &["config", "user.email", "logledge@localhost"], None);
        }
        if self.run(s, &["remote", "get-url", "origin"], None).is_err() {
            self.run(s, &["remote", "add", "origin", &s.repo_url], None)?;
        } else {
            self.run(s, &["remote", "set-url", "origin", &s.repo_url], None)?;
        }
        Ok(())
    }

    fn has_local_changes(&self, s: &Settings) -> Result<bool> {
        Ok(!self
            .run(s, &["status", "--porcelain"], None)?
            .trim()
            .is_empty())
    }

    /// Stages and commits all local changes as an "Auto-sync" commit.
    fn auto_commit(&self, s: &Settings) -> Result<()> {
        if !self.has_local_changes(s)? {
            return Ok(());
        }
        self.run(s, &["add", "-A"], None)?;
        let msg = format!("Auto-sync: {}", rfc3339_now());
        self.run(s, &["commit", "-m", &msg], None)?;
        Ok(())
    }

    fn remote_ref(s: &Settings) -> String {
        format!("refs/remotes/origin/{}", s.branch)
    }

    /// Fetches the remote branch into the local tracking ref without touching
    /// the working tree.
    fn fetch_remote(&self, s: &Settings) -> Result<()> {
        let (url, secret) = self.authed_url(s)?;
        let refspec = format!("+{}:{}", s.branch, Self::remote_ref(s));
        self.run(s, &["fetch", &url, &refspec], secret.as_deref())?;
        Ok(())
    }

    fn push(&self, s: &Settings) -> Result<()> {
        let (url, secret) = self.authed_url(s)?;
        let target = format!("HEAD:{}", s.branch);
        self.run(s, &["push", &url, &target], secret.as_deref())?;
        Ok(())
    }

    fn rev_count(&self, s: &Settings, range: &str) -> u64 {
        self.run(s, &["rev-list", "--count", range], None)
            .ok()
            .and_then(|out| out.trim().parse().ok())
            .unwrap_or(0)
    }

    fn ref_exists(&self, s: &Settings, reference: &str) -> bool {
        self.run(s, &["rev-parse", "--verify", "--quiet", reference], None)
            .is_ok()
    }

    /// Fetches the remote, auto-commits local changes, integrates (fast-forward,
    /// or merge with the rename-on-conflict policy when diverged) and pushes.
    /// Called on startup, periodically, on exit and by "Sync now"; concurrent
    /// calls are serialized.
    ///
    /// Fetch and push run without the worktree lock so the editor keeps saving
    /// meanwhile. Auto-commit and merge run atomically under it: the working
    /// tree is clean when the merge starts and no editor write lands mid-merge.
    pub fn sync(&self) -> Result<()> {
        let _run = lock(&self.run);
        let s = self.settings();
        if !s.configured {
            return Ok(());
        }

        self.set_status("syncing", "Đang đồng bộ…");
        if let Err(e) = self.ensure_repo(&s) {
            self.set_status("error", &e.to_string());
            return Err(e);
        }

        let fetch_result = self.fetch_remote(&s);

        let worktree = self.worktree_lock();
        let guard = worktree.as_deref().map(lock);
        if let Err(e) = self.auto_commit(&s) {
            drop(guard);
            self.set_status("error", &format!("Không thể commit thay đổi cục bộ: {e}"));
            return Err(e);
        }
        if let Err(e) = fetch_result {
            drop(guard);
            self.set_status("offline", &format!("Không thể kết nối GitHub: {e}"));
            return Err(e);
        }
        let reconciled = self.reconcile(&s);
        drop(guard);
        if !reconciled? {
            return Ok(());
        }

        if let Err(e) = self.push(&s) {
            self.set_status("error", &format!("Không thể push: {e}"));
            return Err(e);
        }
        self.set_status("idle", &format!("Đã đồng bộ lúc {}", now("%H:%M:%S")));
        Ok(())
    }

    /// Integrates the fetched remote branch into the local one. Must run under
    /// the worktree lock with a clean working tree. Returns whether a push
    /// should follow; when it returns false or an error, the final status has
    /// already been emitted.
    fn reconcile(&self, s: &Settings) -> Result<bool> {
        let remote_ref = Self::remote_ref(s);
        if !self.ref_exists(s, &remote_ref) {
            // The remote does not have this branch yet (new repo). If the Vault
            // has no commits either, there is nothing to sync.
            if !self.ref_exists(s, "HEAD") {
                self.set_status("idle", "Chưa có nội dung để đồng bộ");
                return Ok(false);
            }
            return Ok(true);
        }

        if !self.ref_exists(s, "HEAD") {
            // Fresh git init without commits: no conflict is possible, adopt the
            // remote content as is.
            if let Err(e) = self.run(s, &["reset", "--hard", &remote_ref], None) {
                self.set_status("error", &format!("Không thể lấy nội dung remote: {e}"));
                return Err(e);
            }
            self.set_status("idle", &format!("Đã đồng bộ lúc {}", now("%H:%M:%S")));
            return Ok(false);
        }

        let behind = self.rev_count(s, &format!("HEAD..{remote_ref}"));
        let ahead = self.rev_count(s, &format!("{remote_ref}..HEAD"));
        if behind == 0 {
            // Nothing new on the remote; push only if local has new commits.
        } else if ahead == 0 {
            // Only the remote moved: fast-forward, no conflict possible.
            if let Err(e) = self.run(s, &["merge", "--ff-only", &remote_ref], None) {
                self.set_status("error", &format!("Fast-forward thất bại: {e}"));
                return Err(e);
            }
        } else if let Err(e) = self.merge_with_conflict_rename(s, &remote_ref) {
            self.set_status(
                "conflict",
                &format!(
                    "Đã xảy ra xung đột, các file trùng đổi tên .conflict — kiểm tra lại: {e}"
                ),
            );
            return Err(e);
        }
        Ok(true)
    }

    /// Merges diverged branches. `git merge -X ours` avoids conflict markers in
    /// any file; then every file changed on BOTH sides keeps the local version
    /// as "Name.conflict.<timestamp>.md" and takes the remote version, per the
    /// conflict policy.
    fn merge_with_conflict_rename(&self, s: &Settings, remote_ref: &str) -> Result<()> {
        let base = self.run(s, &["merge-base", "HEAD", remote_ref], None)?;
        let base = base.trim();
        let local_changed = self.changed_files(s, base, "HEAD")?;
        let remote_changed = self.changed_files(s, base, remote_ref)?;

        if let Err(e) = self.run(
            s,
            &["merge", "--no-commit", "--no-ff", "-X", "ours", remote_ref],
            None,
        ) {
            // "-X ours" resolves content conflicts, but structural ones (e.g.
            // modified locally, deleted remotely) still stop the merge. Those are
            // handled below as long as every unmerged path changed on both
            // sides; anything else is a genuine failure.
            let resolvable = self.unmerged_files(s).is_ok_and(|unmerged| {
                !unmerged.is_empty()
                    && unmerged
                        .iter()
                        .all(|p| local_changed.contains(p) && remote_changed.contains(p))
            });
            if !resolvable {
                let _ = self.run(s, &["merge", "--abort"], None);
                return Err(e.context("merge thất bại"));
            }
        }

        let ts = now("%Y-%m-%dT%H-%M-%S");
        for path in remote_changed.intersection(&local_changed) {
            let abs = s.root.join(path);
            // Only a path present in the local commit has a local version worth
            // keeping. When it was deleted locally and modified remotely, the
            // file the merge left on disk is the remote version: no copy.
            let in_head = self
                .run(s, &["cat-file", "-e", &format!("HEAD:{path}")], None)
                .is_ok();
            if in_head && abs.is_file() {
                let ext = go_ext(path);
                let conflict_rel =
                    format!("{}.conflict.{ts}{ext}", &path[..path.len() - ext.len()]);
                if fs::rename(&abs, s.root.join(&conflict_rel)).is_ok() {
                    let _ = self.run(s, &["add", &conflict_rel], None);
                }
            }

            if self
                .run(
                    s,
                    &["cat-file", "-e", &format!("{remote_ref}:{path}")],
                    None,
                )
                .is_ok()
            {
                let _ = self.run(s, &["checkout", remote_ref, "--", path], None);
            } else {
                let _ = fs::remove_file(&abs);
                let _ = self.run(s, &["rm", "-f", "--ignore-unmatch", path], None);
            }
        }

        self.run(s, &["add", "-A"], None)?;
        let msg = format!("Auto-sync (merge): {}", rfc3339_now());
        self.run(s, &["commit", "-m", &msg], None)?;
        Ok(())
    }

    /// Paths changed between two refs. `-z` prints raw paths (no octal quoting
    /// of non-ASCII names such as Vietnamese titles). Rename detection stays on
    /// so a note renamed on one side and edited on the other merges into the
    /// new name instead of conflicting on the old one.
    fn changed_files(&self, s: &Settings, from: &str, to: &str) -> Result<BTreeSet<String>> {
        Ok(split_nul(&self.run(
            s,
            &["diff", "--name-only", "-z", from, to],
            None,
        )?))
    }

    /// Paths left unmerged in the index by an interrupted merge.
    fn unmerged_files(&self, s: &Settings) -> Result<BTreeSet<String>> {
        Ok(split_nul(&self.run(
            s,
            &["diff", "--name-only", "--diff-filter=U", "-z"],
            None,
        )?))
    }
}

/// Injects the PAT as basic-auth credentials (user "x-access-token") into an
/// HTTPS remote URL.
fn url_with_pat(repo_url: &str, pat: &str) -> Result<String> {
    let mut url =
        url::Url::parse(repo_url).map_err(|e| Error::msg(format!("URL repo không hợp lệ: {e}")))?;
    let invalid = || Error::msg("URL repo không hợp lệ");
    url.set_username("x-access-token").map_err(|_| invalid())?;
    url.set_password(Some(pat)).map_err(|_| invalid())?;
    Ok(url.to_string())
}

/// Extension of a "/"-separated path including the dot (Go's filepath.Ext):
/// "notes/a.md" -> ".md", "dir.v1/file" -> "".
fn go_ext(path: &str) -> &str {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    path[name_start..]
        .rfind('.')
        .map_or("", |i| &path[name_start + i..])
}

fn split_nul(out: &str) -> BTreeSet<String> {
    out.split('\0')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests;
