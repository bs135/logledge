package config

import (
	"encoding/json"
	"testing"
)

func TestConfigJSONSerialization(t *testing.T) {
	cfg := Config{
		VaultPath: "/path/to/vault-a",
		Vaults: []VaultEntry{
			{
				Path:          "/path/to/vault-a",
				Name:          "vault-a",
				GitRepoURL:    "https://github.com/example/vault-a.git",
				GitBranch:     "main",
				GitAuthMethod: "pat",
			},
			{
				Path:          "/path/to/vault-b",
				Name:          "vault-b",
				GitRepoURL:    "git@github.com:example/vault-b.git",
				GitBranch:     "develop",
				GitAuthMethod: "ssh",
			},
		},
		Theme:    "dark",
		Language: "vi",
	}

	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var parsed Config
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if parsed.VaultPath != cfg.VaultPath {
		t.Errorf("expected VaultPath %q, got %q", cfg.VaultPath, parsed.VaultPath)
	}
	if len(parsed.Vaults) != 2 {
		t.Fatalf("expected 2 vaults, got %d", len(parsed.Vaults))
	}
	if parsed.Vaults[0].Name != "vault-a" || parsed.Vaults[1].Name != "vault-b" {
		t.Errorf("unexpected vaults list: %+v", parsed.Vaults)
	}
	if parsed.Vaults[0].GitRepoURL != "https://github.com/example/vault-a.git" || parsed.Vaults[0].GitAuthMethod != "pat" {
		t.Errorf("unexpected vault-a git settings: %+v", parsed.Vaults[0])
	}
	if parsed.Vaults[1].GitRepoURL != "git@github.com:example/vault-b.git" || parsed.Vaults[1].GitAuthMethod != "ssh" {
		t.Errorf("unexpected vault-b git settings: %+v", parsed.Vaults[1])
	}
	if parsed.Theme != "dark" {
		t.Errorf("expected Theme dark, got %q", parsed.Theme)
	}
	if parsed.Language != "vi" {
		t.Errorf("expected Language vi, got %q", parsed.Language)
	}
}
