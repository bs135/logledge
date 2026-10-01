import {useEffect, useState} from 'react'
import {useVault} from './hooks/useVault'
import {FileTree} from './components/FileTree'
import {Editor} from './components/Editor'
import {QuickSwitcher} from './components/QuickSwitcher'
import {GlobalSearch} from './components/GlobalSearch'
import {ReadFile, WriteFile} from '../wailsjs/go/main/App'

function App() {
    const vault = useVault()
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [initialContent, setInitialContent] = useState('')
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
    const [globalSearchOpen, setGlobalSearchOpen] = useState(false)

    async function openFile(path: string) {
        try {
            const text = await ReadFile(path)
            setInitialContent(text)
            setSelectedPath(path)
        } catch {
            setInitialContent('')
            setSelectedPath(path)
        }
        setQuickSwitcherOpen(false)
        setGlobalSearchOpen(false)
    }

    // Ctrl+P: Quick Switcher (fuzzy theo tên file). Ctrl+Shift+F: Global Search
    // (toàn văn). Chặn hành vi mặc định của trình duyệt (in trang / tìm trang).
    useEffect(() => {
        function onKeyDown(e: globalThis.KeyboardEvent) {
            if (!vault.vaultPath) return
            const ctrlOrCmd = e.ctrlKey || e.metaKey
            if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault()
                setGlobalSearchOpen(false)
                setQuickSwitcherOpen(true)
            } else if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'f') {
                e.preventDefault()
                setQuickSwitcherOpen(false)
                setGlobalSearchOpen(true)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [vault.vaultPath])

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
            <main className="flex-1 overflow-hidden p-4">
                {selectedPath ? (
                    <Editor
                        key={selectedPath}
                        path={selectedPath}
                        initialContent={initialContent}
                        onChange={(markdown) => WriteFile(selectedPath, markdown)}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-neutral-500">
                        Chọn một ghi chú để bắt đầu
                    </div>
                )}
            </main>
            {quickSwitcherOpen && (
                <QuickSwitcher onOpen={openFile} onClose={() => setQuickSwitcherOpen(false)} />
            )}
            {globalSearchOpen && (
                <GlobalSearch onOpen={openFile} onClose={() => setGlobalSearchOpen(false)} />
            )}
        </div>
    )
}

export default App
