//go:build windows

package tray

import (
	"context"
	"encoding/binary"
	"testing"
)

func TestLoadTrayIcon(t *testing.T) {
	if len(embeddedIcon) < 6 {
		t.Fatalf("embeddedIcon is too short: %d bytes", len(embeddedIcon))
	}

	count := int(binary.LittleEndian.Uint16(embeddedIcon[4:6]))
	t.Logf("Embedded icon count: %d", count)

	hIcon := loadTrayIcon(0)
	if hIcon == 0 {
		t.Fatal("loadTrayIcon returned 0")
	}
	t.Logf("Successfully loaded tray icon handle: %v", hIcon)

	// Clean up icon
	if procDestroyIcon != nil {
		procDestroyIcon.Call(uintptr(hIcon))
	}
}

func TestGetMenuLabels(t *testing.T) {
	showVi, syncVi, quitVi := getMenuLabels("vi")
	if showVi != "Mở Logledge" || syncVi != "Đồng bộ ngay" || quitVi != "Thoát" {
		t.Errorf("Unexpected Vietnamese labels: %s, %s, %s", showVi, syncVi, quitVi)
	}

	showEn, syncEn, quitEn := getMenuLabels("en")
	if showEn != "Open Logledge" || syncEn != "Sync Now" || quitEn != "Quit" {
		t.Errorf("Unexpected English labels: %s, %s, %s", showEn, syncEn, quitEn)
	}

	// Default fallback for unknown or empty
	showDef, syncDef, quitDef := getMenuLabels("")
	if showDef != "Mở Logledge" || syncDef != "Đồng bộ ngay" || quitDef != "Thoát" {
		t.Errorf("Unexpected fallback labels: %s, %s, %s", showDef, syncDef, quitDef)
	}
}

func TestTrayStartAndCleanup(t *testing.T) {
	cleanup := Start(context.Background(), nil)
	if cleanup == nil {
		t.Fatal("Start returned nil cleanup function")
	}
	cleanup()
	// Calling cleanup a second time should be safe and no-op
	cleanup()
}

func TestTrayIdempotentStart(t *testing.T) {
	cleanup1 := Start(context.Background(), nil)
	if cleanup1 == nil {
		t.Fatal("First Start returned nil cleanup function")
	}
	// Calling Start again while active should replace and clean up the previous instance
	cleanup2 := Start(context.Background(), nil)
	if cleanup2 == nil {
		t.Fatal("Second Start returned nil cleanup function")
	}
	cleanup2()
}

