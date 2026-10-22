package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"logledge/internal/updater"
)

// wailsConfig embeds wails.json so the backend shares the single source of truth
// for the app version (info.productVersion, bumped by release-please).
//
//go:embed wails.json
var wailsConfig []byte

const updateCheckTimeout = 10 * time.Second

// checkForUpdateFunc is overridable in tests to avoid network access.
var checkForUpdateFunc = func(ctx context.Context, currentVersion string) (updater.Info, error) {
	return updater.New().Check(ctx, currentVersion)
}

func parseAppVersion(data []byte) string {
	var cfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil || cfg.Info.ProductVersion == "" {
		return "0.0.0"
	}
	return cfg.Info.ProductVersion
}

// GetAppVersion returns the current application version.
func (a *App) GetAppVersion() string {
	return parseAppVersion(wailsConfig)
}

// CheckForUpdate queries GitHub Releases for a version newer than the running one.
// It is invoked asynchronously by the frontend so it never blocks cold start.
func (a *App) CheckForUpdate() (updater.Info, error) {
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, updateCheckTimeout)
	defer cancel()
	info, err := checkForUpdateFunc(ctx, a.GetAppVersion())
	if err != nil {
		return info, fmt.Errorf("check for update: %w", err)
	}
	return info, nil
}
