// Package vault implements VaultService: manages the file/folder tree of a
// Logledge Vault on disk (listing, creating, renaming, moving, trash-to-recycle-bin),
// and wires with the watcher package to emit change events to the frontend.
package vault

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Bios-Marcel/wastebasket/v2"

	"logledge/internal/watcher"
)

// suppressWindow is the duration following an app write during which the
// watcher ignores corresponding fsnotify events (preventing self-trigger loops).
const suppressWindow = 2 * time.Second

// debounceInterval aggregates consecutive change events (e.g., git pull, bulk
// file copy) into a single notification event for the frontend.
const debounceInterval = 300 * time.Millisecond

// Node represents a file or directory in the Vault tree, serialized
// to JSON for the frontend.
type Node struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"` // relative path, separated by "/"
	IsDir    bool    `json:"isDir"`
	Children []*Node `json:"children,omitempty"`
}

// Service represents VaultService: the backend single entry point for
// operating on the currently open Vault.
type Service struct {
	root    string
	watch   *watcher.Watcher
	onEvent func() // called on debounced file tree changes, used to emit Wails events
}

// New creates a Service with no Vault currently open. onEvent is called
// (debounced) whenever Vault contents change on disk after Open.
func New(onEvent func()) *Service {
	return &Service{onEvent: onEvent}
}

// Open sets root as the current Vault and initializes the file watcher.
// Re-calling Open closes the previous watcher (if any) before opening a new one.
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

// Root returns the absolute path of the open Vault, or "" if none is open.
func (s *Service) Root() string {
	return s.root
}

// isOpen checks whether a Vault has been opened.
func (s *Service) isOpen() bool {
	return s.root != ""
}

// resolve converts a "/"-separated relative path into an absolute path on disk,
// guarding against path traversal attacks (e.g., "../../etc").
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

// relFromAbs converts an absolute disk path to a "/"-separated relative path.
func (s *Service) relFromAbs(abs string) string {
	rel, err := filepath.Rel(s.root, abs)
	if err != nil {
		return abs
	}
	return filepath.ToSlash(rel)
}

// isHidden determines whether an entry should be hidden from the tree (internal management):
// .git (Phase 4 sync) and other dotfiles/dotfolders.
func isHidden(name string) bool {
	return strings.HasPrefix(name, ".")
}

// Tree lists the entire Vault folder hierarchy, sorting directories first, alphabetically A-Z.
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
				continue // skip inaccessible directories (permissions...), do not fail whole tree
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
			return children[i].IsDir // directories first
		}
		return strings.ToLower(children[i].Name) < strings.ToLower(children[j].Name)
	})

	node.Children = children
	return node, nil
}

// suppress marks a path so the watcher ignores the next fsnotify event
// triggered by this operation.
func (s *Service) suppress(abs string) {
	if s.watch != nil {
		s.watch.Suppress(abs, suppressWindow)
	}
}

// CreateFile creates a new empty .md file at parentRelPath/name. If name lacks
// an extension, ".md" is appended automatically.
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

// CreateFolder creates a new subdirectory at parentRelPath/name.
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

// Rename renames a file or directory at relPath to newName within the same parent folder.
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

// Move relocates a file/folder at srcRelPath into destParentRelPath
// (used for drag-and-drop operations in the file tree).
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

// Delete moves the file/folder at relPath to the OS recycle bin (non-permanent
// deletion) using the wastebasket library (Windows Shell32 / FreeDesktop Trash
// spec on Linux / Finder on macOS).
func (s *Service) Delete(relPath string) error {
	abs, err := s.resolve(relPath)
	if err != nil {
		return err
	}
	s.suppress(abs)
	return wastebasket.Trash(abs)
}

// ReadFile reads the file contents at relPath (used by editor in Phase 2).
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

// WriteFile overwrites file contents at relPath (used for auto-save in Phase 2).
func (s *Service) WriteFile(relPath, content string) error {
	abs, err := s.resolve(relPath)
	if err != nil {
		return err
	}
	s.suppress(abs)
	return os.WriteFile(abs, []byte(content), 0o644)
}

// unsafeFilenameChars matches characters that should not appear in filenames on
// Windows/macOS/Linux (preserves alphanumeric, spaces, hyphens, and underscores).
var unsafeFilenameChars = regexp.MustCompile(`[^\w\s.-]`)

func sanitizeFilename(name string) string {
	name = unsafeFilenameChars.ReplaceAllString(name, "_")
	if name == "" {
		return "image"
	}
	return name
}

// SaveAttachment saves an image pasted from clipboard (or drag-and-dropped) into
// `.attachments/` at the Vault root (base64-encoded from frontend), returning a
// relative Markdown link from the active note's directory to the image file.
func (s *Service) SaveAttachment(noteRelPath, filename, base64Data string) (string, error) {
	if !s.isOpen() {
		return "", errors.New("chưa mở vault nào")
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("dữ liệu ảnh không hợp lệ: %w", err)
	}

	attachDir := filepath.Join(s.root, ".attachments")
	if err := os.MkdirAll(attachDir, 0o755); err != nil {
		return "", err
	}

	ext := filepath.Ext(filename)
	base := sanitizeFilename(strings.TrimSuffix(filepath.Base(filename), ext))
	unique := fmt.Sprintf("%s-%d%s", base, time.Now().UnixNano(), ext)
	abs := filepath.Join(attachDir, unique)

	s.suppress(abs)
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return "", err
	}

	noteParentAbs, err := s.resolve(filepath.ToSlash(filepath.Dir(filepath.FromSlash(noteRelPath))))
	if err != nil {
		noteParentAbs = s.root
	}
	rel, err := filepath.Rel(noteParentAbs, abs)
	if err != nil {
		rel = filepath.Join(".attachments", unique)
	}
	return filepath.ToSlash(rel), nil
}
