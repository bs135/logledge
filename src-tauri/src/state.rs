//! Application state shared by all Tauri commands: the Vault, search and sync
//! services plus the multi-vault configuration logic ported from app.go.

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::config::{self, Config, FileFilterConfig, VaultEntry};
use crate::error::{Error, Result};
use crate::gitsync::{self, AuthMethod, OnStatus, SyncService};
use crate::search::SearchService;
use crate::vault::{clean_path, VaultService};
use crate::watcher::OnChange;

/// Cadence of automatic sync while the app runs.
const SYNC_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// GitHub sync settings exposed to the frontend. The PAT itself is never sent;
/// only whether one is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncSettings {
    #[serde(rename = "repoURL")]
    pub repo_url: String,
    pub branch: String,
    #[serde(rename = "authMethod")]
    pub auth_method: String,
    #[serde(rename = "hasPAT")]
    pub has_pat: bool,
}

pub struct AppState {
    config_path: PathBuf,
    pub vault: VaultService,
    pub search: Arc<SearchService>,
    pub sync: Arc<SyncService>,
    language: RwLock<String>,
    /// Reports whether a PAT is stored; replaced in tests so they never read
    /// the user's real keychain entry.
    has_pat: fn() -> bool,
    /// Emits `vault:changed` and reindexes search in the background.
    vault_changed: OnChange,
}

fn same_path(a: &str, b: &Path) -> bool {
    clean_path(Path::new(a)) == clean_path(b)
}

/// Display name of a vault folder: its last path element, or the whole path
/// for roots like "C:\".
fn folder_name(path: &Path) -> String {
    match path.file_name() {
        Some(name) if !name.is_empty() => name.to_string_lossy().into_owned(),
        _ => path.to_string_lossy().into_owned(),
    }
}

impl AppState {
    /// `emit_vault_changed` notifies the frontend that the tree changed;
    /// `on_status` forwards sync status changes.
    pub fn new(
        config_path: PathBuf,
        search: SearchService,
        emit_vault_changed: OnChange,
        on_status: OnStatus,
    ) -> Arc<Self> {
        Self::build(config_path, search, emit_vault_changed, on_status, || {
            matches!(gitsync::get_pat(), Ok(Some(_)))
        })
    }

    fn build(
        config_path: PathBuf,
        search: SearchService,
        emit_vault_changed: OnChange,
        on_status: OnStatus,
        has_pat: fn() -> bool,
    ) -> Arc<Self> {
        let search = Arc::new(search);
        let reindex_search = Arc::clone(&search);
        let vault_changed: OnChange = Arc::new(move || {
            emit_vault_changed();
            let search = Arc::clone(&reindex_search);
            thread::spawn(move || {
                let _ = search.reindex();
            });
        });

        let vault = VaultService::new(Arc::clone(&vault_changed));
        let sync = Arc::new(SyncService::new(on_status));
        sync.set_worktree_lock(vault.worktree_lock());

        let language = config::load_from(&config_path)
            .map(|c| c.language)
            .unwrap_or_default();
        Arc::new(AppState {
            config_path,
            vault,
            search,
            sync,
            language: RwLock::new(if language.is_empty() {
                "vi".into()
            } else {
                language
            }),
            has_pat,
            vault_changed,
        })
    }

    fn load_config(&self) -> Result<Config> {
        config::load_from(&self.config_path)
    }

    fn save_config(&self, cfg: &Config) -> Result<()> {
        config::save_to(&self.config_path, cfg)
    }

    fn notify_vault_changed(&self) {
        (self.vault_changed)();
    }

    fn is_active_vault(&self, path: &Path) -> bool {
        self.vault
            .root()
            .is_some_and(|root| clean_path(&root) == clean_path(path))
    }

    /// Applies sync settings to the active vault and starts (or stops)
    /// background syncing. Configuration errors are reported via sync status.
    fn apply_sync(
        &self,
        root: &Path,
        repo_url: &str,
        branch: &str,
        auth: AuthMethod,
    ) -> Result<()> {
        let result = self.sync.configure(root, repo_url, branch, auth);
        if self.sync.is_configured() {
            let sync = Arc::clone(&self.sync);
            thread::spawn(move || {
                let _ = sync.sync();
            });
            self.sync.start_periodic(SYNC_INTERVAL);
        } else {
            self.sync.stop();
        }
        result
    }

    /// Opens the Vault, its search index and (if configured) Git sync for the
    /// same folder; indexing and the first sync run in the background so cold
    /// start is not blocked.
    pub fn open_vault(&self, path: &Path) -> Result<()> {
        let path = clean_path(path);
        if self.is_active_vault(&path) {
            return Ok(());
        }
        self.vault.open(&path)?;
        self.search.open(&path)?;
        let search = Arc::clone(&self.search);
        thread::spawn(move || {
            let _ = search.reindex();
        });

        let mut cfg = self.load_config().unwrap_or_default();
        cfg.vault_path = path.to_string_lossy().into_owned();
        let _ = self.save_config(&cfg);

        let (repo_url, branch, auth) = match cfg.vaults.iter().find(|v| same_path(&v.path, &path)) {
            Some(entry) if !entry.git_repo_url.is_empty() => (
                entry.git_repo_url.clone(),
                entry.git_branch.clone(),
                entry.git_auth_method.clone(),
            ),
            // Migration fallback from the older global sync settings.
            _ => (
                cfg.git_repo_url.clone(),
                cfg.git_branch.clone(),
                cfg.git_auth_method.clone(),
            ),
        };
        let branch = if branch.is_empty() {
            "main".to_string()
        } else {
            branch
        };
        // Sync errors must not block opening the Vault; they surface via status.
        let _ = self.apply_sync(&path, &repo_url, &branch, AuthMethod::parse(&auth));
        Ok(())
    }

    /// Reopens the previously active Vault; returns its path, or "" when none
    /// has been configured yet.
    pub fn init_vault(&self) -> Result<String> {
        let cfg = self.load_config()?;
        if cfg.vault_path.is_empty() {
            return Ok(String::new());
        }
        self.open_vault(Path::new(&cfg.vault_path))?;
        Ok(cfg.vault_path)
    }

    /// A VaultEntry for `path` pre-filled with the detected Git settings.
    pub fn detect_vault_info(&self, path: &Path) -> VaultEntry {
        let path = clean_path(path);
        let detected = gitsync::detect_git_info(&path);
        VaultEntry {
            name: folder_name(&path),
            path: path.to_string_lossy().into_owned(),
            git_repo_url: detected.repo_url,
            git_branch: detected.branch,
            git_auth_method: detected.auth_method.as_str().to_string(),
        }
    }

    /// Creates or updates a vault in config.json. With `make_active` it switches
    /// to it; if it is already the active vault, sync settings are reapplied.
    pub fn save_vault(&self, mut entry: VaultEntry, make_active: bool) -> Result<()> {
        let path = clean_path(Path::new(&entry.path));
        entry.path = path.to_string_lossy().into_owned();
        if entry.name.is_empty() {
            entry.name = folder_name(&path);
        }
        if entry.git_branch.is_empty() {
            entry.git_branch = "main".into();
        }
        if entry.git_auth_method.is_empty() {
            entry.git_auth_method = AuthMethod::for_url(&entry.git_repo_url).as_str().into();
        }

        let mut cfg = self.load_config().unwrap_or_default();
        match cfg.vaults.iter_mut().find(|v| same_path(&v.path, &path)) {
            Some(existing) => *existing = entry.clone(),
            None => cfg.vaults.push(entry.clone()),
        }
        if make_active {
            cfg.vault_path = entry.path.clone();
        }
        self.save_config(&cfg)?;

        if make_active {
            self.open_vault(&path)?;
            self.notify_vault_changed();
        } else if self.is_active_vault(&path) {
            let auth = AuthMethod::parse(&entry.git_auth_method);
            let _ = self.apply_sync(&path, &entry.git_repo_url, &entry.git_branch, auth);
            self.notify_vault_changed();
        }
        Ok(())
    }

    /// Makes `dir` the active vault in config.json, registering it if unknown.
    fn ensure_vault_in_config(&self, dir: &Path) -> Result<()> {
        let dir = clean_path(dir);
        let mut cfg = self.load_config().unwrap_or_default();
        cfg.vault_path = dir.to_string_lossy().into_owned();
        if !cfg.vaults.iter().any(|v| same_path(&v.path, &dir)) {
            cfg.vaults.push(self.detect_vault_info(&dir));
        }
        self.save_config(&cfg)
    }

    pub fn get_vault_list(&self) -> Result<Vec<VaultEntry>> {
        Ok(self.load_config()?.vaults)
    }

    /// Switches the active vault to `target`.
    pub fn switch_vault(&self, target: &Path) -> Result<()> {
        let target = clean_path(target);
        if self.is_active_vault(&target) {
            let _ = self.ensure_vault_in_config(&target);
            self.notify_vault_changed();
            return Ok(());
        }
        self.open_vault(&target)?;
        self.ensure_vault_in_config(&target)?;
        self.notify_vault_changed();
        Ok(())
    }

    /// Removes a vault from the registered list (files stay on disk).
    pub fn remove_vault(&self, target: &Path) -> Result<()> {
        let mut cfg = self.load_config()?;
        cfg.vaults.retain(|v| !same_path(&v.path, target));
        self.save_config(&cfg)
    }

    pub fn get_app_settings(&self) -> Result<Config> {
        self.load_config()
    }

    /// Active UI language ("vi" or "en"), used by the tray menu.
    pub fn language(&self) -> String {
        self.language.read().unwrap().clone()
    }

    pub fn save_app_settings(&self, theme: &str, language: &str) -> Result<()> {
        if !language.is_empty() {
            *self.language.write().unwrap() = language.to_string();
        }
        let mut cfg = self.load_config()?;
        cfg.theme = theme.to_string();
        cfg.language = language.to_string();
        self.save_config(&cfg)
    }

    pub fn get_file_filter_config(&self) -> Result<FileFilterConfig> {
        Ok(self.load_config()?.file_filter)
    }

    pub fn save_file_filter_config(&self, filter: FileFilterConfig) -> Result<()> {
        let mut cfg = self.load_config().unwrap_or_default();
        cfg.file_filter = filter;
        self.save_config(&cfg)
    }

    /// Sync settings of the active vault (or the legacy global settings).
    pub fn get_sync_settings(&self) -> Result<SyncSettings> {
        let cfg = self.load_config()?;
        let root = self.vault.root().unwrap_or_default();
        let (repo_url, branch, auth) = match cfg.vaults.iter().find(|v| same_path(&v.path, &root)) {
            Some(e) => (&e.git_repo_url, &e.git_branch, &e.git_auth_method),
            None => (&cfg.git_repo_url, &cfg.git_branch, &cfg.git_auth_method),
        };
        Ok(SyncSettings {
            repo_url: repo_url.clone(),
            branch: if branch.is_empty() {
                "main".into()
            } else {
                branch.clone()
            },
            auth_method: if auth.is_empty() {
                "none".into()
            } else {
                auth.clone()
            },
            has_pat: (self.has_pat)(),
        })
    }

    /// Saves sync settings for the active vault, applies them (git init/remote
    /// as needed) and starts periodic sync.
    pub fn configure_sync(&self, repo_url: &str, branch: &str, auth_method: &str) -> Result<()> {
        let root = self
            .vault
            .root()
            .ok_or_else(|| Error::msg("no active vault"))?;
        let mut cfg = self.load_config()?;
        if let Some(entry) = cfg.vaults.iter_mut().find(|v| same_path(&v.path, &root)) {
            entry.git_repo_url = repo_url.to_string();
            entry.git_branch = branch.to_string();
            entry.git_auth_method = auth_method.to_string();
        }
        self.save_config(&cfg)?;
        self.apply_sync(&root, repo_url, branch, AuthMethod::parse(auth_method))
    }

    /// Final sync before the app exits: stops periodic syncing and, if sync is
    /// configured, runs one last sync, giving up after `timeout` so a slow or
    /// broken network never hangs the exit.
    pub fn final_sync(&self, timeout: Duration) {
        self.sync.stop();
        if !self.sync.is_configured() {
            return;
        }
        let sync = Arc::clone(&self.sync);
        let (done_tx, done_rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = sync.sync();
            let _ = done_tx.send(());
        });
        let _ = done_rx.recv_timeout(timeout);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn path_string(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    struct TestApp {
        app: Arc<AppState>,
        changed: Arc<AtomicUsize>,
        dir: tempfile::TempDir,
    }

    impl TestApp {
        fn config_path(&self) -> PathBuf {
            self.dir.path().join("config.json")
        }

        fn vault(&self, name: &str) -> PathBuf {
            let p = self.dir.path().join(name);
            fs::create_dir_all(&p).unwrap();
            p
        }
    }

    fn new_app() -> TestApp {
        let dir = tempfile::tempdir().unwrap();
        let changed = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&changed);
        let app = AppState::build(
            dir.path().join("config.json"),
            SearchService::with_index_dir(Some(dir.path().join("index"))),
            Arc::new(move || {
                c.fetch_add(1, Ordering::SeqCst);
            }),
            Arc::new(|_| {}),
            || false,
        );
        TestApp { app, changed, dir }
    }

    #[test]
    fn init_without_config_returns_empty_path() {
        let t = new_app();
        assert_eq!(t.app.init_vault().unwrap(), "");
        assert_eq!(t.app.language(), "vi");
    }

    #[test]
    fn save_vault_activates_and_persists() {
        let t = new_app();
        let vault = t.vault("notes");
        let entry = t.app.detect_vault_info(&vault);
        assert_eq!(entry.name, "notes");
        assert_eq!(entry.git_auth_method, "none");

        t.app.save_vault(entry, true).unwrap();
        assert_eq!(t.app.vault.root().unwrap(), clean_path(&vault));
        assert_eq!(t.changed.load(Ordering::SeqCst), 1);

        let cfg = config::load_from(&t.config_path()).unwrap();
        assert_eq!(cfg.vault_path, vault.to_string_lossy());
        assert_eq!(cfg.vaults.len(), 1);
        assert_eq!(cfg.vaults[0].git_branch, "main");

        // Saving the same path again updates instead of duplicating.
        let mut renamed = cfg.vaults[0].clone();
        renamed.name = "My notes".into();
        t.app.save_vault(renamed, false).unwrap();
        let cfg = config::load_from(&t.config_path()).unwrap();
        assert_eq!(cfg.vaults.len(), 1);
        assert_eq!(cfg.vaults[0].name, "My notes");
    }

    #[test]
    fn save_vault_infers_auth_from_url() {
        let t = new_app();
        let vault = t.vault("v");
        let entry = VaultEntry {
            path: vault.to_string_lossy().into_owned(),
            git_repo_url: "git@github.com:a/b.git".into(),
            ..VaultEntry::default()
        };
        t.app.save_vault(entry, false).unwrap();
        let saved = &t.app.get_vault_list().unwrap()[0];
        assert_eq!(saved.git_auth_method, "ssh");
        assert_eq!(saved.name, "v");
    }

    #[test]
    fn switch_and_remove_vaults() {
        let t = new_app();
        let a = t.vault("a");
        let b = t.vault("b");
        t.app.switch_vault(&a).unwrap();
        t.app.switch_vault(&b).unwrap();
        assert_eq!(t.app.vault.root().unwrap(), clean_path(&b));
        assert_eq!(t.app.get_vault_list().unwrap().len(), 2);

        // A fresh state reopens the last active vault.
        let reopened = AppState::build(
            t.config_path(),
            SearchService::with_index_dir(Some(t.dir.path().join("index2"))),
            Arc::new(|| {}),
            Arc::new(|_| {}),
            || false,
        );
        assert_eq!(reopened.init_vault().unwrap(), b.to_string_lossy());

        t.app.remove_vault(&a).unwrap();
        let names: Vec<_> = t
            .app
            .get_vault_list()
            .unwrap()
            .into_iter()
            .map(|v| v.name)
            .collect();
        assert_eq!(names, ["b"]);
    }

    #[test]
    fn app_settings_and_file_filter() {
        let t = new_app();
        t.app.save_app_settings("light", "en").unwrap();
        assert_eq!(t.app.language(), "en");
        let cfg = t.app.get_app_settings().unwrap();
        assert_eq!((cfg.theme.as_str(), cfg.language.as_str()), ("light", "en"));

        assert_eq!(
            t.app.get_file_filter_config().unwrap(),
            FileFilterConfig::default_filter()
        );
        let filter = FileFilterConfig {
            enabled: false,
            mode: "blacklist".into(),
            whitelist: vec![],
            blacklist: vec![".exe".into()],
        };
        t.app.save_file_filter_config(filter.clone()).unwrap();
        assert_eq!(t.app.get_file_filter_config().unwrap(), filter);
    }

    #[test]
    fn sync_settings_follow_active_vault_and_legacy_fallback() {
        // Local, unreachable remotes with auth "none": no network access and no
        // keychain lookup of a real token during tests.
        let t = new_app();
        let legacy_url = path_string(&t.dir.path().join("legacy.git"));
        let cfg = Config {
            git_repo_url: legacy_url.clone(),
            git_auth_method: "none".into(),
            ..Config::default()
        };
        config::save_to(&t.config_path(), &cfg).unwrap();
        let legacy = t.app.get_sync_settings().unwrap();
        assert_eq!(legacy.repo_url, legacy_url);
        assert_eq!(legacy.branch, "main");

        // Opening a vault without its own settings applies the legacy ones.
        let vault = t.vault("v");
        t.app.switch_vault(&vault).unwrap();
        assert!(t.app.sync.is_configured());
        assert_eq!(t.app.get_sync_settings().unwrap().repo_url, legacy_url);

        // Per-vault settings take precedence once saved.
        let own_url = path_string(&t.dir.path().join("own.git"));
        let entry = VaultEntry {
            path: path_string(&vault),
            git_repo_url: own_url.clone(),
            git_branch: "notes".into(),
            git_auth_method: "none".into(),
            ..VaultEntry::default()
        };
        t.app.save_vault(entry, false).unwrap();
        let s = t.app.get_sync_settings().unwrap();
        assert_eq!(
            (
                s.repo_url.as_str(),
                s.branch.as_str(),
                s.auth_method.as_str()
            ),
            (own_url.as_str(), "notes", "none")
        );
        let json = serde_json::to_value(&s).unwrap();
        for key in ["repoURL", "branch", "authMethod", "hasPAT"] {
            assert!(json.get(key).is_some(), "missing {key} in {json}");
        }
    }

    #[test]
    fn configure_sync_requires_active_vault() {
        let t = new_app();
        assert!(t.app.configure_sync("", "main", "none").is_err());

        let vault = t.vault("v");
        t.app.switch_vault(&vault).unwrap();
        t.app.configure_sync("", "main", "none").unwrap();
        assert!(!t.app.sync.is_configured());
    }

    #[test]
    fn final_sync_runs_once_and_respects_timeout() {
        let t = new_app();
        // Not configured: returns immediately.
        t.app.final_sync(Duration::from_secs(8));

        // Configured against an unreachable local remote: the sync fails fast
        // and its outcome is reported through status.
        let vault = t.vault("v");
        t.app.switch_vault(&vault).unwrap();
        let remote = path_string(&t.dir.path().join("missing.git"));
        t.app.configure_sync(&remote, "main", "none").unwrap();

        let started = std::time::Instant::now();
        t.app.final_sync(Duration::from_secs(20));
        assert!(started.elapsed() < Duration::from_secs(20));
        assert_eq!(t.app.sync.status().state, "offline");
    }

    #[test]
    fn external_change_emits_and_reindexes() {
        let t = new_app();
        let vault = t.vault("v");
        t.app.switch_vault(&vault).unwrap();
        let before = t.changed.load(Ordering::SeqCst);

        fs::write(vault.join("note.md"), "findable content").unwrap();
        thread::sleep(Duration::from_millis(1500));
        assert!(t.changed.load(Ordering::SeqCst) > before);
        assert_eq!(t.app.search.search("findable", 10).unwrap().len(), 1);
    }
}
