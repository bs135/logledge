//! Watches a Vault directory tree, debounces bursts of filesystem events into a
//! single callback, and ignores events caused by the app's own writes
//! (suppression) so that saving a note does not trigger a self-refresh loop.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher as _};

use crate::error::{Error, Result};

pub type OnChange = Arc<dyn Fn() + Send + Sync>;

/// Monitors a directory tree and calls `on_change` (debounced) for changes
/// that were not suppressed. Dropping the watcher stops it.
pub struct Watcher {
    suppressed: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    // Dropping the notify watcher drops its event sender, which ends the
    // debounce thread.
    _inner: notify::RecommendedWatcher,
}

impl Watcher {
    /// Starts watching `root` recursively. `on_change` runs on a background
    /// thread at most once per `debounce` window after changes settle.
    pub fn new(root: &Path, debounce: Duration, on_change: OnChange) -> Result<Watcher> {
        let suppressed: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::default();
        let (tx, rx) = mpsc::channel::<()>();

        let filter = Arc::clone(&suppressed);
        let mut inner = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            // Watcher errors must not crash the app; ignore and continue.
            let Ok(event) = res else { return };
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let relevant = event
                .paths
                .iter()
                .any(|p| !in_git_dir(p) && !is_suppressed(&filter, p));
            if relevant {
                let _ = tx.send(());
            }
        })
        .map_err(|e| Error::msg(e.to_string()))?;
        inner
            .watch(root, RecursiveMode::Recursive)
            .map_err(|e| Error::msg(e.to_string()))?;

        thread::spawn(move || debounce_loop(rx, debounce, on_change));

        Ok(Watcher {
            suppressed,
            _inner: inner,
        })
    }

    /// Marks `path` as changed by the app itself, so events for it are ignored
    /// for `window`. Called right before the Vault writes, creates, deletes or
    /// renames an entry.
    pub fn suppress(&self, path: &Path, window: Duration) {
        self.suppressed
            .lock()
            .unwrap()
            .insert(path.to_path_buf(), Instant::now() + window);
    }
}

fn is_suppressed(map: &Mutex<HashMap<PathBuf, Instant>>, path: &Path) -> bool {
    let mut map = map.lock().unwrap();
    match map.get(path) {
        Some(expiry) if Instant::now() <= *expiry => true,
        Some(_) => {
            map.remove(path);
            false
        }
        None => false,
    }
}

/// Git metadata changes constantly during sync and is never shown in the tree.
fn in_git_dir(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::Normal(name) if name == ".git"))
}

/// Trailing-edge debounce: fires once `debounce` has passed without new events.
fn debounce_loop(rx: mpsc::Receiver<()>, debounce: Duration, on_change: OnChange) {
    while rx.recv().is_ok() {
        loop {
            match rx.recv_timeout(debounce) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        on_change();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const DEBOUNCE: Duration = Duration::from_millis(100);

    fn start(root: &Path) -> (Watcher, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&count);
        let w = Watcher::new(root, DEBOUNCE, Arc::new(move || {
            c.fetch_add(1, Ordering::SeqCst);
        }))
        .unwrap();
        (w, count)
    }

    fn settle() {
        thread::sleep(DEBOUNCE * 6);
    }

    #[test]
    fn burst_of_external_changes_fires_once() {
        let dir = tempfile::tempdir().unwrap();
        let (_w, count) = start(dir.path());
        for i in 0..5 {
            fs::write(dir.path().join(format!("n{i}.md")), "x").unwrap();
        }
        settle();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn suppressed_and_git_paths_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        let (w, count) = start(dir.path());

        let own = dir.path().join("own.md");
        w.suppress(&own, Duration::from_secs(2));
        fs::write(&own, "x").unwrap();
        fs::write(dir.path().join(".git").join("index"), "x").unwrap();
        settle();
        assert_eq!(count.load(Ordering::SeqCst), 0);

        fs::write(dir.path().join("other.md"), "x").unwrap();
        settle();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn new_subdirectories_are_watched() {
        let dir = tempfile::tempdir().unwrap();
        let (_w, count) = start(dir.path());
        fs::create_dir(dir.path().join("sub")).unwrap();
        settle();
        let before = count.load(Ordering::SeqCst);
        fs::write(dir.path().join("sub").join("a.md"), "x").unwrap();
        settle();
        assert_eq!(count.load(Ordering::SeqCst), before + 1);
    }
}
