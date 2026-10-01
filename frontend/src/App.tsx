import {useRef, useState} from 'react'
import {useVault} from './hooks/useVault'
import {FileTree} from './components/FileTree'
import {ReadFile, WriteFile} from '../wailsjs/go/main/App'

function App() {
    const vault = useVault()
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [content, setContent] = useState('')
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    async function openFile(path: string) {
        setSelectedPath(path)
        try {
            setContent(await ReadFile(path))
        } catch {
            setContent('')
        }
    }

    // Placeholder editor cho Phase 1 (raw textarea); Milkdown WYSIWYG Live
    // Preview sẽ thay thế ở Phase 2. Debounce 600ms để tránh ghi đĩa mỗi phím gõ.
    function onEdit(next: string) {
        setContent(next)
        if (!selectedPath) return
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
            WriteFile(selectedPath, next)
        }, 600)
    }

    if (vault.loading) {
        return (
            <div className="flex h-full items-center justify-center bg-neutral-900 text-neutral-400">
                Đang tải…
            </div>
        )
    }

    if (!vault.vaultPath) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-neutral-900 text-neutral-100">
                <h1 className="text-2xl font-semibold">Logledge</h1>
                <p className="text-neutral-400">Chọn một thư mục để làm Vault</p>
                <button
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
                    onClick={vault.selectFolder}
                >
                    Chọn thư mục Vault
                </button>
                {vault.error && <p className="text-sm text-red-400">{vault.error}</p>}
            </div>
        )
    }

    return (
        <div className="flex h-full bg-neutral-900 text-neutral-100">
            <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 p-2">
                {vault.tree && (
                    <FileTree
                        root={vault.tree}
                        selectedPath={selectedPath}
                        onSelectFile={openFile}
                        onCreateFile={(parent) => {
                            const name = window.prompt('Tên ghi chú mới:')
                            if (name) vault.createFile(parent, name)
                        }}
                        onCreateFolder={(parent) => {
                            const name = window.prompt('Tên thư mục mới:')
                            if (name) vault.createFolder(parent, name)
                        }}
                        onRename={(path) => {
                            const name = window.prompt('Tên mới:', path.split('/').pop())
                            if (name) vault.rename(path, name)
                        }}
                        onDelete={(path) => {
                            if (window.confirm(`Chuyển "${path}" vào thùng rác?`)) vault.remove(path)
                        }}
                        onMove={vault.move}
                    />
                )}
            </aside>
            <main className="flex-1 p-4">
                {selectedPath ? (
                    <textarea
                        className="h-full w-full resize-none bg-transparent font-mono text-sm outline-none"
                        value={content}
                        onChange={(e) => onEdit(e.target.value)}
                        placeholder="Bắt đầu viết…"
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-neutral-500">
                        Chọn một ghi chú để bắt đầu
                    </div>
                )}
            </main>
        </div>
    )
}

export default App
