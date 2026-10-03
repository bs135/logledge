//go:build windows

package tray

import (
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
