//go:build darwin

package reveal

import "os/exec"

func reveal(absPath string) error {
	cmd := exec.Command("open", "-R", absPath)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
