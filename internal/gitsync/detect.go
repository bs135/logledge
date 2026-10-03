package gitsync

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type DetectedGitInfo struct {
	RepoURL    string     `json:"repoUrl"`
	Branch     string     `json:"branch"`
	AuthMethod AuthMethod `json:"authMethod"`
}

// DetectGitInfo attempts to detect the Git remote URL, current branch, and
// corresponding authentication method for the repository located at dir.
func DetectGitInfo(dir string) DetectedGitInfo {
	info := DetectedGitInfo{
		Branch:     "main",
		AuthMethod: AuthPAT,
	}

	// 1. Try git CLI first
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = dir
	prepareCmd(cmd)
	if out, err := cmd.Output(); err == nil {
		info.RepoURL = strings.TrimSpace(string(out))
	}

	if info.RepoURL == "" {
		cmdConfig := exec.Command("git", "config", "--get", "remote.origin.url")
		cmdConfig.Dir = dir
		prepareCmd(cmdConfig)
		if out, err := cmdConfig.Output(); err == nil {
			info.RepoURL = strings.TrimSpace(string(out))
		}
	}

	// 2. Fallback: Parse .git/config directly if git CLI didn't find it or failed
	if info.RepoURL == "" {
		gitConfigPath := filepath.Join(dir, ".git", "config")
		if f, err := os.Open(gitConfigPath); err == nil {
			defer f.Close()
			scanner := bufio.NewScanner(f)
			inOriginRemote := false
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "[") {
					inOriginRemote = strings.EqualFold(line, `[remote "origin"]`)
					continue
				}
				if inOriginRemote && strings.HasPrefix(line, "url") {
					parts := strings.SplitN(line, "=", 2)
					if len(parts) == 2 {
						info.RepoURL = strings.TrimSpace(parts[1])
						break
					}
				}
			}
		}
	}

	// 3. Detect branch
	cmdBranch := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmdBranch.Dir = dir
	prepareCmd(cmdBranch)
	if out, err := cmdBranch.Output(); err == nil {
		b := strings.TrimSpace(string(out))
		if b != "" && b != "HEAD" {
			info.Branch = b
		}
	}

	if info.Branch == "main" {
		gitHeadPath := filepath.Join(dir, ".git", "HEAD")
		if data, err := os.ReadFile(gitHeadPath); err == nil {
			content := strings.TrimSpace(string(data))
			if strings.HasPrefix(content, "ref: refs/heads/") {
				b := strings.TrimPrefix(content, "ref: refs/heads/")
				if b != "" {
					info.Branch = b
				}
			}
		}
	}

	// 4. Select authentication method based on repo URL
	if info.RepoURL != "" {
		trimmed := strings.ToLower(info.RepoURL)
		if strings.HasPrefix(trimmed, "git@") || strings.HasPrefix(trimmed, "ssh://") {
			info.AuthMethod = AuthSSH
		} else {
			info.AuthMethod = AuthPAT
		}
	} else {
		info.AuthMethod = AuthPAT
	}

	return info
}
