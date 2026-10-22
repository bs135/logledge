// Package gitsync implements SyncService: synchronizing the Vault with a GitHub
// repository by directly invoking the system `git` CLI via os/exec (avoiding
// go-git to reimplement rebase/merge — see PLAN.md feasibility assessment).
// The Personal Access Token is never stored in .git/config or any file on disk:
// it is read exclusively from the OS Keychain (via internal/gitsync/credentials.go)
// and temporarily injected into the URL passed to each git fetch/push command.
package gitsync

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// AuthMethod specifies the authentication mechanism used with GitHub.
type AuthMethod string

const (
	AuthNone AuthMethod = "none"
	AuthPAT  AuthMethod = "pat"
	AuthSSH  AuthMethod = "ssh"
)

// Status represents the current synchronization state emitted to the frontend status bar.
type Status struct {
	State   string `json:"state"` // not_configured | idle | syncing | conflict | offline | error
	Message string `json:"message"`
}

// Service manages Git synchronization for the active Vault.
type Service struct {
	mu         sync.Mutex
	root       string
	repoURL    string
	branch     string
	authMethod AuthMethod
	configured bool

	status   Status
	onStatus func(Status)

	stopPeriodic func()

	// runMu serializes whole Sync() runs: startup, periodic, manual "Sync now",
	// and shutdown syncs must never execute git commands concurrently.
	runMu sync.Mutex
	// worktree, when set, is held while committing local changes and merging the
	// remote branch so that app-initiated file writes (editor auto-save, renames,
	// ...) cannot interleave with git modifying the working tree.
	worktree sync.Locker
}

// New creates a Service; onStatus is invoked whenever sync status changes.
func New(onStatus func(Status)) *Service {
	return &Service{
		onStatus: onStatus,
		status:   Status{State: "not_configured"},
	}
}

// Configure sets up the Vault root, GitHub repo, branch, and auth method,
// then ensures the local Git repository is initialized (git init + remote origin if needed).
func (s *Service) Configure(root, repoURL, branch string, auth AuthMethod) error {
	if branch == "" {
		branch = "main"
	}
	s.mu.Lock()
	s.root = root
	s.repoURL = repoURL
	s.branch = branch
	s.authMethod = auth
	s.configured = repoURL != ""
	s.mu.Unlock()

	if !s.configured {
		s.setStatus("not_configured", "Chưa cấu hình đồng bộ GitHub")
		return nil
	}
	if err := s.ensureRepo(); err != nil {
		s.setStatus("error", err.Error())
		return err
	}
	s.setStatus("idle", "Sẵn sàng đồng bộ")
	return nil
}

// SetWorktreeLocker registers the lock that guards app-initiated working tree
// mutations (provided by VaultService). Sync holds it only for the local
// commit/merge phase; network operations (fetch, push) run without it.
func (s *Service) SetWorktreeLocker(l sync.Locker) {
	s.mu.Lock()
	s.worktree = l
	s.mu.Unlock()
}

func (s *Service) lockWorktree() func() {
	s.mu.Lock()
	l := s.worktree
	s.mu.Unlock()
	if l == nil {
		return func() {}
	}
	l.Lock()
	return l.Unlock
}

// IsConfigured reports whether the active Vault has GitHub sync configured.
func (s *Service) IsConfigured() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.configured
}

// Status returns the current synchronization status.
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Service) setStatus(state, message string) {
	s.mu.Lock()
	s.status = Status{State: state, Message: message}
	cb := s.onStatus
	st := s.status
	s.mu.Unlock()
	if cb != nil {
		cb(st)
	}
}

// StartPeriodic runs Sync() periodically every interval in the background until
// Stop() is called. Periodic synchronization errors do not crash the application.
func (s *Service) StartPeriodic(interval time.Duration) {
	s.Stop()
	ticker := time.NewTicker(interval)
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-done:
				ticker.Stop()
				return
			case <-ticker.C:
				_ = s.Sync()
			}
		}
	}()
	s.mu.Lock()
	s.stopPeriodic = func() { close(done) }
	s.mu.Unlock()
}

// Stop halts the periodic synchronization loop (if running).
func (s *Service) Stop() {
	s.mu.Lock()
	stop := s.stopPeriodic
	s.stopPeriodic = nil
	s.mu.Unlock()
	if stop != nil {
		stop()
	}
}

func (s *Service) run(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = s.root
	prepareCmd(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// authedURL returns the remote URL with the Personal Access Token injected (if using
// PAT authentication) to pass directly to fetch/push — never written to .git/config.
func (s *Service) authedURL() (string, error) {
	if s.authMethod != AuthPAT {
		return s.repoURL, nil
	}
	pat, ok, err := GetPAT()
	if err != nil {
		return "", err
	}
	if !ok || pat == "" {
		return "", errors.New("chưa cấu hình GitHub Personal Access Token")
	}
	u, err := url.Parse(s.repoURL)
	if err != nil {
		return "", fmt.Errorf("URL repo không hợp lệ: %w", err)
	}
	u.User = url.UserPassword("x-access-token", pat)
	return u.String(), nil
}

// ensureRepo initializes the local Git repo (if the Vault lacks .git) and ensures
// remote "origin" points to repoURL (without credentials).
func (s *Service) ensureRepo() error {
	if _, err := os.Stat(filepath.Join(s.root, ".git")); os.IsNotExist(err) {
		if _, err := s.run("init"); err != nil {
			return err
		}
		_, _ = s.run("checkout", "-B", s.branch)
		_, _ = s.run("config", "user.name", "Logledge")
		_, _ = s.run("config", "user.email", "logledge@localhost")
	}
	if _, err := s.run("remote", "get-url", "origin"); err != nil {
		if _, err := s.run("remote", "add", "origin", s.repoURL); err != nil {
			return err
		}
	} else {
		if _, err := s.run("remote", "set-url", "origin", s.repoURL); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) hasLocalChanges() (bool, error) {
	out, err := s.run("status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) != "", nil
}

// autoCommit stages and commits all uncommitted changes into an "Auto-sync" commit.
func (s *Service) autoCommit() error {
	changed, err := s.hasLocalChanges()
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	if _, err := s.run("add", "-A"); err != nil {
		return err
	}
	msg := fmt.Sprintf("Auto-sync: %s", time.Now().Format(time.RFC3339))
	_, err = s.run("commit", "-m", msg)
	return err
}

func (s *Service) remoteRef() string {
	return "refs/remotes/origin/" + s.branch
}

// fetchRemote fetches the remote branch history into the local tracking ref
// without touching the working tree.
func (s *Service) fetchRemote() error {
	authed, err := s.authedURL()
	if err != nil {
		return err
	}
	refspec := fmt.Sprintf("+%s:%s", s.branch, s.remoteRef())
	_, err = s.run("fetch", authed, refspec)
	return err
}

func (s *Service) push() error {
	authed, err := s.authedURL()
	if err != nil {
		return err
	}
	_, err = s.run("push", authed, "HEAD:"+s.branch)
	return err
}

func (s *Service) revCount(rangeExpr string) int {
	out, err := s.run("rev-list", "--count", rangeExpr)
	if err != nil {
		return 0
	}
	out = strings.TrimSpace(out)
	var n int
	fmt.Sscanf(out, "%d", &n)
	return n
}

func (s *Service) refExists(ref string) bool {
	_, err := s.run("rev-parse", "--verify", "--quiet", ref)
	return err == nil
}

// Sync is the primary entry point: fetches remote, auto-commits local changes,
// reconciles (fast-forward if possible, or merge with rename-on-conflict policy
// if diverged), and pushes. Callable on startup, periodically, on exit, or via
// manual "Sync now" trigger. Concurrent calls are serialized.
//
// The fetch and push network round-trips run without holding the worktree lock,
// so the editor can keep saving while they are in flight. The auto-commit and
// the merge run atomically under the lock: the working tree is guaranteed to be
// clean when the merge starts, and no editor write can land mid-merge.
func (s *Service) Sync() error {
	s.runMu.Lock()
	defer s.runMu.Unlock()

	s.mu.Lock()
	configured := s.configured
	s.mu.Unlock()
	if !configured {
		return nil
	}

	s.setStatus("syncing", "Đang đồng bộ…")

	if err := s.ensureRepo(); err != nil {
		s.setStatus("error", err.Error())
		return err
	}

	fetchErr := s.fetchRemote()

	unlock := s.lockWorktree()
	if err := s.autoCommit(); err != nil {
		unlock()
		s.setStatus("error", "Không thể commit thay đổi cục bộ: "+err.Error())
		return err
	}
	if fetchErr != nil {
		unlock()
		s.setStatus("offline", "Không thể kết nối GitHub: "+fetchErr.Error())
		return fetchErr
	}
	needPush, err := s.reconcile()
	unlock()
	if err != nil || !needPush {
		return err
	}

	if err := s.push(); err != nil {
		s.setStatus("error", "Không thể push: "+err.Error())
		return err
	}
	s.setStatus("idle", "Đã đồng bộ lúc "+time.Now().Format("15:04:05"))
	return nil
}

// reconcile integrates the fetched remote branch into the local branch. It must
// be called with the worktree lock held and a clean working tree. It reports
// whether a push should follow; when it returns false or an error, the final
// status has already been emitted.
func (s *Service) reconcile() (bool, error) {
	remoteRef := s.remoteRef()
	if !s.refExists(remoteRef) {
		// Remote does not have this branch yet (new repo). If local also has no
		// commits (empty Vault, no notes written yet), there is nothing to sync.
		if !s.refExists("HEAD") {
			s.setStatus("idle", "Chưa có nội dung để đồng bộ")
			return false, nil
		}
		return true, nil
	}

	if !s.refExists("HEAD") {
		// Local Vault has no commits (fresh git init) — conflict is impossible,
		// simply reset working tree to the full remote content.
		if _, err := s.run("reset", "--hard", remoteRef); err != nil {
			s.setStatus("error", "Không thể lấy nội dung remote: "+err.Error())
			return false, err
		}
		s.setStatus("idle", "Đã đồng bộ lúc "+time.Now().Format("15:04:05"))
		return false, nil
	}

	behind := s.revCount("HEAD.." + remoteRef)
	ahead := s.revCount(remoteRef + "..HEAD")

	switch {
	case behind == 0:
		// Remote has no new commits; only push if local has new commits.
	case ahead == 0:
		// Only remote has new commits -> safe fast-forward, conflict is impossible.
		if _, err := s.run("merge", "--ff-only", remoteRef); err != nil {
			s.setStatus("error", "Fast-forward thất bại: "+err.Error())
			return false, err
		}
	default:
		if err := s.mergeWithConflictRename(remoteRef); err != nil {
			s.setStatus("conflict", "Đã xảy ra xung đột, các file trùng đổi tên .conflict — kiểm tra lại: "+err.Error())
			return false, err
		}
	}
	return true, nil
}

// mergeWithConflictRename merges remoteRef into HEAD when branches have diverged.
// It uses `git merge -X ours` to automate merging at the Git level without leaving
// conflict markers (<<<<<<<) in any file. Then, for files modified on BOTH sides
// (genuine conflicts), it renames the local version to "Name.conflict.<timestamp>.md"
// and checks out the remote version, in accordance with the conflict policy.
func (s *Service) mergeWithConflictRename(remoteRef string) error {
	base, err := s.run("merge-base", "HEAD", remoteRef)
	if err != nil {
		return err
	}
	base = strings.TrimSpace(base)

	localChanged, err := s.changedFiles(base, "HEAD")
	if err != nil {
		return err
	}
	remoteChanged, err := s.changedFiles(base, remoteRef)
	if err != nil {
		return err
	}

	if _, err := s.run("merge", "--no-commit", "--no-ff", "-X", "ours", remoteRef); err != nil {
		// "-X ours" resolves content conflicts, but structural ones (e.g. a note
		// modified locally and deleted remotely) still stop the merge. Those are
		// handled by the rename-on-conflict policy below as long as every unmerged
		// path was changed on both sides; anything else is a genuine failure.
		unmerged, uErr := s.unmergedFiles()
		if uErr != nil || len(unmerged) == 0 || !allIn(unmerged, localChanged, remoteChanged) {
			_, _ = s.run("merge", "--abort")
			return fmt.Errorf("merge thất bại: %w", err)
		}
	}

	ts := time.Now().Format("2006-01-02T15-04-05")
	for path := range remoteChanged {
		if !localChanged[path] {
			continue // remote-only change: git merge already applied it to working tree
		}

		absPath := filepath.Join(s.root, filepath.FromSlash(path))
		// Only a path that exists in the local commit has a local version worth
		// keeping. When it was deleted locally and modified remotely, the file left
		// on disk by the merge is the remote version, so no conflict copy is made.
		_, inHeadErr := s.run("cat-file", "-e", "HEAD:"+path)
		if info, statErr := os.Stat(absPath); inHeadErr == nil && statErr == nil && !info.IsDir() {
			ext := filepath.Ext(path)
			conflictRel := strings.TrimSuffix(path, ext) + ".conflict." + ts + ext
			absConflict := filepath.Join(s.root, filepath.FromSlash(conflictRel))
			if err := os.Rename(absPath, absConflict); err == nil {
				_, _ = s.run("add", conflictRel)
			}
		}

		if _, err := s.run("cat-file", "-e", remoteRef+":"+path); err == nil {
			_, _ = s.run("checkout", remoteRef, "--", path)
		} else {
			_ = os.Remove(absPath)
			_, _ = s.run("rm", "-f", "--ignore-unmatch", path)
		}
	}

	if _, err := s.run("add", "-A"); err != nil {
		return err
	}
	msg := fmt.Sprintf("Auto-sync (merge): %s", time.Now().Format(time.RFC3339))
	_, err = s.run("commit", "-m", msg)
	return err
}

func (s *Service) changedFiles(fromRef, toRef string) (map[string]bool, error) {
	// -z prints raw paths (no octal quoting of non-ASCII names such as Vietnamese
	// note titles), so they can be matched and resolved on disk. Rename detection
	// stays on (git default) so a note renamed on one side and edited on the other
	// is merged into the new name rather than treated as a conflict on the old one.
	out, err := s.run("diff", "--name-only", "-z", fromRef, toRef)
	if err != nil {
		return nil, err
	}
	return splitNUL(out), nil
}

// unmergedFiles lists paths left unmerged in the index by an interrupted merge.
func (s *Service) unmergedFiles() (map[string]bool, error) {
	out, err := s.run("diff", "--name-only", "--diff-filter=U", "-z")
	if err != nil {
		return nil, err
	}
	return splitNUL(out), nil
}

func splitNUL(out string) map[string]bool {
	set := make(map[string]bool)
	for _, p := range strings.Split(out, "\x00") {
		if p != "" {
			set[p] = true
		}
	}
	return set
}

// allIn reports whether every path in paths belongs to both a and b.
func allIn(paths, a, b map[string]bool) bool {
	for p := range paths {
		if !a[p] || !b[p] {
			return false
		}
	}
	return true
}
