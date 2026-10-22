import {useCallback, useEffect, useRef, useState} from 'react'
import {useVault} from './hooks/useVault'
import {useTheme} from './hooks/useTheme'
import {useI18n} from './i18n'
import {TitleBar} from './components/TitleBar'
import {FileClipboard, FileTree, InlineAction, parentOf} from './components/FileTree'
import {Editor} from './components/Editor'
import {QuickSwitcher} from './components/QuickSwitcher'
import {GlobalSearch} from './components/GlobalSearch'
import {SyncStatusBar} from './components/SyncStatusBar'
import {SettingsModal} from './components/SettingsModal'
import {QuickHelpModal} from './components/QuickHelpModal'
import {VaultModal} from './components/VaultModal'
import {ConfirmModal} from './components/ConfirmModal'
import {SidebarContextMenu} from './components/SidebarContextMenu'
import {DetectVaultInfo, GetAbsolutePath, GetFileFilterConfig, GetNativeRelativePath, PickVaultFolder, ReadFile, RevealInExplorer, SaveFileFilterConfig, SaveVault, SetGitHubPAT, WriteFileIfUnchanged} from '../wailsjs/go/main/App'
import {config} from '../wailsjs/go/models'
import {ClipboardSetText, EventsOn} from '../wailsjs/runtime/runtime'
import {FilePlus, FolderPlus, Filter, FilterX} from 'lucide-react'

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
    // Latest editor content, including edits not yet auto-saved.
    const currentContentRef = useRef('')
    // Content known to be on disk for the open note (last read or successfully saved).
    // Comparing disk against this — not against the live editor text — is what tells
    // a genuine external change (e.g., Git sync) apart from the user's own unsaved edits.
    const diskRef = useRef<{path: string | null; content: string}>({path: null, content: ''})
    // Serializes auto-saves so each one is checked against the outcome of the previous one.
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
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
    const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const lastResizeMouseDownTimeRef = useRef(0)
    const isDraggingSidebarRef = useRef(false)
    const dragStartXRef = useRef(0)
    const [filterConfig, setFilterConfig] = useState<config.FileFilterConfig>(() => {
        return new config.FileFilterConfig({
            enabled: true,
            mode: 'whitelist',
            whitelist: ['.md', '.markdown', '.txt'],
            blacklist: ['.exe', '.bin', '.dll', '.logledge'],
        })
    })
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
    const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settingsTab, setSettingsTab] = useState<'general' | 'filter' | 'vaults' | 'appearance' | 'about'>('general')
    const [quickHelpOpen, setQuickHelpOpen] = useState(false)
    const [addingVault, setAddingVault] = useState<config.VaultEntry | null>(null)
    const [inlineAction, setInlineAction] = useState<InlineAction | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

    useEffect(() => {
        GetFileFilterConfig()
            .then((cfg) => {
                if (cfg) {
                    setFilterConfig(cfg)
                }
            })
            .catch(() => {})
    }, [])

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

    // loadNote (re)initializes the editor with content that is known to be on disk.
    function loadNote(path: string | null, text: string) {
        currentContentRef.current = text
        diskRef.current = {path, content: text}
        setExternalChangeNotice(null)
        setInitialContent(text)
        setSelectedPath(path)
        setEditorKey((k) => k + 1)
    }

    // queueSave auto-saves with optimistic concurrency: the write only happens if the
    // file still holds the version the editor is based on. If Git sync (or another
    // program) changed it meanwhile, nothing is overwritten and the user is asked
    // whether to reload the new version or keep the draft.
    function queueSave(path: string, markdown: string) {
        const run = async () => {
            // The note was closed or renamed while this save was queued.
            if (diskRef.current.path !== path) return
            try {
                const res = await WriteFileIfUnchanged(path, markdown, diskRef.current.content)
                if (diskRef.current.path !== path) return
                if (res.saved) {
                    diskRef.current = {path, content: markdown}
                } else {
                    setExternalChangeNotice(res.diskContent)
                }
            } catch (err) {
                console.error('Auto-save failed:', err)
            }
        }
        saveQueueRef.current = saveQueueRef.current.then(run)
        return saveQueueRef.current
    }

    // followSelectedPath keeps the open note (and its unsaved edits) when its path
    // changes because the note or one of its parent folders was renamed.
    function followSelectedPath(newPath: string) {
        diskRef.current = {...diskRef.current, path: newPath}
        setInitialContent(currentContentRef.current)
        setSelectedPath(newPath)
    }

    async function openFile(path: string) {
        // Let in-flight auto-saves of the current note finish before switching.
        await saveQueueRef.current
        let text = ''
        try {
            text = await ReadFile(path)
        } catch {
            // Open as empty note if it cannot be read.
        }
        loadNote(path, text)
        setQuickSwitcherOpen(false)
        setGlobalSearchOpen(false)
    }

    function handleVaultSwitched(_newPath: string) {
        setFileClipboard(null)
        loadNote(null, '')
        vault.reload()
    }

    function handleCreateNote(parent = '') {
        if (!sidebarOpen) setSidebarOpen(true)
        setInlineAction({type: 'create-file', targetPath: parent})
    }

    function handleCreateFolder(parent = '') {
        if (!sidebarOpen) setSidebarOpen(true)
        setInlineAction({type: 'create-folder', targetPath: parent})
    }

    function handleStartRename(path: string) {
        if (!sidebarOpen) setSidebarOpen(true)
        setInlineAction({
            type: 'rename',
            targetPath: path,
            initialValue: path.split('/').pop() || '',
        })
    }

    async function handleCommitInlineAction(action: InlineAction, name: string) {
        const trimmed = name.trim()
        if (!trimmed) {
            setInlineAction(null)
            return
        }

        if (action.type === 'create-file') {
            setInlineAction(null)
            const newPath = await vault.createFile(action.targetPath, trimmed)
            if (newPath) {
                openFile(newPath)
            }
        } else if (action.type === 'create-folder') {
            setInlineAction(null)
            await vault.createFolder(action.targetPath, trimmed)
        } else if (action.type === 'rename') {
            setInlineAction(null)
            if (trimmed === action.initialValue) {
                return
            }
            try {
                const newPath = await vault.rename(action.targetPath, trimmed)
                if (newPath) {
                    if (selectedPath === action.targetPath) {
                        followSelectedPath(newPath)
                    } else if (selectedPath && selectedPath.startsWith(action.targetPath + '/')) {
                        followSelectedPath(newPath + selectedPath.slice(action.targetPath.length))
                    }
                }
            } catch (err) {
                alert((lang === 'vi' ? 'Không thể đổi tên: ' : 'Failed to rename: ') + String(err))
            }
        }
    }

    async function handleDuplicate(path: string) {
        try {
            await vault.duplicate(path)
        } catch (err) {
            alert(t('duplicateFailed') + String(err))
        }
    }

    async function copyToClipboard(getText: () => Promise<string>) {
        try {
            const text = await getText()
            const ok = await ClipboardSetText(text)
            if (!ok) {
                await navigator.clipboard.writeText(text)
            }
        } catch (err) {
            alert(t('copyPathFailed') + String(err))
        }
    }

    async function handleReveal(path: string) {
        try {
            await RevealInExplorer(path)
        } catch (err) {
            alert(t('revealFailed') + String(err))
        }
    }

    async function handlePaste(destParent: string) {
        const clip = fileClipboard
        if (!clip) return
        try {
            if (clip.mode === 'copy') {
                await vault.copyTo(clip.path, destParent)
                return
            }
            if (parentOf(clip.path) === destParent) {
                // Pasting a cut entry back into its own folder is a no-op.
                setFileClipboard(null)
                return
            }
            // Let in-flight auto-saves of the open note land before it is moved.
            await saveQueueRef.current
            const newPath = await vault.moveTo(clip.path, destParent)
            setFileClipboard(null)
            if (selectedPath === clip.path) {
                followSelectedPath(newPath)
            } else if (selectedPath && selectedPath.startsWith(clip.path + '/')) {
                followSelectedPath(newPath + selectedPath.slice(clip.path.length))
            }
        } catch (err) {
            alert(t('pasteFailed') + String(err))
        }
    }

    async function handleConfirmDelete() {
        if (!deleteTarget) return
        const pathToDelete = deleteTarget
        setDeleteTarget(null)
        await vault.remove(pathToDelete)
        if (selectedPath === pathToDelete || (selectedPath && selectedPath.startsWith(pathToDelete + '/'))) {
            diskRef.current = {path: null, content: ''}
            setSelectedPath(null)
        }
    }

    // Auto-refresh active note if changed externally or after git sync
    useEffect(() => {
        if (!selectedPath) return

        async function checkExternalChange() {
            if (!selectedPath) return
            try {
                const diskContent = await ReadFile(selectedPath)
                const known = diskRef.current
                if (known.path !== selectedPath || diskContent === known.content) {
                    // Nothing changed on disk since we last read or saved the note:
                    // unsaved edits in the editor are not an external change.
                    return
                }
                if (diskContent === currentContentRef.current) {
                    // Our own in-flight auto-save has already reached the disk.
                    diskRef.current = {path: selectedPath, content: diskContent}
                    return
                }
                if (currentContentRef.current === known.content) {
                    // No unsaved edits: silently show the new version.
                    loadNote(selectedPath, diskContent)
                } else {
                    setExternalChangeNotice(diskContent)
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
                        filterConfig={filterConfig}
                        onUpdateFilterConfig={setFilterConfig}
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
                                <div
                                    className="flex items-center gap-1"
                                    onContextMenu={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                    }}
                                >
                                    <button
                                        onClick={() => {
                                            const updated = new config.FileFilterConfig({
                                                ...filterConfig,
                                                enabled: !filterConfig.enabled,
                                            })
                                            setFilterConfig(updated)
                                            SaveFileFilterConfig(updated).catch(() => {})
                                        }}
                                        title={filterConfig.enabled ? t('filterActive') : t('filterInactive')}
                                        className={`p-1 rounded transition-colors ${
                                            filterConfig.enabled
                                                ? 'bg-blue-50 text-blue-700 border border-blue-300 dark:bg-blue-600/30 dark:text-blue-300 dark:border-blue-500/40'
                                                : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200'
                                        }`}
                                    >
                                        {filterConfig.enabled ? (
                                            <Filter className="h-3.5 w-3.5" />
                                        ) : (
                                            <FilterX className="h-3.5 w-3.5" />
                                        )}
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
                                        filter={filterConfig}
                                        selectedPath={selectedPath}
                                        inlineAction={inlineAction}
                                        onSelectFile={openFile}
                                        onCreateFile={handleCreateNote}
                                        onCreateFolder={handleCreateFolder}
                                        onRename={handleStartRename}
                                        onDelete={(path) => setDeleteTarget(path)}
                                        onDuplicate={handleDuplicate}
                                        onCopyPath={(path) => copyToClipboard(() => GetAbsolutePath(path))}
                                        onCopyRelativePath={(path) => copyToClipboard(() => GetNativeRelativePath(path))}
                                        onReveal={handleReveal}
                                        clipboard={fileClipboard}
                                        onCopy={(path) => setFileClipboard({mode: 'copy', path})}
                                        onCut={(path) => setFileClipboard({mode: 'cut', path})}
                                        onPaste={handlePaste}
                                        onMove={vault.move}
                                        onCommitInlineAction={handleCommitInlineAction}
                                        onCancelInlineAction={() => setInlineAction(null)}
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
                                    onClick={() => loadNote(selectedPath, externalChangeNotice)}
                                    className="rounded bg-amber-600 px-2.5 py-0.5 font-medium text-white hover:bg-amber-500"
                                >
                                    {t('reloadBtn')}
                                </button>
                                <button
                                    onClick={() => {
                                        // Acknowledge the disk version, then overwrite it with the draft.
                                        if (selectedPath) {
                                            diskRef.current = {path: selectedPath, content: externalChangeNotice}
                                            queueSave(selectedPath, currentContentRef.current)
                                        }
                                        setExternalChangeNotice(null)
                                    }}
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
                            }}
                            onChange={(markdown) => {
                                currentContentRef.current = markdown
                                queueSave(selectedPath, markdown)
                            }}
                            onRename={async (newName) => {
                                if (!selectedPath) return
                                try {
                                    await saveQueueRef.current
                                    const newPath = await vault.rename(selectedPath, newName)
                                    if (newPath) {
                                        followSelectedPath(newPath)
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
                    filterConfig={filterConfig}
                    onUpdateFilterConfig={setFilterConfig}
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
                    canPaste={Boolean(fileClipboard)}
                    onPaste={() => handlePaste('')}
                />
            )}
            <ConfirmModal
                isOpen={deleteTarget !== null}
                title={t('deleteModalTitle')}
                message={t('deleteModalDesc')}
                itemName={deleteTarget ? deleteTarget.split('/').pop() : undefined}
                onConfirm={handleConfirmDelete}
                onClose={() => setDeleteTarget(null)}
            />
            {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
        </div>
    )
}

export default App

