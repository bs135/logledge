package vault

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestService(t *testing.T) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	svc := New(func() {})
	if err := svc.Open(root); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		if svc.watch != nil {
			_ = svc.watch.Close()
		}
	})
	return svc, root
}

func TestCreateFileAddsMdExtension(t *testing.T) {
	svc, root := newTestService(t)

	rel, err := svc.CreateFile("", "note")
	if err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	if rel != "note.md" {
		t.Fatalf("expected note.md, got %q", rel)
	}
	if _, err := os.Stat(filepath.Join(root, "note.md")); err != nil {
		t.Fatalf("file not created on disk: %v", err)
	}
}

func TestCreateFolderAndNestedTree(t *testing.T) {
	svc, _ := newTestService(t)

	if _, err := svc.CreateFolder("", "projects"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := svc.CreateFile("projects", "todo"); err != nil {
		t.Fatalf("CreateFile nested: %v", err)
	}

	tree, err := svc.Tree()
	if err != nil {
		t.Fatalf("Tree: %v", err)
	}
	if len(tree.Children) != 1 || tree.Children[0].Name != "projects" {
		t.Fatalf("expected single 'projects' child, got %+v", tree.Children)
	}
	projects := tree.Children[0]
	if len(projects.Children) != 1 || projects.Children[0].Path != "projects/todo.md" {
		t.Fatalf("expected projects/todo.md, got %+v", projects.Children)
	}
}

func TestTreeHidesDotEntries(t *testing.T) {
	svc, root := newTestService(t)
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	if _, err := svc.CreateFile("", "visible"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	tree, err := svc.Tree()
	if err != nil {
		t.Fatalf("Tree: %v", err)
	}
	if len(tree.Children) != 1 || tree.Children[0].Name != "visible.md" {
		t.Fatalf("expected only visible.md, got %+v", tree.Children)
	}
}

func TestRename(t *testing.T) {
	svc, _ := newTestService(t)
	if _, err := svc.CreateFile("", "old"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	newRel, err := svc.Rename("old.md", "new.md")
	if err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if newRel != "new.md" {
		t.Fatalf("expected new.md, got %q", newRel)
	}
}

func TestMoveIntoFolder(t *testing.T) {
	svc, _ := newTestService(t)
	if _, err := svc.CreateFolder("", "archive"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := svc.CreateFile("", "note"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	newRel, err := svc.Move("note.md", "archive")
	if err != nil {
		t.Fatalf("Move: %v", err)
	}
	if newRel != "archive/note.md" {
		t.Fatalf("expected archive/note.md, got %q", newRel)
	}
}

func TestResolveRejectsPathTraversal(t *testing.T) {
	svc, _ := newTestService(t)
	if _, err := svc.resolve("../outside.md"); err == nil {
		t.Fatal("expected error for path traversal, got nil")
	}
}

func TestReadWriteFile(t *testing.T) {
	svc, _ := newTestService(t)
	rel, err := svc.CreateFile("", "note")
	if err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	if err := svc.WriteFile(rel, "hello world"); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	content, err := svc.ReadFile(rel)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if content != "hello world" {
		t.Fatalf("expected 'hello world', got %q", content)
	}
}

func TestSaveAttachmentReturnsRelativeLink(t *testing.T) {
	svc, root := newTestService(t)
	if _, err := svc.CreateFolder("", "projects"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := svc.CreateFile("projects", "note"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	data := base64.StdEncoding.EncodeToString([]byte("fake-png-bytes"))
	link, err := svc.SaveAttachment("projects/note.md", "screenshot.png", data)
	if err != nil {
		t.Fatalf("SaveAttachment: %v", err)
	}
	if link != "../.attachments/"+filepath.Base(filepath.FromSlash(link)) {
		t.Fatalf("unexpected relative link: %q", link)
	}
	if !strings.HasPrefix(filepath.Base(link), "screenshot-") {
		t.Fatalf("expected filename to be based on original name, got %q", link)
	}

	attachDir := filepath.Join(root, ".attachments")
	entries, err := os.ReadDir(attachDir)
	if err != nil {
		t.Fatalf("read .attachments: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected exactly 1 attachment file, got %d", len(entries))
	}
}

func TestReadAttachmentDataURLResolvesRelativeToNote(t *testing.T) {
	svc, _ := newTestService(t)
	if _, err := svc.CreateFolder("", "projects"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := svc.CreateFile("projects", "note"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	original := "fake-png-bytes"
	data := base64.StdEncoding.EncodeToString([]byte(original))
	link, err := svc.SaveAttachment("projects/note.md", "screenshot.png", data)
	if err != nil {
		t.Fatalf("SaveAttachment: %v", err)
	}

	dataURL, err := svc.ReadAttachmentDataURL("projects/note.md", link)
	if err != nil {
		t.Fatalf("ReadAttachmentDataURL: %v", err)
	}
	if !strings.HasPrefix(dataURL, "data:image/png;base64,") {
		t.Fatalf("unexpected data URL prefix: %q", dataURL)
	}
	encoded := strings.TrimPrefix(dataURL, "data:image/png;base64,")
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode data URL payload: %v", err)
	}
	if string(decoded) != original {
		t.Fatalf("expected %q, got %q", original, string(decoded))
	}
}

func TestReadAttachmentDataURLRejectsPathEscapingVault(t *testing.T) {
	svc, _ := newTestService(t)
	if _, err := svc.CreateFile("", "note"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}

	if _, err := svc.ReadAttachmentDataURL("note.md", "../../etc/passwd"); err == nil {
		t.Fatal("expected error for path escaping the vault root, got nil")
	}
}

func TestWriteFileIfUnchanged(t *testing.T) {
	svc, root := newTestService(t)
	abs := filepath.Join(root, "note.md")
	if err := os.WriteFile(abs, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Disk matches the editor's base version -> saved.
	res, err := svc.WriteFileIfUnchanged("note.md", "v2", "v1")
	if err != nil || !res.Saved {
		t.Fatalf("expected save, got %+v err=%v", res, err)
	}

	// Simulate Git sync replacing the file with a remote version.
	if err := os.WriteFile(abs, []byte("remote"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err = svc.WriteFileIfUnchanged("note.md", "v3", "v2")
	if err != nil {
		t.Fatal(err)
	}
	if res.Saved || res.DiskContent != "remote" {
		t.Fatalf("expected external change to be reported, got %+v", res)
	}
	if got, _ := os.ReadFile(abs); string(got) != "remote" {
		t.Fatalf("external version must not be overwritten, got %q", got)
	}

	// Content already on disk (e.g., duplicate save) -> treated as saved.
	res, err = svc.WriteFileIfUnchanged("note.md", "remote", "stale")
	if err != nil || !res.Saved {
		t.Fatalf("expected idempotent save, got %+v err=%v", res, err)
	}

	// Missing file (deleted by sync) is recreated so the draft is not lost.
	if err := os.Remove(abs); err != nil {
		t.Fatal(err)
	}
	res, err = svc.WriteFileIfUnchanged("note.md", "draft", "remote")
	if err != nil || !res.Saved {
		t.Fatalf("expected recreate, got %+v err=%v", res, err)
	}
	if got, _ := os.ReadFile(abs); string(got) != "draft" {
		t.Fatalf("expected draft written, got %q", got)
	}
}

func TestWorktreeLockerBlocksWrites(t *testing.T) {
	svc, root := newTestService(t)
	l := svc.WorktreeLocker()
	l.Lock()

	done := make(chan error, 1)
	go func() { done <- svc.WriteFile("note.md", "x") }()

	select {
	case <-done:
		t.Fatal("WriteFile must wait while the worktree lock is held")
	case <-time.After(100 * time.Millisecond):
	}
	l.Unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "note.md")); string(got) != "x" {
		t.Fatalf("expected write after unlock, got %q", got)
	}
}
