# Logledge

Ứng dụng ghi chú desktop, local-first, dựa trên file `.md` thuần — đồng bộ đa
thiết bị qua GitHub. Xây bằng [Wails v2](https://wails.io) (backend Go +
frontend React/TypeScript).

## Mục tiêu

- **Chủ quyền dữ liệu**: mọi ghi chú là file `.md` độc lập trên đĩa, không phụ
  thuộc định dạng đóng hay server.
- **Tối ưu cho lập trình viên**: khởi động nhanh, gọn nhẹ, phím tắt sâu,
  Markdown WYSIWYG kiểu Obsidian.
- **Đồng bộ tự động qua Git**: không cần thao tác dòng lệnh thủ công.

## Tính năng (theo phase phát triển)

| Phase | Nội dung |
|---|---|
| 0 | Scaffold Wails + TailwindCSS, CI cơ bản |
| 1 | Vault & File Tree: chọn thư mục Vault, cây thư mục lồng nhau, tạo/đổi tên/xoá (vào thùng rác OS)/kéo-thả, live sync với thay đổi ngoài app (fsnotify) |
| 2 | Markdown Editor: WYSIWYG Live Preview (Milkdown/Crepe) — CommonMark+GFM, code block syntax highlight, LaTeX; auto-save debounce 600ms; dán ảnh clipboard vào `.attachments/` |
| 3 | Full-Text Search: SQLite FTS5, Quick Switcher (`Ctrl+P`, fuzzy theo tên file), Global Search (`Ctrl+Shift+F`, toàn văn có snippet highlight) |
| 4 | GitHub Sync Engine: đồng bộ tự động (mở app / định kỳ 5 phút / khi thoát / thủ công), PAT lưu qua OS Keychain, xử lý xung đột bằng rename thay vì chèn conflict marker |

## Phím tắt

| Phím tắt | Chức năng |
|---|---|
| `Ctrl+P` | Quick Switcher — tìm nhanh file theo tên (fuzzy) |
| `Ctrl+Shift+F` | Global Search — tìm toàn văn trong Vault |
| Chuột phải trên cây thư mục | New note / New folder / Rename / Delete |
| Kéo-thả trên cây thư mục | Di chuyển file/thư mục |

Không có phím tắt lưu (`Ctrl+S`) — mọi thay đổi được tự động lưu (debounce ~600ms).

## Phát triển

Yêu cầu: Go 1.25+, Node 20+, [Wails CLI v2](https://wails.io/docs/gettingstarted/installation).

```bash
# chạy chế độ dev (hot-reload frontend qua Vite)
wails dev

# build production
wails build

# build kèm installer NSIS (Windows)
wails build -nsis
```

Kiểm thử backend:

```bash
go build ./...
go vet ./...
go test ./...
```

Kiểm thử frontend:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

## Đóng gói đa nền tảng

`.github/workflows/release.yml` build & đóng gói cho Windows (NSIS),
macOS (universal, dmg) và Linux (AppImage) khi push tag `v*`, dùng
[`dAppServer/wails-build-action`](https://github.com/dAppServer/wails-build-action).
Việc build/test macOS và Linux, cũng như tạo installer NSIS trên Windows, cần
chạy trên CI (hoặc máy có quyền admin) — môi trường phát triển sandbox hiện
tại không có quyền cài đặt NSIS cục bộ nên chỉ portable `.exe` được build và
xác minh thủ công tại đây.

## Chỉ số phi chức năng đã đo (Windows, máy dev)

| Chỉ số | Mục tiêu | Đo được |
|---|---|---|
| Cold-start | < 1s | ~1.0s |
| RAM nền (idle) | < 80MB | ~35–67MB |
| Binary size (portable exe) | < 30MB | ~19.3MB |

## Đồng bộ GitHub — lưu ý triển khai

- Đồng bộ dùng `git` CLI hệ thống qua `os/exec` (không dùng go-git) — yêu cầu
  máy người dùng đã cài Git.
- Thay vì `git pull --rebase` theo đúng nghĩa đen, engine dùng
  `git fetch` + `git merge --no-commit --no-ff -X ours`, sau đó áp dụng chính
  sách đổi tên file xung đột (`Tên.conflict.<timestamp>.md`) chỉ cho đúng
  những file bị sửa ở cả 2 phía. Cách này tránh được việc chèn ký tự
  `<<<<<<<` vào file đồng thời vẫn giữ lịch sử merge đúng đắn giữa 2 nhánh —
  xem chi tiết lý do điều chỉnh trong lịch sử commit Phase 4.
- Personal Access Token không bao giờ được ghi ra đĩa dạng plaintext — chỉ
  lưu trong OS Keychain (Windows Credential Manager / macOS Keychain / Linux
  Secret Service qua `go-keyring`).

## Cấu trúc thư mục

```
app.go                  # Wails App: điểm nối các service với frontend
main.go                 # Entry point, khai báo Wails options
internal/
  config/               # Cấu hình ứng dụng (đường dẫn Vault, cấu hình sync)
  vault/                 # VaultService: CRUD cây thư mục/file, attachments
  watcher/               # fsnotify wrapper (debounce + self-write suppression)
  search/                # SearchService: SQLite FTS5, Quick Switcher, Global Search
  gitsync/               # SyncService: đồng bộ GitHub qua git CLI + go-keyring
frontend/
  src/components/        # FileTree, Editor, QuickSwitcher, GlobalSearch, Sync UI
  src/hooks/              # useVault
```
