//! SearchService: SQLite FTS5 index of the Vault's .md files, powering Global
//! Search (full text with highlighted snippets), the Quick Switcher (fuzzy
//! file names), backlinks (a `links` table of every note-to-note link) and
//! tags (a `tags` table; `tag:name` filters in Global Search). The index lives outside the Vault, in the user cache directory,
//! at the same path and with the same schema as the Go build, so existing
//! indexes are reused after an upgrade.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, UNIX_EPOCH};

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::fuzzy;
use crate::grep::{build_pattern, grep_text, GrepOptions, LineMatch};
use crate::links::{extract_links, target_key, LinkKind};
use crate::tags::{extract_tags, normalize_tag};
use crate::watcher::OnChange;

/// Schema version stored in `PRAGMA user_version`. Version 1 added the `links`
/// table, version 2 the `tags` table; an older index is rebuilt once so every
/// note gets them indexed.
const SCHEMA_VERSION: i64 = 2;

/// Matches of an exact (case-sensitive / regex) search in one note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    pub path: String,
    /// Lines with matches (possibly fewer than the note has, see `total`).
    pub lines: Vec<LineMatch>,
    /// Number of matches in the note.
    pub total: u32,
}

/// Result of [`SearchService::grep`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub files: Vec<FileMatches>,
    /// True when the file or line limit cut the results short.
    pub truncated: bool,
}

/// Limits for exact search results sent to the frontend.
const GREP_MAX_FILES: usize = 200;
const GREP_MAX_LINES_PER_FILE: usize = 50;
const GREP_MAX_LINES: usize = 2000;

/// `tag:` / `path:` filters of a search query and the remaining text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchFilters {
    /// Normalized tags; a note must have every one (or a tag nested under it).
    pub tags: Vec<String>,
    /// Folders (vault-relative, no surrounding "/"); a note must be in one of them.
    pub folders: Vec<String>,
    /// The query without the filter tokens, otherwise unchanged (spacing kept for regex).
    pub text: String,
}

/// A tag and the number of notes carrying it (exactly, not counting nested tags).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: u32,
}

/// A link found in `source` whose target may point at the note asked about (same
/// file name). The frontend resolves `target` to decide whether it really does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    pub source: String,
    pub target: String,
    pub kind: LinkKind,
    pub line: u32,
    pub context: String,
}

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
    /// Called after the index changed (a reindex finished or one file was
    /// re-indexed), so views built on it (backlinks) can refresh.
    on_indexed: Mutex<Option<OnChange>>,
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

    /// Like [`new`](Self::new) with an explicit index directory (tests).
    pub(crate) fn with_index_dir(index_dir: Option<PathBuf>) -> Self {
        SearchService {
            index_dir,
            index: Mutex::new(None),
            run: Mutex::new(()),
            cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
            on_indexed: Mutex::new(None),
        }
    }

    /// Sets the callback run after the index changed.
    pub fn set_on_indexed(&self, f: OnChange) {
        *lock(&self.on_indexed) = Some(f);
    }

    fn notify_indexed(&self) {
        let f = lock(&self.on_indexed).clone();
        if let Some(f) = f {
            f();
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
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body);
            CREATE TABLE IF NOT EXISTS links (
                src_id     INTEGER NOT NULL,
                target     TEXT NOT NULL,
                target_key TEXT NOT NULL,
                kind       TEXT NOT NULL,
                line       INTEGER NOT NULL,
                context    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS links_by_key ON links(target_key);
            CREATE INDEX IF NOT EXISTS links_by_src ON links(src_id);
            CREATE TABLE IF NOT EXISTS tags (
                src_id INTEGER NOT NULL,
                tag    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tags_by_tag ON tags(tag);
            CREATE INDEX IF NOT EXISTS tags_by_src ON tags(src_id);",
        )?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < SCHEMA_VERSION {
            // Notes indexed before links/tags existed have none: forget them so the
            // next reindex reads every note again.
            conn.execute_batch(&format!(
                "DELETE FROM tags; DELETE FROM links; DELETE FROM notes_fts; DELETE FROM files;
                 PRAGMA user_version = {SCHEMA_VERSION};"
            ))?;
        }

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
            store_note(
                &lock(&conn),
                existing.map(|(id, _)| id),
                &rel,
                mtime,
                &title,
                &body,
            );
        }

        self.remove_stale(&conn, &seen, &cancelled)?;
        if !cancelled.load(Ordering::SeqCst) {
            self.notify_indexed();
        }
        Ok(())
    }

    /// Re-indexes one note right away (after the app itself saved, created or
    /// changed it: those writes are hidden from the file watcher). A path that is
    /// not a Markdown file on disk any more is removed from the index.
    pub fn reindex_file(&self, rel: &str) -> Result<()> {
        let (root, conn) = self.snapshot().ok_or_else(not_open)?;
        let rel = rel.trim_start_matches(['/', '\\']).replace('\\', "/");
        let abs = root.join(&rel);
        let name = abs
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let is_md = Path::new(&name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
        let existing: Option<i64> = lock(&conn)
            .query_row("SELECT id FROM files WHERE path = ?1", [&rel], |r| r.get(0))
            .optional()?;
        let meta = fs::metadata(&abs).ok().filter(|m| m.is_file());
        match meta {
            Some(meta) if is_md && !name.starts_with('.') => {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos() as i64)
                    .unwrap_or_default();
                let body = String::from_utf8_lossy(&fs::read(&abs)?).into_owned();
                let title = name[..name.len() - ".md".len()].to_string();
                store_note(&lock(&conn), existing, &rel, mtime, &title, &body);
            }
            _ => {
                if let Some(id) = existing {
                    delete_note(&lock(&conn), id);
                }
            }
        }
        self.notify_indexed();
        Ok(())
    }

    /// Links whose target has the file name of `path` (case-insensitive, without
    /// extension), from every indexed note, ordered by source, line and position.
    pub fn backlinks(&self, path: &str) -> Result<Vec<LinkRef>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let conn = lock(&conn);
        let mut stmt = conn.prepare(
            "SELECT f.path, l.target, l.kind, l.line, l.context
             FROM links l JOIN files f ON f.id = l.src_id
             WHERE l.target_key = ?1
             ORDER BY f.path, l.line, l.rowid",
        )?;
        let rows = stmt.query_map([target_key(path)], |r| {
            Ok(LinkRef {
                source: r.get(0)?,
                target: r.get(1)?,
                kind: LinkKind::parse(&r.get::<_, String>(2)?),
                line: r.get(3)?,
                context: r.get(4)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Notes whose text contains `phrase` as a phrase (unlinked mentions of a note
    /// title), with highlighted snippets, up to `limit`.
    pub fn mentions(&self, phrase: &str, limit: usize) -> Result<Vec<SearchResult>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let phrase = phrase.trim();
        if phrase.is_empty() {
            return Ok(Vec::new());
        }
        let query = format!("body : \"{}\"", phrase.replace('"', "\"\""));
        let conn = lock(&conn);
        let mut stmt = conn.prepare(
            "SELECT f.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 12)
             FROM notes_fts n
             JOIN files f ON f.id = n.rowid
             WHERE notes_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit as i64], |r| {
            Ok(SearchResult {
                path: r.get(0)?,
                title: r.get(1)?,
                snippet: r.get(2)?,
            })
        })?;
        Ok(rows.flatten().collect())
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
            delete_note(&lock(conn), id);
        }
        Ok(())
    }

    /// Full-text search (FTS5 MATCH), returning up to `limit` results ranked by
    /// relevance, with snippets highlighted using `**`. `tag:name` tokens keep only
    /// notes with that tag (or a nested `name/...` tag); a query of tags alone lists
    /// those notes by path, without snippets.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let filters = parse_filters(query);
        let text = filters
            .text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if filters.tags.is_empty() && filters.folders.is_empty() && text.is_empty() {
            return Ok(Vec::new());
        }
        let limit = if limit == 0 { 20 } else { limit };

        let mut args: Vec<Value> = Vec::new();
        let tag_sql = filter_sql(&filters, &mut args);
        let sql = if text.is_empty() {
            format!(
                "SELECT f.path, n.title, ''
                 FROM files f JOIN notes_fts n ON n.rowid = f.id
                 WHERE 1 = 1{tag_sql}
                 ORDER BY f.path
                 LIMIT ?"
            )
        } else {
            args.insert(0, Value::Text(fts_query(&text)));
            format!(
                "SELECT f.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 10)
                 FROM notes_fts n
                 JOIN files f ON f.id = n.rowid
                 WHERE notes_fts MATCH ?{tag_sql}
                 ORDER BY rank
                 LIMIT ?"
            )
        };
        args.push(Value::Integer(limit as i64));

        let conn = lock(&conn);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), |r| {
            Ok(SearchResult {
                path: r.get(0)?,
                title: r.get(1)?,
                snippet: r.get(2)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Exact search (case-sensitive and/or regex) through the notes matching the
    /// query's `tag:` / `path:` filters, line by line. Errors on an invalid or
    /// empty-matching pattern. Results are capped (see `truncated`).
    pub fn grep(&self, query: &str, opts: GrepOptions) -> Result<GrepResult> {
        let (root, conn) = self.snapshot().ok_or_else(not_open)?;
        let filters = parse_filters(query);
        let re = build_pattern(filters.text.trim(), opts)?;
        let paths = candidate_paths(&lock(&conn), &filters)?;

        let mut files = Vec::new();
        let mut lines_left = GREP_MAX_LINES;
        let mut truncated = false;
        for path in paths {
            let Ok(data) = fs::read(root.join(&path)) else {
                continue;
            };
            let text = String::from_utf8_lossy(&data);
            let max = GREP_MAX_LINES_PER_FILE.min(lines_left);
            let (lines, total, matching_lines) = grep_text(&re, &text, max);
            if total == 0 {
                continue;
            }
            if files.len() == GREP_MAX_FILES || lines_left == 0 {
                truncated = true;
                break;
            }
            truncated |= matching_lines > lines.len();
            lines_left -= lines.len();
            files.push(FileMatches { path, lines, total });
        }
        Ok(GrepResult { files, truncated })
    }

    /// Every tag in the vault with its note count, sorted by tag.
    pub fn all_tags(&self) -> Result<Vec<TagCount>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let conn = lock(&conn);
        let mut stmt = conn.prepare("SELECT tag, COUNT(*) FROM tags GROUP BY tag ORDER BY tag")?;
        let rows = stmt.query_map([], |r| {
            Ok(TagCount {
                tag: r.get(0)?,
                count: r.get(1)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Notes with `tag` or a tag nested under it (`tag/...`), sorted by path.
    pub fn notes_with_tag(&self, tag: &str) -> Result<Vec<String>> {
        let (_, conn) = self.snapshot().ok_or_else(not_open)?;
        let Some(tag) = normalize_tag(tag) else {
            return Ok(Vec::new());
        };
        let conn = lock(&conn);
        let mut stmt = conn.prepare(
            "SELECT DISTINCT f.path FROM tags t JOIN files f ON f.id = t.src_id
             WHERE t.tag = ?1 OR t.tag LIKE ?2 ESCAPE '\\'
             ORDER BY f.path",
        )?;
        let rows = stmt.query_map(params![tag, format!("{}/%", escape_like(&tag))], |r| {
            r.get(0)
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

/// Writes a note's text and links to the index, keeping its rowid when it was
/// already indexed. Errors on single statements are ignored, like the rest of
/// the crawl: one bad note must not stop indexing.
fn store_note(
    conn: &Connection,
    existing: Option<i64>,
    rel: &str,
    mtime: i64,
    title: &str,
    body: &str,
) {
    let id = match existing {
        Some(id) => {
            let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", [id]);
            let _ = conn.execute("DELETE FROM links WHERE src_id = ?1", [id]);
            let _ = conn.execute("DELETE FROM tags WHERE src_id = ?1", [id]);
            let _ = conn.execute(
                "UPDATE files SET mtime = ?1 WHERE id = ?2",
                params![mtime, id],
            );
            id
        }
        None => {
            if conn
                .execute(
                    "INSERT INTO files(path, mtime) VALUES (?1, ?2)",
                    params![rel, mtime],
                )
                .is_err()
            {
                return;
            }
            conn.last_insert_rowid()
        }
    };
    let _ = conn.execute(
        "INSERT INTO notes_fts(rowid, title, body) VALUES (?1, ?2, ?3)",
        params![id, title, body],
    );
    for tag in extract_tags(body) {
        let _ = conn.execute(
            "INSERT INTO tags(src_id, tag) VALUES (?1, ?2)",
            params![id, tag],
        );
    }
    for link in extract_links(body) {
        let _ = conn.execute(
            "INSERT INTO links(src_id, target, target_key, kind, line, context)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                link.target,
                target_key(&link.target),
                link.kind.as_str(),
                link.line,
                link.context
            ],
        );
    }
}

/// Removes a note, its links and its tags from the index.
fn delete_note(conn: &Connection, id: i64) {
    let _ = conn.execute("DELETE FROM tags WHERE src_id = ?1", [id]);
    let _ = conn.execute("DELETE FROM links WHERE src_id = ?1", [id]);
    let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", [id]);
    let _ = conn.execute("DELETE FROM files WHERE id = ?1", [id]);
}

/// Splits a search query into `tag:name` and `path:folder` filters (invalid tags
/// and empty folders are dropped) and the remaining text, which keeps its spacing.
pub fn parse_filters(query: &str) -> SearchFilters {
    let mut filters = SearchFilters::default();
    let mut text = String::with_capacity(query.len());
    let mut rest = query;
    while !rest.is_empty() {
        // Copy whitespace as is, then look at the next token.
        let ws = rest.len() - rest.trim_start().len();
        text.push_str(&rest[..ws]);
        rest = &rest[ws..];
        let mut end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let token = &rest[..end];
        let lower = token.to_lowercase();
        // `get` instead of slicing: a token may start with multi-byte characters.
        let is_path = token
            .get(..5)
            .is_some_and(|p| p.eq_ignore_ascii_case("path:"));
        if let Some(tag) = lower.strip_prefix("tag:") {
            filters.tags.extend(normalize_tag(tag));
        } else if is_path && token.len() > 5 {
            // path:"My Notes" / path:'My Notes' for folder names with spaces. An
            // unclosed quote (still typing) takes the rest of the query.
            let value = &rest[5..];
            let raw = match value.chars().next() {
                Some(q @ ('"' | '\'')) => {
                    let inner = &value[1..];
                    match inner.find(q) {
                        Some(close) => {
                            end = 5 + 1 + close + 1;
                            &inner[..close]
                        }
                        None => {
                            end = rest.len();
                            inner
                        }
                    }
                }
                _ => &token[5..],
            };
            let folder = raw.trim().replace('\\', "/").trim_matches('/').to_string();
            if !folder.is_empty() {
                filters.folders.push(folder);
            }
        } else {
            text.push_str(token);
        }
        rest = &rest[end..];
    }
    filters.text = text.trim().to_string();
    filters
}

/// SQL conditions (" AND ...") for the tag and folder filters, on `files f`, with
/// their arguments appended to `args`.
fn filter_sql(filters: &SearchFilters, args: &mut Vec<Value>) -> String {
    let mut sql = String::new();
    for tag in &filters.tags {
        sql.push_str(
            " AND f.id IN (SELECT src_id FROM tags WHERE tag = ? OR tag LIKE ? ESCAPE '\\')",
        );
        args.push(Value::Text(tag.clone()));
        args.push(Value::Text(format!("{}/%", escape_like(tag))));
    }
    if !filters.folders.is_empty() {
        let parts: Vec<_> = filters
            .folders
            .iter()
            .map(|folder| {
                args.push(Value::Text(format!("{}/%", escape_like(folder))));
                "f.path LIKE ? ESCAPE '\\'"
            })
            .collect();
        sql.push_str(&format!(" AND ({})", parts.join(" OR ")));
    }
    sql
}

/// Indexed notes matching the tag and folder filters, sorted by path.
fn candidate_paths(conn: &Connection, filters: &SearchFilters) -> Result<Vec<String>> {
    let mut args = Vec::new();
    let sql = format!(
        "SELECT f.path FROM files f WHERE 1 = 1{} ORDER BY f.path",
        filter_sql(filters, &mut args)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), |r| r.get(0))?;
    Ok(rows.flatten().collect())
}

/// Escapes `%`, `_` and `\` for a LIKE pattern used with `ESCAPE '\'`.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
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
    fn backlinks_follow_edits_renames_and_deletes() {
        let t = new_search();
        let root = t.vault.path();
        write_note(root, "target.md", "# Target");
        write_note(
            root,
            "a.md",
            "intro\nsee [[Target]] here\n```\n[[Target]] in code\n```",
        );
        write_note(
            root,
            "dir/b.md",
            "[t](../target.md) and [[TARGET#Sec|alias]]",
        );
        write_note(root, "c.md", "[[Other]]");
        t.svc.reindex().unwrap();

        let refs = t.svc.backlinks("target.md").unwrap();
        let got: Vec<_> = refs
            .iter()
            .map(|r| (r.source.as_str(), r.target.as_str(), r.kind, r.line))
            .collect();
        assert_eq!(
            got,
            vec![
                ("a.md", "Target", LinkKind::Wiki, 2),
                // Same line: wiki links are extracted before Markdown links.
                ("dir/b.md", "TARGET", LinkKind::Wiki, 1),
                ("dir/b.md", "../target.md", LinkKind::Markdown, 1),
            ]
        );
        assert_eq!(refs[0].context, "see [[Target]] here");

        // An edit picked up by reindex_file (the app's own saves).
        write_note(root, "c.md", "now [[target]] too");
        t.svc.reindex_file("c.md").unwrap();
        assert_eq!(t.svc.backlinks("target.md").unwrap().len(), 4);

        // Deleting a source removes its links.
        fs::remove_file(root.join("a.md")).unwrap();
        t.svc.reindex_file("a.md").unwrap();
        let sources: Vec<_> = t
            .svc
            .backlinks("target.md")
            .unwrap()
            .into_iter()
            .map(|r| r.source)
            .collect();
        assert_eq!(sources, ["c.md", "dir/b.md", "dir/b.md"]);
    }

    #[test]
    fn tags_are_indexed_listed_and_searchable() {
        let t = new_search();
        let root = t.vault.path();
        write_note(root, "a.md", "#Work planning for #work/q3 with apples");
        write_note(root, "b.md", "---\ntags: [work, home]\n---\napples too");
        write_note(root, "c.md", "#home only, no fruit");
        write_note(root, "d.md", "#a_b and #axb/c");
        t.svc.reindex().unwrap();

        let tags: Vec<_> = t
            .svc
            .all_tags()
            .unwrap()
            .into_iter()
            .map(|t| (t.tag, t.count))
            .collect();
        assert_eq!(
            tags,
            vec![
                ("a_b".into(), 1),
                ("axb/c".into(), 1),
                ("home".into(), 2),
                ("work".into(), 2),
                ("work/q3".into(), 1),
            ]
        );
        // Nested tags count for their parent.
        assert_eq!(t.svc.notes_with_tag("Work").unwrap(), ["a.md", "b.md"]);
        assert_eq!(t.svc.notes_with_tag("work/q3").unwrap(), ["a.md"]);
        // "_" is not a LIKE wildcard here: "a_b/%" must not match "axb/c".
        assert_eq!(t.svc.notes_with_tag("a_b").unwrap(), ["d.md"]);

        let paths = |q: &str| -> Vec<String> {
            t.svc
                .search(q, 10)
                .unwrap()
                .into_iter()
                .map(|r| r.path)
                .collect()
        };
        assert_eq!(paths("tag:home"), ["b.md", "c.md"]);
        assert_eq!(paths("tag:work apples").len(), 2);
        assert_eq!(paths("apples tag:home"), ["b.md"]);
        assert_eq!(paths("tag:work tag:home"), ["b.md"]);
        assert!(paths("tag:nope").is_empty());
        // An invalid tag filter is dropped, leaving no query at all.
        assert!(paths("tag:123").is_empty());

        // Re-indexing a note replaces its tags.
        write_note(root, "c.md", "no tags now");
        t.svc.reindex_file("c.md").unwrap();
        assert_eq!(t.svc.notes_with_tag("home").unwrap(), ["b.md"]);
    }

    #[test]
    fn parse_filters_keeps_text_spacing() {
        let f = parse_filters("tag:Work  a  b path:/notes/2024/ PATH:x\\y tag:123");
        assert_eq!(f.tags, ["work"]);
        assert_eq!(f.folders, ["notes/2024", "x/y"]);
        assert_eq!(f.text, "a  b");
        assert_eq!(parse_filters("path:").text, "path:");
    }

    #[test]
    fn parse_filters_quoted_folders_and_unicode() {
        let f = parse_filters(r#"meeting path:"My Notes/2024" path:'Dự án' notes"#);
        assert_eq!(f.folders, ["My Notes/2024", "Dự án"]);
        // Filters are removed in place; the spaces around them stay.
        assert_eq!(f.text, "meeting   notes");
        // Unclosed quote while typing: the rest of the query is the folder.
        assert_eq!(
            parse_filters(r#"x path:"Work in prog"#).folders,
            ["Work in prog"]
        );
        // Multi-byte characters at the start of a token must not panic.
        let f = parse_filters("aaaệ ệệ path:ý tag:ý");
        assert_eq!(f.text, "aaaệ ệệ");
        assert_eq!(f.folders, ["ý"]);
        assert_eq!(f.tags, ["ý"]);
    }

    #[test]
    fn folder_filter_and_grep() {
        let t = new_search();
        let root = t.vault.path();
        write_note(root, "a.md", "Alpha line\nalpha again");
        write_note(root, "notes/b.md", "ALPHA beta\nnothing");
        write_note(root, "notes_x/c.md", "alpha in a sibling folder");
        t.svc.reindex().unwrap();

        let fts: Vec<_> = t
            .svc
            .search("alpha path:notes", 10)
            .unwrap()
            .into_iter()
            .map(|r| r.path)
            .collect();
        assert_eq!(fts, ["notes/b.md"], "notes_x is not inside notes");

        let opts = GrepOptions {
            case_sensitive: true,
            regex: false,
            whole_word: false,
        };
        let res = t.svc.grep("alpha", opts).unwrap();
        let got: Vec<_> = res
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.total, f.lines.len()))
            .collect();
        assert_eq!(got, vec![("a.md", 1, 1), ("notes_x/c.md", 1, 1)]);
        assert!(!res.truncated);

        let rx = GrepOptions {
            case_sensitive: false,
            regex: true,
            whole_word: false,
        };
        let res = t.svc.grep("path:notes al.ha\\s+\\w+", rx).unwrap();
        assert_eq!(res.files.len(), 1);
        assert_eq!(res.files[0].lines[0].line, 1);
        assert!(t.svc.grep("(", rx).is_err());
    }

    #[test]
    fn mentions_match_the_phrase() {
        let t = new_search();
        write_note(
            t.vault.path(),
            "a.md",
            "We discussed the Project Roadmap today.",
        );
        write_note(t.vault.path(), "b.md", "project notes and a roadmap, apart");
        t.svc.reindex().unwrap();
        let found: Vec<_> = t
            .svc
            .mentions("Project Roadmap", 10)
            .unwrap()
            .into_iter()
            .map(|r| r.path)
            .collect();
        assert_eq!(found, ["a.md"]);
        assert!(
            t.svc.mentions("say \"hi\"", 10).is_ok(),
            "quotes must be escaped"
        );
    }

    #[test]
    fn old_index_without_links_is_rebuilt() {
        let cache = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        write_note(vault.path(), "a.md", "[[B]]");
        let svc = SearchService::with_index_dir(Some(cache.path().to_path_buf()));
        svc.open(vault.path()).unwrap();
        svc.reindex().unwrap();
        // Simulate an index from before links existed: no links, old version.
        {
            let (_, conn) = svc.snapshot().unwrap();
            let conn = lock(&conn);
            conn.execute_batch("DELETE FROM links; PRAGMA user_version = 0;")
                .unwrap();
        }
        svc.open(vault.path()).unwrap();
        svc.reindex().unwrap();
        assert_eq!(svc.backlinks("b.md").unwrap().len(), 1);
    }

    #[test]
    fn on_indexed_runs_after_reindex_and_reindex_file() {
        use std::sync::atomic::AtomicUsize;
        let t = new_search();
        let count = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&count);
        t.svc.set_on_indexed(Arc::new(move || {
            c.fetch_add(1, Ordering::SeqCst);
        }));
        write_note(t.vault.path(), "a.md", "x");
        t.svc.reindex().unwrap();
        t.svc.reindex_file("a.md").unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
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
