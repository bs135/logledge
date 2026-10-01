package main

import (
	"context"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"logledge/internal/config"
	"logledge/internal/gitsync"
	"logledge/internal/search"
	"logledge/internal/vault"
)

// vaultChangedEvent là tên sự kiện Wails phát tới frontend mỗi khi cây Vault
// thay đổi trên đĩa (do app hoặc bên ngoài), để frontend gọi lại GetTree.
const vaultChangedEvent = "vault:changed"

// syncStatusEvent là tên sự kiện Wails phát tới frontend mỗi khi trạng thái
// đồng bộ GitHub thay đổi (Synced/Syncing/Conflict/Offline/...).
const syncStatusEvent = "sync:status"

// syncInterval là chu kỳ tự động đồng bộ định kỳ trong lúc app đang chạy.
const syncInterval = 5 * time.Minute

// App struct
type App struct {
	ctx    context.Context
	vault  *vault.Service
	search *search.Service
	sync   *gitsync.Service
}

// NewApp creates a new App application struct
func NewApp() *App {
	a := &App{}
	a.vault = vault.New(a.emitVaultChanged)
	a.search = search.New()
	a.sync = gitsync.New(a.emitSyncStatus)
	return a
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods. Không mở Vault ở đây để không chặn
// cold-start; frontend sẽ chủ động gọi InitVault() sau khi mount.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// shutdown được main.go gọi (qua OnShutdown) trước khi app đóng: cố gắng
// đồng bộ lần cuối, giới hạn thời gian chờ để không treo việc thoát app nếu
// mạng chậm/mất kết nối.
func (a *App) shutdown(ctx context.Context) {
	a.sync.Stop()
	if !a.sync.IsConfigured() {
		return
	}
	done := make(chan struct{})
	go func() {
		_ = a.sync.Sync()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
	}
}

// emitVaultChanged được gọi (debounced) mỗi khi cây Vault thay đổi trên đĩa:
// báo frontend refetch cây, đồng thời reindex lại search trong nền (không
// chặn UI).
func (a *App) emitVaultChanged() {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, vaultChangedEvent)
	}
	go a.search.Reindex()
}

func (a *App) emitSyncStatus(status gitsync.Status) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, syncStatusEvent, status)
	}
}

// openVault mở đồng thời VaultService, SearchService và (nếu đã cấu hình)
// GitSync cho cùng một thư mục, rồi kích hoạt index + đồng bộ nền (không
// chặn cold-start).
func (a *App) openVault(path string) error {
	if err := a.vault.Open(path); err != nil {
		return err
	}
	if err := a.search.Open(path); err != nil {
		return err
	}
	go a.search.Reindex()

	cfg, _ := config.Load()
	auth := gitsync.AuthMethod(cfg.GitAuthMethod)
	if auth == "" {
		auth = gitsync.AuthNone
	}
	if err := a.sync.Configure(path, cfg.GitRepoURL, cfg.GitBranch, auth); err != nil {
		// Lỗi cấu hình đồng bộ không nên chặn việc mở Vault; trạng thái lỗi
		// đã được phát qua sync:status để frontend hiển thị.
	}
	if a.sync.IsConfigured() {
		go a.sync.Sync()
		a.sync.StartPeriodic(syncInterval)
	}
	return nil
}

// InitVault mở lại Vault đã cấu hình từ lần chạy trước (nếu có) và trả về
// đường dẫn của nó, hoặc "" nếu người dùng chưa chọn Vault nào.
func (a *App) InitVault() (string, error) {
	cfg, err := config.Load()
	if err != nil || cfg.VaultPath == "" {
		return "", err
	}
	if err := a.openVault(cfg.VaultPath); err != nil {
		return "", err
	}
	return cfg.VaultPath, nil
}

// SelectVaultFolder mở hộp thoại chọn thư mục hệ điều hành, mở thư mục đó
// làm Vault mới và lưu lại lựa chọn. Trả về "" nếu người dùng huỷ.
func (a *App) SelectVaultFolder() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Chọn thư mục làm Vault",
	})
	if err != nil || dir == "" {
		return "", err
	}
	if err := a.openVault(dir); err != nil {
		return "", err
	}
	if err := config.Save(config.Config{VaultPath: dir}); err != nil {
		return "", err
	}
	return dir, nil
}

// GetTree trả về toàn bộ cây thư mục/file của Vault đang mở.
func (a *App) GetTree() (*vault.Node, error) {
	return a.vault.Tree()
}

// CreateFile tạo file .md mới bên trong parentRelPath.
func (a *App) CreateFile(parentRelPath, name string) (string, error) {
	return a.vault.CreateFile(parentRelPath, name)
}

// CreateFolder tạo thư mục mới bên trong parentRelPath.
func (a *App) CreateFolder(parentRelPath, name string) (string, error) {
	return a.vault.CreateFolder(parentRelPath, name)
}

// RenameEntry đổi tên file/thư mục tại relPath.
func (a *App) RenameEntry(relPath, newName string) (string, error) {
	return a.vault.Rename(relPath, newName)
}

// MoveEntry di chuyển file/thư mục vào một thư mục cha khác (kéo-thả).
func (a *App) MoveEntry(srcRelPath, destParentRelPath string) (string, error) {
	return a.vault.Move(srcRelPath, destParentRelPath)
}

// DeleteEntry chuyển file/thư mục vào thùng rác hệ điều hành.
func (a *App) DeleteEntry(relPath string) error {
	return a.vault.Delete(relPath)
}

// ReadFile đọc nội dung file (Phase 2 dùng cho editor).
func (a *App) ReadFile(relPath string) (string, error) {
	return a.vault.ReadFile(relPath)
}

// WriteFile ghi nội dung file (Phase 2 dùng cho auto-save).
func (a *App) WriteFile(relPath, content string) error {
	return a.vault.WriteFile(relPath, content)
}

// SaveAttachment lưu ảnh (dán từ clipboard / kéo-thả trong editor) vào
// .attachments/ và trả về link Markdown tương đối để chèn vào note.
func (a *App) SaveAttachment(noteRelPath, filename, base64Data string) (string, error) {
	return a.vault.SaveAttachment(noteRelPath, filename, base64Data)
}

// SearchNotes tìm kiếm toàn văn (Ctrl+Shift+F) xuyên suốt Vault, trả về kèm
// snippet ngữ cảnh đã highlight từ khoá.
func (a *App) SearchNotes(query string) ([]search.Result, error) {
	return a.search.Search(query, 30)
}

// QuickSwitch tìm nhanh theo tên file (Ctrl+P), fuzzy match.
func (a *App) QuickSwitch(query string) ([]string, error) {
	return a.search.QuickSwitch(query, 30)
}

// SyncSettings là cấu hình đồng bộ GitHub hiển thị/chỉnh sửa được ở frontend
// (không bao gồm Personal Access Token — token được quản lý riêng qua
// SetGitHubPAT/HasGitHubPAT, không bao giờ hiển thị lại dạng plaintext).
type SyncSettings struct {
	RepoURL    string `json:"repoURL"`
	Branch     string `json:"branch"`
	AuthMethod string `json:"authMethod"`
	HasPAT     bool   `json:"hasPAT"`
}

// GetSyncSettings trả về cấu hình đồng bộ hiện tại (đọc từ config.json).
func (a *App) GetSyncSettings() (SyncSettings, error) {
	cfg, err := config.Load()
	if err != nil {
		return SyncSettings{}, err
	}
	_, hasPAT, _ := gitsync.GetPAT()
	auth := cfg.GitAuthMethod
	if auth == "" {
		auth = string(gitsync.AuthNone)
	}
	return SyncSettings{
		RepoURL:    cfg.GitRepoURL,
		Branch:     cfg.GitBranch,
		AuthMethod: auth,
		HasPAT:     hasPAT,
	}, nil
}

// ConfigureSync lưu cấu hình đồng bộ GitHub, áp dụng ngay cho Vault đang mở
// (git init/remote nếu cần) và bắt đầu đồng bộ định kỳ.
func (a *App) ConfigureSync(repoURL, branch, authMethod string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.GitRepoURL = repoURL
	cfg.GitBranch = branch
	cfg.GitAuthMethod = authMethod
	if err := config.Save(cfg); err != nil {
		return err
	}

	root := a.vault.Root()
	if root == "" {
		return nil // chưa mở Vault nào, cấu hình sẽ được áp dụng khi mở Vault
	}
	if err := a.sync.Configure(root, repoURL, branch, gitsync.AuthMethod(authMethod)); err != nil {
		return err
	}
	if a.sync.IsConfigured() {
		go a.sync.Sync()
		a.sync.StartPeriodic(syncInterval)
	} else {
		a.sync.Stop()
	}
	return nil
}

// SetGitHubPAT lưu Personal Access Token vào OS Keychain (không lưu ra file).
func (a *App) SetGitHubPAT(pat string) error {
	return gitsync.SetPAT(pat)
}

// SyncNow kích hoạt một lượt đồng bộ ngay lập tức (nút bấm thủ công).
func (a *App) SyncNow() error {
	return a.sync.Sync()
}

// GetSyncStatus trả về trạng thái đồng bộ hiện tại cho status bar.
func (a *App) GetSyncStatus() gitsync.Status {
	return a.sync.Status()
}
