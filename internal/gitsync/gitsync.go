// Package gitsync triển khai SyncService: đồng bộ Vault với một GitHub
// repository bằng cách gọi trực tiếp `git` CLI của hệ thống qua os/exec
// (không dùng go-git để tự viết lại rebase/merge — xem plan.md phần đánh giá
// độ khả thi). Personal Access Token không bao giờ được ghi vào .git/config
// hay bất kỳ file nào trên đĩa: nó chỉ được đọc từ OS Keychain (qua
// internal/gitsync/credentials.go) và chèn tạm thời vào URL truyền cho từng
// lệnh git fetch/push.
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

// AuthMethod xác định cách xác thực với GitHub.
type AuthMethod string

const (
	AuthNone AuthMethod = "none"
	AuthPAT  AuthMethod = "pat"
	AuthSSH  AuthMethod = "ssh"
)

// Status là trạng thái đồng bộ hiện tại, phát ra cho status bar của frontend.
type Status struct {
	State   string `json:"state"` // not_configured | idle | syncing | conflict | offline | error
	Message string `json:"message"`
}

// Service quản lý việc đồng bộ Git cho Vault đang mở.
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
}

// New tạo Service; onStatus được gọi mỗi khi trạng thái đồng bộ thay đổi.
func New(onStatus func(Status)) *Service {
	return &Service{
		onStatus: onStatus,
		status:   Status{State: "not_configured"},
	}
}

// Configure thiết lập Vault root, repo GitHub, nhánh và phương thức xác thực,
// rồi đảm bảo repo Git cục bộ đã sẵn sàng (git init + remote origin nếu cần).
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

// IsConfigured cho biết Vault hiện tại đã cấu hình đồng bộ GitHub hay chưa.
func (s *Service) IsConfigured() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.configured
}

// Status trả về trạng thái đồng bộ hiện tại.
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

// StartPeriodic chạy Sync() định kỳ mỗi `interval` trong nền, cho tới khi
// Stop() được gọi. Lỗi đồng bộ định kỳ không làm crash app.
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

// Stop dừng vòng lặp đồng bộ định kỳ (nếu có).
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
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// authedURL trả về URL remote đã chèn Personal Access Token (nếu dùng auth
// PAT) để truyền trực tiếp cho fetch/push — không bao giờ ghi vào .git/config.
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

// ensureRepo khởi tạo repo Git cục bộ (nếu Vault chưa có .git) và đảm bảo có
// remote "origin" trỏ tới repoURL (không kèm credential).
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

// autoCommit gom mọi thay đổi chưa commit thành một commit "Auto-sync".
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

// fetchRemote lấy về lịch sử của nhánh remote vào ref theo dõi cục bộ, không
// đụng tới working tree.
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

// Sync là điểm vào chính: auto-commit thay đổi cục bộ, fetch remote, hợp
// nhất (fast-forward nếu có thể, hoặc merge với chính sách rename-on-conflict
// nếu 2 bên đã phân kỳ), rồi push. Chạy được ở startup, định kỳ, khi thoát
// app, hoặc do người dùng bấm nút "Sync now".
func (s *Service) Sync() error {
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
	if err := s.autoCommit(); err != nil {
		s.setStatus("error", "Không thể commit thay đổi cục bộ: "+err.Error())
		return err
	}
	if err := s.fetchRemote(); err != nil {
		s.setStatus("offline", "Không thể kết nối GitHub: "+err.Error())
		return err
	}

	remoteRef := s.remoteRef()
	if !s.refExists(remoteRef) {
		// Remote chưa có nhánh này (repo mới). Nếu local cũng chưa có commit
		// nào (Vault trống, chưa từng ghi note) thì không có gì để đồng bộ.
		if !s.refExists("HEAD") {
			s.setStatus("idle", "Chưa có nội dung để đồng bộ")
			return nil
		}
		if err := s.push(); err != nil {
			s.setStatus("error", "Không thể push: "+err.Error())
			return err
		}
		s.setStatus("idle", "Đã đồng bộ lúc "+time.Now().Format("15:04:05"))
		return nil
	}

	if !s.refExists("HEAD") {
		// Vault local chưa có commit nào (vừa git init) — không thể có xung
		// đột, chỉ cần lấy toàn bộ nội dung remote về.
		if _, err := s.run("reset", "--hard", remoteRef); err != nil {
			s.setStatus("error", "Không thể lấy nội dung remote: "+err.Error())
			return err
		}
		s.setStatus("idle", "Đã đồng bộ lúc "+time.Now().Format("15:04:05"))
		return nil
	}

	behind := s.revCount("HEAD.." + remoteRef)
	ahead := s.revCount(remoteRef + "..HEAD")

	switch {
	case behind == 0:
		// Remote không có gì mới; chỉ cần push nếu local có commit mới.
	case ahead == 0:
		// Chỉ remote có commit mới -> fast-forward an toàn, không thể có conflict.
		if _, err := s.run("merge", "--ff-only", remoteRef); err != nil {
			s.setStatus("error", "Fast-forward thất bại: "+err.Error())
			return err
		}
	default:
		if err := s.mergeWithConflictRename(remoteRef); err != nil {
			s.setStatus("conflict", "Đã xảy ra xung đột, các file trùng đổi tên .conflict — kiểm tra lại: "+err.Error())
			return err
		}
	}

	if err := s.push(); err != nil {
		s.setStatus("error", "Không thể push: "+err.Error())
		return err
	}
	s.setStatus("idle", "Đã đồng bộ lúc "+time.Now().Format("15:04:05"))
	return nil
}

// mergeWithConflictRename hợp nhất remoteRef vào HEAD khi 2 bên đã phân kỳ.
// Dùng `git merge -X ours` để tự động hoá việc hợp nhất ở tầng Git mà không
// bao giờ để lại ký tự xung đột (<<<<<<<) trong bất kỳ file nào; sau đó, với
// đúng những file mà CẢ HAI bên cùng sửa (xung đột thật sự), đổi tên bản local
// thành "Tên.conflict.<timestamp>.md" và lấy bản remote về, theo đúng chính
// sách xử lý xung đột đã đặt ra trong spec.
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
		_, _ = s.run("merge", "--abort")
		return fmt.Errorf("merge thất bại: %w", err)
	}

	ts := time.Now().Format("2006-01-02T15-04-05")
	for path := range remoteChanged {
		if !localChanged[path] {
			continue // remote-only change: git merge đã tự đưa vào working tree rồi
		}

		absPath := filepath.Join(s.root, filepath.FromSlash(path))
		if info, statErr := os.Stat(absPath); statErr == nil && !info.IsDir() {
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
	out, err := s.run("diff", "--name-only", fromRef, toRef)
	if err != nil {
		return nil, err
	}
	set := make(map[string]bool)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			set[line] = true
		}
	}
	return set, nil
}
