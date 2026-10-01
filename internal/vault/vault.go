// Package vault triển khai VaultService: quản lý cây thư mục/file của một
// Vault Logledge trên đĩa (liệt kê, tạo, đổi tên, di chuyển, xoá-vào-thùng-rác),
// đồng thời wiring với watcher package để phát sự kiện thay đổi tới frontend.
package vault

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Bios-Marcel/wastebasket/v2"

	"logledge/internal/watcher"
)

// suppressWindow là khoảng thời gian sau một thao tác ghi của chính app mà
// watcher sẽ bỏ qua sự kiện fsnotify tương ứng (tránh watcher tự phản ứng lại).
const suppressWindow = 2 * time.Second

// debounceInterval gộp nhiều sự kiện thay đổi liên tiếp (vd: git pull, copy
// hàng loạt file) thành một lần thông báo duy nhất cho frontend.
const debounceInterval = 300 * time.Millisecond

// Node đại diện một file hoặc thư mục trong cây Vault, dùng để serialize
// sang JSON cho frontend.
type Node struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"` // đường dẫn tương đối, phân tách bằng "/"
	IsDir    bool    `json:"isDir"`
	Children []*Node `json:"children,omitempty"`
}

// Service là VaultService: điểm truy cập duy nhất backend dùng để thao tác
// với Vault hiện đang mở.
type Service struct {
	root    string
	watch   *watcher.Watcher
	onEvent func() // gọi khi cây thay đổi (debounced), dùng để bắn Wails event
}

// New tạo Service chưa mở Vault nào. onEvent được gọi (debounced) mỗi khi
// nội dung Vault thay đổi trên đĩa (kể cả do bên ngoài sửa) sau khi Open.
func New(onEvent func()) *Service {
	return &Service{onEvent: onEvent}
}

// Open thiết lập root làm Vault hiện tại và khởi động file watcher.
// Gọi lại Open sẽ đóng watcher cũ (nếu có) trước khi mở watcher mới.
func (s *Service) Open(root string) error {
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("không thể mở vault: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("đường dẫn vault không phải là thư mục: %s", root)
	}

	if s.watch != nil {
		_ = s.watch.Close()
		s.watch = nil
	}

	root = filepath.Clean(root)
	w, err := watcher.New(root, debounceInterval, s.onEvent)
	if err != nil {
		return fmt.Errorf("không thể khởi động watcher: %w", err)
	}

	s.root = root
	s.watch = w
	return nil
}

// Root trả về đường dẫn tuyệt đối của Vault đang mở, hoặc "" nếu chưa mở.
func (s *Service) Root() string {
	return s.root
}

// isOpen kiểm tra Vault đã được mở chưa.
func (s *Service) isOpen() bool {
	return s.root != ""
}

// resolve chuyển một đường dẫn tương đối (dùng dấu "/") thành đường dẫn tuyệt
// đối trên đĩa, đồng thời chống path traversal (vd: "../../etc").
func (s *Service) resolve(relPath string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(relPath))
	if clean == "." {
		return s.root, nil
	}
	abs := filepath.Join(s.root, clean)
	rootWithSep := s.root + string(os.PathSeparator)
	if abs != s.root && !strings.HasPrefix(abs, rootWithSep) {
		return "", errors.New("đường dẫn nằm ngoài vault")
	}
	return abs, nil
}

// relFromAbs chuyển đường dẫn tuyệt đối trên đĩa về dạng tương đối "/"-separated.
func (s *Service) relFromAbs(abs string) string {
	rel, err := filepath.Rel(s.root, abs)
	if err != nil {
		return abs
	}
	return filepath.ToSlash(rel)
}

// isHidden xác định các entry không hiển thị trong cây (quản lý nội bộ):
// .git (Phase 4 sync) và các file/thư mục dotfile khác.
func isHidden(name string) bool {
	return strings.HasPrefix(name, ".")
}

// Tree liệt kê toàn bộ cây thư mục Vault, sắp xếp thư mục trước, tên A-Z.
func (s *Service) Tree() (*Node, error) {
	if !s.isOpen() {
		return nil, errors.New("chưa mở vault nào")
	}
	return s.buildNode(s.root, "")
}

func (s *Service) buildNode(abs, name string) (*Node, error) {
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}

	node := &Node{
		Name:  name,
		Path:  s.relFromAbs(abs),
		IsDir: true,
	}

	var children []*Node
	for _, e := range entries {
		if isHidden(e.Name()) {
			continue
		}
		childAbs := filepath.Join(abs, e.Name())
		if e.IsDir() {
			childNode, err := s.buildNode(childAbs, e.Name())
			if err != nil {
				continue // bỏ qua thư mục lỗi (permission...), không fail cả cây
			}
			children = append(children, childNode)
		} else {
			children = append(children, &Node{
				Name:  e.Name(),
				Path:  s.relFromAbs(childAbs),
				IsDir: false,
			})
		}
	}

	sort.Slice(children, func(i, j int) bool {
		if children[i].IsDir != children[j].IsDir {
			return children[i].IsDir // thư mục trước file
		}
		return strings.ToLower(children[i].Name) < strings.ToLower(children[j].Name)
	})

	node.Children = children
	return node, nil
}

// suppress đánh dấu path để watcher bỏ qua sự kiện fsnotify kế tiếp do chính
// thao tác này gây ra.
func (s *Service) suppress(abs string) {
	if s.watch != nil {
		s.watch.Suppress(abs, suppressWindow)
	}
}

// CreateFile tạo file .md rỗng mới tại parentRelPath/name. Nếu name không có
// phần mở rộng, ".md" sẽ được thêm tự động.
func (s *Service) CreateFile(parentRelPath, name string) (string, error) {
	if !strings.Contains(filepath.Base(name), ".") {
		name += ".md"
	}
	parentAbs, err := s.resolve(parentRelPath)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(parentAbs, name)
	if _, err := os.Stat(abs); err == nil {
		return "", fmt.Errorf("đã tồn tại: %s", name)
	}
	s.suppress(abs)
	if err := os.WriteFile(abs, []byte{}, 0o644); err != nil {
		return "", err
	}
	return s.relFromAbs(abs), nil
}

// CreateFolder tạo thư mục con mới tại parentRelPath/name.
func (s *Service) CreateFolder(parentRelPath, name string) (string, error) {
	parentAbs, err := s.resolve(parentRelPath)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(parentAbs, name)
	if _, err := os.Stat(abs); err == nil {
		return "", fmt.Errorf("đã tồn tại: %s", name)
	}
	s.suppress(abs)
	if err := os.Mkdir(abs, 0o755); err != nil {
		return "", err
	}
	return s.relFromAbs(abs), nil
}

// Rename đổi tên file/thư mục tại relPath thành newName (giữ nguyên thư mục cha).
func (s *Service) Rename(relPath, newName string) (string, error) {
	abs, err := s.resolve(relPath)
	if err != nil {
		return "", err
	}
	newAbs := filepath.Join(filepath.Dir(abs), newName)
	if _, err := os.Stat(newAbs); err == nil {
		return "", fmt.Errorf("đã tồn tại: %s", newName)
	}
	s.suppress(abs)
	s.suppress(newAbs)
	if err := os.Rename(abs, newAbs); err != nil {
		return "", err
	}
	return s.relFromAbs(newAbs), nil
}

// Move di chuyển file/thư mục tại srcRelPath vào bên trong destParentRelPath
// (dùng cho thao tác kéo-thả trên cây thư mục).
func (s *Service) Move(srcRelPath, destParentRelPath string) (string, error) {
	srcAbs, err := s.resolve(srcRelPath)
	if err != nil {
		return "", err
	}
	destParentAbs, err := s.resolve(destParentRelPath)
	if err != nil {
		return "", err
	}
	destAbs := filepath.Join(destParentAbs, filepath.Base(srcAbs))
	if strings.HasPrefix(destAbs+string(os.PathSeparator), srcAbs+string(os.PathSeparator)) {
		return "", errors.New("không thể di chuyển thư mục vào chính nó")
	}
	if _, err := os.Stat(destAbs); err == nil {
		return "", fmt.Errorf("đã tồn tại: %s", filepath.Base(destAbs))
	}
	s.suppress(srcAbs)
	s.suppress(destAbs)
	if err := os.Rename(srcAbs, destAbs); err != nil {
		return "", err
	}
	return s.relFromAbs(destAbs), nil
}

// Delete chuyển file/thư mục tại relPath vào thùng rác hệ điều hành (không
// xoá vĩnh viễn), qua thư viện wastebasket (Windows Shell32 / FreeDesktop
// Trash spec trên Linux / Finder trên macOS).
func (s *Service) Delete(relPath string) error {
	abs, err := s.resolve(relPath)
	if err != nil {
		return err
	}
	s.suppress(abs)
	return wastebasket.Trash(abs)
}

// ReadFile đọc nội dung file tại relPath (dùng cho editor ở Phase 2).
func (s *Service) ReadFile(relPath string) (string, error) {
	abs, err := s.resolve(relPath)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile ghi đè nội dung file tại relPath (dùng cho auto-save ở Phase 2).
func (s *Service) WriteFile(relPath, content string) error {
	abs, err := s.resolve(relPath)
	if err != nil {
		return err
	}
	s.suppress(abs)
	return os.WriteFile(abs, []byte(content), 0o644)
}
