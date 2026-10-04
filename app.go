package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
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
	langMu      sync.RWMutex
	language    string
}

// NewApp creates a new App application struct
func NewApp() *App {
	a := &App{}
	a.vault = vault.New(a.emitVaultChanged)
	a.search = search.New()
	a.sync = gitsync.New(a.emitSyncStatus)
	return a
}

var (
	windowShowFunc       = runtime.WindowShow
	windowUnminimiseFunc = runtime.WindowUnminimise
)

// onSecondInstanceLaunch is invoked by Wails SingleInstanceLock when another instance
// of the application is launched. It brings the existing window to the foreground and unminimizes it.
func (a *App) onSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	for i := 0; i < 20 && a.ctx == nil; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if a.ctx != nil {
		windowShowFunc(a.ctx)
		windowUnminimiseFunc(a.ctx)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods. Vault is not opened here to avoid blocking
// cold-start; frontend triggers InitVault() after mounting.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	cfg, _ := config.Load()
	a.langMu.Lock()
	if cfg.Language != "" {
		a.language = cfg.Language
	} else {
		a.language = "vi"
	}
	a.langMu.Unlock()
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
	cfg.VaultPath = path
	_ = config.Save(cfg)

	var entry *config.VaultEntry
	for i := range cfg.Vaults {
		if filepath.Clean(cfg.Vaults[i].Path) == path {
			entry = &cfg.Vaults[i]
			break
		}
	}

	repoURL := ""
	branch := "main"
	auth := gitsync.AuthNone

	if entry != nil && entry.GitRepoURL != "" {
		repoURL = entry.GitRepoURL
		if entry.GitBranch != "" {
			branch = entry.GitBranch
		}
		if entry.GitAuthMethod != "" {
			auth = gitsync.AuthMethod(entry.GitAuthMethod)
		}
	} else if cfg.GitRepoURL != "" {
		// Migration fallback from older global config
		repoURL = cfg.GitRepoURL
		if cfg.GitBranch != "" {
			branch = cfg.GitBranch
		}
		if cfg.GitAuthMethod != "" {
			auth = gitsync.AuthMethod(cfg.GitAuthMethod)
		}
	}

	if err := a.sync.Configure(path, repoURL, branch, auth); err != nil {
		// Sync configuration error should not block opening the Vault;
		// the error status is emitted via sync:status for frontend display.
	}
	if a.sync.IsConfigured() {
		go a.sync.Sync()
		a.sync.StartPeriodic(syncInterval)
	} else {
		a.sync.Stop()
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

// PickVaultFolder opens the native OS directory picker without opening the vault yet.
// Returns "" if cancelled by the user.
func (a *App) PickVaultFolder() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Chọn thư mục làm Vault",
	})
	if err != nil || dir == "" {
		return "", err
	}
	return filepath.Clean(dir), nil
}

// DetectVaultInfo inspects a directory and returns a VaultEntry with detected Git info.
func (a *App) DetectVaultInfo(path string) (config.VaultEntry, error) {
	path = filepath.Clean(path)
	name := filepath.Base(path)
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = path
	}

	detected := gitsync.DetectGitInfo(path)

	return config.VaultEntry{
		Path:          path,
		Name:          name,
		GitRepoURL:    detected.RepoURL,
		GitBranch:     detected.Branch,
		GitAuthMethod: string(detected.AuthMethod),
	}, nil
}

// SaveVault creates or updates a vault configuration in config.json.
// If makeActive is true, it switches to this vault.
// If it is the currently active vault, it dynamically reapplies sync settings.
func (a *App) SaveVault(entry config.VaultEntry, makeActive bool) error {
	entry.Path = filepath.Clean(entry.Path)
	if entry.Name == "" {
		entry.Name = filepath.Base(entry.Path)
		if entry.Name == "" || entry.Name == "." || entry.Name == string(filepath.Separator) {
			entry.Name = entry.Path
		}
	}
	if entry.GitBranch == "" {
		entry.GitBranch = "main"
	}
	if entry.GitAuthMethod == "" {
		if entry.GitRepoURL != "" {
			if strings.HasPrefix(entry.GitRepoURL, "git@") || strings.HasPrefix(entry.GitRepoURL, "ssh://") {
				entry.GitAuthMethod = string(gitsync.AuthSSH)
			} else {
				entry.GitAuthMethod = string(gitsync.AuthPAT)
			}
		} else {
			entry.GitAuthMethod = string(gitsync.AuthNone)
		}
	}

	cfg, err := config.Load()
	if err != nil {
		cfg = config.Config{}
	}

	found := false
	for i := range cfg.Vaults {
		if filepath.Clean(cfg.Vaults[i].Path) == entry.Path {
			cfg.Vaults[i] = entry
			found = true
			break
		}
	}
	if !found {
		cfg.Vaults = append(cfg.Vaults, entry)
	}

	if makeActive {
		cfg.VaultPath = entry.Path
	}

	if err := config.Save(cfg); err != nil {
		return err
	}

	if makeActive {
		if err := a.openVault(entry.Path); err != nil {
			return err
		}
		a.emitVaultChanged()
	} else if a.vault.Root() != "" && filepath.Clean(a.vault.Root()) == entry.Path {
		auth := gitsync.AuthMethod(entry.GitAuthMethod)
		if err := a.sync.Configure(entry.Path, entry.GitRepoURL, entry.GitBranch, auth); err != nil {
			// error status emitted via sync:status
		}
		if a.sync.IsConfigured() {
			go a.sync.Sync()
			a.sync.StartPeriodic(syncInterval)
		} else {
			a.sync.Stop()
		}
		a.emitVaultChanged()
	}

	return nil
}

// SelectVaultFolder opens the native OS directory picker, initializes that directory
// as the active Vault, and persists the selection. Returns "" if cancelled by the user.
func (a *App) SelectVaultFolder() (string, error) {
	dir, err := a.PickVaultFolder()
	if err != nil || dir == "" {
		return "", err
	}
	detected, _ := a.DetectVaultInfo(dir)
	if err := a.SaveVault(detected, true); err != nil {
		return "", err
	}
	return dir, nil
}

func (a *App) ensureVaultInConfig(dir string) error {
	dir = filepath.Clean(dir)
	cfg, err := config.Load()
	if err != nil {
		cfg = config.Config{}
	}
	cfg.VaultPath = dir
	found := false
	for _, v := range cfg.Vaults {
		if filepath.Clean(v.Path) == dir {
			found = true
			break
		}
	}
	if !found {
		name := filepath.Base(dir)
		if name == "" || name == "." || name == string(filepath.Separator) {
			name = dir
		}
		detected := gitsync.DetectGitInfo(dir)
		cfg.Vaults = append(cfg.Vaults, config.VaultEntry{
			Path:          dir,
			Name:          name,
			GitRepoURL:    detected.RepoURL,
			GitBranch:     detected.Branch,
			GitAuthMethod: string(detected.AuthMethod),
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

// GetLanguage returns the currently active language ("vi" or "en").
func (a *App) GetLanguage() string {
	a.langMu.RLock()
	defer a.langMu.RUnlock()
	if a.language == "" {
		return "vi"
	}
	return a.language
}

// SaveAppSettings updates general settings like theme and language.
func (a *App) SaveAppSettings(theme, language string) error {
	a.langMu.Lock()
	if language != "" {
		a.language = language
	}
	a.langMu.Unlock()

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Theme = theme
	cfg.Language = language
	return config.Save(cfg)
}

// GetFileFilterConfig returns the file filtering configuration.
func (a *App) GetFileFilterConfig() (config.FileFilterConfig, error) {
	cfg, err := config.Load()
	if err != nil {
		return config.DefaultFileFilterConfig(), err
	}
	return cfg.FileFilter, nil
}

// SaveFileFilterConfig persists the file filter settings to config.json.
func (a *App) SaveFileFilterConfig(filter config.FileFilterConfig) error {
	cfg, err := config.Load()
	if err != nil {
		cfg = config.Config{}
	}
	cfg.FileFilter = filter
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

// GetSyncSettings returns the current sync settings (loaded from active vault in config.json).
func (a *App) GetSyncSettings() (SyncSettings, error) {
	cfg, err := config.Load()
	if err != nil {
		return SyncSettings{}, err
	}
	root := a.vault.Root()
	var entry *config.VaultEntry
	for i := range cfg.Vaults {
		if filepath.Clean(cfg.Vaults[i].Path) == filepath.Clean(root) {
			entry = &cfg.Vaults[i]
			break
		}
	}
	repoURL := ""
	branch := "main"
	auth := string(gitsync.AuthNone)
	if entry != nil {
		repoURL = entry.GitRepoURL
		if entry.GitBranch != "" {
			branch = entry.GitBranch
		}
		if entry.GitAuthMethod != "" {
			auth = entry.GitAuthMethod
		}
	} else {
		repoURL = cfg.GitRepoURL
		if cfg.GitBranch != "" {
			branch = cfg.GitBranch
		}
		if cfg.GitAuthMethod != "" {
			auth = cfg.GitAuthMethod
		}
	}
	_, hasPAT, _ := gitsync.GetPAT()
	return SyncSettings{
		RepoURL:    repoURL,
		Branch:     branch,
		AuthMethod: auth,
		HasPAT:     hasPAT,
	}, nil
}

// ConfigureSync saves GitHub sync settings, applies them to the active Vault
// (running git init/remote if needed), and starts periodic synchronization.
func (a *App) ConfigureSync(repoURL, branch, authMethod string) error {
	root := a.vault.Root()
	if root == "" {
		return errors.New("no active vault")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	for i := range cfg.Vaults {
		if filepath.Clean(cfg.Vaults[i].Path) == filepath.Clean(root) {
			cfg.Vaults[i].GitRepoURL = repoURL
			cfg.Vaults[i].GitBranch = branch
			cfg.Vaults[i].GitAuthMethod = authMethod
			break
		}
	}
	if err := config.Save(cfg); err != nil {
		return err
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
