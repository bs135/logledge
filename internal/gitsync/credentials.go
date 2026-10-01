package gitsync

import "github.com/zalando/go-keyring"

// keyringService and keyringUser identify the entry in the OS Keychain
// (Windows Credential Manager / macOS Keychain / Linux Secret Service) used
// to store the GitHub Personal Access Token. Only 1 global PAT per user machine
// is supported (simplified for MVP — sufficient for the common use case of
// 1 Vault / 1 GitHub account per machine).
const (
	keyringService = "logledge"
	keyringUser    = "github-pat"
)

// SetPAT stores the Personal Access Token in the OS Keychain, never writing
// it to disk in plaintext.
func SetPAT(pat string) error {
	return keyring.Set(keyringService, keyringUser, pat)
}

// GetPAT retrieves the PAT from the OS Keychain. Returns ok=false if not found.
func GetPAT() (pat string, ok bool, err error) {
	pat, err = keyring.Get(keyringService, keyringUser)
	if err == keyring.ErrNotFound {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return pat, true, nil
}

// ClearPAT removes the PAT from the OS Keychain (used when changing or resetting sync settings).
func ClearPAT() error {
	err := keyring.Delete(keyringService, keyringUser)
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}
