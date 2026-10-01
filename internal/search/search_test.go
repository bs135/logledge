package search

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestSearch(t *testing.T) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	// Index lưu theo user cache dir thật của máy test; cô lập bằng biến môi
	// trường để không đụng tới cache thật và để mỗi test có index riêng.
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())

	svc := New()
	if err := svc.Open(root); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc, root
}

func writeNote(t *testing.T, root, rel, content string) {
	t.Helper()
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}
}

func TestReindexAndSearch(t *testing.T) {
	svc, root := newTestSearch(t)
	writeNote(t, root, "hello.md", "# Hello\nThis note talks about golang and wails development.")
	writeNote(t, root, "other.md", "# Other\nNothing related here.")

	if err := svc.Reindex(); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	results, err := svc.Search("golang", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 1 || results[0].Path != "hello.md" {
		t.Fatalf("expected 1 result hello.md, got %+v", results)
	}
	if !strings.Contains(results[0].Snippet, "**golang**") {
		t.Fatalf("expected highlighted snippet, got %q", results[0].Snippet)
	}
}

func TestReindexPicksUpChangesAndDeletions(t *testing.T) {
	svc, root := newTestSearch(t)
	writeNote(t, root, "note.md", "original content about apples")
	if err := svc.Reindex(); err != nil {
		t.Fatalf("Reindex: %v", err)
	}
	if results, _ := svc.Search("apples", 10); len(results) != 1 {
		t.Fatalf("expected to find 'apples' before edit, got %+v", results)
	}

	// Sửa nội dung: cần bảo đảm mtime khác đi để Reindex phát hiện thay đổi.
	time.Sleep(10 * time.Millisecond)
	writeNote(t, root, "note.md", "updated content about oranges")
	if err := svc.Reindex(); err != nil {
		t.Fatalf("Reindex after edit: %v", err)
	}
	if results, _ := svc.Search("apples", 10); len(results) != 0 {
		t.Fatalf("expected 'apples' to be gone after edit, got %+v", results)
	}
	if results, _ := svc.Search("oranges", 10); len(results) != 1 {
		t.Fatalf("expected to find 'oranges' after edit, got %+v", results)
	}

	if err := os.Remove(filepath.Join(root, "note.md")); err != nil {
		t.Fatalf("remove note: %v", err)
	}
	if err := svc.Reindex(); err != nil {
		t.Fatalf("Reindex after delete: %v", err)
	}
	if results, _ := svc.Search("oranges", 10); len(results) != 0 {
		t.Fatalf("expected no results after file deletion, got %+v", results)
	}
}

func TestQuickSwitchFuzzy(t *testing.T) {
	svc, root := newTestSearch(t)
	writeNote(t, root, "projects/roadmap.md", "")
	writeNote(t, root, "daily/2024-01-01.md", "")
	if err := svc.Reindex(); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	matches, err := svc.QuickSwitch("rdmp", 10)
	if err != nil {
		t.Fatalf("QuickSwitch: %v", err)
	}
	if len(matches) != 1 || matches[0] != "projects/roadmap.md" {
		t.Fatalf("expected fuzzy match on roadmap.md, got %v", matches)
	}
}
