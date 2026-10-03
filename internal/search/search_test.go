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
	// Index is stored in the system cache directory; isolate via environment
	// variables so tests do not touch actual cache and have isolated indexes.
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

	// Modify content: sleep briefly to ensure mtime changes so Reindex detects the update.
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

func TestConcurrentReindexAndOpenVault(t *testing.T) {
	svc, root1 := newTestSearch(t)
	root2 := t.TempDir()

	for i := 0; i < 20; i++ {
		writeNote(t, root1, filepath.Join("notes", strings.Repeat("a", i+1)+".md"), "content about golang testing")
		writeNote(t, root2, filepath.Join("notes", strings.Repeat("b", i+1)+".md"), "content about second vault notes")
	}

	// Concurrently trigger reindex while opening and switching vaults repeatedly
	done := make(chan struct{})
	go func() {
		for i := 0; i < 10; i++ {
			_ = svc.Reindex()
			time.Sleep(2 * time.Millisecond)
		}
		close(done)
	}()

	for i := 0; i < 5; i++ {
		target := root1
		if i%2 == 1 {
			target = root2
		}
		if err := svc.Open(target); err != nil {
			t.Fatalf("Open during concurrent reindex failed: %v", err)
		}
		time.Sleep(3 * time.Millisecond)
	}
	<-done

	// Verify service is still usable
	if err := svc.Reindex(); err != nil {
		t.Fatalf("Reindex after concurrent test failed: %v", err)
	}
	res, err := svc.Search("vault", 10)
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	_ = res
}

