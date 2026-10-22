//go:build windows

package reveal

import (
	"fmt"
	"os/exec"
	"syscall"
)

func reveal(absPath string) error {
	cmd := exec.Command("explorer.exe")
	// explorer.exe expects the raw form `/select,"<path>"`; Go's default argument
	// quoting would wrap the whole switch in quotes, which explorer misparses.
	// Windows paths cannot contain double quotes, so this quoting is safe.
	// explorer.exe is a GUI process, so no console window needs to be hidden.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: fmt.Sprintf(`explorer.exe /select,"%s"`, absPath),
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	// explorer.exe exits with a non-zero code even on success, so only reap it.
	go func() { _ = cmd.Wait() }()
	return nil
}
