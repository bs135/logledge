# Logledge — Kế hoạch triển khai

## 1. Đánh giá độ khả thi tổng thể

Ý tưởng khả thi. Wails v2 (Go + React/TS, WebView hệ điều hành thay vì bundle Chromium) là lựa chọn đúng đắn để đạt cold-start <1s, RAM <80MB và binary <30MB — đây chính là lợi thế cốt lõi của Wails so với Electron. Kiến trúc local-first, file `.md` độc lập, đồng bộ qua Git là mô hình đã được chứng minh (Obsidian + Git plugin, Foam...).

Tuy nhiên một số điểm trong spec gốc rủi ro cao nếu làm đúng 100% như mô tả — đã điều chỉnh sau khi trao đổi với bạn:

| Hạng mục | Spec gốc | Điều chỉnh | Lý do |
|---|---|---|---|
| Sync engine | go-git thuần Go | Gọi `git` CLI hệ thống qua `os/exec` | go-git không hỗ trợ tốt rebase/3-way merge; tự viết lại rủi ro bug cao. Dùng git thật ổn định hơn nhiều, người dùng mục tiêu (lập trình viên) hầu như luôn có sẵn git. App vẫn tự động hoá toàn bộ thao tác, người dùng không cần gõ lệnh. |
| Editor | Split-view + WYSIWYG (2 chế độ) | Chỉ 1 chế độ: WYSIWYG Live Preview (kiểu Obsidian) bằng Milkdown | Giảm ~50% độ phức tạp editor, tránh đồng bộ 2 state (raw text ⇄ AST) song song. |
| PAT storage | Không nêu rõ | OS Keychain qua `zalando/go-keyring` | Không lưu token dạng plaintext trên đĩa. |
| Lộ trình | "TBD" | Chia 6 phase tuần tự, mỗi phase chạy được độc lập | Scope quá lớn để làm 1 lượt; cần cột mốc kiểm thử rõ ràng. |

### Rủi ro/giả định cần xác minh sớm (sẽ làm ngay đầu Phase 1 bằng spike nhỏ)
- **FTS5 trong `modernc.org/sqlite`:** thư viện này là bản dịch toàn bộ amalgamation SQLite sang Go (không cần CGO) và có hỗ trợ FTS5 — cần viết 1 test nhỏ xác nhận trước khi phụ thuộc vào toàn bộ Search Engine.
- **WebView2 trên Windows:** Wails yêu cầu WebView2 Runtime; Win10/11 bản mới thường có sẵn, nhưng cần bootstrapper cài kèm cho máy thiếu.
- **Binary size 30MB:** khả thi với Wails (thường 5-15MB), nhưng cần theo dõi khi thêm SQLite pure-Go (tăng size đáng kể do amalgamation C transpile) — đo lại ở cuối mỗi phase.
- **Cold-start <1s:** không được block UI bằng full re-index hay `git pull` khi mở app — phải chạy nền (goroutine), hiển thị cây file ngay, index/sync chạy sau và cập nhật UI dần.
- **fsnotify tự-kích hoạt vòng lặp:** cần cơ chế "bỏ qua sự kiện do chính app ghi" (self-write registry với timestamp/hash) để tránh watcher phản ứng với auto-save của chính nó.

## 2. Kiến trúc cập nhật

```
+-------------------------------------------------------------+
|                   Frontend (WebView - React/TS)              |
|  - UI: React + TailwindCSS                                   |
|  - Editor: Milkdown (WYSIWYG Live Preview only)               |
|  - File Tree, Command Palette (Ctrl+P), Global Search (Ctrl+Shift+F) |
|  - Status bar: Sync state (Synced/Syncing/Conflict/Offline)  |
+------------------------------+--------------------------------+
                               | Wails auto-generated bindings (JSON-RPC over IPC)
+------------------------------v--------------------------------+
|                        Backend (Go)                            |
|  - VaultService: CRUD file/folder, trash (OS recycle bin)      |
|  - Watcher: fsnotify + self-write suppression + debounce       |
|  - EditorService: debounced write-to-disk (500-1000ms)         |
|  - AttachmentService: clipboard image -> .attachments/         |
|  - SearchService: modernc.org/sqlite FTS5, background indexer  |
|  - SyncService: os/exec("git", ...) wrapper, PAT via go-keyring|
|  - ConflictResolver: diff local/remote per file, rename-on-conflict |
+-----------------------------------------------------------------+
```

## 3. Lộ trình theo Phase (mỗi phase = 1 cột mốc chạy/test được)

**Phase 0 — Scaffold & Spike**
- `wails init` (React-TS template), cấu trúc thư mục, TailwindCSS.
- Spike xác nhận FTS5 hoạt động trong modernc.org/sqlite.
- CI cơ bản: `go build`, `go vet`, `npm run build`.

**Phase 1 — Vault & File Tree (MVP)**
- Chọn/khởi tạo thư mục Vault, lưu config (đường dẫn vault) local.
- VaultService: liệt kê cây thư mục lồng nhau, tạo/đổi tên/xóa (trash OS)/kéo-thả di chuyển file-folder.
- fsnotify watcher đồng bộ 2 chiều với UI, có suppression cho self-write.
- Sidebar tree UI (React) + trạng thái loading không chặn cold-start.

**Phase 2 — Markdown Editor**
- Tích hợp Milkdown chế độ WYSIWYG Live Preview (CommonMark + GFM: bảng, task list, strikethrough, code block với syntax highlight).
- Auto-save debounce 500-1000ms, không có Ctrl+S.
- Dán ảnh từ clipboard → lưu `.attachments/`, chèn link markdown tương đối.

**Phase 3 — Full-Text Search**
- SearchService dùng SQLite FTS5, index nền (goroutine) khi mở app / khi file đổi.
- Quick Switcher (Ctrl+P, fuzzy theo tên file).
- Global Search (Ctrl+Shift+F) với snippet + highlight từ khóa.

**Phase 4 — GitHub Sync Engine**
- Cấu hình repo (URL, branch, PAT hoặc SSH) — PAT lưu OS Keychain qua go-keyring.
- SyncService dùng `git` CLI hệ thống (os/exec): pull --rebase khi mở app, auto commit+push định kỳ/khi thoát, nút sync thủ công.
- Status bar hiển thị Synced/Syncing/Conflict/Offline.
- Conflict handling: phát hiện diverge, so khớp theo từng file — nếu chỉ 1 bên đổi thì lấy bản đó; nếu cả 2 đổi thì rename local thành `Tên.conflict.[timestamp].md`, lấy bản remote về.

**Phase 5 — Đóng gói & Tối ưu phi chức năng**
- Đo & tối ưu cold-start (<1s), RAM nền (<80MB), binary size (<30MB) trên Windows/macOS/Linux.
- Build/sign/package installer (NSIS/DMG/AppImage tuỳ nền tảng qua Wails build).
- Polish UX, phím tắt, hoàn thiện docs.

## 5. Kết quả đã triển khai (cập nhật tiến độ)

**Phase 0 — DONE**
- Scaffold Wails v2 (`react-ts` template) + TailwindCSS v4 (qua `@tailwindcss/vite`).
- Spike xác nhận **FTS5 hoạt động trong `modernc.org/sqlite`** (test `internal/search/fts5_spike_test.go` pass) — rủi ro lớn nhất của Phase 3 đã được gỡ bỏ.
- CI cơ bản (`.github/workflows/ci.yml`): go build/vet/test + npm build.
- Đo binary size baseline: **~11.5MB** (ngân sách 30MB) — còn nhiều dư địa cho sqlite/go-git/go-keyring ở các phase sau.

**Phase 1 — DONE**
- `internal/config`: lưu đường dẫn Vault tại `%AppData%/logledge/config.json` (tương đương trên macOS/Linux).
- `internal/watcher`: fsnotify đệ quy toàn vault, debounce 300ms, cơ chế `Suppress()` chống watcher tự phản ứng với thao tác của chính app.
- `internal/vault`: VaultService — Tree/CreateFile/CreateFolder/Rename/Move/Delete (xoá vào thùng rác OS qua `Bios-Marcel/wastebasket/v2`, không cần CGO)/ReadFile/WriteFile; chống path traversal; ẩn `.git` và dotfile khỏi cây. Có unit test (`go test ./internal/vault/...` pass).
- `app.go`: expose các method trên qua Wails bindings + phát event `vault:changed` khi cây thay đổi.
- Frontend: `useVault` hook, `FileTree` component (thu/mở lồng nhau, menu chuột phải New note/New folder/Rename/Delete, kéo-thả di chuyển), `App.tsx` với màn hình chọn Vault + textarea placeholder (autosave debounce 600ms, sẽ được thay bằng Milkdown ở Phase 2).
- Đã build production (`wails build`) và chạy thử: cold-start ~1.0s, RAM idle **~67MB** (dưới ngân sách 80MB nhưng khá sát — cần theo dõi tiếp khi thêm SQLite indexer ở Phase 3, vì WebView2 tự chiếm phần lớn RAM này).

**Phase 2 — DONE**
- Editor dùng `@milkdown/crepe` (WYSIWYG Live Preview, xây trên Milkdown/ProseMirror) — hỗ trợ sẵn CommonMark+GFM (bảng, task list, strikethrough), code block syntax highlight (CodeMirror feature, bật mặc định), LaTeX, link tooltip — đúng yêu cầu "kiểu Obsidian" mà không cần tự ráp plugin.
- `frontend/src/components/Editor.tsx`: mount/unmount Crepe theo `key={selectedPath}` khi đổi file; lắng nghe `markdownUpdated`, debounce 600ms rồi gọi `WriteFile` (auto-save, không có Ctrl+S).
- Dán/kéo-thả ảnh: dùng tính năng `ImageBlock.onUpload` có sẵn của Crepe → encode file thành base64 ở frontend → backend `SaveAttachment` (mới, có unit test) lưu vào `.attachments/` ở gốc Vault, trả về link Markdown tương đối theo vị trí note đang mở.
- Build production thành công; binary tăng lên **~15.4MB** (vẫn dưới ngân sách 30MB) sau khi nhúng Milkdown + toàn bộ ngôn ngữ CodeMirror (code-split theo ngôn ngữ, chỉ tải khi dùng).
- Giới hạn đã biết: môi trường hiện tại chưa thể tự động hoá thao tác gõ/dán ảnh thực tế trong WebView (không có driver GUI khả dụng) — đã xác minh qua build/test backend + khởi động app thành công; khuyến nghị người dùng tự kiểm tra thủ công (gõ Markdown, dán ảnh, chuyển file) trước khi coi Phase 2 là "đóng".

**Phase 3 — DONE**
- `internal/search`: SearchService dùng SQLite FTS5 (bảng `files` lưu mtime để chỉ re-index file đổi, bảng ảo `notes_fts` dùng chung rowid với `files` để tránh mơ hồ khi xoá/ghi đè theo cột). Index lưu **ngoài Vault** (user cache dir, khoá theo hash đường dẫn Vault) để không phình/kẹt kho Git ở Phase 4.
- `Reindex()` chạy nền (goroutine), tự bỏ qua nếu đã có lượt index đang chạy; được kích hoạt khi mở Vault và mỗi khi watcher báo thay đổi (`emitVaultChanged`) — không chặn cold-start hay thao tác gõ phím.
- `Search(query)`: FTS5 MATCH theo prefix từng từ, trả kèm `snippet()` highlight bằng `**...**`. `QuickSwitch(query)`: fuzzy filename qua `github.com/sahilm/fuzzy`.
- Unit test: index/tìm kiếm, cập nhật khi file đổi nội dung, gỡ khỏi index khi file bị xoá, fuzzy match — tất cả pass.
- Frontend: `QuickSwitcher.tsx` (Ctrl+P) và `GlobalSearch.tsx` (Ctrl+Shift+F) — overlay có ô nhập, điều hướng bằng bàn phím (↑/↓/Enter/Esc), Global Search hiển thị snippet với `<mark>` highlight.
- Build production thành công; binary **~19.2MB** (tăng ~4MB do nhúng thật `modernc.org/sqlite` vào app, trước đó chỉ có trong test) — vẫn dưới ngân sách 30MB, còn dư địa cho Phase 4 (go-git CLI wrapper + go-keyring, dự kiến nhẹ vì gọi `git` hệ thống thay vì nhúng thư viện).

**Phase 4 — DONE**
- `internal/gitsync`: SyncService gọi trực tiếp `git` CLI hệ thống qua `os/exec` (đúng quyết định đã chốt ở bước lên kế hoạch) — không dùng go-git, không tự viết lại thuật toán merge/rebase từ đầu.
- **Điều chỉnh quan trọng so với spec gốc:** thay vì `git pull --rebase`, dùng `git fetch` + `git merge --no-commit --no-ff -X ours` rồi áp policy rename-on-conflict thủ công lên đúng các file bị sửa ở CẢ 2 phía. Lý do: rebase từng commit "Auto-sync" (vốn chỉ là snapshot định kỳ, không có ý nghĩa atomic) kết hợp với chính sách rename-on-conflict theo spec là gần như không thể làm đúng & an toàn; cách tiếp cận merge một lần cho cùng kết quả cuối (không có `<<<<<<<`, giữ lịch sử 2 nhánh, tự động) với độ rủi ro thấp hơn hẳn. Đã có unit test xác nhận: fast-forward thuần remote, merge 2 bên sửa file khác nhau (không xung đột), và xung đột thật (đổi tên `.conflict.<timestamp>.md`, không còn ký tự conflict marker, sync tiếp theo là no-op) — tất cả pass với các "remote" repo Git cục bộ thật (bare repo), không mock.
- PAT lưu qua `github.com/zalando/go-keyring` (Windows Credential Manager/macOS Keychain/Linux Secret Service) — không bao giờ ghi ra `.git/config` hay bất kỳ file nào; chỉ chèn tạm vào URL truyền cho từng lệnh `git fetch`/`git push`. Đã smoke-test set/get/clear round-trip thật trên Windows Credential Manager — pass.
- Trigger đồng bộ: khi mở Vault (nếu đã cấu hình), định kỳ mỗi 5 phút trong lúc app chạy, khi thoát app (`OnShutdown`, giới hạn 8s để không treo việc thoát), và nút "Cấu hình đồng bộ"/status bar cho sync thủ công.
- Frontend: `SyncStatusBar` (icon trạng thái Synced/Syncing/Conflict/Offline/Error/Chưa cấu hình, bấm để sync ngay) + `SyncSettingsModal` (nhập Repo URL, nhánh, phương thức xác thực, PAT — PAT chỉ ghi mới, không hiển thị lại).
- Build production thành công; binary **~19.25MB** (gần như không tăng so với Phase 3, vì go-keyring rất nhẹ và git CLI chạy ngoài, không nhúng vào binary) — còn ~10.7MB dư địa so với ngân sách 30MB.
- Giới hạn đã biết: mỗi máy chỉ lưu 1 PAT toàn cục (đủ dùng cho kịch bản phổ biến 1 Vault/1 tài khoản GitHub mỗi máy); chưa test round-trip go-keyring trên macOS/Linux thật (chỉ xác minh trên Windows) — nên kiểm tra thủ công khi đóng gói đa nền tảng ở Phase 5.

**Phase 5 — DONE (trong giới hạn môi trường sandbox)**
- README.md viết lại đầy đủ: tổng quan, tính năng theo phase, phím tắt, hướng dẫn dev/build/test, cấu trúc thư mục, lưu ý triển khai sync, bảng NFR đã đo.
- `.github/workflows/release.yml`: build & đóng gói đa nền tảng (Windows NSIS, macOS universal dmg, Linux AppImage) khi push tag `v*`, dùng action cộng đồng phổ biến `dAppServer/wails-build-action`.
- **Giới hạn môi trường quan trọng**: không thể tạo installer NSIS cục bộ trong phiên sandbox này — `wails build -nsis` báo "makensis not found", và cài đặt NSIS qua `winget` bị chặn do sandbox không có quyền admin (lỗi `0x800704c7`, elevation bị từ chối); tải bản portable NSIS trực tiếp từ SourceForge cũng thất bại (trả về trang HTML thay vì file zip thật). Do đó **NSIS installer và build macOS/Linux chưa được build/test trực tiếp trong phiên này** — cần chạy qua CI (`release.yml`) hoặc trên máy có quyền admin thật để hoàn tất xác minh đóng gói đa nền tảng.
- Đã xác minh đầy đủ trên Windows: `wails build` (portable exe) thành công, build/test toàn bộ Go + frontend pass, cold-start ~1s, RAM idle 35–67MB, binary ~19.25MB — tất cả trong ngân sách NFR đề ra.

## 6. Quyết định đã chốt cùng bạn
- Sync: dùng `git` CLI hệ thống (os/exec), không tự viết lại git bằng go-git.
- Editor: chỉ 1 chế độ WYSIWYG Live Preview (Milkdown), không làm split raw-markdown view.
- Bảo mật PAT: OS Keychain (go-keyring).
- Cách làm: triển khai tuần tự theo phase ở trên, bắt đầu Phase 0 + Phase 1 sau khi duyệt plan này.
