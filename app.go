package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"logledge/internal/config"
	"logledge/internal/vault"
)

// vaultChangedEvent là tên sự kiện Wails phát tới frontend mỗi khi cây Vault
// thay đổi trên đĩa (do app hoặc bên ngoài), để frontend gọi lại GetTree.
const vaultChangedEvent = "vault:changed"

// App struct
type App struct {
	ctx   context.Context
	vault *vault.Service
}

// NewApp creates a new App application struct
func NewApp() *App {
	a := &App{}
	a.vault = vault.New(a.emitVaultChanged)
	return a
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods. Không mở Vault ở đây để không chặn
// cold-start; frontend sẽ chủ động gọi InitVault() sau khi mount.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) emitVaultChanged() {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, vaultChangedEvent)
	}
}

// InitVault mở lại Vault đã cấu hình từ lần chạy trước (nếu có) và trả về
// đường dẫn của nó, hoặc "" nếu người dùng chưa chọn Vault nào.
func (a *App) InitVault() (string, error) {
	cfg, err := config.Load()
	if err != nil || cfg.VaultPath == "" {
		return "", err
	}
	if err := a.vault.Open(cfg.VaultPath); err != nil {
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
	if err := a.vault.Open(dir); err != nil {
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
