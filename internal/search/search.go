// Package search triển khai SearchService: index toàn văn các file .md trong
// Vault bằng SQLite FTS5 (modernc.org/sqlite, pure Go, không cần CGO), phục
// vụ Quick Switcher (fuzzy theo tên file) và Global Search (toàn văn có
// snippet + highlight).
package search

import (
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

// Result là một kết quả tìm kiếm toàn văn, kèm trích dẫn ngữ cảnh đã highlight.
type Result struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

// Service quản lý index FTS5 của một Vault. Index được lưu ngoài Vault (trong
// user cache dir), tránh làm phình/kẹt kho Git đồng bộ ở Phase 4.
type Service struct {
	root string
	db   *sql.DB

	mu       sync.Mutex
	indexing bool
}

// New tạo Service chưa mở index nào.
func New() *Service {
	return &Service{}
}

// indexFilePath tính đường dẫn file SQLite index cho một Vault, dựa trên hash
// của đường dẫn Vault để mỗi Vault có index riêng biệt, ổn định giữa các lần chạy.
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

// Open mở (tạo mới nếu chưa có) index SQLite cho Vault tại root.
func (s *Service) Open(root string) error {
	if s.db != nil {
		_ = s.db.Close()
		s.db = nil
	}

	p, err := indexFilePath(root)
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", p+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return err
	}
	// SQLite chỉ cho phép 1 writer tại 1 thời điểm; giới hạn 1 connection để
	// tránh lỗi "database is locked" khi nhiều goroutine cùng ghi.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS files (
			id    INTEGER PRIMARY KEY,
			path  TEXT UNIQUE NOT NULL,
			mtime INTEGER NOT NULL
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body);
	`); err != nil {
		db.Close()
		return err
	}

	s.root = root
	s.db = db
	return nil
}

// Close đóng kết nối SQLite của index hiện tại.
func (s *Service) Close() error {
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

// Reindex quét toàn bộ Vault, chỉ index lại (ghi) các file .md có mtime thay
// đổi so với lần index trước, và gỡ khỏi index các file không còn tồn tại.
// An toàn để gọi nhiều lần / đồng thời (lượt gọi trùng sẽ bị bỏ qua).
func (s *Service) Reindex() error {
	s.mu.Lock()
	if s.indexing {
		s.mu.Unlock()
		return nil
	}
	s.indexing = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.indexing = false
		s.mu.Unlock()
	}()

	if s.db == nil {
		return errors.New("search chưa mở index nào")
	}

	seen := make(map[string]bool)
	err := filepath.WalkDir(s.root, func(abs string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // bỏ qua entry lỗi, không fail cả lượt quét
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

		rel, err := filepath.Rel(s.root, abs)
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
		row := s.db.QueryRow(`SELECT id, mtime FROM files WHERE path = ?`, rel)
		scanErr := row.Scan(&id, &existingMtime)
		if scanErr == nil && existingMtime == mtime {
			return nil // không đổi kể từ lần index trước
		}

		data, err := os.ReadFile(abs)
		if err != nil {
			return nil
		}
		title := strings.TrimSuffix(name, filepath.Ext(name))
		body := string(data)

		if scanErr == nil {
			// File đã có trong index, cập nhật lại (giữ nguyên rowid).
			if _, err := s.db.Exec(`INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)`, id, title, body); err != nil {
				// Có thể do đã tồn tại rowid (index cũ), xoá rồi ghi lại.
				s.db.Exec(`DELETE FROM notes_fts WHERE rowid = ?`, id)
				s.db.Exec(`INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)`, id, title, body)
			}
			s.db.Exec(`UPDATE files SET mtime = ? WHERE id = ?`, mtime, id)
		} else {
			res, err := s.db.Exec(`INSERT INTO files(path, mtime) VALUES (?, ?)`, rel, mtime)
			if err != nil {
				return nil
			}
			newID, err := res.LastInsertId()
			if err != nil {
				return nil
			}
			s.db.Exec(`INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)`, newID, title, body)
		}
		return nil
	})
	if err != nil {
		return err
	}

	return s.removeStale(seen)
}

// removeStale gỡ khỏi index các file đã bị xoá/đổi tên trên đĩa (không còn
// xuất hiện trong lượt quét `seen` vừa rồi).
func (s *Service) removeStale(seen map[string]bool) error {
	rows, err := s.db.Query(`SELECT id, path FROM files`)
	if err != nil {
		return err
	}
	type staleEntry struct {
		id   int64
		path string
	}
	var stale []staleEntry
	for rows.Next() {
		var e staleEntry
		if err := rows.Scan(&e.id, &e.path); err != nil {
			continue
		}
		if !seen[e.path] {
			stale = append(stale, e)
		}
	}
	rows.Close()

	for _, e := range stale {
		s.db.Exec(`DELETE FROM notes_fts WHERE rowid = ?`, e.id)
		s.db.Exec(`DELETE FROM files WHERE id = ?`, e.id)
	}
	return nil
}

// Search thực hiện tìm kiếm toàn văn (FTS5 MATCH) trên toàn bộ Vault, trả về
// tối đa `limit` kết quả kèm snippet đã highlight từ khoá bằng cặp ** **.
func (s *Service) Search(query string, limit int) ([]Result, error) {
	if s.db == nil {
		return nil, errors.New("search chưa mở index nào")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}

	rows, err := s.db.Query(`
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

// ftsQuery bọc mỗi từ bằng dấu "" và nối bằng AND ngầm định của FTS5, đồng
// thời cho phép match theo tiền tố (prefix) để tìm kiếm "gõ tới đâu ra tới đó".
func ftsQuery(query string) string {
	fields := strings.Fields(query)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		fields[i] = `"` + f + `"*`
	}
	return strings.Join(fields, " ")
}

// QuickSwitch tìm fuzzy theo tên file (Ctrl+P), trả về tối đa `limit` đường
// dẫn tương đối được sắp xếp theo độ khớp giảm dần.
func (s *Service) QuickSwitch(query string, limit int) ([]string, error) {
	if s.db == nil {
		return nil, errors.New("search chưa mở index nào")
	}
	if limit <= 0 {
		limit = 20
	}

	rows, err := s.db.Query(`SELECT path FROM files ORDER BY path`)
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
