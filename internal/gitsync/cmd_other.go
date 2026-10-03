//go:build !windows

package gitsync

import "os/exec"

func prepareCmd(cmd *exec.Cmd) {
	// No-op on non-Windows platforms
}
