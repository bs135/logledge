package main

import (
	"context"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"logledge/internal/config"
	"logledge/internal/gitsync"
	"logledge/internal/search"
	"logledge/internal/tray"
	"logledge/internal/vault"
)

// vaultChangedEvent is the Wails event emitted to the frontend whenever the Vault
// tree changes on disk (externally or by the app), triggering frontend to refetch GetTree.
const vaultChangedEvent = "vault:changed"

// syncStatusEvent is the Wails event emitted to the frontend whenever GitHub
// sync status changes (Synced/Syncing/Conflict/Offline/...).
const syncStatusEvent = "sync:status"

// syncInterval is the cadence for automatic periodic sync while the app is running.
const syncInterval = 5 * time.Minute

// App struct
type App struct {
	ctx         context.Context
	vault       *vault.Service
	search      *search.Service
	sync        *gitsync.Service
	trayCleanup func()
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
// so we can call the runtime methods. Vault is not opened here to avoid blocking
// cold-start; frontend triggers InitVault() after mounting.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.trayCleanup = tray.Start(ctx, a)
}

// shutdown is invoked by main.go (via OnShutdown) before the app closes:
// attempts a final synchronization with a timeout to avoid hanging app exit
// on slow or severed network connections.
func (a *App) shutdown(ctx context.Context) {
	if a.trayCleanup != nil {
		a.trayCleanup()
	}
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

// emitVaultChanged is called (debounced) whenever the Vault tree changes on disk:
// prompts frontend to refetch the tree and triggers background search reindexing (non-blocking).
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

// openVault opens VaultService, SearchService, and (if configured) GitSync
// for the same root directory, initiating background indexing and synchronization
// without blocking cold-start.
func (a *App) openVault(path string) error {
	path = filepath.Clean(path)
	if a.vault.Root() != "" && filepath.Clean(a.vault.Root()) == path {
		return nil
	}
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
		// Sync configuration error should not block opening the Vault;
		// the error status is emitted via sync:status for frontend display.
	}
	if a.sync.IsConfigured() {
		go a.sync.Sync()
		a.sync.StartPeriodic(syncInterval)
	}
	return nil
}

// InitVault reopens the previously configured Vault (if any) and returns its
// path, or "" if no Vault has been configured yet.
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

// SelectVaultFolder opens the native OS directory picker, initializes that directory
// as the active Vault, and persists the selection. Returns "" if cancelled by the user.
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
	if err := a.ensureVaultInConfig(dir); err != nil {
		return "", err
	}
	a.emitVaultChanged()
	return dir, nil
}

func (a *App) ensureVaultInConfig(dir string) error {
	cfg, err := config.Load()
	if err != nil {
		cfg = config.Config{}
	}
	cfg.VaultPath = dir
	found := false
	for _, v := range cfg.Vaults {
		if filepath.Clean(v.Path) == filepath.Clean(dir) {
			found = true
			break
		}
	}
	if !found {
		name := filepath.Base(dir)
		if name == "" || name == "." || name == string(filepath.Separator) {
			name = dir
		}
		cfg.Vaults = append(cfg.Vaults, config.VaultEntry{
			Path: dir,
			Name: name,
		})
	}
	return config.Save(cfg)
}

// GetVaultList returns the registered vaults and the currently active one.
func (a *App) GetVaultList() ([]config.VaultEntry, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	return cfg.Vaults, nil
}

// SwitchVault switches the active vault to targetPath.
func (a *App) SwitchVault(targetPath string) error {
	targetPath = filepath.Clean(targetPath)
	if a.vault.Root() != "" && filepath.Clean(a.vault.Root()) == targetPath {
		_ = a.ensureVaultInConfig(targetPath)
		a.emitVaultChanged()
		return nil
	}
	if err := a.openVault(targetPath); err != nil {
		return err
	}
	if err := a.ensureVaultInConfig(targetPath); err != nil {
		return err
	}
	a.emitVaultChanged()
	return nil
}

// RemoveVault removes a vault from the registered vaults list.
func (a *App) RemoveVault(targetPath string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	var updated []config.VaultEntry
	for _, v := range cfg.Vaults {
		if filepath.Clean(v.Path) != filepath.Clean(targetPath) {
			updated = append(updated, v)
		}
	}
	cfg.Vaults = updated
	return config.Save(cfg)
}

// GetAppSettings returns the saved configuration (theme, language, etc.).
func (a *App) GetAppSettings() (config.Config, error) {
	return config.Load()
}

// SaveAppSettings updates general settings like theme and language.
func (a *App) SaveAppSettings(theme, language string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Theme = theme
	cfg.Language = language
	return config.Save(cfg)
}

// GetTree returns the entire directory and file tree of the active Vault.
func (a *App) GetTree() (*vault.Node, error) {
	return a.vault.Tree()
}

// CreateFile creates a new .md file inside parentRelPath.
func (a *App) CreateFile(parentRelPath, name string) (string, error) {
	return a.vault.CreateFile(parentRelPath, name)
}

// CreateFolder creates a new folder inside parentRelPath.
func (a *App) CreateFolder(parentRelPath, name string) (string, error) {
	return a.vault.CreateFolder(parentRelPath, name)
}

// RenameEntry renames the file or directory at relPath.
func (a *App) RenameEntry(relPath, newName string) (string, error) {
	return a.vault.Rename(relPath, newName)
}

// MoveEntry relocates a file or directory into a new parent folder (drag-and-drop).
func (a *App) MoveEntry(srcRelPath, destParentRelPath string) (string, error) {
	return a.vault.Move(srcRelPath, destParentRelPath)
}

// DeleteEntry moves the file or folder to the OS recycle bin.
func (a *App) DeleteEntry(relPath string) error {
	return a.vault.Delete(relPath)
}

// ReadFile reads the file content (used by the editor in Phase 2).
func (a *App) ReadFile(relPath string) (string, error) {
	return a.vault.ReadFile(relPath)
}

// WriteFile writes file content (used for auto-save in Phase 2).
func (a *App) WriteFile(relPath, content string) error {
	return a.vault.WriteFile(relPath, content)
}

// SaveAttachment saves an image (clipboard paste / drag-and-drop in editor) into
// .attachments/ and returns a relative Markdown link to insert into the note.
func (a *App) SaveAttachment(noteRelPath, filename, base64Data string) (string, error) {
	return a.vault.SaveAttachment(noteRelPath, filename, base64Data)
}

// SearchNotes executes a full-text search (Ctrl+Shift+F) across the Vault,
// returning highlighted contextual snippets.
func (a *App) SearchNotes(query string) ([]search.Result, error) {
	return a.search.Search(query, 30)
}

// QuickSwitch performs fast fuzzy filename lookup (Ctrl+P).
func (a *App) QuickSwitch(query string) ([]string, error) {
	return a.search.QuickSwitch(query, 30)
}

// SyncSettings represents GitHub synchronization configuration exposed to frontend
// (excluding the Personal Access Token — managed securely via SetGitHubPAT/HasGitHubPAT,
// never exposed in plaintext).
type SyncSettings struct {
	RepoURL    string `json:"repoURL"`
	Branch     string `json:"branch"`
	AuthMethod string `json:"authMethod"`
	HasPAT     bool   `json:"hasPAT"`
}

// GetSyncSettings returns the current sync settings (loaded from config.json).
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

// ConfigureSync saves GitHub sync settings, applies them to the active Vault
// (running git init/remote if needed), and starts periodic synchronization.
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
		return nil // No Vault opened yet; settings will take effect when a Vault is opened
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

// SetGitHubPAT saves the Personal Access Token to the OS Keychain (never written to disk).
func (a *App) SetGitHubPAT(pat string) error {
	return gitsync.SetPAT(pat)
}

// SyncNow triggers an immediate synchronization cycle (manual trigger).
func (a *App) SyncNow() error {
	return a.sync.Sync()
}

// GetSyncStatus returns the current sync status for the status bar.
func (a *App) GetSyncStatus() gitsync.Status {
	return a.sync.Status()
}
