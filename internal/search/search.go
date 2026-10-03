// Package search implements SearchService: full-text indexing of .md files in the
// Vault using SQLite FTS5 (modernc.org/sqlite, pure Go, no CGO required), powering
// Quick Switcher (fuzzy filename search) and Global Search (full-text with snippet
// extraction and keyword highlighting).
package search

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/sahilm/fuzzy"
	_ "modernc.org/sqlite"
)

// Result represents a full-text search match, including a highlighted contextual snippet.
type Result struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

// Service manages the SQLite FTS5 index for a Vault. The index database is stored
// outside the Vault (in the user cache directory) to avoid bloating or polluting Git sync in Phase 4.
type Service struct {
	mu     sync.RWMutex
	root   string
	db     *sql.DB
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// New creates a Service with no index open.
func New() *Service {
	return &Service{}
}

// indexFilePath calculates the SQLite index file path for a Vault based on a hash
// of the Vault root path, ensuring isolated and persistent indexes across runs.
func indexFilePath(vaultRoot string) (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cacheDir, "logledge", "index")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(vaultRoot))
	return filepath.Join(dir, hex.EncodeToString(sum[:8])+".sqlite"), nil
}

// Open opens (or creates if missing) the SQLite index for the Vault at root.
func (s *Service) Open(root string) error {
	_ = s.Close()

	p, err := indexFilePath(root)
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", p+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return err
	}
	// SQLite allows only 1 writer at a time; restrict to 1 connection to
	// prevent "database is locked" errors when concurrent goroutines write.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS files (
			id    INTEGER PRIMARY KEY,
			path  TEXT UNIQUE NOT NULL,
			mtime INTEGER NOT NULL
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body);
	`); err != nil {
		_ = db.Close()
		return err
	}

	s.mu.Lock()
	s.root = root
	s.db = db
	s.mu.Unlock()
	return nil
}

// Close terminates the SQLite connection for the current index and cancels any active indexing.
func (s *Service) Close() error {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	s.wg.Wait()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	s.root = ""
	return err
}

// Reindex traverses the Vault, re-indexing only .md files whose mtime has
// changed since the last index run, and purging files that no longer exist on disk.
// Safe for concurrent/repeated invocations (redundant calls are safely cancelled/sequenced).
func (s *Service) Reindex() error {
	s.mu.Lock()
	if s.db == nil || s.root == "" {
		s.mu.Unlock()
		return errors.New("search chưa mở index nào")
	}

	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.mu.Unlock()

	s.wg.Wait()

	s.mu.Lock()
	if s.db == nil || s.root == "" {
		s.mu.Unlock()
		return errors.New("search chưa mở index nào")
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	db := s.db
	root := s.root
	s.wg.Add(1)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		cancel()
		if s.cancel != nil {
			s.cancel = nil
		}
		s.mu.Unlock()
		s.wg.Done()
	}()

	seen := make(map[string]bool)
	err := filepath.WalkDir(root, func(abs string, d os.DirEntry, err error) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err != nil {
			return nil // skip erroneous entries without failing entire crawl
		}
		name := d.Name()
		if d.IsDir() {
			if strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") || !strings.EqualFold(filepath.Ext(name), ".md") {
			return nil
		}

		rel, err := filepath.Rel(root, abs)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		seen[rel] = true

		info, err := d.Info()
		if err != nil {
			return nil
		}
		mtime := info.ModTime().UnixNano()

		var id, existingMtime int64
		row := db.QueryRowContext(ctx, `SELECT id, mtime FROM files WHERE path = ?`, rel)
		scanErr := row.Scan(&id, &existingMtime)
		if scanErr == nil && existingMtime == mtime {
			return nil // unchanged since previous index run
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		data, err := os.ReadFile(abs)
		if err != nil {
			return nil
		}
		title := strings.TrimSuffix(name, filepath.Ext(name))
		body := string(data)

		if scanErr == nil {
			// File exists in index; update contents while preserving rowid.
			if _, err := db.ExecContext(ctx, `INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)`, id, title, body); err != nil {
				// In case of rowid collision in legacy index, delete and re-insert.
				_, _ = db.ExecContext(ctx, `DELETE FROM notes_fts WHERE rowid = ?`, id)
				_, _ = db.ExecContext(ctx, `INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)`, id, title, body)
			}
			_, _ = db.ExecContext(ctx, `UPDATE files SET mtime = ? WHERE id = ?`, mtime, id)
		} else {
			res, err := db.ExecContext(ctx, `INSERT INTO files(path, mtime) VALUES (?, ?)`, rel, mtime)
			if err != nil {
				return nil
			}
			newID, err := res.LastInsertId()
			if err != nil {
				return nil
			}
			_, _ = db.ExecContext(ctx, `INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)`, newID, title, body)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}

	return s.removeStale(ctx, db, seen)
}

// removeStale removes files from the index that were deleted or renamed on disk
// (no longer present in the `seen` set from the latest crawl).
func (s *Service) removeStale(ctx context.Context, db *sql.DB, seen map[string]bool) error {
	if ctx.Err() != nil {
		return nil
	}

	rows, err := db.QueryContext(ctx, `SELECT id, path FROM files`)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	defer rows.Close()

	type staleEntry struct {
		id   int64
		path string
	}
	var stale []staleEntry
	for rows.Next() {
		if ctx.Err() != nil {
			return nil
		}
		var e staleEntry
		if err := rows.Scan(&e.id, &e.path); err != nil {
			continue
		}
		if !seen[e.path] {
			stale = append(stale, e)
		}
	}
	_ = rows.Close()

	for _, e := range stale {
		if ctx.Err() != nil {
			return nil
		}
		_, _ = db.ExecContext(ctx, `DELETE FROM notes_fts WHERE rowid = ?`, e.id)
		_, _ = db.ExecContext(ctx, `DELETE FROM files WHERE id = ?`, e.id)
	}
	return nil
}

// Search executes a full-text query (FTS5 MATCH) across the Vault, returning up
// to `limit` results with contextual snippets highlighted with ** ** delimiters.
func (s *Service) Search(query string, limit int) ([]Result, error) {
	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	if db == nil {
		return nil, errors.New("search chưa mở index nào")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}

	rows, err := db.Query(`
		SELECT f.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 10) AS snip
		FROM notes_fts n
		JOIN files f ON f.id = n.rowid
		WHERE notes_fts MATCH ?
		ORDER BY rank
		LIMIT ?`, ftsQuery(query), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Result
	for rows.Next() {
		var r Result
		if err := rows.Scan(&r.Path, &r.Title, &r.Snippet); err != nil {
			continue
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// ftsQuery quotes each token with double quotes and joins them using FTS5's implicit AND,
// while appending prefix wildcards to support search-as-you-type.
func ftsQuery(query string) string {
	fields := strings.Fields(query)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		fields[i] = `"` + f + `"*`
	}
	return strings.Join(fields, " ")
}

// QuickSwitch performs fuzzy filename matching (Ctrl+P), returning up to `limit`
// relative paths sorted by match quality descending.
func (s *Service) QuickSwitch(query string, limit int) ([]string, error) {
	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	if db == nil {
		return nil, errors.New("search chưa mở index nào")
	}
	if limit <= 0 {
		limit = 20
	}

	rows, err := db.Query(`SELECT path FROM files ORDER BY path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			continue
		}
		paths = append(paths, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	query = strings.TrimSpace(query)
	if query == "" {
		if len(paths) > limit {
			paths = paths[:limit]
		}
		return paths, nil
	}

	matches := fuzzy.Find(query, paths)
	var out []string
	for i, m := range matches {
		if i >= limit {
			break
		}
		out = append(out, m.Str)
	}
	return out, nil
}
