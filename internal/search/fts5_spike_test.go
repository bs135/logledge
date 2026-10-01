package search

// Spike: xác nhận modernc.org/sqlite (pure Go, no CGO) hỗ trợ FTS5.
// Đây là giả định rủi ro cao được nêu trong plan.md (Phase 0) — nếu test này
// pass, SearchService ở Phase 3 có thể dựa vào FTS5 mà không cần CGO.

import (
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestFTS5Available(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	// Nếu FTS5 không được build vào modernc.org/sqlite, câu lệnh CREATE VIRTUAL
	// TABLE ... USING fts5 sẽ trả lỗi "no such module: fts5".
	_, err = db.Exec(`CREATE VIRTUAL TABLE notes_fts USING fts5(path, title, body)`)
	if err != nil {
		t.Fatalf("FTS5 not available in modernc.org/sqlite: %v", err)
	}

	_, err = db.Exec(`INSERT INTO notes_fts(path, title, body) VALUES
		('/vault/hello.md', 'Hello World', 'This is a test note about golang and wails'),
		('/vault/other.md', 'Other Note', 'Nothing interesting here')`)
	if err != nil {
		t.Fatalf("insert into fts5 table: %v", err)
	}

	rows, err := db.Query(`SELECT path, snippet(notes_fts, 2, '[', ']', '...', 8)
		FROM notes_fts WHERE notes_fts MATCH 'golang' ORDER BY rank`)
	if err != nil {
		t.Fatalf("fts5 match query: %v", err)
	}
	defer rows.Close()

	var got []string
	var snippets []string
	for rows.Next() {
		var path, snippet string
		if err := rows.Scan(&path, &snippet); err != nil {
			t.Fatalf("scan row: %v", err)
		}
		got = append(got, path)
		snippets = append(snippets, snippet)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows iteration: %v", err)
	}

	if len(got) != 1 || got[0] != "/vault/hello.md" {
		t.Fatalf("expected exactly one match for 'golang' at /vault/hello.md, got %v", got)
	}
	if !strings.Contains(snippets[0], "[golang]") {
		t.Fatalf("expected highlighted snippet to contain [golang], got %q", snippets[0])
	}
}
