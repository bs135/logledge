import {useCallback, useEffect, useRef, useState} from 'react'
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
import {VaultModal} from './components/VaultModal'
import {SidebarContextMenu} from './components/SidebarContextMenu'
import {DetectVaultInfo, PickVaultFolder, ReadFile, SaveVault, SetGitHubPAT, WriteFile} from '../wailsjs/go/main/App'
import {config} from '../wailsjs/go/models'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {FilePlus, FolderPlus} from 'lucide-react'

const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 700

function App() {
    const vault = useVault()
    const {theme, setTheme} = useTheme()
    const {t, lang} = useI18n()
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [initialContent, setInitialContent] = useState('')
    const [editorKey, setEditorKey] = useState(0)
    const [externalChangeNotice, setExternalChangeNotice] = useState<string | null>(null)
    const currentContentRef = useRef('')
    const isDirtyRef = useRef(false)
    const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('logledge:sidebarOpen') !== 'false')
    const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
        const saved = localStorage.getItem('logledge:sidebarWidth')
        if (saved) {
            const parsed = parseInt(saved, 10)
            if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
                return parsed
            }
        }
        return DEFAULT_SIDEBAR_WIDTH
    })
    const [isResizing, setIsResizing] = useState(false)
    const [sidebarContextMenuPos, setSidebarContextMenuPos] = useState<{x: number; y: number} | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const lastResizeMouseDownTimeRef = useRef(0)
    const isDraggingSidebarRef = useRef(false)
    const dragStartXRef = useRef(0)
    const [onlyNotes, setOnlyNotes] = useState(() => localStorage.getItem('logledge:onlyNotes') !== 'false')
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
    const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settingsTab, setSettingsTab] = useState<'general' | 'vaults' | 'appearance' | 'about'>('general')
    const [quickHelpOpen, setQuickHelpOpen] = useState(false)
    const [addingVault, setAddingVault] = useState<config.VaultEntry | null>(null)

    async function handleOpenVaultFolder() {
        try {
            const chosen = await PickVaultFolder()
            if (!chosen) return
            const detected = await DetectVaultInfo(chosen)
            setAddingVault(detected)
        } catch (err) {
            alert(String(err))
        }
    }

    async function handleSaveNewVault(entry: config.VaultEntry, pat?: string) {
        if (pat && entry.gitAuthMethod === 'pat') {
            await SetGitHubPAT(pat)
        }
        await SaveVault(entry, true)
        setAddingVault(null)
        handleVaultSwitched(entry.path)
    }

    const toggleTheme = () => {
        if (theme === 'dark') {
            setTheme('light')
        } else if (theme === 'light') {
            setTheme('system')
        } else {
            setTheme('dark')
        }
    }

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

    async function handleCreateNote(parent = '') {
        const name = window.prompt(t('newNote') + ':')
        if (!name) return
        const newPath = await vault.createFile(parent, name)
        if (newPath) {
            openFile(newPath)
        }
    }

    async function handleCreateFolder(parent = '') {
        const name = window.prompt(t('newFolder') + ':')
        if (!name) return
        await vault.createFolder(parent, name)
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

    const handleResetSidebarWidth = useCallback(() => {
        setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
    }, [])

    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return
        e.preventDefault()

        const now = Date.now()
        const timeDiff = now - lastResizeMouseDownTimeRef.current
        if (timeDiff <= 500 && timeDiff > 0) {
            handleResetSidebarWidth()
            lastResizeMouseDownTimeRef.current = 0
            isDraggingSidebarRef.current = false
            setIsResizing(false)
            return
        }
        lastResizeMouseDownTimeRef.current = now

        dragStartXRef.current = e.clientX
        isDraggingSidebarRef.current = false

        const prevUserSelect = document.body.style.userSelect
        const prevCursor = document.body.style.cursor

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isDraggingSidebarRef.current) {
                if (Math.abs(moveEvent.clientX - dragStartXRef.current) >= 3) {
                    isDraggingSidebarRef.current = true
                    lastResizeMouseDownTimeRef.current = 0
                    setIsResizing(true)
                    document.body.style.userSelect = 'none'
                    document.body.style.cursor = 'col-resize'
                } else {
                    return
                }
            }

            const containerLeft = containerRef.current?.getBoundingClientRect().left ?? 0
            const maxAllowed = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 200))
            const newWidth = Math.min(Math.max(moveEvent.clientX - containerLeft, MIN_SIDEBAR_WIDTH), maxAllowed)
            setSidebarWidth(newWidth)
        }

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            window.removeEventListener('blur', handleMouseUp)
            if (isDraggingSidebarRef.current) {
                isDraggingSidebarRef.current = false
                setIsResizing(false)
                document.body.style.userSelect = prevUserSelect
                document.body.style.cursor = prevCursor
            }
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        window.addEventListener('blur', handleMouseUp)
    }, [handleResetSidebarWidth])

    useEffect(() => {
        return () => {
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
    }, [])

    useEffect(() => {
        localStorage.setItem('logledge:sidebarWidth', String(sidebarWidth))
    }, [sidebarWidth])

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
            <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400">
                <TitleBar
                    vaultPath={null}
                    selectedPath={null}
                    sidebarOpen={false}
                    theme={theme}
                    onToggleTheme={toggleTheme}
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
            <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
                <TitleBar
                    vaultPath={null}
                    selectedPath={null}
                    sidebarOpen={false}
                    theme={theme}
                    onToggleTheme={toggleTheme}
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
                    <p className="text-neutral-500 dark:text-neutral-400">{t('selectVaultPrompt')}</p>
                    <button
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                        onClick={handleOpenVaultFolder}
                    >
                        {t('selectVaultBtn')}
                    </button>
                    {vault.error && <p className="text-sm text-red-500 dark:text-red-400">{vault.error}</p>}
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
                {addingVault && (
                    <VaultModal
                        isOpen={true}
                        mode="create"
                        initialVault={addingVault}
                        onSave={handleSaveNewVault}
                        onClose={() => setAddingVault(null)}
                    />
                )}
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 overflow-hidden">
            <TitleBar
                vaultPath={vault.vaultPath}
                selectedPath={selectedPath}
                sidebarOpen={sidebarOpen}
                theme={theme}
                onToggleTheme={toggleTheme}
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
            <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
                {sidebarOpen && (
                    <>
                        <aside
                            style={{
                                width: `${sidebarWidth}px`,
                                minWidth: `${MIN_SIDEBAR_WIDTH}px`,
                                maxWidth: `min(${MAX_SIDEBAR_WIDTH}px, calc(100vw - 200px))`,
                            }}
                            className="shrink-0 overflow-hidden bg-neutral-50/50 dark:bg-neutral-900/40 p-2 flex flex-col"
                            onContextMenu={(e) => {
                                e.preventDefault()
                                setSidebarContextMenuPos({x: e.clientX, y: e.clientY})
                            }}
                        >
                            <div className="flex items-center justify-between px-2 py-1 mb-1 text-xs text-neutral-500 dark:text-neutral-400 font-medium select-none">
                                <span className="tracking-wider text-[11px]">{t('explorer')}</span>
                                <div className="flex items-center gap-1" onContextMenu={(e) => e.stopPropagation()}>
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
                                                ? 'bg-blue-50 text-blue-700 border border-blue-300 dark:bg-blue-600/30 dark:text-blue-300 dark:border-blue-500/40'
                                                : 'bg-neutral-200 text-neutral-700 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                                        }`}
                                    >
                                        {onlyNotes ? '.md' : 'all'}
                                    </button>
                                    <button
                                        onClick={() => handleCreateNote('')}
                                        title={t('newNote')}
                                        className="p-1 rounded text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                                    >
                                        <FilePlus className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={() => handleCreateFolder('')}
                                        title={t('newFolder')}
                                        className="p-1 rounded text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                                    >
                                        <FolderPlus className="h-3.5 w-3.5" />
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
                                        onCreateFile={handleCreateNote}
                                        onCreateFolder={handleCreateFolder}
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
                    {/* Resize handle */}
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-valuenow={sidebarWidth}
                        aria-valuemin={MIN_SIDEBAR_WIDTH}
                        aria-valuemax={MAX_SIDEBAR_WIDTH}
                        tabIndex={0}
                        title={t('resizeSidebar')}
                        onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                        }}
                        onMouseDown={handleResizeMouseDown}
                        onDoubleClick={handleResetSidebarWidth}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowLeft') {
                                e.preventDefault()
                                setSidebarWidth((w) => Math.max(MIN_SIDEBAR_WIDTH, w - 16))
                            } else if (e.key === 'ArrowRight') {
                                e.preventDefault()
                                const maxAllowed = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 200))
                                setSidebarWidth((w) => Math.min(maxAllowed, w + 16))
                            } else if (e.key === 'Home') {
                                e.preventDefault()
                                setSidebarWidth(MIN_SIDEBAR_WIDTH)
                            } else if (e.key === 'End') {
                                e.preventDefault()
                                handleResetSidebarWidth()
                            }
                        }}
                        className="relative w-px shrink-0 select-none bg-neutral-200 dark:bg-neutral-800 cursor-col-resize group focus:outline-none"
                    >
                        {/* Invisible expanded hit area for easier grabbing */}
                        <div
                            className="absolute inset-y-0 -left-1.5 -right-1.5 z-20 cursor-col-resize"
                            onDoubleClick={handleResetSidebarWidth}
                        />
                        {/* Visual indicator on hover and active dragging */}
                        <div
                            className={`absolute inset-y-0 -left-[1px] w-[3px] transition-colors pointer-events-none ${
                                isResizing
                                    ? 'bg-blue-500 dark:bg-blue-500'
                                    : 'group-hover:bg-blue-500/80 dark:group-hover:bg-blue-400/80'
                            }`}
                        />
                    </div>
                </>
            )}
                <main className="flex-1 overflow-hidden p-4 flex flex-col bg-white dark:bg-neutral-900">
                    {externalChangeNotice !== null && (
                        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 border border-amber-300 text-amber-900 dark:bg-amber-950/80 dark:border-amber-600/50 dark:text-amber-200 px-3 py-1.5 text-xs">
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
                                    className="rounded bg-amber-600 px-2.5 py-0.5 font-medium text-white hover:bg-amber-500"
                                >
                                    {t('reloadBtn')}
                                </button>
                                <button
                                    onClick={() => setExternalChangeNotice(null)}
                                    className="rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600 px-2.5 py-0.5"
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
                                    alert((lang === 'vi' ? 'Không thể đổi tên: ' : 'Failed to rename: ') + String(err))
                                }
                            }}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center text-neutral-400 dark:text-neutral-500">
                            {t('selectNotePlaceholder')}
                        </div>
                    )}
                </main>
            </div>
            <SyncStatusBar onOpenSettings={() => {
                setSettingsTab('vaults')
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
            {addingVault && (
                <VaultModal
                    isOpen={true}
                    mode="create"
                    initialVault={addingVault}
                    onSave={handleSaveNewVault}
                    onClose={() => setAddingVault(null)}
                />
            )}
            {sidebarContextMenuPos && (
                <SidebarContextMenu
                    position={sidebarContextMenuPos}
                    onClose={() => setSidebarContextMenuPos(null)}
                    onCreateFile={() => handleCreateNote('')}
                    onCreateFolder={() => handleCreateFolder('')}
                />
            )}
            {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
        </div>
    )
}

export default App

