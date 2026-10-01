// Package config quản lý cấu hình cấp ứng dụng của Logledge (ví dụ: đường
// dẫn Vault đang được chọn), lưu dưới dạng JSON trong thư mục config chuẩn
// của hệ điều hành (os.UserConfigDir()/logledge/config.json).
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config là toàn bộ cấu hình được lưu bền vững giữa các lần chạy app.
type Config struct {
	// VaultPath là đường dẫn tuyệt đối tới thư mục gốc Vault do người dùng chọn.
	VaultPath string `json:"vaultPath"`
}

// path trả về đường dẫn tới file config.json trên đĩa.
func path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(dir, "logledge")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(appDir, "config.json"), nil
}

// Load đọc config từ đĩa. Nếu file chưa tồn tại, trả về Config rỗng (không lỗi).
func Load() (Config, error) {
	p, err := path()
	if err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return Config{}, nil
		}
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Save ghi config xuống đĩa dạng JSON.
func Save(cfg Config) error {
	p, err := path()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}
