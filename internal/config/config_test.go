package config

import (
	"encoding/json"
	"testing"
)

func TestConfigJSONSerialization(t *testing.T) {
	cfg := Config{
		VaultPath: "/path/to/vault-a",
		Vaults: []VaultEntry{
			{Path: "/path/to/vault-a", Name: "vault-a"},
			{Path: "/path/to/vault-b", Name: "vault-b"},
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
	if parsed.Theme != "dark" {
		t.Errorf("expected Theme dark, got %q", parsed.Theme)
	}
	if parsed.Language != "vi" {
		t.Errorf("expected Language vi, got %q", parsed.Language)
	}
}
