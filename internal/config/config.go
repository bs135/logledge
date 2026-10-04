// Package config manages Logledge application-level configuration (e.g., the
// currently selected Vault path), stored as JSON in the OS standard config
// directory (os.UserConfigDir()/logledge/config.json).
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type VaultEntry struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	GitRepoURL    string `json:"gitRepoUrl,omitempty"`
	GitBranch     string `json:"gitBranch,omitempty"`
	GitAuthMethod string `json:"gitAuthMethod,omitempty"` // "none" | "pat" | "ssh"
}

// FileFilterConfig defines settings for filtering file types displayed in the vault tree.
type FileFilterConfig struct {
	Enabled   bool     `json:"enabled"`
	Mode      string   `json:"mode"` // "whitelist" | "blacklist"
	Whitelist []string `json:"whitelist"`
	Blacklist []string `json:"blacklist"`
}

// DefaultFileFilterConfig returns the standard file filter configuration.
func DefaultFileFilterConfig() FileFilterConfig {
	return FileFilterConfig{
		Enabled:   true,
		Mode:      "whitelist",
		Whitelist: []string{".md", ".markdown", ".txt"},
		Blacklist: []string{".exe", ".bin", ".dll", ".logledge"},
	}
}

// Config represents the application settings persisted across sessions.
type Config struct {
	// VaultPath is the absolute path to the Vault root directory selected by the user.
	VaultPath string `json:"vaultPath"`

	// Vaults stores the list of known vaults for multi-vault switching.
	Vaults []VaultEntry `json:"vaults,omitempty"`

	// Theme preference: "dark" | "light" | "system"
	Theme string `json:"theme,omitempty"`

	// Language preference: "vi" | "en"
	Language string `json:"language,omitempty"`

	// GitHub synchronization configuration fields (Phase 4). The Personal Access Token
	// is NOT stored here — it is kept securely in the OS Keychain via go-keyring.
	GitRepoURL    string `json:"gitRepoUrl,omitempty"`
	GitBranch     string `json:"gitBranch,omitempty"`
	GitAuthMethod string `json:"gitAuthMethod,omitempty"` // "none" | "pat" | "ssh"

	// FileFilter preferences for explorer tree display.
	FileFilter FileFilterConfig `json:"fileFilter"`
}

// path returns the on-disk path to config.json.
func path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(dir, "logledge")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(appDir, "config.json"), nil
}

// Load reads configuration from disk. If the file does not exist, it returns an empty Config with defaults without error.
func Load() (Config, error) {
	p, err := path()
	if err != nil {
		return Config{FileFilter: DefaultFileFilterConfig()}, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return Config{FileFilter: DefaultFileFilterConfig()}, nil
		}
		return Config{FileFilter: DefaultFileFilterConfig()}, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{FileFilter: DefaultFileFilterConfig()}, err
	}
	if cfg.FileFilter.Mode == "" && len(cfg.FileFilter.Whitelist) == 0 && len(cfg.FileFilter.Blacklist) == 0 {
		cfg.FileFilter = DefaultFileFilterConfig()
	}
	if cfg.FileFilter.Whitelist == nil {
		cfg.FileFilter.Whitelist = []string{}
	}
	if cfg.FileFilter.Blacklist == nil {
		cfg.FileFilter.Blacklist = []string{}
	}
	return cfg, nil
}

// Save writes the configuration to disk as formatted JSON.
func Save(cfg Config) error {
	p, err := path()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}
