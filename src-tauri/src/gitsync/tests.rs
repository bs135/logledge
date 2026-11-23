//! Port of gitsync_test.go: end-to-end sync scenarios against a local bare
//! repository acting as the GitHub remote.

use super::*;

/// Runs git for fixture setup and panics on failure.
fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {} failed: {}{}",
        args.join(" "),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn write(dir: &Path, rel: &str, content: &str) {
    let abs = dir.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    fs::write(abs, content).unwrap();
}

fn read(dir: &Path, rel: &str) -> String {
    fs::read_to_string(dir.join(rel)).unwrap()
}

struct Remote {
    bare: PathBuf,
    _dirs: Vec<tempfile::TempDir>,
}

/// Bare repo acting as GitHub, seeded with one commit on `main`.
fn bare_remote_with_seed(seed: &[(&str, &str)]) -> Remote {
    let holder = tempfile::tempdir().unwrap();
    let bare = holder.path().join("remote.git");
    git(
        holder.path(),
        &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
    );

    let seed_dir = tempfile::tempdir().unwrap();
    git(seed_dir.path(), &["init", "-b", "main"]);
    for (rel, content) in seed {
        write(seed_dir.path(), rel, content);
    }
    git(seed_dir.path(), &["add", "-A"]);
    git(seed_dir.path(), &["commit", "-m", "seed"]);
    git(
        seed_dir.path(),
        &["remote", "add", "origin", bare.to_str().unwrap()],
    );
    git(seed_dir.path(), &["push", "origin", "main"]);
    Remote {
        bare,
        _dirs: vec![holder, seed_dir],
    }
}

/// Simulates another machine editing and pushing to the remote.
fn push_remote_change(remote: &Remote, mutate: impl FnOnce(&Path)) {
    let clone = tempfile::tempdir().unwrap();
    let dest = clone.path().join("clone");
    git(
        clone.path(),
        &[
            "clone",
            remote.bare.to_str().unwrap(),
            dest.to_str().unwrap(),
        ],
    );
    git(&dest, &["checkout", "main"]);
    mutate(&dest);
    git(&dest, &["add", "-A"]);
    git(&dest, &["commit", "-m", "remote change"]);
    git(&dest, &["push", "origin", "main"]);
}

struct LocalVault {
    svc: Arc<SyncService>,
    dir: tempfile::TempDir,
}

impl LocalVault {
    fn root(&self) -> &Path {
        self.dir.path()
    }

    fn conflict_files(&self, prefix: &str) -> Vec<String> {
        fs::read_dir(self.root())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&format!("{prefix}.conflict.")))
            .collect()
    }

    fn single_conflict_file(&self, prefix: &str) -> String {
        let files = self.conflict_files(prefix);
        assert_eq!(
            files.len(),
            1,
            "expected one {prefix}.conflict.* file, got {files:?}"
        );
        files[0].clone()
    }
}

fn local_vault(remote: &Remote) -> LocalVault {
    let dir = tempfile::tempdir().unwrap();
    let svc = Arc::new(SyncService::new(Arc::new(|_| {})));
    svc.configure(
        dir.path(),
        remote.bare.to_str().unwrap(),
        "main",
        AuthMethod::None,
    )
    .unwrap();
    LocalVault { svc, dir }
}

/// Local vault after an initial successful sync with the remote.
fn synced_vault(remote: &Remote) -> LocalVault {
    let v = local_vault(remote);
    v.svc.sync().unwrap();
    v
}

#[test]
fn adopts_existing_remote_into_empty_vault() {
    let remote = bare_remote_with_seed(&[("hello.md", "hello from remote")]);
    let v = synced_vault(&remote);
    assert_eq!(read(v.root(), "hello.md"), "hello from remote");
    assert_eq!(v.svc.status().state, "idle");
}

#[test]
fn fast_forward_when_only_remote_changed() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    push_remote_change(&remote, |d| write(d, "b.md", "b from remote"));

    v.svc.sync().unwrap();
    assert_eq!(read(v.root(), "b.md"), "b from remote");
}

#[test]
fn merges_non_conflicting_divergent_changes() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    write(v.root(), "local-only.md", "written locally");
    push_remote_change(&remote, |d| write(d, "remote-only.md", "written remotely"));

    v.svc.sync().unwrap();
    assert_eq!(read(v.root(), "local-only.md"), "written locally");
    assert_eq!(read(v.root(), "remote-only.md"), "written remotely");
    assert!(v.conflict_files("local-only").is_empty());
}

#[test]
fn renames_local_on_true_conflict() {
    let remote = bare_remote_with_seed(&[("shared.md", "original")]);
    let v = synced_vault(&remote);
    write(v.root(), "shared.md", "edited locally");
    push_remote_change(&remote, |d| write(d, "shared.md", "edited remotely"));

    v.svc.sync().unwrap();
    assert_eq!(read(v.root(), "shared.md"), "edited remotely");
    let conflict = v.single_conflict_file("shared");
    assert!(conflict.ends_with(".md"), "{conflict}");
    assert_eq!(read(v.root(), &conflict), "edited locally");
    for name in ["shared.md", conflict.as_str()] {
        assert!(
            !read(v.root(), name).contains("<<<<<<<"),
            "{name} has conflict markers"
        );
    }

    // The merge commit was pushed: the next sync is a no-op.
    v.svc.sync().unwrap();
}

#[test]
fn edit_during_fetch_is_committed_before_merge() {
    let remote = bare_remote_with_seed(&[("note.md", "original")]);
    let v = local_vault(&remote);
    v.svc.set_worktree_lock(WorktreeLock::default());
    v.svc.sync().unwrap();

    push_remote_change(&remote, |d| write(d, "note.md", "edited remotely"));
    // The user keeps typing: an auto-save lands after fetch, before the lock.
    let root = v.root().to_path_buf();
    *lock(&v.svc.before_worktree_lock) = Some(Box::new(move || {
        write(&root, "note.md", "edited locally while syncing");
    }));

    v.svc.sync().unwrap();
    assert_eq!(read(v.root(), "note.md"), "edited remotely");
    let conflict = v.single_conflict_file("note");
    assert_eq!(read(v.root(), &conflict), "edited locally while syncing");
    assert_eq!(git(v.root(), &["status", "--porcelain"]).trim(), "");
    v.svc.sync().unwrap();
}

#[test]
fn worktree_lock_is_held_during_commit_and_merge() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    let worktree = WorktreeLock::default();
    v.svc.set_worktree_lock(Arc::clone(&worktree));
    write(v.root(), "local.md", "local");

    let guard = worktree.lock().unwrap();
    let svc = Arc::clone(&v.svc);
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || tx.send(svc.sync()).unwrap());
    assert!(
        rx.recv_timeout(Duration::from_millis(1500)).is_err(),
        "sync must wait for the worktree lock before committing"
    );
    drop(guard);
    rx.recv_timeout(Duration::from_secs(30)).unwrap().unwrap();
}

#[test]
fn concurrent_calls_are_serialized() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    push_remote_change(&remote, |d| write(d, "remote.md", "remote"));
    write(v.root(), "local.md", "local");

    let handles: Vec<_> = (0..4)
        .map(|_| {
            let svc = Arc::clone(&v.svc);
            thread::spawn(move || svc.sync())
        })
        .collect();
    for h in handles {
        h.join().unwrap().unwrap();
    }
    assert_eq!(read(v.root(), "remote.md"), "remote");
}

#[test]
fn local_edit_remote_delete_keeps_local_as_conflict() {
    let remote = bare_remote_with_seed(&[("shared.md", "original"), ("keep.md", "k")]);
    let v = synced_vault(&remote);
    write(v.root(), "shared.md", "edited locally");
    push_remote_change(&remote, |d| fs::remove_file(d.join("shared.md")).unwrap());

    v.svc
        .sync()
        .expect("modify/delete must be resolved, not fail the sync");
    let conflict = v.single_conflict_file("shared");
    assert_eq!(read(v.root(), &conflict), "edited locally");
    v.svc.sync().unwrap();
}

#[test]
fn conflict_on_non_ascii_filename() {
    let name = "ghi chú.md";
    let remote = bare_remote_with_seed(&[(name, "original")]);
    let v = synced_vault(&remote);
    write(v.root(), name, "edited locally");
    push_remote_change(&remote, |d| write(d, name, "edited remotely"));

    v.svc.sync().unwrap();
    assert_eq!(read(v.root(), name), "edited remotely");
    let conflict = v.single_conflict_file("ghi chú");
    assert_eq!(read(v.root(), &conflict), "edited locally");
}

#[test]
fn local_delete_remote_edit_restores_remote_without_conflict_copy() {
    let remote = bare_remote_with_seed(&[("shared.md", "original"), ("keep.md", "k")]);
    let v = synced_vault(&remote);
    fs::remove_file(v.root().join("shared.md")).unwrap();
    push_remote_change(&remote, |d| write(d, "shared.md", "edited remotely"));

    v.svc.sync().unwrap();
    assert_eq!(read(v.root(), "shared.md"), "edited remotely");
    let names: Vec<_> = fs::read_dir(v.root())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".conflict."))
        .collect();
    assert!(names.is_empty(), "no local version exists, got {names:?}");
}

#[test]
fn local_rename_remote_edit_merges_into_new_name() {
    let remote = bare_remote_with_seed(&[("a.md", "line1\nline2\nline3\nline4\n")]);
    let v = synced_vault(&remote);
    fs::rename(v.root().join("a.md"), v.root().join("b.md")).unwrap();
    push_remote_change(&remote, |d| {
        write(d, "a.md", "line1\nline2\nline3\nline4 edited remotely\n")
    });

    v.svc.sync().unwrap();
    assert!(
        !v.root().join("a.md").exists(),
        "a.md was renamed locally and must not come back"
    );
    assert!(read(v.root(), "b.md").contains("line4 edited remotely"));
}

#[test]
fn unconfigured_sync_is_a_no_op() {
    let statuses: Arc<Mutex<Vec<String>>> = Arc::default();
    let seen = Arc::clone(&statuses);
    let svc = SyncService::new(Arc::new(move |s: Status| {
        seen.lock().unwrap().push(s.state)
    }));
    let dir = tempfile::tempdir().unwrap();
    svc.configure(dir.path(), "", "", AuthMethod::None).unwrap();

    assert!(!svc.is_configured());
    svc.sync().unwrap();
    assert!(!dir.path().join(".git").exists());
    assert_eq!(*statuses.lock().unwrap(), ["not_configured"]);
}

#[test]
fn offline_remote_reports_status_and_keeps_local_commit() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    write(v.root(), "local.md", "local");
    fs::remove_dir_all(&remote.bare).unwrap();

    assert!(v.svc.sync().is_err());
    assert_eq!(v.svc.status().state, "offline");
    assert_eq!(
        git(v.root(), &["status", "--porcelain"]).trim(),
        "",
        "local change must be committed"
    );
}

#[test]
fn run_scrubs_secret_from_errors() {
    let dir = tempfile::tempdir().unwrap();
    let svc = SyncService::new(Arc::new(|_| {}));
    let s = Settings {
        root: dir.path().to_path_buf(),
        ..Settings::default()
    };
    let url = "https://x-access-token:ghp_SECRET@127.0.0.1:1/none.git";
    let err = svc
        .run(&s, &["fetch", url, "main"], Some("ghp_SECRET"))
        .unwrap_err()
        .to_string();
    assert!(!err.contains("ghp_SECRET"), "{err}");
    assert!(err.contains("<REDACTED>"), "{err}");
}

#[test]
fn pat_is_injected_into_https_url() {
    assert_eq!(
        url_with_pat("https://github.com/a/b.git", "ghp_x/y").unwrap(),
        "https://x-access-token:ghp_x%2Fy@github.com/a/b.git"
    );
    assert!(url_with_pat("not a url", "p").is_err());
}

#[test]
fn helpers() {
    assert_eq!(go_ext("notes/a.md"), ".md");
    assert_eq!(go_ext("dir.v1/file"), "");
    assert_eq!(go_ext(".env"), ".env");
    assert_eq!(
        split_nul("a\0b c\0\0"),
        BTreeSet::from(["a".to_string(), "b c".to_string()])
    );
    assert_eq!(AuthMethod::for_url("SSH://host/x"), AuthMethod::Ssh);
    assert_eq!(
        AuthMethod::for_url("https://github.com/a/b"),
        AuthMethod::Pat
    );
    assert_eq!(AuthMethod::parse("bogus"), AuthMethod::None);
}

#[test]
fn pending_follows_uncommitted_edits_and_clears_after_sync() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    assert_eq!(v.svc.status().state, "idle");

    // Clean tree: stays idle.
    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "idle");

    write(v.root(), "a.md", "edited");
    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "pending");

    // Reverting the edit returns to idle.
    write(v.root(), "a.md", "a");
    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "idle");

    write(v.root(), "a.md", "edited again");
    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "pending");
    v.svc.sync().unwrap();
    assert_eq!(v.svc.status().state, "idle");
}

#[test]
fn pending_when_local_commit_is_unpushed() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    write(v.root(), "b.md", "b");
    git(v.root(), &["add", "-A"]);
    git(v.root(), &["commit", "-m", "local"]);

    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "pending");
}

#[test]
fn pending_when_remote_is_ahead_of_last_fetch() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    push_remote_change(&remote, |d| write(d, "b.md", "b"));
    // Fetch without merging: the tracking ref moves ahead of HEAD.
    let s = v.svc.settings();
    v.svc.fetch_remote(&s).unwrap();

    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "pending");
    v.svc.sync().unwrap();
    assert_eq!(v.svc.status().state, "idle");
}

#[test]
fn pending_check_never_masks_other_states() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    write(v.root(), "a.md", "edited");
    for state in ["error", "offline", "conflict", "syncing", "not_configured"] {
        v.svc.set_status(state, "kept");
        v.svc.refresh_pending();
        let st = v.svc.status();
        assert_eq!((st.state.as_str(), st.message.as_str()), (state, "kept"));
    }
}

#[test]
fn pending_check_skips_while_sync_runs() {
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    write(v.root(), "a.md", "edited");

    let running = lock(&v.svc.run);
    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "idle");
    drop(running);

    v.svc.refresh_pending();
    assert_eq!(v.svc.status().state, "pending");
}

#[test]
fn push_updates_tracking_ref_even_when_url_differs_from_origin() {
    // A PAT-injected URL never matches the configured `origin`, so git leaves
    // the tracking ref behind; the pending check relies on it being current.
    let remote = bare_remote_with_seed(&[("a.md", "a")]);
    let v = synced_vault(&remote);
    git(
        v.root(),
        &[
            "remote",
            "set-url",
            "origin",
            "https://example.invalid/x.git",
        ],
    );
    write(v.root(), "b.md", "b");
    git(v.root(), &["add", "-A"]);
    git(v.root(), &["commit", "-m", "local"]);

    let s = v.svc.settings();
    v.svc.push(&s).unwrap();
    assert_eq!(
        git(v.root(), &["rev-parse", "HEAD"]),
        git(v.root(), &["rev-parse", "refs/remotes/origin/main"])
    );
}
