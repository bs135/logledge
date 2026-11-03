//! VaultService: manages the file/folder tree of the open Vault on disk
//! (listing, creating, renaming, moving, copying, trashing, reading/writing
//! notes and attachments) and owns the file watcher that reports external
//! changes. Paths exchanged with the frontend are "/"-separated and relative
//! to the Vault root.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf, MAIN_SEPARATOR_STR};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Serialize;

use crate::error::{Error, Result};
use crate::watcher::{OnChange, Watcher};

/// How long after an app write the watcher ignores events for that path
/// (prevents self-trigger loops).
const SUPPRESS_WINDOW: Duration = Duration::from_secs(2);

/// Aggregates consecutive change events (git pull, bulk copy) into a single
/// notification for the frontend.
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(300);

/// A file or directory in the Vault tree, serialized to JSON for the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub name: String,
    /// Relative path separated by "/" ("." for the Vault root).
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Node>,
}

/// Outcome of [`VaultService::write_file_if_unchanged`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// True when the content was written to disk.
    pub saved: bool,
    /// Current on-disk content when `saved` is false, i.e. the file was
    /// modified externally (e.g. by Git sync) since the editor last loaded or
    /// saved it.
    pub disk_content: String,
}

/// Lock serializing app-initiated working tree mutations with Git sync
/// (auto-commit, merge, conflict resolution).
pub type WorktreeLock = Arc<Mutex<()>>;

#[derive(Default)]
struct OpenVault {
    root: PathBuf,
    watcher: Option<Watcher>,
}

pub struct VaultService {
    state: RwLock<OpenVault>,
    on_change: OnChange,
    worktree: WorktreeLock,
}

impl VaultService {
    /// Creates a service with no Vault open. `on_change` is called (debounced)
    /// whenever Vault contents change on disk after [`open`](Self::open).
    pub fn new(on_change: OnChange) -> Self {
        VaultService {
            state: RwLock::default(),
            on_change,
            worktree: WorktreeLock::default(),
        }
    }

    /// Sets `root` as the current Vault and (re)starts the file watcher.
    pub fn open(&self, root: &Path) -> Result<()> {
        let meta = fs::metadata(root).map_err(|e| Error::from(e).context("không thể mở vault"))?;
        if !meta.is_dir() {
            return Err(Error::msg(format!(
                "đường dẫn vault không phải là thư mục: {}",
                root.display()
            )));
        }
        let root = clean_path(root);

        let mut state = self.state.write().unwrap();
        state.watcher = None; // stop the previous watcher before starting a new one
        let watcher = Watcher::new(&root, DEBOUNCE_INTERVAL, Arc::clone(&self.on_change))
            .map_err(|e| e.context("không thể khởi động watcher"))?;
        *state = OpenVault {
            root,
            watcher: Some(watcher),
        };
        Ok(())
    }

    /// Lock that Git sync holds while committing and merging so no Vault write
    /// happens in the middle of a sync.
    pub fn worktree_lock(&self) -> WorktreeLock {
        Arc::clone(&self.worktree)
    }

    fn lock_worktree(&self) -> MutexGuard<'_, ()> {
        self.worktree.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Absolute path of the open Vault, or `None` if none is open.
    pub fn root(&self) -> Option<PathBuf> {
        let state = self.state.read().unwrap();
        (!state.root.as_os_str().is_empty()).then(|| state.root.clone())
    }

    fn require_root(&self) -> Result<PathBuf> {
        self.root().ok_or_else(|| Error::msg("chưa mở vault nào"))
    }

    fn suppress(&self, abs: &Path) {
        if let Some(w) = &self.state.read().unwrap().watcher {
            w.suppress(abs, SUPPRESS_WINDOW);
        }
    }

    /// Lists the whole Vault hierarchy: directories first, then A–Z
    /// (case-insensitive). Dot entries (.git, .attachments, ...) are hidden.
    pub fn tree(&self) -> Result<Node> {
        let root = self.require_root()?;
        build_node(&root, &root, String::new())
    }

    /// Creates an empty file in `parent_rel`; ".md" is appended when `name` has
    /// no extension.
    pub fn create_file(&self, parent_rel: &str, name: &str) -> Result<String> {
        let mut name = name.to_string();
        if !base_name(&name).contains('.') {
            name.push_str(".md");
        }
        let root = self.require_root()?;
        let parent = resolve(&root, parent_rel)?;
        let _guard = self.lock_worktree();
        let abs = parent.join(&name);
        if abs.exists() {
            return Err(Error::msg(format!("đã tồn tại: {name}")));
        }
        self.suppress(&abs);
        fs::write(&abs, b"")?;
        Ok(rel_from_abs(&root, &abs))
    }

    /// Creates a subdirectory in `parent_rel`.
    pub fn create_folder(&self, parent_rel: &str, name: &str) -> Result<String> {
        let root = self.require_root()?;
        let parent = resolve(&root, parent_rel)?;
        let _guard = self.lock_worktree();
        let abs = parent.join(name);
        if abs.exists() {
            return Err(Error::msg(format!("đã tồn tại: {name}")));
        }
        self.suppress(&abs);
        fs::create_dir(&abs)?;
        Ok(rel_from_abs(&root, &abs))
    }

    /// Renames the entry at `rel` to `new_name` within the same folder.
    pub fn rename(&self, rel: &str, new_name: &str) -> Result<String> {
        let root = self.require_root()?;
        let abs = resolve(&root, rel)?;
        let _guard = self.lock_worktree();
        let new_abs = parent_dir(&abs).join(new_name);
        if new_abs.exists() {
            return Err(Error::msg(format!("đã tồn tại: {new_name}")));
        }
        self.suppress(&abs);
        self.suppress(&new_abs);
        fs::rename(&abs, &new_abs)?;
        Ok(rel_from_abs(&root, &new_abs))
    }

    /// Moves the entry at `src_rel` into the folder `dest_parent_rel`
    /// (file tree drag-and-drop).
    pub fn move_entry(&self, src_rel: &str, dest_parent_rel: &str) -> Result<String> {
        let root = self.require_root()?;
        let src = resolve(&root, src_rel)?;
        let dest_parent = resolve(&root, dest_parent_rel)?;
        let _guard = self.lock_worktree();
        let dest = dest_parent.join(file_name(&src));
        if is_within(&dest, &src) {
            return Err(Error::msg("không thể di chuyển thư mục vào chính nó"));
        }
        if dest.exists() {
            return Err(Error::msg(format!("đã tồn tại: {}", file_name(&dest))));
        }
        self.suppress(&src);
        self.suppress(&dest);
        fs::rename(&src, &dest)?;
        Ok(rel_from_abs(&root, &dest))
    }

    /// Absolute, OS-native path of the entry at `rel`.
    pub fn abs_path(&self, rel: &str) -> Result<PathBuf> {
        let root = self.require_root()?;
        resolve(&root, rel)
    }

    /// `rel` relative to the Vault root with OS-native separators, e.g.
    /// `folder\Note.md` on Windows.
    pub fn native_rel_path(&self, rel: &str) -> Result<String> {
        let root = self.require_root()?;
        let abs = resolve(&root, rel)?;
        Ok(match abs.strip_prefix(&root) {
            Ok(p) if p.as_os_str().is_empty() => ".".to_string(),
            Ok(p) => p.to_string_lossy().into_owned(),
            Err(_) => abs.to_string_lossy().into_owned(),
        })
    }

    /// Copies the entry at `rel` next to itself ("Note.md" -> "Note copy.md"
    /// -> "Note copy (1).md") and returns the copy's relative path.
    pub fn duplicate(&self, rel: &str) -> Result<String> {
        self.copy(rel, &parent_rel(rel))
    }

    /// Copies the entry at `src_rel` into `dest_parent_rel` (file tree
    /// Copy/Paste). The original name is kept when free, otherwise a " copy" /
    /// " copy (n)" suffix is added. Folders are copied recursively and cannot be
    /// pasted into themselves.
    pub fn copy(&self, src_rel: &str, dest_parent_rel: &str) -> Result<String> {
        let root = self.require_root()?;
        let src = resolve(&root, src_rel)?;
        if src == root {
            return Err(Error::msg("không thể sao chép thư mục gốc của vault"));
        }
        let dest_parent = resolve(&root, dest_parent_rel)?;
        if is_within(&dest_parent, &src) {
            return Err(Error::msg("không thể sao chép thư mục vào chính nó"));
        }
        let _guard = self.lock_worktree();

        let meta = fs::metadata(&src).map_err(|e| Error::from(e).context("không thể sao chép"))?;
        if !fs::metadata(&dest_parent)
            .map(|m| m.is_dir())
            .unwrap_or(false)
        {
            return Err(Error::msg("thư mục đích không hợp lệ"));
        }
        let mut name = file_name(&src);
        if fs::symlink_metadata(dest_parent.join(&name)).is_ok() {
            name = copy_name(&dest_parent, &name, meta.is_dir());
        }
        let dest = dest_parent.join(&name);

        let result = if meta.is_dir() {
            self.copy_dir(&src, &dest)
        } else {
            self.copy_file(&src, &dest)
        };
        if let Err(e) = result {
            let _ = fs::remove_dir_all(&dest).or_else(|_| fs::remove_file(&dest));
            return Err(Error::from(e).context("không thể sao chép"));
        }
        Ok(rel_from_abs(&root, &dest))
    }

    /// Copies one regular file, failing if `dst` already exists.
    fn copy_file(&self, src: &Path, dst: &Path) -> io::Result<()> {
        let mut input = fs::File::open(src)?;
        self.suppress(dst);
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dst)?;
        io::copy(&mut input, &mut output)?;
        output.set_permissions(input.metadata()?.permissions())
    }

    /// Recursively copies the directory `src` into the new directory `dst`.
    /// Symlinks and other non-regular files are skipped. Created directories
    /// are intentionally not suppressed so the watcher reports them.
    fn copy_dir(&self, src: &Path, dst: &Path) -> io::Result<()> {
        for entry in walkdir::WalkDir::new(src) {
            let entry = entry?;
            let rel = entry.path().strip_prefix(src).map_err(io::Error::other)?;
            let target = dst.join(rel);
            let file_type = entry.file_type();
            if file_type.is_dir() {
                if rel.as_os_str().is_empty() {
                    fs::create_dir(&target)?;
                } else {
                    fs::create_dir_all(&target)?;
                }
            } else if file_type.is_file() {
                self.copy_file(entry.path(), &target)?;
            }
        }
        Ok(())
    }

    /// Moves the entry at `rel` to the OS recycle bin (not a permanent delete).
    pub fn delete(&self, rel: &str) -> Result<()> {
        let root = self.require_root()?;
        let abs = resolve(&root, rel)?;
        let _guard = self.lock_worktree();
        self.suppress(&abs);
        trash::delete(&abs).map_err(|e| Error::msg(e.to_string()))
    }

    /// Reads a note. Invalid UTF-8 is replaced rather than rejected, as the Go
    /// backend's JSON encoding did.
    pub fn read_file(&self, rel: &str) -> Result<String> {
        let root = self.require_root()?;
        let abs = resolve(&root, rel)?;
        Ok(String::from_utf8_lossy(&fs::read(abs)?).into_owned())
    }

    /// Overwrites a note.
    pub fn write_file(&self, rel: &str, content: &str) -> Result<()> {
        let root = self.require_root()?;
        let abs = resolve(&root, rel)?;
        let _guard = self.lock_worktree();
        self.suppress(&abs);
        fs::write(abs, content)?;
        Ok(())
    }

    /// Auto-save with optimistic concurrency: writes `content` only if the file
    /// on disk still equals `expected` (the version the editor last loaded or
    /// saved). If it was changed externally (e.g. Git sync), nothing is written
    /// and the current disk content is returned so the frontend can ask the
    /// user. A missing file is (re)created so unsaved edits are never lost.
    pub fn write_file_if_unchanged(
        &self,
        rel: &str,
        content: &str,
        expected: &str,
    ) -> Result<WriteResult> {
        let root = self.require_root()?;
        let abs = resolve(&root, rel)?;
        let _guard = self.lock_worktree();

        match fs::read(&abs) {
            Ok(data) => {
                let disk = String::from_utf8_lossy(&data);
                if disk == content {
                    return Ok(WriteResult {
                        saved: true,
                        ..Default::default()
                    });
                }
                if disk != expected {
                    return Ok(WriteResult {
                        saved: false,
                        disk_content: disk.into_owned(),
                    });
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }

        self.suppress(&abs);
        fs::write(&abs, content)?;
        Ok(WriteResult {
            saved: true,
            ..Default::default()
        })
    }

    /// Saves an image pasted or dropped into the editor (base64 from the
    /// frontend) into `.attachments/` at the Vault root and returns a Markdown
    /// link to it relative to the note's folder.
    pub fn save_attachment(
        &self,
        note_rel: &str,
        filename: &str,
        base64_data: &str,
    ) -> Result<String> {
        let root = self.require_root()?;
        let data = base64::engine::general_purpose::STANDARD
            .decode(base64_data)
            .map_err(|e| Error::msg(format!("dữ liệu ảnh không hợp lệ: {e}")))?;

        let _guard = self.lock_worktree();
        let attach_dir = root.join(".attachments");
        fs::create_dir_all(&attach_dir)?;

        let base = base_name(filename);
        let ext = extension(base);
        let stem = sanitize_filename(&base[..base.len() - ext.len()]);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let unique = format!("{stem}-{nanos}{ext}");
        let abs = attach_dir.join(&unique);

        self.suppress(&abs);
        fs::write(&abs, data)?;

        let note_parent = resolve(&root, &parent_rel(note_rel)).unwrap_or_else(|_| root.clone());
        Ok(relative_path(&note_parent, &abs).unwrap_or_else(|| format!(".attachments/{unique}")))
    }

    /// Reads a local image referenced by a note (e.g. `../.attachments/a.png`,
    /// relative to the note's folder) and returns it as a `data:` URL for the
    /// Live Preview editor.
    pub fn read_attachment_data_url(&self, note_rel: &str, img_rel: &str) -> Result<String> {
        let root = self.require_root()?;
        let note_dir = parent_rel(note_rel);
        let joined = if note_dir == "." {
            img_rel.to_string()
        } else {
            format!("{note_dir}/{img_rel}")
        };
        let abs = resolve(&root, &joined)?;
        let data = fs::read(&abs)?;
        let mime = mime_guess::from_path(&abs).first_or_octet_stream();
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        ))
    }
}

fn build_node(root: &Path, abs: &Path, name: String) -> Result<Node> {
    let mut children = Vec::new();
    for entry in fs::read_dir(abs)?.flatten() {
        let child_name = entry.file_name().to_string_lossy().into_owned();
        if child_name.starts_with('.') {
            continue;
        }
        let child_abs = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            // Skip inaccessible directories instead of failing the whole tree.
            if let Ok(node) = build_node(root, &child_abs, child_name) {
                children.push(node);
            }
        } else {
            children.push(Node {
                name: child_name,
                path: rel_from_abs(root, &child_abs),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }
    children.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Node {
        name,
        path: rel_from_abs(root, abs),
        is_dir: true,
        children,
    })
}

/// Lexically normalizes a path: drops "." and resolves ".." (Go's filepath.Clean).
pub fn clean_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        out.push(".");
    }
    out
}

/// Converts a "/"-separated relative path into an absolute path inside `root`,
/// rejecting anything that escapes the Vault (e.g. "../../etc").
fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let native = if cfg!(windows) {
        rel.replace('/', "\\")
    } else {
        rel.to_string()
    };
    let mut abs = root.to_path_buf();
    let mut depth = 0usize;
    for c in Path::new(&native).components() {
        match c {
            Component::Normal(part) => {
                abs.push(part);
                depth += 1;
            }
            Component::ParentDir => {
                if depth == 0 {
                    return Err(Error::msg("đường dẫn nằm ngoài vault"));
                }
                abs.pop();
                depth -= 1;
            }
            // A leading "/" is treated as relative to the root, as Go's
            // filepath.Join did.
            Component::CurDir | Component::RootDir => {}
            Component::Prefix(_) => return Err(Error::msg("đường dẫn nằm ngoài vault")),
        }
    }
    Ok(abs)
}

/// Converts an absolute path inside `root` to a "/"-separated relative path.
fn rel_from_abs(root: &Path, abs: &Path) -> String {
    match abs.strip_prefix(root) {
        Ok(p) if p.as_os_str().is_empty() => ".".to_string(),
        Ok(p) => p
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
        Err(_) => abs.to_string_lossy().into_owned(),
    }
}

/// Path from directory `from` to `to` using "/" (Go's filepath.Rel + ToSlash).
fn relative_path(from: &Path, to: &Path) -> Option<String> {
    let from: Vec<_> = from.components().collect();
    let to: Vec<_> = to.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    if common == 0 {
        return None; // different volumes
    }
    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(
        to[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    Some(if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    })
}

/// Parent of a "/"-separated relative path ("." for top-level entries).
fn parent_rel(rel: &str) -> String {
    let trimmed = rel.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(0) => ".".to_string(),
        Some(i) => trimmed[..i].to_string(),
        None => ".".to_string(),
    }
}

/// True when `path` is `ancestor` or lies inside it.
fn is_within(path: &Path, ancestor: &Path) -> bool {
    let with_sep = |p: &Path| format!("{}{MAIN_SEPARATOR_STR}", p.display());
    with_sep(path).starts_with(&with_sep(ancestor))
}

fn parent_dir(path: &Path) -> &Path {
    path.parent().unwrap_or(path)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Last element of a "/" or "\"-separated name.
fn base_name(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

/// Extension including the dot, from the last "." (Go's filepath.Ext).
fn extension(name: &str) -> &str {
    name.rfind('.').map_or("", |i| &name[i..])
}

/// First name not yet present in `dir` for a copy of `name`:
/// "Note.md" -> "Note copy.md" -> "Note copy (1).md" -> ... Folder names keep
/// their dots ("v1.2" -> "v1.2 copy").
fn copy_name(dir: &Path, name: &str, is_dir: bool) -> String {
    let mut ext = if is_dir { "" } else { extension(name) };
    if ext == name {
        ext = ""; // dotfile without a real extension, e.g. ".env"
    }
    let base = &name[..name.len() - ext.len()];
    let mut candidate = format!("{base} copy{ext}");
    let mut i = 1;
    loop {
        if let Err(e) = fs::symlink_metadata(dir.join(&candidate)) {
            if e.kind() == io::ErrorKind::NotFound {
                return candidate;
            }
        }
        candidate = format!("{base} copy ({i}){ext}");
        i += 1;
    }
}

/// Replaces characters outside `[\w\s.-]` (ASCII, like Go's regexp) with "_".
fn sanitize_filename(name: &str) -> String {
    let out: String = name
        .chars()
        .map(|c| {
            let keep = c.is_ascii_alphanumeric()
                || matches!(c, '_' | '.' | '-' | ' ' | '\t' | '\n' | '\r' | '\x0c');
            if keep {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() {
        "image".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    struct TestVault {
        svc: VaultService,
        dir: tempfile::TempDir,
    }

    impl TestVault {
        fn root(&self) -> &Path {
            self.dir.path()
        }
    }

    fn new_vault() -> TestVault {
        let dir = tempfile::tempdir().unwrap();
        let svc = VaultService::new(Arc::new(|| {}));
        svc.open(dir.path()).unwrap();
        TestVault { svc, dir }
    }

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s)
    }

    #[test]
    fn create_file_adds_md_extension() {
        let v = new_vault();
        assert_eq!(v.svc.create_file("", "note").unwrap(), "note.md");
        assert!(v.root().join("note.md").exists());
    }

    #[test]
    fn create_folder_and_nested_tree() {
        let v = new_vault();
        v.svc.create_folder("", "projects").unwrap();
        v.svc.create_file("projects", "todo").unwrap();

        let tree = v.svc.tree().unwrap();
        assert_eq!(tree.path, ".");
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].name, "projects");
        assert_eq!(tree.children[0].children[0].path, "projects/todo.md");
    }

    #[test]
    fn tree_hides_dot_entries_and_sorts_dirs_first() {
        let v = new_vault();
        fs::create_dir(v.root().join(".git")).unwrap();
        v.svc.create_file("", "b").unwrap();
        v.svc.create_file("", "A").unwrap();
        v.svc.create_folder("", "z-dir").unwrap();

        let names: Vec<_> = v
            .svc
            .tree()
            .unwrap()
            .children
            .into_iter()
            .map(|n| n.name)
            .collect();
        assert_eq!(names, ["z-dir", "A.md", "b.md"]);
    }

    #[test]
    fn tree_json_matches_go_shape() {
        let v = new_vault();
        v.svc.create_folder("", "empty").unwrap();
        let json = serde_json::to_value(v.svc.tree().unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "name": "", "path": ".", "isDir": true,
                "children": [{ "name": "empty", "path": "empty", "isDir": true }]
            })
        );
    }

    #[test]
    fn rename_and_move() {
        let v = new_vault();
        v.svc.create_file("", "old").unwrap();
        assert_eq!(v.svc.rename("old.md", "new.md").unwrap(), "new.md");

        v.svc.create_folder("", "archive").unwrap();
        assert_eq!(
            v.svc.move_entry("new.md", "archive").unwrap(),
            "archive/new.md"
        );
        assert!(v.svc.move_entry("archive", "archive").is_err());
    }

    #[test]
    fn resolve_rejects_path_traversal() {
        let v = new_vault();
        assert!(resolve(v.root(), "../outside.md").is_err());
        assert!(resolve(v.root(), "a/../../outside.md").is_err());
        assert_eq!(
            resolve(v.root(), "a/../b.md").unwrap(),
            v.root().join("b.md")
        );
        assert_eq!(resolve(v.root(), "").unwrap(), v.root());
    }

    #[test]
    fn read_write_file() {
        let v = new_vault();
        let rel = v.svc.create_file("", "note").unwrap();
        v.svc.write_file(&rel, "hello world").unwrap();
        assert_eq!(v.svc.read_file(&rel).unwrap(), "hello world");
    }

    #[test]
    fn save_attachment_returns_relative_link() {
        let v = new_vault();
        v.svc.create_folder("", "projects").unwrap();
        v.svc.create_file("projects", "note").unwrap();

        let link = v
            .svc
            .save_attachment(
                "projects/note.md",
                "screen shot ✓.png",
                &b64("fake-png-bytes"),
            )
            .unwrap();
        let name = link
            .strip_prefix("../.attachments/")
            .expect("relative link");
        assert!(
            name.starts_with("screen shot _-") && name.ends_with(".png"),
            "{name}"
        );
        assert_eq!(
            fs::read_dir(v.root().join(".attachments")).unwrap().count(),
            1
        );

        let top = v
            .svc
            .save_attachment("note.md", "a.png", &b64("x"))
            .unwrap();
        assert!(top.starts_with(".attachments/a-"), "{top}");
        assert!(v.svc.save_attachment("note.md", "a.png", "%%%").is_err());
    }

    #[test]
    fn read_attachment_data_url_resolves_relative_to_note() {
        let v = new_vault();
        v.svc.create_folder("", "projects").unwrap();
        let link = v
            .svc
            .save_attachment("projects/note.md", "screenshot.png", &b64("fake-png-bytes"))
            .unwrap();

        let url = v
            .svc
            .read_attachment_data_url("projects/note.md", &link)
            .unwrap();
        let payload = url
            .strip_prefix("data:image/png;base64,")
            .expect("png data url");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .unwrap();
        assert_eq!(decoded, b"fake-png-bytes");

        assert!(v
            .svc
            .read_attachment_data_url("note.md", "../../etc/passwd")
            .is_err());
    }

    #[test]
    fn write_file_if_unchanged() {
        let v = new_vault();
        let abs = v.root().join("note.md");
        fs::write(&abs, "v1").unwrap();

        // Disk matches the editor's base version -> saved.
        assert!(
            v.svc
                .write_file_if_unchanged("note.md", "v2", "v1")
                .unwrap()
                .saved
        );

        // Git sync replaced the file -> reported, not overwritten.
        fs::write(&abs, "remote").unwrap();
        let res = v
            .svc
            .write_file_if_unchanged("note.md", "v3", "v2")
            .unwrap();
        assert_eq!(
            res,
            WriteResult {
                saved: false,
                disk_content: "remote".into()
            }
        );
        assert_eq!(fs::read_to_string(&abs).unwrap(), "remote");

        // Content already on disk -> treated as saved.
        assert!(
            v.svc
                .write_file_if_unchanged("note.md", "remote", "stale")
                .unwrap()
                .saved
        );

        // Missing file is recreated so the draft is not lost.
        fs::remove_file(&abs).unwrap();
        assert!(
            v.svc
                .write_file_if_unchanged("note.md", "draft", "remote")
                .unwrap()
                .saved
        );
        assert_eq!(fs::read_to_string(&abs).unwrap(), "draft");
    }

    #[test]
    fn worktree_lock_blocks_writes() {
        let v = Arc::new(new_vault());
        let lock = v.svc.worktree_lock();
        let guard = lock.lock().unwrap();

        let (tx, rx) = mpsc::channel();
        let v2 = Arc::clone(&v);
        thread::spawn(move || tx.send(v2.svc.write_file("note.md", "x")).unwrap());

        assert!(
            rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "write must wait for the lock"
        );
        drop(guard);
        rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        assert_eq!(fs::read_to_string(v.root().join("note.md")).unwrap(), "x");
    }

    #[test]
    fn duplicate_file_adds_copy_suffix_with_counter() {
        let v = new_vault();
        fs::create_dir(v.root().join("dir")).unwrap();
        fs::write(v.root().join("dir/Note.md"), "hello").unwrap();

        for want in [
            "dir/Note copy.md",
            "dir/Note copy (1).md",
            "dir/Note copy (2).md",
        ] {
            let got = v.svc.duplicate("dir/Note.md").unwrap();
            assert_eq!(got, want);
            assert_eq!(fs::read_to_string(v.root().join(&got)).unwrap(), "hello");
        }
        assert_eq!(
            v.svc.duplicate("Top.md").ok(),
            None,
            "missing source must fail"
        );
        fs::write(v.root().join(".env"), "k").unwrap();
        assert_eq!(v.svc.duplicate(".env").unwrap(), ".env copy");
    }

    #[test]
    fn duplicate_folder_copies_recursively() {
        let v = new_vault();
        fs::create_dir_all(v.root().join("v1.2/sub")).unwrap();
        fs::write(v.root().join("v1.2/sub/a.md"), "A").unwrap();

        assert_eq!(v.svc.duplicate("v1.2").unwrap(), "v1.2 copy");
        assert_eq!(
            fs::read_to_string(v.root().join("v1.2 copy/sub/a.md")).unwrap(),
            "A"
        );
        assert_eq!(v.svc.duplicate("v1.2").unwrap(), "v1.2 copy (1)");
    }

    #[test]
    fn duplicate_rejects_root_and_traversal() {
        let v = new_vault();
        assert!(v.svc.duplicate("").is_err());
        assert!(v.svc.duplicate("../outside.md").is_err());
    }

    #[test]
    fn abs_and_native_rel_path() {
        let v = new_vault();
        assert_eq!(
            v.svc.abs_path("dir/Note.md").unwrap(),
            v.root().join("dir").join("Note.md")
        );
        assert_eq!(
            v.svc.native_rel_path("dir/Note.md").unwrap(),
            Path::new("dir").join("Note.md").to_string_lossy()
        );
        assert!(v.svc.abs_path("../x").is_err());
    }

    #[test]
    fn copy_keeps_name_or_adds_suffix() {
        let v = new_vault();
        fs::create_dir(v.root().join("src")).unwrap();
        fs::create_dir(v.root().join("dst")).unwrap();
        fs::write(v.root().join("src/Note.md"), "hi").unwrap();

        for want in ["dst/Note.md", "dst/Note copy.md", "dst/Note copy (1).md"] {
            assert_eq!(v.svc.copy("src/Note.md", "dst").unwrap(), want);
        }
        assert_eq!(v.svc.copy("src/Note.md", "").unwrap(), "Note.md");
        assert!(
            v.root().join("src/Note.md").exists(),
            "source must remain after copy"
        );
    }

    #[test]
    fn copy_folder_into_itself_fails() {
        let v = new_vault();
        fs::create_dir_all(v.root().join("a/b")).unwrap();
        assert!(v.svc.copy("a", "a").is_err());
        assert!(v.svc.copy("a", "a/b").is_err());
        assert!(
            v.svc.copy("a/b", "a/b-x").is_err(),
            "missing destination folder"
        );
        assert_eq!(v.svc.copy("a/b", "a").unwrap(), "a/b copy");
    }

    #[test]
    fn operations_require_open_vault() {
        let svc = VaultService::new(Arc::new(|| {}));
        assert!(svc.tree().is_err());
        assert!(svc.read_file("a.md").is_err());
        assert!(svc.root().is_none());
    }

    #[test]
    fn helpers() {
        assert_eq!(parent_rel("Note.md"), ".");
        assert_eq!(parent_rel("dir/sub/Note.md"), "dir/sub");
        assert_eq!(parent_rel(""), ".");
        assert_eq!(sanitize_filename("ảnh chụp (1)"), "_nh ch_p _1_");
        assert_eq!(sanitize_filename(""), "image");
        assert_eq!(extension("a.tar.gz"), ".gz");
        assert_eq!(
            clean_path(Path::new("a/./b/../c")),
            Path::new("a").join("c")
        );
    }
}
