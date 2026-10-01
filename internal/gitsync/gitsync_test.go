package gitsync

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// runGit executes git in dir and fails the test immediately on error.
// Used for test fixture setup (not production code).
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	abs := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
}

func readFile(t *testing.T, dir, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	return string(data)
}

// newBareRemoteWithSeed creates a bare repo acting as a GitHub remote,
// initialized with a seed commit on branch `branch`.
func newBareRemoteWithSeed(t *testing.T, branch string, seedFiles map[string]string) string {
	t.Helper()
	bareDir := filepath.Join(t.TempDir(), "remote.git")
	runGit(t, t.TempDir(), "init", "--bare", "-b", branch, bareDir)

	seedDir := t.TempDir()
	runGit(t, seedDir, "init", "-b", branch)
	for rel, content := range seedFiles {
		writeFile(t, seedDir, rel, content)
	}
	runGit(t, seedDir, "add", "-A")
	runGit(t, seedDir, "commit", "-m", "seed")
	runGit(t, seedDir, "remote", "add", "origin", bareDir)
	runGit(t, seedDir, "push", "origin", branch)
	return bareDir
}

// pushRemoteChange simulates another machine editing and pushing to remote:
// clones bareDir into a temp directory, applies `mutate`, then pushes back.
func pushRemoteChange(t *testing.T, bareDir, branch string, mutate func(dir string)) {
	t.Helper()
	cloneDir := t.TempDir()
	runGit(t, t.TempDir(), "clone", bareDir, cloneDir)
	runGit(t, cloneDir, "checkout", branch)
	mutate(cloneDir)
	runGit(t, cloneDir, "add", "-A")
	runGit(t, cloneDir, "commit", "-m", "remote change")
	runGit(t, cloneDir, "push", "origin", branch)
}

func newLocalVault(t *testing.T, bareDir, branch string) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	svc := New(func(Status) {})
	if err := svc.Configure(root, bareDir, branch, AuthNone); err != nil {
		t.Fatalf("Configure: %v", err)
	}
	return svc, root
}

func TestSync_AdoptsExistingRemoteIntoEmptyVault(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"hello.md": "hello from remote"})
	svc, root := newLocalVault(t, bareDir, "main")

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if got := readFile(t, root, "hello.md"); got != "hello from remote" {
		t.Fatalf("expected remote content adopted, got %q", got)
	}
}

func TestSync_FastForwardWhenOnlyRemoteChanged(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"a.md": "a"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "b.md", "b from remote")
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("second Sync: %v", err)
	}
	if got := readFile(t, root, "b.md"); got != "b from remote" {
		t.Fatalf("expected fast-forwarded file b.md, got %q", got)
	}
}

func TestSync_MergesNonConflictingDivergentChanges(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"a.md": "a"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	// Local modifies 1 file, another machine pushes a different file — non-overlapping changes.
	writeFile(t, root, "local-only.md", "written locally")
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "remote-only.md", "written remotely")
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if got := readFile(t, root, "local-only.md"); got != "written locally" {
		t.Fatalf("expected local file preserved, got %q", got)
	}
	if got := readFile(t, root, "remote-only.md"); got != "written remotely" {
		t.Fatalf("expected remote file merged in, got %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, "local-only.md") + ".conflict"); err == nil {
		t.Fatal("did not expect any conflict rename for non-overlapping changes")
	}
}

func TestSync_RenamesLocalOnTrueConflict(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"shared.md": "original"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	// Both local and remote edit shared.md differently -> genuine conflict.
	writeFile(t, root, "shared.md", "edited locally")
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "shared.md", "edited remotely")
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if got := readFile(t, root, "shared.md"); got != "edited remotely" {
		t.Fatalf("expected shared.md to contain the remote version, got %q", got)
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read root: %v", err)
	}
	var conflictFile string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "shared.conflict.") {
			conflictFile = e.Name()
		}
	}
	if conflictFile == "" {
		t.Fatalf("expected a shared.conflict.*.md file, got entries: %v", entries)
	}
	if got := readFile(t, root, conflictFile); got != "edited locally" {
		t.Fatalf("expected conflict file to contain local version, got %q", got)
	}

	// Ensure no conflict markers exist in any file.
	for _, name := range []string{"shared.md", conflictFile} {
		if strings.Contains(readFile(t, root, name), "<<<<<<<") {
			t.Fatalf("file %q should not contain conflict markers", name)
		}
	}

	// Sync should successfully push merge commit to remote (no longer diverged).
	if err := svc.Sync(); err != nil {
		t.Fatalf("follow-up Sync should be a no-op: %v", err)
	}
}
