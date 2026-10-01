package gitsync

import "github.com/zalando/go-keyring"

// keyringService/keyringUser xác định mục nhập trong OS Keychain
// (Windows Credential Manager / macOS Keychain / Linux Secret Service) dùng
// để lưu GitHub Personal Access Token. Chỉ hỗ trợ 1 PAT toàn cục cho mỗi máy
// người dùng (đơn giản hoá cho MVP — đủ dùng vì thường chỉ có 1 Vault/1 tài
// khoản GitHub trên mỗi máy).
const (
	keyringService = "logledge"
	keyringUser    = "github-pat"
)

// SetPAT lưu Personal Access Token vào OS Keychain, không bao giờ ghi ra đĩa
// dạng plaintext.
func SetPAT(pat string) error {
	return keyring.Set(keyringService, keyringUser, pat)
}

// GetPAT đọc PAT từ OS Keychain. ok=false nếu chưa từng lưu.
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

// ClearPAT xoá PAT khỏi OS Keychain (dùng khi người dùng đổi/xoá cấu hình đồng bộ).
func ClearPAT() error {
	err := keyring.Delete(keyringService, keyringUser)
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}
