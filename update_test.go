package main

import (
	"context"
	"errors"
	"testing"

	"logledge/internal/updater"
)

func TestParseAppVersion(t *testing.T) {
	if got := parseAppVersion([]byte(`{"info":{"productVersion":"1.2.3"}}`)); got != "1.2.3" {
		t.Errorf("parseAppVersion = %q, want 1.2.3", got)
	}
	if got := parseAppVersion([]byte(`not json`)); got != "0.0.0" {
		t.Errorf("parseAppVersion(invalid) = %q, want 0.0.0", got)
	}
}

func TestGetAppVersionMatchesWailsConfig(t *testing.T) {
	if v := NewApp().GetAppVersion(); v == "" || v == "0.0.0" {
		t.Errorf("GetAppVersion returned %q; expected embedded wails.json productVersion", v)
	}
}

func TestCheckForUpdatePassesCurrentVersion(t *testing.T) {
	orig := checkForUpdateFunc
	defer func() { checkForUpdateFunc = orig }()

	app := NewApp()
	var gotVersion string
	checkForUpdateFunc = func(ctx context.Context, currentVersion string) (updater.Info, error) {
		gotVersion = currentVersion
		return updater.Info{CurrentVersion: currentVersion, LatestVersion: "99.0.0", Available: true}, nil
	}
	info, err := app.CheckForUpdate()
	if err != nil {
		t.Fatalf("CheckForUpdate returned error: %v", err)
	}
	if gotVersion != app.GetAppVersion() || !info.Available {
		t.Errorf("unexpected result: version=%q info=%+v", gotVersion, info)
	}

	checkForUpdateFunc = func(ctx context.Context, currentVersion string) (updater.Info, error) {
		return updater.Info{}, errors.New("offline")
	}
	if _, err := app.CheckForUpdate(); err == nil {
		t.Error("expected error to be propagated")
	}
}
