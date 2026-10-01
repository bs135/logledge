package vault

import (
	"os"
	"path/filepath"
	"testing"
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
