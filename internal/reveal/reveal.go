// Package reveal opens the operating system's file manager (File Explorer,
// Finder, or the desktop file manager on Linux) with a given file or folder
// selected.
package reveal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Path opens the system file manager at the location of absPath, selecting the
// entry when the platform supports it.
func Path(absPath string) error {
	if !filepath.IsAbs(absPath) {
		return errors.New("reveal: path must be absolute")
	}
	absPath = filepath.Clean(absPath)
	if _, err := os.Stat(absPath); err != nil {
		return fmt.Errorf("reveal: %w", err)
	}
	if err := reveal(absPath); err != nil {
		return fmt.Errorf("reveal: cannot open file manager: %w", err)
	}
	return nil
}
