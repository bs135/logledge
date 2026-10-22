// Package vault implements VaultService: manages the file/folder tree of a
// Logledge Vault on disk (listing, creating, renaming, moving, trash-to-recycle-bin),
// and wires with the watcher package to emit change events to the frontend.
package vault

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
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

	// worktreeMu serializes every app-initiated mutation of the Vault working tree
	// with Git sync operations (auto-commit, merge, conflict resolution), so an
	// editor auto-save can never interleave with a sync in progress.
	worktreeMu sync.Mutex
}

// WriteResult reports the outcome of WriteFileIfUnchanged.
type WriteResult struct {
	// Saved is true when the content was written to disk.
	Saved bool `json:"saved"`
	// DiskContent holds the current on-disk content when Saved is false, i.e.
	// the file was modified externally (e.g., by Git sync) since the editor last
	// loaded or saved it.
	DiskContent string `json:"diskContent"`
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

// WorktreeLocker returns the lock guarding app-initiated working tree mutations.
// GitSync holds it while committing and merging so that no Vault write happens
// in the middle of a sync.
func (s *Service) WorktreeLocker() sync.Locker {
	return &s.worktreeMu
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
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
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
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
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
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
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
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
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

// AbsPath returns the absolute, OS-native path on disk of the entry at relPath.
func (s *Service) AbsPath(relPath string) (string, error) {
	if !s.isOpen() {
		return "", errors.New("chưa mở vault nào")
	}
	return s.resolve(relPath)
}

// NativeRelPath returns relPath (relative to the Vault root) using the OS-native
// path separator, e.g. "folder\Note.md" on Windows.
func (s *Service) NativeRelPath(relPath string) (string, error) {
	abs, err := s.AbsPath(relPath)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(s.root, abs)
	if err != nil {
		return "", err
	}
	return rel, nil
}

// copyName returns the first name not yet present in dir for a copy of name:
// "Note.md" -> "Note copy.md" -> "Note copy (1).md" -> "Note copy (2).md"...
// Folder names keep any dots intact ("v1.2" -> "v1.2 copy").
func copyName(dir, name string, isDir bool) string {
	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
		if ext == name {
			ext = "" // dotfile without a real extension, e.g. ".env"
		}
	}
	base := strings.TrimSuffix(name, ext)
	candidate := base + " copy" + ext
	for i := 1; ; i++ {
		if _, err := os.Lstat(filepath.Join(dir, candidate)); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
		candidate = fmt.Sprintf("%s copy (%d)%s", base, i, ext)
	}
}

// Duplicate creates a copy of the file or folder at relPath next to the original,
// naming it with a " copy" suffix (plus a counter when that name is taken), and
// returns the relative path of the copy. Folders are copied recursively.
func (s *Service) Duplicate(relPath string) (string, error) {
	return s.Copy(relPath, filepath.ToSlash(filepath.Dir(filepath.FromSlash(relPath))))
}

// Copy copies the file or folder at srcRelPath into destParentRelPath (used by
// the file tree Copy/Paste actions) and returns the relative path of the copy.
// The original name is kept when free; otherwise a " copy" / " copy (n)" suffix
// is added. Folders are copied recursively and cannot be pasted into themselves.
func (s *Service) Copy(srcRelPath, destParentRelPath string) (string, error) {
	if !s.isOpen() {
		return "", errors.New("chưa mở vault nào")
	}
	srcAbs, err := s.resolve(srcRelPath)
	if err != nil {
		return "", err
	}
	if srcAbs == s.root {
		return "", errors.New("không thể sao chép thư mục gốc của vault")
	}
	destParentAbs, err := s.resolve(destParentRelPath)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(destParentAbs+string(os.PathSeparator), srcAbs+string(os.PathSeparator)) {
		return "", errors.New("không thể sao chép thư mục vào chính nó")
	}
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()

	info, err := os.Stat(srcAbs)
	if err != nil {
		return "", fmt.Errorf("không thể sao chép: %w", err)
	}
	if parentInfo, err := os.Stat(destParentAbs); err != nil || !parentInfo.IsDir() {
		return "", errors.New("thư mục đích không hợp lệ")
	}
	name := filepath.Base(srcAbs)
	if _, err := os.Lstat(filepath.Join(destParentAbs, name)); err == nil {
		name = copyName(destParentAbs, name, info.IsDir())
	}
	destAbs := filepath.Join(destParentAbs, name)

	if info.IsDir() {
		err = s.copyDir(srcAbs, destAbs)
	} else {
		err = s.copyFile(srcAbs, destAbs, info.Mode().Perm())
	}
	if err != nil {
		_ = os.RemoveAll(destAbs)
		return "", fmt.Errorf("không thể sao chép: %w", err)
	}
	return s.relFromAbs(destAbs), nil
}

// copyFile copies a single regular file, failing if dst already exists.
func (s *Service) copyFile(src, dst string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	s.suppress(dst)
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// copyDir recursively copies the directory tree at src into the new directory dst.
// Symlinks and other non-regular files are skipped. Created directories are
// intentionally not suppressed so the watcher picks them up and watches them.
func (s *Service) copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			if rel == "." {
				return os.Mkdir(target, info.Mode().Perm())
			}
			return os.MkdirAll(target, info.Mode().Perm())
		case info.Mode().IsRegular():
			return s.copyFile(path, target, info.Mode().Perm())
		default:
			return nil
		}
	})
}

// Delete moves the file/folder at relPath to the OS recycle bin (non-permanent
// deletion) using the wastebasket library (Windows Shell32 / FreeDesktop Trash
// spec on Linux / Finder on macOS).
func (s *Service) Delete(relPath string) error {
	abs, err := s.resolve(relPath)
	if err != nil {
		return err
	}
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
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
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
	s.suppress(abs)
	return os.WriteFile(abs, []byte(content), 0o644)
}

// WriteFileIfUnchanged is the auto-save entry point with optimistic concurrency:
// it writes content only if the file on disk still equals expected (the version
// the editor last loaded or saved). If the file was changed externally in the
// meantime (e.g., Git sync pulled a remote version or resolved a conflict), it
// does not overwrite it and returns the current disk content instead, letting
// the frontend ask the user whether to reload or keep the draft.
// A missing file is (re)created so unsaved edits are never lost.
func (s *Service) WriteFileIfUnchanged(relPath, content, expected string) (WriteResult, error) {
	abs, err := s.resolve(relPath)
	if err != nil {
		return WriteResult{}, err
	}
	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()

	data, err := os.ReadFile(abs)
	switch {
	case err == nil:
		disk := string(data)
		if disk == content {
			return WriteResult{Saved: true}, nil
		}
		if disk != expected {
			return WriteResult{Saved: false, DiskContent: disk}, nil
		}
	case !errors.Is(err, os.ErrNotExist):
		return WriteResult{}, err
	}

	s.suppress(abs)
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Saved: true}, nil
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

	s.worktreeMu.Lock()
	defer s.worktreeMu.Unlock()
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

// ReadAttachmentDataURL reads a local image referenced by a Markdown image link
// (e.g. "../.attachments/foo.png") and returns it as a "data:" URL. This exists
// because the AssetServer only serves embedded frontend assets, not arbitrary
// Vault files, so Live Preview cannot resolve a relative src through an HTTP URL.
// imgRelPath is resolved relative to the directory of noteRelPath.
func (s *Service) ReadAttachmentDataURL(noteRelPath, imgRelPath string) (string, error) {
	if !s.isOpen() {
		return "", errors.New("chưa mở vault nào")
	}
	noteDir := filepath.Dir(filepath.FromSlash(noteRelPath))
	joined := filepath.ToSlash(filepath.Join(noteDir, filepath.FromSlash(imgRelPath)))
	abs, err := s.resolve(joined)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	mimeType := mime.TypeByExtension(filepath.Ext(abs))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
