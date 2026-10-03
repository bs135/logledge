import {useEffect, useRef, useState} from 'react'
import {useVault} from './hooks/useVault'
import {useTheme} from './hooks/useTheme'
import {useI18n} from './i18n'
import {TitleBar} from './components/TitleBar'
import {FileTree} from './components/FileTree'
import {Editor} from './components/Editor'
import {QuickSwitcher} from './components/QuickSwitcher'
import {GlobalSearch} from './components/GlobalSearch'
import {SyncStatusBar} from './components/SyncStatusBar'
import {SettingsModal} from './components/SettingsModal'
import {QuickHelpModal} from './components/QuickHelpModal'
import {ReadFile, WriteFile} from '../wailsjs/go/main/App'
import {EventsOn} from '../wailsjs/runtime/runtime'

function App() {
    const vault = useVault()
    const {theme, setTheme} = useTheme()
    const {t} = useI18n()
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [initialContent, setInitialContent] = useState('')
    const [editorKey, setEditorKey] = useState(0)
    const [externalChangeNotice, setExternalChangeNotice] = useState<string | null>(null)
    const currentContentRef = useRef('')
    const isDirtyRef = useRef(false)
    const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('logledge:sidebarOpen') !== 'false')
    const [onlyNotes, setOnlyNotes] = useState(() => localStorage.getItem('logledge:onlyNotes') !== 'false')
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
    const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settingsTab, setSettingsTab] = useState<'general' | 'appearance' | 'sync' | 'about'>('general')
    const [quickHelpOpen, setQuickHelpOpen] = useState(false)

    async function openFile(path: string) {
        try {
            const text = await ReadFile(path)
            currentContentRef.current = text
            isDirtyRef.current = false
            setExternalChangeNotice(null)
            setInitialContent(text)
            setSelectedPath(path)
            setEditorKey((k) => k + 1)
        } catch {
            currentContentRef.current = ''
            isDirtyRef.current = false
            setExternalChangeNotice(null)
            setInitialContent('')
            setSelectedPath(path)
            setEditorKey((k) => k + 1)
        }
        setQuickSwitcherOpen(false)
        setGlobalSearchOpen(false)
    }

    function handleVaultSwitched(_newPath: string) {
        setSelectedPath(null)
        setInitialContent('')
        currentContentRef.current = ''
        isDirtyRef.current = false
        setExternalChangeNotice(null)
        vault.reload()
    }

    // Auto-refresh active note if changed externally or after git sync
    useEffect(() => {
        if (!selectedPath) return

        async function checkExternalChange() {
            if (!selectedPath) return
            try {
                const diskContent = await ReadFile(selectedPath)
                if (diskContent !== currentContentRef.current) {
                    if (isDirtyRef.current) {
                        setExternalChangeNotice(diskContent)
                    } else {
                        currentContentRef.current = diskContent
                        setInitialContent(diskContent)
                        setEditorKey((k) => k + 1)
                    }
                }
            } catch {
                // file may have been moved or removed
            }
        }

        const offVault = EventsOn('vault:changed', checkExternalChange)
        const offSync = EventsOn('sync:status', (st: {state: string}) => {
            if (st?.state === 'idle') {
                checkExternalChange()
            }
        })
        return () => {
            offVault()
            offSync()
        }
    }, [selectedPath])

    // Keyboard shortcuts:
    // Ctrl+P: Quick Switcher
    // Ctrl+Shift+F: Global Search
    // Ctrl+B: Toggle sidebar
    // Ctrl+,: Settings
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
            } else if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'b') {
                e.preventDefault()
                setSidebarOpen((s) => {
                    const next = !s
                    localStorage.setItem('logledge:sidebarOpen', String(next))
                    return next
                })
            } else if (ctrlOrCmd && !e.shiftKey && e.key === ',') {
                e.preventDefault()
                setSettingsTab('general')
                setSettingsOpen(true)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [vault.vaultPath])

    if (vault.loading) {
        return (
            <div className="flex h-full flex-col bg-neutral-900 text-neutral-400 light:bg-neutral-50 light:text-neutral-500">
                <TitleBar
                    vaultPath={null}
                    selectedPath={null}
                    sidebarOpen={false}
                    onToggleSidebar={() => {}}
                    onOpenQuickSwitcher={() => {}}
                    onOpenSettings={() => {}}
                    onOpenHelp={() => {}}
                />
                <div className="flex flex-1 items-center justify-center">{t('loading')}</div>
            </div>
        )
    }

    if (!vault.vaultPath) {
        return (
            <div className="flex h-full flex-col bg-neutral-900 text-neutral-100 light:bg-neutral-50 light:text-neutral-900">
                <TitleBar
                    vaultPath={null}
                    selectedPath={null}
                    sidebarOpen={false}
                    onToggleSidebar={() => {}}
                    onOpenQuickSwitcher={() => {}}
                    onOpenSettings={() => {
                        setSettingsTab('general')
                        setSettingsOpen(true)
                    }}
                    onOpenHelp={() => setQuickHelpOpen(true)}
                    onVaultSwitched={handleVaultSwitched}
                />
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <img src="/icon.svg" alt="Logledge" className="h-16 w-16" />
                    <h1 className="text-2xl font-semibold">{t('appName')}</h1>
                    <p className="text-neutral-400 light:text-neutral-500">{t('selectVaultPrompt')}</p>
                    <button
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                        onClick={vault.selectFolder}
                    >
                        {t('selectVaultBtn')}
                    </button>
                    {vault.error && <p className="text-sm text-red-400">{vault.error}</p>}
                </div>
                {quickHelpOpen && <QuickHelpModal onClose={() => setQuickHelpOpen(false)} />}
                {settingsOpen && (
                    <SettingsModal
                        initialTab={settingsTab}
                        currentVaultPath={vault.vaultPath}
                        currentTheme={theme}
                        onSetTheme={setTheme}
                        onSwitchVault={handleVaultSwitched}
                        onClose={() => setSettingsOpen(false)}
                    />
                )}
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col bg-neutral-900 text-neutral-100 light:bg-neutral-50 light:text-neutral-900 overflow-hidden">
            <TitleBar
                vaultPath={vault.vaultPath}
                selectedPath={selectedPath}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() =>
                    setSidebarOpen((s) => {
                        const next = !s
                        localStorage.setItem('logledge:sidebarOpen', String(next))
                        return next
                    })
                }
                onOpenQuickSwitcher={() => {
                    setGlobalSearchOpen(false)
                    setQuickSwitcherOpen(true)
                }}
                onOpenSettings={() => {
                    setSettingsTab('general')
                    setSettingsOpen(true)
                }}
                onOpenHelp={() => setQuickHelpOpen(true)}
                onVaultSwitched={handleVaultSwitched}
            />
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {sidebarOpen && (
                    <aside className="w-64 shrink-0 overflow-hidden border-r border-neutral-800 light:border-neutral-200 light:bg-neutral-50/50 p-2 flex flex-col">
                        <div className="flex items-center justify-between px-2 py-1 mb-1 text-xs text-neutral-400 light:text-neutral-500 font-medium select-none">
                            <span className="tracking-wider text-[11px]">{t('explorer')}</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() =>
                                        setOnlyNotes((n) => {
                                            const next = !n
                                            localStorage.setItem('logledge:onlyNotes', String(next))
                                            return next
                                        })
                                    }
                                    title={onlyNotes ? t('onlyNotes') : t('allFiles')}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                                        onlyNotes
                                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 light:bg-blue-50 light:text-blue-700 light:border-blue-300'
                                            : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 light:bg-neutral-200 light:text-neutral-700'
                                    }`}
                                >
                                    {onlyNotes ? '.md' : 'all'}
                                </button>
                                <button
                                    onClick={() => {
                                        const name = window.prompt(t('newNote') + ':')
                                        if (name) vault.createFile('', name)
                                    }}
                                    title={t('newNote')}
                                    className="p-1 hover:bg-neutral-800 light:hover:bg-neutral-200 rounded text-neutral-400 hover:text-neutral-200 light:text-neutral-600"
                                >
                                    +📄
                                </button>
                                <button
                                    onClick={() => {
                                        const name = window.prompt(t('newFolder') + ':')
                                        if (name) vault.createFolder('', name)
                                    }}
                                    title={t('newFolder')}
                                    className="p-1 hover:bg-neutral-800 light:hover:bg-neutral-200 rounded text-neutral-400 hover:text-neutral-200 light:text-neutral-600"
                                >
                                    +📁
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {vault.tree && (
                                <FileTree
                                    root={vault.tree}
                                    onlyNotes={onlyNotes}
                                    selectedPath={selectedPath}
                                    onSelectFile={openFile}
                                    onCreateFile={(parent) => {
                                        const name = window.prompt(t('newNote') + ':')
                                        if (name) vault.createFile(parent, name)
                                    }}
                                    onCreateFolder={(parent) => {
                                        const name = window.prompt(t('newFolder') + ':')
                                        if (name) vault.createFolder(parent, name)
                                    }}
                                    onRename={async (path) => {
                                        const name = window.prompt(t('rename') + ':', path.split('/').pop())
                                        if (name) {
                                            const newPath = await vault.rename(path, name)
                                            if (newPath && selectedPath === path) {
                                                setSelectedPath(newPath)
                                            }
                                        }
                                    }}
                                    onDelete={(path) => {
                                        if (window.confirm(`${t('moveToTrashConfirm')} "${path}"`)) {
                                            vault.remove(path)
                                            if (selectedPath === path) setSelectedPath(null)
                                        }
                                    }}
                                    onMove={vault.move}
                                />
                            )}
                        </div>
                    </aside>
                )}
                <main className="flex-1 overflow-hidden p-4 flex flex-col light:bg-white">
                    {externalChangeNotice !== null && (
                        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-950/80 border border-amber-600/50 px-3 py-1.5 text-xs text-amber-200 light:bg-amber-50 light:border-amber-300 light:text-amber-900">
                            <span>{t('externalUpdateNotice')}</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        currentContentRef.current = externalChangeNotice
                                        setInitialContent(externalChangeNotice)
                                        setEditorKey((k) => k + 1)
                                        setExternalChangeNotice(null)
                                        isDirtyRef.current = false
                                    }}
                                    className="rounded bg-amber-600 px-2.5 py-0.5 font-medium text-neutral-900 hover:bg-amber-500"
                                >
                                    {t('reloadBtn')}
                                </button>
                                <button
                                    onClick={() => setExternalChangeNotice(null)}
                                    className="rounded bg-neutral-700 px-2.5 py-0.5 text-neutral-200 hover:bg-neutral-600 light:bg-neutral-200 light:text-neutral-800"
                                >
                                    {t('keepDraftBtn')}
                                </button>
                            </div>
                        </div>
                    )}
                    {selectedPath ? (
                        <Editor
                            key={`${selectedPath}-${editorKey}`}
                            path={selectedPath}
                            initialContent={initialContent}
                            onContentChange={(markdown) => {
                                currentContentRef.current = markdown
                                isDirtyRef.current = true
                            }}
                            onChange={async (markdown) => {
                                currentContentRef.current = markdown
                                try {
                                    await WriteFile(selectedPath, markdown)
                                } finally {
                                    isDirtyRef.current = false
                                }
                            }}
                            onRename={async (newName) => {
                                if (!selectedPath) return
                                try {
                                    const newPath = await vault.rename(selectedPath, newName)
                                    if (newPath) {
                                        setSelectedPath(newPath)
                                    }
                                } catch (err) {
                                    alert('Không thể đổi tên: ' + String(err))
                                }
                            }}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center text-neutral-500 light:text-neutral-400">
                            {t('selectNotePlaceholder')}
                        </div>
                    )}
                </main>
            </div>
            <SyncStatusBar onOpenSettings={() => {
                setSettingsTab('sync')
                setSettingsOpen(true)
            }} />
            {quickSwitcherOpen && (
                <QuickSwitcher onOpen={openFile} onClose={() => setQuickSwitcherOpen(false)} />
            )}
            {globalSearchOpen && (
                <GlobalSearch onOpen={openFile} onClose={() => setGlobalSearchOpen(false)} />
            )}
            {settingsOpen && (
                <SettingsModal
                    initialTab={settingsTab}
                    currentVaultPath={vault.vaultPath}
                    currentTheme={theme}
                    onSetTheme={setTheme}
                    onSwitchVault={handleVaultSwitched}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
            {quickHelpOpen && <QuickHelpModal onClose={() => setQuickHelpOpen(false)} />}
        </div>
    )
}

export default App

