//go:build !windows && !darwin

package reveal

import (
	"net/url"
	"os/exec"
	"path/filepath"
)

func reveal(absPath string) error {
	// Prefer the freedesktop FileManager1 D-Bus interface, which opens the parent
	// folder with the entry selected (supported by Nautilus, Dolphin, Nemo...).
	uri := (&url.URL{Scheme: "file", Path: absPath}).String()
	showItems := exec.Command("dbus-send", "--session", "--print-reply",
		"--dest=org.freedesktop.FileManager1", "--type=method_call",
		"/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
		"array:string:"+uri, "string:")
	if err := showItems.Run(); err == nil {
		return nil
	}

	// Fallback: open the containing folder without selection.
	cmd := exec.Command("xdg-open", filepath.Dir(absPath))
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
