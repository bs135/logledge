// Package watcher bọc fsnotify để theo dõi toàn bộ cây thư mục của một Vault,
// tự thêm/bỏ watch khi thư mục con được tạo/xoá, gộp (debounce) nhiều sự kiện
// liên tiếp thành một callback duy nhất, và cho phép "tạm nén" (suppress) các
// sự kiện do chính ứng dụng gây ra (ví dụ: khi VaultService tự ghi file) để
// tránh vòng lặp watcher tự phản ứng với thao tác của chính mình.
package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watcher theo dõi một cây thư mục và gọi OnChange (debounced) khi có thay đổi
// không bị suppress.
type Watcher struct {
	root       string
	fsw        *fsnotify.Watcher
	debounce   time.Duration
	suppressed sync.Map // path(string) -> expiry(time.Time)

	mu      sync.Mutex
	timer   *time.Timer
	onEvent func()

	done chan struct{}
}

// New tạo watcher cho cây thư mục root. onEvent được gọi (trên goroutine riêng)
// tối đa 1 lần mỗi `debounce` khoảng thời gian, sau khi tổng hợp các thay đổi.
func New(root string, debounce time.Duration, onEvent func()) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		root:     root,
		fsw:      fsw,
		debounce: debounce,
		onEvent:  onEvent,
		done:     make(chan struct{}),
	}
	if err := w.addRecursive(root); err != nil {
		fsw.Close()
		return nil, err
	}
	go w.loop()
	return w, nil
}

// Suppress đánh dấu path (và các sự kiện tới trong `window`) là do chính app
// gây ra, để watcher bỏ qua không phát sinh onEvent cho chúng. Dùng ngay trước
// khi VaultService tự ghi/tạo/xoá/đổi tên file.
func (w *Watcher) Suppress(path string, window time.Duration) {
	w.suppressed.Store(filepath.Clean(path), time.Now().Add(window))
}

func (w *Watcher) isSuppressed(path string) bool {
	v, ok := w.suppressed.Load(filepath.Clean(path))
	if !ok {
		return false
	}
	expiry := v.(time.Time)
	if time.Now().After(expiry) {
		w.suppressed.Delete(filepath.Clean(path))
		return false
	}
	return true
}

// Close dừng watcher và giải phóng tài nguyên fsnotify.
func (w *Watcher) Close() error {
	close(w.done)
	return w.fsw.Close()
}

func (w *Watcher) addRecursive(dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// Bỏ qua các thư mục không truy cập được thay vì fail toàn bộ.
			return nil
		}
		if d.IsDir() {
			if isIgnored(d.Name()) {
				return filepath.SkipDir
			}
			return w.fsw.Add(path)
		}
		return nil
	})
}

// isIgnored xác định các thư mục không cần watch/hiển thị: metadata nội bộ
// (.git dùng cho Phase 4 sync) và các thư mục ẩn hệ thống.
func isIgnored(name string) bool {
	switch name {
	case ".git":
		return true
	default:
		return false
	}
}

func (w *Watcher) loop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			w.handle(ev)
		case _, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
			// Lỗi watcher không nên làm crash app; bỏ qua và tiếp tục.
		}
	}
}

func (w *Watcher) handle(ev fsnotify.Event) {
	if w.isSuppressed(ev.Name) {
		return
	}

	// Nếu một thư mục mới được tạo, thêm watch đệ quy cho nó để theo dõi
	// các file bên trong (fsnotify không tự theo dõi đệ quy).
	if ev.Op&fsnotify.Create == fsnotify.Create {
		if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
			_ = w.addRecursive(ev.Name)
		}
	}

	w.scheduleEmit()
}

func (w *Watcher) scheduleEmit() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.timer = time.AfterFunc(w.debounce, func() {
		if w.onEvent != nil {
			w.onEvent()
		}
	})
}
