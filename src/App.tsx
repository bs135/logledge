import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useVault} from './hooks/useVault'
import {useNoteLists} from './hooks/useNoteLists'
import {useTheme} from './hooks/useTheme'
import {useTypography} from './hooks/useTypography'
import {zoomPercent, zoomTypography} from './lib/typography'
import {toast} from 'sonner'
import {translate, useI18n} from './i18n'
import {TitleBar} from './components/TitleBar'
import {FileClipboard, FileTree, InlineAction, parentOf, resolveCreateParent} from './components/FileTree'
import {Editor, type EditorStats} from './components/Editor'
import {EditorStatus, type SaveState} from './components/EditorStatus'
import {EmptyState} from './components/EmptyState'
import {QuickSwitcher} from './components/QuickSwitcher'
import {GlobalSearch} from './components/GlobalSearch'
import {SyncStatusBar} from './components/SyncStatusBar'
import {SettingsModal} from './components/SettingsModal'
import {QuickHelpModal} from './components/QuickHelpModal'
import {VaultModal} from './components/VaultModal'
import {ConfirmModal} from './components/ConfirmModal'
import {SidebarContextMenu} from './components/SidebarContextMenu'
import {runStartupUpdateCheck} from './components/updateCheck'
import {collectFilePaths, newNoteLocation, parseWikiLink, resolveWikiLink} from './lib/wikilink'
import {addRecent, removeFromList, renameInList, switcherSections, togglePin} from './lib/noteLists'
import {canGoBack, canGoForward, emptyHistory, NavHistory, pushHistory, removeFromHistory, renameInHistory, stepHistory} from './lib/navHistory'
import {createFile as apiCreateFile, createFolder as apiCreateFolder, detectVaultInfo, getAbsolutePath, getFileFilterConfig, getNativeRelativePath, onEvent, pickVaultFolder, readFile, revealInExplorer, saveFileFilterConfig, saveVault, setGitHubPAT, writeFileIfUnchanged} from './lib/api'
import type {FileFilterConfig, VaultEntry} from './lib/types'
import {FilePlus, FolderPlus, Filter, FilterX} from 'lucide-react'

const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 700
const STARTUP_UPDATE_CHECK_DELAY_MS = 2000
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const NAV_SHORTCUT_BACK = IS_MAC ? '⌘⌥←' : 'Alt+←'
const NAV_SHORTCUT_FORWARD = IS_MAC ? '⌘⌥→' : 'Alt+→'

function App() {
    const vault = useVault()
    const {theme, setTheme} = useTheme()
    const {typography, setTypography} = useTypography()
    // Read by the global keydown handler, which is not re-created on every change.
    const typographyRef = useRef(typography)
    typographyRef.current = typography
    const {t, lang} = useI18n()
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [initialContent, setInitialContent] = useState('')
    const [editorKey, setEditorKey] = useState(0)
    const [externalChangeNotice, setExternalChangeNotice] = useState<string | null>(null)
    // Status bar: save state of the open note and its word/character counts.
    const [saveState, setSaveState] = useState<{state: SaveState; error?: string}>({state: 'saved'})
    const [editorStats, setEditorStats] = useState<EditorStats | null>(null)
    // The open note's file disappeared from disk (deleted or moved outside the app).
    // While set, auto-save is paused so the file is not silently recreated.
    const [noteDeleted, setNoteDeletedState] = useState(false)
    const noteDeletedRef = useRef(false)
    const setNoteDeleted = (value: boolean) => {
        noteDeletedRef.current = value
        setNoteDeletedState(value)
    }
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
    // Active (focused) item in the file tree; toolbar New Note/New Folder create relative to it.
    const [treeActivePath, setTreeActivePath] = useState<string | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const lastResizeMouseDownTimeRef = useRef(0)
    const isDraggingSidebarRef = useRef(false)
    const dragStartXRef = useRef(0)
    const [filterConfig, setFilterConfig] = useState<FileFilterConfig>(() => {
        return ({
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
    const [addingVault, setAddingVault] = useState<VaultEntry | null>(null)
    const [inlineAction, setInlineAction] = useState<InlineAction | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
    // Heading to scroll to after following a [[Note#Heading]] link.
    const [scrollTarget, setScrollTarget] = useState<{heading: string; seq: number} | null>(null)
    // A WikiLink to a missing note waiting for the user to confirm creating it.
    const [pendingNoteCreate, setPendingNoteCreate] = useState<{parent: string; name: string; heading: string | null} | null>(null)
    const notePaths = useMemo(() => collectFilePaths(vault.tree), [vault.tree])
    // Pinned and recently opened notes of this vault (Quick Switcher, file tree pin icon).
    const noteLists = useNoteLists(vault.vaultPath)
    // Back/Forward history of opened notes. The ref mirrors the state so handlers that
    // run outside React's render cycle (keyboard and mouse listeners) see the latest value.
    const [navHistory, setNavHistoryState] = useState<NavHistory>(emptyHistory)
    const navHistoryRef = useRef<NavHistory>(emptyHistory)
    const setNavHistory = (update: (h: NavHistory) => NavHistory) => {
        navHistoryRef.current = update(navHistoryRef.current)
        setNavHistoryState(navHistoryRef.current)
    }

    useEffect(() => {
        getFileFilterConfig()
            .then((cfg) => {
                if (cfg) {
                    setFilterConfig(cfg)
                }
            })
            .catch(() => {})
    }, [])

    // Reopen the last viewed note of a vault once its file tree is loaded: at startup and
    // after switching vaults. Skipped when a note is already open. Waits for `loading` to
    // clear, because while a vault switch is in flight `tree` still belongs to the old vault.
    const restoredVaultRef = useRef<string | null>(null)
    useEffect(() => {
        const path = vault.vaultPath
        if (!path || vault.loading || !vault.tree || restoredVaultRef.current === path) return
        restoredVaultRef.current = path
        if (selectedPath) return
        const existing = new Set(notePaths)
        const last = noteLists.lists.recent.find((p) => existing.has(p))
        if (last) openFile(last)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vault.vaultPath, vault.loading, vault.tree])

    // Check for a new release once per launch, deferred so it never competes with cold start.
    useEffect(() => {
        const timer = window.setTimeout(runStartupUpdateCheck, STARTUP_UPDATE_CHECK_DELAY_MS)
        return () => window.clearTimeout(timer)
    }, [])

    async function handleOpenVaultFolder() {
        try {
            const chosen = await pickVaultFolder()
            if (!chosen) return
            const detected = await detectVaultInfo(chosen)
            setAddingVault(detected)
        } catch (err) {
            alert(String(err))
        }
    }

    async function handleSaveNewVault(entry: VaultEntry, pat?: string) {
        if (pat && entry.gitAuthMethod === 'pat') {
            await setGitHubPAT(pat)
        }
        await saveVault(entry, true)
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
        setNoteDeleted(false)
        setSaveState({state: 'saved'})
        if (!path) setEditorStats(null)
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
            // Don't recreate a file that was deleted outside the app; the user decides
            // with Restore / Close in the banner.
            if (noteDeletedRef.current) return
            setSaveState({state: 'saving'})
            try {
                const res = await writeFileIfUnchanged(path, markdown, diskRef.current.content)
                if (diskRef.current.path !== path) return
                if (res.saved) {
                    diskRef.current = {path, content: markdown}
                    // Typing may have continued while the write was in flight.
                    setSaveState({state: currentContentRef.current === markdown ? 'saved' : 'unsaved'})
                } else {
                    setExternalChangeNotice(res.diskContent)
                    setSaveState({state: 'conflict'})
                }
            } catch (err) {
                console.error('Auto-save failed:', err)
                if (diskRef.current.path === path) setSaveState({state: 'error', error: String(err)})
            }
        }
        saveQueueRef.current = saveQueueRef.current.then(run)
        return saveQueueRef.current
    }

    // followSelectedPath keeps the open note (and its unsaved edits) when its path
    // changes because the note or one of its parent folders was renamed.
    function followSelectedPath(newPath: string) {
        diskRef.current = {...diskRef.current, path: newPath}
        // A check that raced with the rename may have read the old, now missing path.
        if (noteDeletedRef.current) {
            setNoteDeleted(false)
            setSaveState({state: currentContentRef.current === diskRef.current.content ? 'saved' : 'unsaved'})
        }
        setInitialContent(currentContentRef.current)
        setSelectedPath(newPath)
    }

    // A note or folder was renamed or moved from `from` to `to`: keep the open note and the
    // Back/Forward history pointing at the new location.
    function handleEntryMoved(from: string, to: string) {
        if (selectedPath === from) {
            followSelectedPath(to)
        } else if (selectedPath && selectedPath.startsWith(from + '/')) {
            followSelectedPath(to + selectedPath.slice(from.length))
        }
        setNavHistory((h) => renameInHistory(h, from, to))
        noteLists.update((l) => ({pinned: renameInList(l.pinned, from, to), recent: renameInList(l.recent, from, to)}))
    }

    // Opens the previous (-1) or next (+1) note in the history. Entries for notes that no
    // longer exist (deleted outside the app, or by sync) are dropped first.
    async function navigate(step: -1 | 1) {
        if (vault.tree) {
            const existing = new Set(notePaths)
            setNavHistory((h) => removeFromHistory(h, (p) => !existing.has(p)))
        }
        const h = navHistoryRef.current
        // When the current entry is not open (its note was just deleted), Back reopens
        // that entry instead of skipping past it.
        const target =
            step === -1 && h.index >= 0 && h.entries[h.index] !== selectedPath
                ? {history: h, path: h.entries[h.index]}
                : stepHistory(h, step)
        if (!target) return
        setNavHistory(() => target.history)
        await openFile(target.path, null, false)
    }
    const navigateRef = useRef(navigate)
    navigateRef.current = navigate

    async function openFile(path: string, heading: string | null = null, recordHistory = true) {
        // Let in-flight auto-saves of the current note finish before switching.
        await saveQueueRef.current
        let text = ''
        try {
            text = await readFile(path)
        } catch {
            // Open as empty note if it cannot be read.
        }
        loadNote(path, text)
        if (recordHistory) setNavHistory((h) => pushHistory(h, path))
        noteLists.update((l) => ({...l, recent: addRecent(l.recent, path)}))
        setScrollTarget(heading ? {heading, seq: Date.now()} : null)
        setQuickSwitcherOpen(false)
        setGlobalSearchOpen(false)
    }

    // Follows a WikiLink: opens the resolved note, or creates it when it does not exist yet.
    async function handleOpenWikiLink(raw: string) {
        const {target, heading} = parseWikiLink(raw)
        if (!target) {
            // [[#Heading]]: a link inside the open note.
            if (heading) setScrollTarget({heading, seq: Date.now()})
            return
        }
        const existing = resolveWikiLink(target, notePaths, selectedPath)
        if (existing) {
            if (existing === selectedPath) {
                if (heading) setScrollTarget({heading, seq: Date.now()})
            } else {
                await openFile(existing, heading)
            }
            return
        }
        // Ask first, so a typo in a link does not silently create a stray note.
        setPendingNoteCreate({...newNoteLocation(target, selectedPath), heading})
    }

    async function handleConfirmNoteCreate() {
        if (!pendingNoteCreate) return
        const {parent, name, heading} = pendingNoteCreate
        setPendingNoteCreate(null)
        try {
            // Create missing parent folders one level at a time; existing ones are fine.
            let dir = ''
            for (const part of parent ? parent.split('/') : []) {
                await apiCreateFolder(dir, part).catch(() => {})
                dir = dir ? `${dir}/${part}` : part
            }
            const newPath = await apiCreateFile(parent, name)
            vault.refresh()
            await openFile(newPath, heading)
        } catch (err) {
            alert(t('wikiLinkCreateFailed') + String(err))
        }
    }

    function handleVaultSwitched(_newPath: string) {
        setFileClipboard(null)
        setNavHistory(() => emptyHistory)
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
                if (newPath) handleEntryMoved(action.targetPath, newPath)
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
            await navigator.clipboard.writeText(text)
        } catch (err) {
            alert(t('copyPathFailed') + String(err))
        }
    }

    async function handleReveal(path: string) {
        try {
            await revealInExplorer(path)
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
            handleEntryMoved(clip.path, newPath)
        } catch (err) {
            alert(t('pasteFailed') + String(err))
        }
    }

    // Drag-and-drop in the file tree. Goes through moveTo (like Cut + Paste) so the new path
    // is known: the open note and the history follow the move, and errors are shown.
    async function handleDragMove(srcPath: string, destParent: string) {
        try {
            await saveQueueRef.current
            const newPath = await vault.moveTo(srcPath, destParent)
            handleEntryMoved(srcPath, newPath)
        } catch (err) {
            alert(t('moveFailed') + String(err))
        }
    }

    async function handleConfirmDelete() {
        if (!deleteTarget) return
        const pathToDelete = deleteTarget
        setDeleteTarget(null)
        await vault.remove(pathToDelete)
        setNavHistory((h) => removeFromHistory(h, pathToDelete))
        noteLists.update((l) => ({pinned: removeFromList(l.pinned, pathToDelete), recent: removeFromList(l.recent, pathToDelete)}))
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
            let diskContent: string
            try {
                diskContent = await readFile(selectedPath)
            } catch {
                // The file is gone: deleted, or moved/renamed outside the app. Ignore it
                // when the app itself moved, renamed or closed the note meanwhile.
                if (diskRef.current.path !== selectedPath) return
                setNoteDeleted(true)
                setExternalChangeNotice(null)
                setSaveState({state: 'deleted'})
                return
            }
            if (noteDeletedRef.current) {
                // The file came back (restored from the trash, or by sync).
                setNoteDeleted(false)
                setSaveState({state: currentContentRef.current === diskContent ? 'saved' : 'unsaved'})
            }
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
        }

        const offVault = onEvent('vault:changed', checkExternalChange)
        const offSync = onEvent('sync:status', (st: {state: string}) => {
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

    // Back/Forward: Alt+Left/Right (Windows/Linux), Cmd+Alt+Left/Right (macOS), and the
    // mouse back/forward buttons. Keys are caught in the capture phase so they win over
    // CodeMirror, which binds Alt+Left/Right to cursorSyntaxLeft/Right.
    useEffect(() => {
        if (!vault.vaultPath) return
        function onKeyDown(e: globalThis.KeyboardEvent) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            const nav = IS_MAC
                ? e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey
                : e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
            if (!nav) return
            e.preventDefault()
            e.stopPropagation()
            navigateRef.current(e.key === 'ArrowLeft' ? -1 : 1)
        }
        function onMouseUp(e: MouseEvent) {
            if (e.button !== 3 && e.button !== 4) return
            e.preventDefault()
            navigateRef.current(e.button === 3 ? -1 : 1)
        }
        // Stops the webview's own back/forward handling of those buttons.
        function onMouseDown(e: MouseEvent) {
            if (e.button === 3 || e.button === 4) e.preventDefault()
        }
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('mouseup', onMouseUp)
        window.addEventListener('mousedown', onMouseDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('mouseup', onMouseUp)
            window.removeEventListener('mousedown', onMouseDown)
        }
    }, [vault.vaultPath])

    // Keyboard shortcuts:
    // Ctrl+P: Quick Switcher
    // Ctrl+Shift+F: Global Search
    // Ctrl+\: Toggle sidebar (works everywhere, including inside the editor)
    // Ctrl+B: Toggle sidebar outside the editor (inside it, the editor uses Ctrl+B for bold)
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
            } else if (
                ctrlOrCmd &&
                !e.shiftKey &&
                // e.code keeps Ctrl+\ layout-independent; skip Ctrl+B if the editor already handled it (bold)
                (e.code === 'Backslash' || (e.key.toLowerCase() === 'b' && !e.defaultPrevented))
            ) {
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
            } else if (ctrlOrCmd && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
                // Editor zoom: Ctrl+= / Ctrl+- change the font size by 1px, Ctrl+0 resets.
                e.preventDefault()
                const step = e.key === '0' ? 0 : e.key === '-' ? -1 : 1
                const next = zoomTypography(typographyRef.current, step)
                setTypography(() => next)
                toast(`${translate('zoomLevel')} ${zoomPercent(next)}% (${next.fontSize}px)`, {id: 'editor-zoom', duration: 1200})
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
                        typography={typography}
                        onChangeTypography={setTypography}
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
                nav={{
                    canGoBack:
                        canGoBack(navHistory) ||
                        (navHistory.index >= 0 && navHistory.entries[navHistory.index] !== selectedPath),
                    canGoForward: canGoForward(navHistory),
                    onGoBack: () => navigate(-1),
                    onGoForward: () => navigate(1),
                    backShortcut: NAV_SHORTCUT_BACK,
                    forwardShortcut: NAV_SHORTCUT_FORWARD,
                }}
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
                                            const updated = ({
                                                ...filterConfig,
                                                enabled: !filterConfig.enabled,
                                            })
                                            setFilterConfig(updated)
                                            saveFileFilterConfig(updated).catch(() => {})
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
                                        onClick={() => handleCreateNote(resolveCreateParent(vault.tree, treeActivePath))}
                                        title={t('newNote')}
                                        className="p-1 rounded text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                                    >
                                        <FilePlus className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={() => handleCreateFolder(resolveCreateParent(vault.tree, treeActivePath))}
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
                                        onActivePathChange={setTreeActivePath}
                                        onRename={handleStartRename}
                                        onDelete={(path) => setDeleteTarget(path)}
                                        onDuplicate={handleDuplicate}
                                        onCopyPath={(path) => copyToClipboard(() => getAbsolutePath(path))}
                                        onCopyRelativePath={(path) => copyToClipboard(() => getNativeRelativePath(path))}
                                        onReveal={handleReveal}
                                        clipboard={fileClipboard}
                                        onCopy={(path) => setFileClipboard({mode: 'copy', path})}
                                        onCut={(path) => setFileClipboard({mode: 'cut', path})}
                                        onPaste={handlePaste}
                                        onMove={handleDragMove}
                                        pinnedPaths={noteLists.lists.pinned}
                                        onTogglePin={(path) => noteLists.update((l) => ({...l, pinned: togglePin(l.pinned, path)}))}
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
                    {noteDeleted && selectedPath && (
                        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 dark:bg-amber-950/80 dark:border-amber-600/50 dark:text-amber-200 px-3 py-1.5 text-xs">
                            <span>{t('noteDeletedNotice')}</span>
                            <div className="flex shrink-0 gap-2">
                                <button
                                    onClick={() => {
                                        // Write the editor content back to the same path.
                                        setNoteDeleted(false)
                                        queueSave(selectedPath, currentContentRef.current)
                                    }}
                                    className="rounded bg-amber-600 px-2.5 py-0.5 font-medium text-white hover:bg-amber-500"
                                >
                                    {t('restoreNoteBtn')}
                                </button>
                                <button
                                    onClick={() => loadNote(null, '')}
                                    className="rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600 px-2.5 py-0.5"
                                >
                                    {t('closeNoteBtn')}
                                </button>
                            </div>
                        </div>
                    )}
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
                            scrollTarget={scrollTarget}
                            notePaths={notePaths}
                            onOpenWikiLink={handleOpenWikiLink}
                            onContentChange={(markdown) => {
                                currentContentRef.current = markdown
                                // Same-value updates are ignored by React, so this only
                                // re-renders when the state actually flips.
                                setSaveState((s) =>
                                    s.state === 'conflict' || s.state === 'saving' || s.state === 'deleted'
                                        ? s
                                        : markdown === diskRef.current.content
                                          ? s.state === 'saved' ? s : {state: 'saved'}
                                          : s.state === 'unsaved' ? s : {state: 'unsaved'},
                                )
                            }}
                            onStatsChange={setEditorStats}
                            onChange={(markdown) => {
                                currentContentRef.current = markdown
                                queueSave(selectedPath, markdown)
                            }}
                            onRename={async (newName) => {
                                if (!selectedPath) return
                                try {
                                    await saveQueueRef.current
                                    const newPath = await vault.rename(selectedPath, newName)
                                    if (newPath) handleEntryMoved(selectedPath, newPath)
                                } catch (err) {
                                    alert((lang === 'vi' ? 'Không thể đổi tên: ' : 'Failed to rename: ') + String(err))
                                }
                            }}
                        />
                    ) : (
                        <EmptyState
                            {...switcherSections(noteLists.lists.pinned, noteLists.lists.recent, new Set(notePaths), null, 8)}
                            vaultIsEmpty={vault.tree !== null && !notePaths.some((p) => /\.(md|markdown)$/i.test(p))}
                            onOpen={(path) => openFile(path)}
                            onNewNote={() => handleCreateNote(resolveCreateParent(vault.tree, treeActivePath))}
                            onQuickSwitcher={() => {
                                setGlobalSearchOpen(false)
                                setQuickSwitcherOpen(true)
                            }}
                            onSearch={() => {
                                setQuickSwitcherOpen(false)
                                setGlobalSearchOpen(true)
                            }}
                            onHelp={() => setQuickHelpOpen(true)}
                        />
                    )}
                </main>
            </div>
            <SyncStatusBar
                onOpenSettings={() => {
                    setSettingsTab('vaults')
                    setSettingsOpen(true)
                }}
            >
                {selectedPath && editorStats && (
                    <EditorStatus stats={editorStats} saveState={saveState.state} saveError={saveState.error} />
                )}
            </SyncStatusBar>
            {quickSwitcherOpen && (
                <QuickSwitcher
                    onOpen={(path) => openFile(path)}
                    onClose={() => setQuickSwitcherOpen(false)}
                    sections={switcherSections(noteLists.lists.pinned, noteLists.lists.recent, new Set(notePaths), selectedPath)}
                    pinnedPaths={noteLists.lists.pinned}
                />
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
                    typography={typography}
                    onChangeTypography={setTypography}
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
            <ConfirmModal
                isOpen={pendingNoteCreate !== null}
                isDestructive={false}
                title={t('wikiLinkCreateTitle')}
                message={t('wikiLinkCreateDesc')}
                itemName={pendingNoteCreate ? (pendingNoteCreate.parent ? `${pendingNoteCreate.parent}/` : '') + pendingNoteCreate.name : undefined}
                confirmLabel={t('createBtn')}
                onConfirm={handleConfirmNoteCreate}
                onClose={() => setPendingNoteCreate(null)}
            />
            {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
        </div>
    )
}

export default App

