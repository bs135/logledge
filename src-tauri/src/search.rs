//! SearchService: SQLite FTS5 index of the Vault's .md files, powering Global
//! Search (full text with highlighted snippets) and the Quick Switcher (fuzzy
//! file names). The index lives outside the Vault, in the user cache directory,
//! at the same path and with the same schema as the Go build, so existing
//! indexes are reused after an upgrade.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::fuzzy;

/// A full-text match with a contextual snippet (matches wrapped in `**`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

struct Index {
    root: PathBuf,
    // SQLite allows one writer at a time; one shared connection, locked per
    // statement, lets searches run between the writes of a reindex.
    conn: Arc<Mutex<Connection>>,
}

pub struct SearchService {
    index_dir: Option<PathBuf>,
    index: Mutex<Option<Index>>,
    /// Held for the whole duration of a reindex; serializes reindex runs and
    /// lets open/close wait for the running one to stop.
    run: Mutex<()>,
    /// Cancellation flag of the current (or last) reindex run.
    cancel: Mutex<Arc<AtomicBool>>,
}

fn not_open() -> Error {
    Error::msg("search chưa mở index nào")
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl SearchService {
    /// Index files are stored under `<cache dir>/logledge/index`.
    pub fn new() -> Self {
        Self::with_index_dir(None)
    }

    fn with_index_dir(index_dir: Option<PathBuf>) -> Self {
        SearchService {
            index_dir,
            index: Mutex::new(None),
            run: Mutex::new(()),
            cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
        }
    }

    /// Index file for a Vault, named after a hash of its root path so every
    /// Vault keeps its own persistent index.
    fn index_file(&self, root: &Path) -> Result<PathBuf> {
        let dir = match &self.index_dir {
            Some(dir) => dir.clone(),
            None => dirs::cache_dir()
                .ok_or_else(|| Error::msg("cannot determine the user cache directory"))?
                .join("logledge")
                .join("index"),
        };
        fs::create_dir_all(&dir)?;
        let sum = Sha256::digest(root.to_string_lossy().as_bytes());
        let name: String = sum[..8].iter().map(|b| format!("{b:02x}")).collect();
        Ok(dir.join(format!("{name}.sqlite")))
    }

    /// Opens (creating if missing) the index for the Vault at `root`, closing
    /// the previous one.
    pub fn open(&self, root: &Path) -> Result<()> {
        self.close();

        let conn = Connection::open(self.index_file(root)?)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS files (
                id    INTEGER PRIMARY KEY,
                path  TEXT UNIQUE NOT NULL,
                mtime INTEGER NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body);",
        )?;

        *lock(&self.index) = Some(Index {
            root: root.to_path_buf(),
            conn: Arc::new(Mutex::new(conn)),
        });
        Ok(())
    }

    /// Cancels any running reindex, waits for it to stop and closes the index.
    pub fn close(&self) {
        lock(&self.cancel).store(true, Ordering::SeqCst);
        let _run = lock(&self.run);
        *lock(&self.index) = None;
    }

    fn snapshot(&self) -> Option<(PathBuf, Arc<Mutex<Connection>>)> {
        lock(&self.index)
            .as_ref()
            .map(|i| (i.root.clone(), Arc::clone(&i.conn)))
    }

    /// Walks the Vault and re-indexes .md files whose mtime changed since the
    /// last run, then purges files that no longer exist. A newer call cancels a
    /// run in progress.
    pub fn reindex(&self) -> Result<()> {
        lock(&self.cancel).store(true, Ordering::SeqCst);
        let _run = lock(&self.run);

        let cancelled = Arc::new(AtomicBool::new(false));
        *lock(&self.cancel) = Arc::clone(&cancelled);
        let (root, conn) = self.snapshot().ok_or_else(not_open)?;

        let mut seen = HashSet::new();
        let walker = walkdir::WalkDir::new(&root).into_iter().filter_entry(|e| {
            // Skip hidden directories (.git, .attachments, ...) but never the root.
            e.depth() == 0
                || !(e.file_type().is_dir() && e.file_name().to_string_lossy().starts_with('.'))
        });
        for entry in walker {
            if cancelled.load(Ordering::SeqCst) {
                return Ok(());
            }
            // Skip unreadable entries without failing the whole crawl.
            let Ok(entry) = entry else { continue };
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_md = Path::new(&name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
            if name.starts_with('.') || !is_md {
                continue;
            }
            let Ok(rel_path) = entry.path().strip_prefix(&root) else {
                continue;
            };
            let rel = rel_path
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            seen.insert(rel.clone());

            let Some(mtime) = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| {
                    t.duration_since(UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_nanos() as i64)
                })
            else {
                continue;
            };

            let existing: Option<(i64, i64)> = lock(&conn)
                .query_row("SELECT id, mtime FROM files WHERE path = ?1", [&rel], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()?;
            if matches!(existing, Some((_, m)) if m == mtime) {
                continue; // unchanged since the previous run
            }
            if cancelled.load(Ordering::SeqCst) {
                return Ok(());
            }

            let Ok(data) = fs::read(entry.path()) else {
                continue;
            };
            let title = name[..name.len() - ".md".len()].to_string();
            let body = String::from_utf8_lossy(&data);

            let conn = lock(&conn);
            match existing {
                Some((id, _)) => {
                    // Replace the content while keeping the rowid.
                    let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", [id]);
                    let _ = conn.execute(
                        "INSERT INTO notes_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
                        params![id, title, body],
                    );
                    let _ = conn.execute(
                        "UPDATE files SET mtime = ?1 WHERE id = ?2",
                        params![mtime, id],
                    );
                }
                None => {
                    if conn
                        .execute(
                            "INSERT INTO files(path, mtime) VALUES (?1, ?2)",
                            params![rel, mtime],
                        )
                        .is_err()
                    {
                        continue;
                    }
                    let id = conn.last_insert_rowid();
                    let _ = conn.execute(
                        "INSERT INTO notes_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
                        params![id, title, body],
                    );
                }
            }
        }

        self.remove_stale(&conn, &seen, &cancelled)
    }

    /// Removes index entries for files deleted or renamed on disk.
    fn remove_stale(
        &self,
        conn: &Mutex<Connection>,
        seen: &HashSet<String>,
        cancelled: &AtomicBool,
    ) -> Result<()> {
        if cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let stale: Vec<i64> = {
            let conn = lock(conn);
            let mut stmt = conn.prepare("SELECT id, path FROM files")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
            rows.flatten()
                .filter(|(_, path)| !seen.contains(path))
                .map(|(id, _)| id)
                .collect()
        };
        for id in stale {
            if cancelled.load(Ordering::SeqCst) {
                return Ok(());
            }
            let conn = lock(conn);
            let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", [id]);
            let _ = conn.execute("DELETE FROM files WHERE id = ?1", [id]);
        }
        Ok(())
    }

    /// Full-text search (FTS5 MATCH), returning up to `limit` results ranked by
    /// relevance, with snippets highlighted using `**`.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = if limit == 0 { 20 } else { limit };

        let conn = lock(&conn);
        let mut stmt = conn.prepare(
            "SELECT f.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 10)
             FROM notes_fts n
             JOIN files f ON f.id = n.rowid
             WHERE notes_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![fts_query(query), limit as i64], |r| {
            Ok(SearchResult {
                path: r.get(0)?,
                title: r.get(1)?,
                snippet: r.get(2)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Fuzzy file name lookup (Ctrl+P), returning up to `limit` relative paths,
    /// best match first. An empty query lists the first paths alphabetically.
    pub fn quick_switch(&self, query: &str, limit: usize) -> Result<Vec<String>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let limit = if limit == 0 { 20 } else { limit };

        let paths: Vec<String> = {
            let conn = lock(&conn);
            let mut stmt = conn.prepare("SELECT path FROM files ORDER BY path")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.flatten().collect()
        };

        let query = query.trim();
        if query.is_empty() {
            return Ok(paths.into_iter().take(limit).collect());
        }
        Ok(fuzzy::find(query, &paths)
            .into_iter()
            .take(limit)
            .map(|m| paths[m.index].clone())
            .collect())
    }
}

/// Quotes each token and adds a prefix wildcard, joined by FTS5's implicit AND,
/// to support search-as-you-type without exposing FTS5 query syntax.
fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    struct TestSearch {
        svc: Arc<SearchService>,
        vault: tempfile::TempDir,
        _cache: tempfile::TempDir,
    }

    fn new_search() -> TestSearch {
        let cache = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let svc = Arc::new(SearchService::with_index_dir(Some(
            cache.path().to_path_buf(),
        )));
        svc.open(vault.path()).unwrap();
        TestSearch {
            svc,
            vault,
            _cache: cache,
        }
    }

    fn write_note(root: &Path, rel: &str, content: &str) {
        let abs = root.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(abs, content).unwrap();
    }

    #[test]
    fn reindex_and_search() {
        let t = new_search();
        write_note(
            t.vault.path(),
            "hello.md",
            "# Hello\nThis note talks about golang and wails development.",
        );
        write_note(t.vault.path(), "other.md", "# Other\nNothing related here.");
        write_note(t.vault.path(), ".attachments/hidden.md", "golang");
        write_note(t.vault.path(), "image.png", "golang");
        t.svc.reindex().unwrap();

        let results = t.svc.search("golang", 10).unwrap();
        assert_eq!(results.len(), 1, "{results:?}");
        assert_eq!(results[0].path, "hello.md");
        assert_eq!(results[0].title, "hello");
        assert!(
            results[0].snippet.contains("**golang**"),
            "{}",
            results[0].snippet
        );

        // Prefix search-as-you-type, multiple tokens and quote escaping.
        assert_eq!(t.svc.search("gol wai", 10).unwrap().len(), 1);
        assert!(
            t.svc.search("\"golang", 10).is_ok(),
            "quotes must not break FTS5 syntax"
        );
        assert!(t.svc.search("   ", 10).unwrap().is_empty());
    }

    #[test]
    fn reindex_picks_up_changes_and_deletions() {
        let t = new_search();
        write_note(t.vault.path(), "note.md", "original content about apples");
        t.svc.reindex().unwrap();
        assert_eq!(t.svc.search("apples", 10).unwrap().len(), 1);

        thread::sleep(Duration::from_millis(20)); // ensure the mtime changes
        write_note(t.vault.path(), "note.md", "updated content about oranges");
        t.svc.reindex().unwrap();
        assert!(t.svc.search("apples", 10).unwrap().is_empty());
        assert_eq!(t.svc.search("oranges", 10).unwrap().len(), 1);

        fs::remove_file(t.vault.path().join("note.md")).unwrap();
        t.svc.reindex().unwrap();
        assert!(t.svc.search("oranges", 10).unwrap().is_empty());
    }

    #[test]
    fn quick_switch_fuzzy() {
        let t = new_search();
        write_note(t.vault.path(), "projects/roadmap.md", "");
        write_note(t.vault.path(), "daily/2024-01-01.md", "");
        t.svc.reindex().unwrap();

        assert_eq!(
            t.svc.quick_switch("rdmp", 10).unwrap(),
            ["projects/roadmap.md"]
        );
        assert_eq!(
            t.svc.quick_switch("", 10).unwrap(),
            ["daily/2024-01-01.md", "projects/roadmap.md"]
        );
    }

    #[test]
    fn concurrent_reindex_and_open() {
        let t = new_search();
        let root2 = tempfile::tempdir().unwrap();
        for i in 0..20 {
            let name = format!("notes/{}.md", "a".repeat(i + 1));
            write_note(t.vault.path(), &name, "content about golang testing");
            let name = format!("notes/{}.md", "b".repeat(i + 1));
            write_note(root2.path(), &name, "content about second vault notes");
        }

        let svc = Arc::clone(&t.svc);
        let reindexer = thread::spawn(move || {
            for _ in 0..10 {
                let _ = svc.reindex();
                thread::sleep(Duration::from_millis(2));
            }
        });
        for i in 0..5 {
            let target = if i % 2 == 1 {
                root2.path()
            } else {
                t.vault.path()
            };
            t.svc.open(target).unwrap();
            thread::sleep(Duration::from_millis(3));
        }
        reindexer.join().unwrap();

        // The last open was root1; the service must still be usable.
        t.svc.reindex().unwrap();
        assert_eq!(t.svc.search("golang", 30).unwrap().len(), 20);
    }

    #[test]
    fn operations_require_open_index() {
        let svc = SearchService::with_index_dir(None);
        assert!(svc.reindex().is_err());
        assert!(svc.search("x", 10).is_err());
        assert!(svc.quick_switch("x", 10).is_err());
    }

    #[test]
    fn index_file_name_matches_go() {
        // Go: hex(sha256(root)[:8]) + ".sqlite"
        let dir = tempfile::tempdir().unwrap();
        let svc = SearchService::with_index_dir(Some(dir.path().to_path_buf()));
        let file = svc.index_file(Path::new("C:\\notes")).unwrap();
        assert_eq!(file.file_name().unwrap(), "3e49145df6e48263.sqlite");
    }

    #[test]
    fn fts_query_quotes_tokens() {
        assert_eq!(fts_query("foo  bar"), "\"foo\"* \"bar\"*");
        assert_eq!(fts_query("a\"b"), "\"a\"\"b\"*");
    }
}
