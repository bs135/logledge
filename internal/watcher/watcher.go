// Package watcher wraps fsnotify to monitor an entire Vault directory tree,
// dynamically managing watches as subdirectories are created or deleted,
// debouncing bursts of events into a single notification callback, and
// suppressing self-inflicted filesystem events (e.g., when VaultService writes
// a file) to prevent infinite event feedback loops.
package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watcher monitors a directory tree and triggers OnChange (debounced) for
// unsuppressed filesystem changes.
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

// New creates a watcher for the directory tree at root. onEvent is called
// (in a separate goroutine) at most once per debounce window after changes settle.
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

// Suppress marks a path (and events within window) as initiated by the app itself,
// so the watcher ignores them and does not emit onEvent. Called immediately
// before VaultService writes, creates, deletes, or renames a file.
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

// Close stops the watcher and releases fsnotify resources.
func (w *Watcher) Close() error {
	close(w.done)
	return w.fsw.Close()
}

func (w *Watcher) addRecursive(dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// Skip inaccessible directories instead of failing the entire tree.
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

// isIgnored determines folders that should not be watched: internal metadata
// (.git for Phase 4 sync) and system hidden directories.
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
			// Watcher errors should not crash the app; ignore and continue.
		}
	}
}

func (w *Watcher) handle(ev fsnotify.Event) {
	if w.isSuppressed(ev.Name) {
		return
	}

	// When a new directory is created, watch it recursively to monitor
	// files inside (fsnotify is not recursively automatic on all platforms).
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
