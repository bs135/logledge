package gitsync

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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

// hookLocker simulates VaultService's worktree lock. The optional beforeLock
// hook runs right before the lock is acquired — i.e., after Sync has fetched —
// which lets tests emulate an editor auto-save landing while fetch is in flight.
type hookLocker struct {
	sync.Mutex
	beforeLock func()
}

func (h *hookLocker) Lock() {
	if f := h.beforeLock; f != nil {
		h.beforeLock = nil
		f()
	}
	h.Mutex.Lock()
}

func findConflictFile(t *testing.T, root, prefix string) string {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read root: %v", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix+".conflict.") {
			return e.Name()
		}
	}
	t.Fatalf("expected a %s.conflict.* file, got entries: %v", prefix, entries)
	return ""
}

func TestSync_EditDuringFetchIsCommittedBeforeMerge(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"note.md": "original"})
	svc, root := newLocalVault(t, bareDir, "main")
	lock := &hookLocker{}
	svc.SetWorktreeLocker(lock)
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "note.md", "edited remotely")
	})
	// The user keeps typing: an auto-save lands after Sync started (during fetch).
	lock.beforeLock = func() { writeFile(t, root, "note.md", "edited locally while syncing") }

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync with an edit during fetch must not fail: %v", err)
	}
	if got := readFile(t, root, "note.md"); got != "edited remotely" {
		t.Fatalf("expected remote version in note.md, got %q", got)
	}
	conflict := findConflictFile(t, root, "note")
	if got := readFile(t, root, conflict); got != "edited locally while syncing" {
		t.Fatalf("expected local edit preserved in conflict file, got %q", got)
	}
	if out := runGit(t, root, "status", "--porcelain"); strings.TrimSpace(out) != "" {
		t.Fatalf("expected clean working tree after sync, got:\n%s", out)
	}
	if err := svc.Sync(); err != nil {
		t.Fatalf("follow-up Sync should be a no-op: %v", err)
	}
}

func TestSync_ConcurrentCallsAreSerialized(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"a.md": "a"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "remote.md", "remote")
	})
	writeFile(t, root, "local.md", "local")

	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- svc.Sync()
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent Sync failed: %v", err)
		}
	}
	if got := readFile(t, root, "remote.md"); got != "remote" {
		t.Fatalf("expected remote.md merged, got %q", got)
	}
}

func TestSync_LocalEditRemoteDeleteKeepsLocalAsConflict(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"shared.md": "original", "keep.md": "k"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	writeFile(t, root, "shared.md", "edited locally")
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		if err := os.Remove(filepath.Join(dir, "shared.md")); err != nil {
			t.Fatal(err)
		}
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("modify/delete must be resolved, not fail the sync: %v", err)
	}
	conflict := findConflictFile(t, root, "shared")
	if got := readFile(t, root, conflict); got != "edited locally" {
		t.Fatalf("expected local edit preserved, got %q", got)
	}
	if err := svc.Sync(); err != nil {
		t.Fatalf("follow-up Sync should be a no-op: %v", err)
	}
}

func TestSync_ConflictOnNonASCIIFilename(t *testing.T) {
	const name = "ghi chú.md"
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{name: "original"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	writeFile(t, root, name, "edited locally")
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, name, "edited remotely")
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if got := readFile(t, root, name); got != "edited remotely" {
		t.Fatalf("expected remote version, got %q", got)
	}
	conflict := findConflictFile(t, root, "ghi chú")
	if got := readFile(t, root, conflict); got != "edited locally" {
		t.Fatalf("expected local version in conflict file, got %q", got)
	}
}

func TestSync_LocalDeleteRemoteEditRestoresRemoteWithoutConflictCopy(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"shared.md": "original", "keep.md": "k"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	if err := os.Remove(filepath.Join(root, "shared.md")); err != nil {
		t.Fatal(err)
	}
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "shared.md", "edited remotely")
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if got := readFile(t, root, "shared.md"); got != "edited remotely" {
		t.Fatalf("expected remote edit restored, got %q", got)
	}
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		if strings.Contains(e.Name(), ".conflict.") {
			t.Fatalf("no local version exists, conflict copy %q must not be created", e.Name())
		}
	}
}

func TestSync_LocalRenameRemoteEditMergesIntoNewName(t *testing.T) {
	bareDir := newBareRemoteWithSeed(t, "main", map[string]string{"a.md": "line1\nline2\nline3\nline4\n"})
	svc, root := newLocalVault(t, bareDir, "main")
	if err := svc.Sync(); err != nil {
		t.Fatalf("initial Sync: %v", err)
	}

	if err := os.Rename(filepath.Join(root, "a.md"), filepath.Join(root, "b.md")); err != nil {
		t.Fatal(err)
	}
	pushRemoteChange(t, bareDir, "main", func(dir string) {
		writeFile(t, dir, "a.md", "line1\nline2\nline3\nline4 edited remotely\n")
	})

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "a.md")); err == nil {
		t.Fatal("a.md was renamed locally and must not be restored")
	}
	if got := readFile(t, root, "b.md"); !strings.Contains(got, "line4 edited remotely") {
		t.Fatalf("expected remote edit merged into b.md, got %q", got)
	}
}
