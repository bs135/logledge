package gitsync

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectGitInfo_NonGitDirectory(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "logledge-detect-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	info := DetectGitInfo(tempDir)
	if info.RepoURL != "" {
		t.Errorf("expected empty RepoURL, got %q", info.RepoURL)
	}
	if info.Branch != "main" {
		t.Errorf("expected branch main, got %q", info.Branch)
	}
	if info.AuthMethod != AuthNone {
		t.Errorf("expected AuthNone, got %q", info.AuthMethod)
	}
}

func TestDetectGitInfo_GitWithoutRemote(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "logledge-detect-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	gitDir := filepath.Join(tempDir, ".git")
	if err := os.MkdirAll(gitDir, 0755); err != nil {
		t.Fatal(err)
	}

	info := DetectGitInfo(tempDir)
	if info.RepoURL != "" {
		t.Errorf("expected empty RepoURL, got %q", info.RepoURL)
	}
	if info.AuthMethod != AuthNone {
		t.Errorf("expected AuthNone, got %q", info.AuthMethod)
	}
}

func TestDetectGitInfo_ConfigParsing(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "logledge-detect-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	gitDir := filepath.Join(tempDir, ".git")
	if err := os.MkdirAll(gitDir, 0755); err != nil {
		t.Fatal(err)
	}

	configContent := `[core]
	repositoryformatversion = 0
	filemode = false
	bare = false
[remote "origin"]
	url = https://github.com/sample/test-repo.git
	fetch = +refs/heads/*:refs/remotes/origin/*
`
	if err := os.WriteFile(filepath.Join(gitDir, "config"), []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	headContent := "ref: refs/heads/develop\n"
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte(headContent), 0644); err != nil {
		t.Fatal(err)
	}

	info := DetectGitInfo(tempDir)
	if info.RepoURL != "https://github.com/sample/test-repo.git" {
		t.Errorf("expected https url, got %q", info.RepoURL)
	}
	if info.Branch != "develop" {
		t.Errorf("expected branch develop, got %q", info.Branch)
	}
	if info.AuthMethod != AuthPAT {
		t.Errorf("expected AuthPAT for https, got %q", info.AuthMethod)
	}
}

func TestDetectGitInfo_SSHConfigParsing(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "logledge-detect-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	gitDir := filepath.Join(tempDir, ".git")
	if err := os.MkdirAll(gitDir, 0755); err != nil {
		t.Fatal(err)
	}

	configContent := `[remote "origin"]
	url = git@github.com:sample/ssh-repo.git
`
	if err := os.WriteFile(filepath.Join(gitDir, "config"), []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	info := DetectGitInfo(tempDir)
	if info.RepoURL != "git@github.com:sample/ssh-repo.git" {
		t.Errorf("expected ssh url, got %q", info.RepoURL)
	}
	if info.AuthMethod != AuthSSH {
		t.Errorf("expected AuthSSH for git@, got %q", info.AuthMethod)
	}
}
