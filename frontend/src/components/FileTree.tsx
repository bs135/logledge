import {useEffect, useRef, useState} from 'react'
import type {DragEvent} from 'react'
import {config, vault} from '../../wailsjs/go/models'
import {
    ChevronRight,
    ChevronDown,
    Folder,
    FolderOpen,
    FileText,
    FilePlus,
    FolderPlus,
    Edit3,
    Trash2,
} from 'lucide-react'
import {useI18n} from '../i18n'

export type InlineActionType = 'create-file' | 'create-folder' | 'rename'

export interface InlineAction {
    type: InlineActionType
    targetPath: string
    initialValue?: string
}

function shouldShowFile(name: string, filter: config.FileFilterConfig): boolean {
    const lower = name.toLowerCase()
    if (filter.mode === 'blacklist') {
        const isBlacklisted = (filter.blacklist || []).some((ext) => {
            const clean = ext.trim().toLowerCase()
            return clean ? lower.endsWith(clean) : false
        })
        return !isBlacklisted
    } else {
        const isWhitelisted = (filter.whitelist || []).some((ext) => {
            const clean = ext.trim().toLowerCase()
            return clean ? lower.endsWith(clean) : false
        })
        return isWhitelisted
    }
}

function filterNode(node: vault.Node, filter?: config.FileFilterConfig): vault.Node | null {
    if (!filter || !filter.enabled) return node
    if (!node.isDir) {
        return shouldShowFile(node.name, filter) ? node : null
    }
    const filteredChildren = (node.children || [])
        .map((child) => filterNode(child, filter))
        .filter((child): child is vault.Node => child !== null)

    return vault.Node.createFrom({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        children: filteredChildren,
    })
}

function findNode(node: vault.Node, path: string): vault.Node | null {
    if (node.path === path) return node
    if (node.children) {
        for (const child of node.children) {
            const found = findNode(child, path)
            if (found) return found
        }
    }
    return null
}

export interface FileTreeProps {
    root: vault.Node
    selectedPath: string | null
    filter?: config.FileFilterConfig
    inlineAction?: InlineAction | null
    onSelectFile: (path: string) => void
    onCreateFile: (parentRelPath: string) => void
    onCreateFolder: (parentRelPath: string) => void
    onRename: (relPath: string) => void
    onDelete: (relPath: string) => void
    onMove: (srcRelPath: string, destParentRelPath: string) => void
    onCommitInlineAction: (action: InlineAction, name: string) => void
    onCancelInlineAction: () => void
}

// FileTree renders an arbitrarily nested file and folder tree, supporting
// folder collapse/expand, context menu (right-click), drag-and-drop movement,
// inline input for creating/renaming notes and folders, and keyboard shortcuts (F2 to rename, Del to delete).
export function FileTree({
    filter,
    inlineAction,
    onCommitInlineAction,
    onCancelInlineAction,
    ...props
}: FileTreeProps) {
    const {t} = useI18n()
    const containerRef = useRef<HTMLDivElement>(null)
    const [activePath, setActivePath] = useState<string | null>(props.selectedPath)
    const filteredRoot = filterNode(props.root, filter) || props.root
    const isCreatingAtRoot = Boolean(
        inlineAction && inlineAction.type !== 'rename' && inlineAction.targetPath === ''
    )

    useEffect(() => {
        if (props.selectedPath) {
            setActivePath(props.selectedPath)
        }
    }, [props.selectedPath])

    useEffect(() => {
        if (activePath && !findNode(props.root, activePath)) {
            setActivePath(props.selectedPath || null)
        }
    }, [props.root, activePath, props.selectedPath])

    function handleKeyDown(e: React.KeyboardEvent) {
        const target = e.target as HTMLElement
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
            return
        }
        if (inlineAction) {
            return
        }

        if (e.key === 'F2') {
            if (activePath) {
                e.preventDefault()
                e.stopPropagation()
                props.onRename(activePath)
            }
        } else if (e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key === 'Backspace')) {
            if (activePath) {
                e.preventDefault()
                e.stopPropagation()
                props.onDelete(activePath)
            }
        }
    }

    const handleCommit = (action: InlineAction, name: string) => {
        if (action.type === 'rename') {
            const parent = action.targetPath.includes('/')
                ? action.targetPath.slice(0, action.targetPath.lastIndexOf('/'))
                : ''
            const newPath = parent ? `${parent}/${name}` : name
            setActivePath(newPath)
        } else if (action.type === 'create-folder') {
            const newPath = action.targetPath ? `${action.targetPath}/${name}` : name
            setActivePath(newPath)
        }
        onCommitInlineAction(action, name)
    }

    return (
        <div
            ref={containerRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onClick={() => {
                containerRef.current?.focus()
            }}
            className="select-none text-sm min-h-full outline-none focus:outline-none"
        >
            {isCreatingAtRoot && (
                <InlineInputRow
                    type={inlineAction!.type === 'create-folder' ? 'folder' : 'file'}
                    depth={0}
                    placeholder={
                        inlineAction!.type === 'create-folder'
                            ? t('newFolderPlaceholder')
                            : t('newNotePlaceholder')
                    }
                    onCommit={(name) => handleCommit(inlineAction!, name)}
                    onCancel={onCancelInlineAction}
                />
            )}
            {filteredRoot.children?.map((child) => (
                <TreeEntry
                    key={child.path}
                    node={child}
                    depth={0}
                    rootPath={filteredRoot.path}
                    inlineAction={inlineAction}
                    activePath={activePath}
                    onSetActive={setActivePath}
                    onCommitInlineAction={handleCommit}
                    onCancelInlineAction={onCancelInlineAction}
                    {...props}
                />
            ))}
        </div>
    )
}

interface TreeEntryProps extends Omit<FileTreeProps, 'root'> {
    node: vault.Node
    depth: number
    rootPath: string
    activePath: string | null
    onSetActive: (path: string) => void
}

function TreeEntry({
    node,
    depth,
    rootPath,
    selectedPath,
    activePath,
    onSetActive,
    inlineAction,
    onSelectFile,
    onCreateFile,
    onCreateFolder,
    onRename,
    onDelete,
    onMove,
    onCommitInlineAction,
    onCancelInlineAction,
}: TreeEntryProps) {
    const {t} = useI18n()
    const [open, setOpen] = useState(depth < 1)
    const [menuPos, setMenuPos] = useState<{x: number; y: number} | null>(null)
    const [dragOver, setDragOver] = useState(false)

    const isActive = node.path === activePath
    const isCurrentOpenNote = !node.isDir && node.path === selectedPath

    let selectionClass = ''
    if (isActive) {
        selectionClass = 'bg-neutral-200 dark:bg-neutral-700 font-medium text-neutral-900 dark:text-white'
    } else if (isCurrentOpenNote) {
        selectionClass = 'bg-neutral-100 dark:bg-neutral-800/70 font-medium text-neutral-800 dark:text-neutral-200'
    }

    const isRenaming = Boolean(
        inlineAction && inlineAction.type === 'rename' && inlineAction.targetPath === node.path
    )
    const isCreatingHere = Boolean(
        node.isDir &&
        inlineAction &&
        inlineAction.type !== 'rename' &&
        inlineAction.targetPath === node.path
    )

    useEffect(() => {
        if (!inlineAction || !node.isDir) return
        const isTargetDescendant = inlineAction.targetPath.startsWith(node.path + '/')
        const isCreatingInside =
            inlineAction.type !== 'rename' && inlineAction.targetPath === node.path
        if (isTargetDescendant || isCreatingInside) {
            setOpen(true)
        }
    }, [inlineAction, node.path, node.isDir])

    function handleClick() {
        onSetActive(node.path)
        if (node.isDir) {
            setOpen((o) => !o)
        } else {
            onSelectFile(node.path)
        }
    }

    function handleDragStart(e: DragEvent) {
        e.dataTransfer.setData('text/plain', node.path)
        e.dataTransfer.effectAllowed = 'move'
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault()
        setDragOver(false)
        const srcPath = e.dataTransfer.getData('text/plain')
        if (!srcPath || srcPath === node.path) return
        const destParent = node.isDir ? node.path : rootPath
        onMove(srcPath, destParent)
    }

    if (isRenaming) {
        return (
            <div>
                <div
                    className="flex items-center gap-1.5 rounded px-2 py-0.5 text-neutral-800 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 my-0.5"
                    style={{paddingLeft: `${depth * 14 + 8}px`}}
                >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500">
                        {node.isDir ? (
                            open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                        ) : null}
                    </span>
                    {node.isDir ? (
                        open ? (
                            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                        ) : (
                            <Folder className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                        )
                    ) : (
                        <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
                    )}
                    <InlineInput
                        initialValue={node.name}
                        isDir={node.isDir}
                        onCommit={(name) => onCommitInlineAction(inlineAction!, name)}
                        onCancel={onCancelInlineAction}
                    />
                </div>
                {node.isDir && open && (
                    <div>
                        {node.children?.map((child) => (
                            <TreeEntry
                                key={child.path}
                                node={child}
                                depth={depth + 1}
                                rootPath={rootPath}
                                selectedPath={selectedPath}
                                activePath={activePath}
                                onSetActive={onSetActive}
                                inlineAction={inlineAction}
                                onSelectFile={onSelectFile}
                                onCreateFile={onCreateFile}
                                onCreateFolder={onCreateFolder}
                                onRename={onRename}
                                onDelete={onDelete}
                                onMove={onMove}
                                onCommitInlineAction={onCommitInlineAction}
                                onCancelInlineAction={onCancelInlineAction}
                            />
                        ))}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div>
            <div
                tabIndex={-1}
                draggable
                onDragStart={handleDragStart}
                onDragOver={(e) => {
                    if (node.isDir) {
                        e.preventDefault()
                        setDragOver(true)
                    }
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={(e) => {
                    const el = e.currentTarget as HTMLElement
                    el.focus()
                    handleClick()
                }}
                onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const el = e.currentTarget as HTMLElement
                    el.focus()
                    onSetActive(node.path)
                    setMenuPos({x: e.clientX, y: e.clientY})
                }}
                className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 transition-colors outline-none focus:outline-none ${
                    selectionClass || 'text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
                } ${dragOver ? 'outline outline-1 outline-blue-500' : ''}`}
                style={{paddingLeft: `${depth * 14 + 8}px`}}
            >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500">
                    {node.isDir ? (
                        open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                    ) : null}
                </span>
                {node.isDir ? (
                    open ? (
                        <FolderOpen className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                    ) : (
                        <Folder className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                    )
                ) : (
                    <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
                )}
                <span className="truncate">{node.name}</span>
            </div>

            {menuPos && (
                <ContextMenu
                    node={node}
                    position={menuPos}
                    onClose={() => setMenuPos(null)}
                    onCreateFile={onCreateFile}
                    onCreateFolder={onCreateFolder}
                    onRename={onRename}
                    onDelete={onDelete}
                />
            )}

            {node.isDir && open && (
                <div>
                    {isCreatingHere && (
                        <InlineInputRow
                            type={inlineAction!.type === 'create-folder' ? 'folder' : 'file'}
                            depth={depth + 1}
                            placeholder={
                                inlineAction!.type === 'create-folder'
                                    ? t('newFolderPlaceholder')
                                    : t('newNotePlaceholder')
                            }
                            onCommit={(name) => onCommitInlineAction(inlineAction!, name)}
                            onCancel={onCancelInlineAction}
                        />
                    )}
                    {node.children?.map((child) => (
                        <TreeEntry
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            rootPath={rootPath}
                            selectedPath={selectedPath}
                            activePath={activePath}
                            onSetActive={onSetActive}
                            inlineAction={inlineAction}
                            onSelectFile={onSelectFile}
                            onCreateFile={onCreateFile}
                            onCreateFolder={onCreateFolder}
                            onRename={onRename}
                            onDelete={onDelete}
                            onMove={onMove}
                            onCommitInlineAction={onCommitInlineAction}
                            onCancelInlineAction={onCancelInlineAction}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

interface InlineInputRowProps {
    type: 'file' | 'folder'
    depth: number
    placeholder?: string
    onCommit: (name: string) => void
    onCancel: () => void
}

function InlineInputRow({
    type,
    depth,
    placeholder,
    onCommit,
    onCancel,
}: InlineInputRowProps) {
    return (
        <div
            className="flex items-center gap-1.5 rounded px-2 py-0.5 text-neutral-800 dark:text-neutral-200 bg-neutral-100/90 dark:bg-neutral-800/90 my-0.5"
            style={{paddingLeft: `${depth * 14 + 8}px`}}
            onClick={(e) => e.stopPropagation()}
        >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500" />
            {type === 'folder' ? (
                <Folder className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
            ) : (
                <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
            )}
            <InlineInput
                placeholder={placeholder}
                isDir={type === 'folder'}
                onCommit={onCommit}
                onCancel={onCancel}
            />
        </div>
    )
}

interface InlineInputProps {
    initialValue?: string
    placeholder?: string
    isDir?: boolean
    onCommit: (name: string) => void
    onCancel: () => void
}

function InlineInput({
    initialValue = '',
    placeholder = '',
    isDir = false,
    onCommit,
    onCancel,
}: InlineInputProps) {
    const [val, setVal] = useState(initialValue)
    const inputRef = useRef<HTMLInputElement>(null)
    const handledRef = useRef(false)

    useEffect(() => {
        if (!inputRef.current) return
        inputRef.current.focus()
        inputRef.current.scrollIntoView({block: 'nearest', behavior: 'smooth'})
        if (initialValue) {
            if (!isDir) {
                const dotIdx = initialValue.lastIndexOf('.')
                if (dotIdx > 0) {
                    inputRef.current.setSelectionRange(0, dotIdx)
                    return
                }
            }
            inputRef.current.select()
        }
    }, [initialValue, isDir])

    function handleFinish(shouldCommit: boolean) {
        if (handledRef.current) return
        handledRef.current = true

        if (shouldCommit) {
            let trimmed = val.trim()
            if (trimmed) {
                // Sanitize invalid filename characters: / \ : * ? " < > |
                trimmed = trimmed.replace(/[<>:"/\\|?*]/g, '_')
                let finalName = trimmed
                if (!isDir && initialValue && !finalName.includes('.')) {
                    const originalExt = initialValue.includes('.')
                        ? initialValue.slice(initialValue.lastIndexOf('.'))
                        : ''
                    if (originalExt) {
                        finalName += originalExt
                    }
                }
                onCommit(finalName)
                return
            }
        }
        onCancel()
    }

    return (
        <input
            ref={inputRef}
            type="text"
            value={val}
            placeholder={placeholder}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    handleFinish(true)
                } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    handleFinish(false)
                }
            }}
            onBlur={() => {
                handleFinish(true)
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 h-6 rounded border border-blue-500 bg-white dark:bg-neutral-900 px-1.5 py-0 text-xs text-neutral-900 dark:text-neutral-100 outline-none shadow-sm focus:ring-1 focus:ring-blue-500"
        />
    )
}

interface ContextMenuProps {
    node: vault.Node
    position: {x: number; y: number}
    onClose: () => void
    onCreateFile: (parentRelPath: string) => void
    onCreateFolder: (parentRelPath: string) => void
    onRename: (relPath: string) => void
    onDelete: (relPath: string) => void
}

function ContextMenu({node, position, onClose, onCreateFile, onCreateFolder, onRename, onDelete}: ContextMenuProps) {
    const {t} = useI18n()
    const parent = node.isDir ? node.path : node.path.split('/').slice(0, -1).join('/')

    function act(fn: () => void) {
        fn()
        onClose()
    }

    // Keep menu within viewport
    const menuWidth = 160
    const menuHeight = 160
    const left = Math.max(10, Math.min(position.x, window.innerWidth - menuWidth - 10))
    const top = Math.max(10, Math.min(position.y, window.innerHeight - menuHeight - 10))

    return (
        <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
            <div
                className="absolute z-50 min-w-[160px] rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 shadow-lg shadow-black/10 dark:shadow-black/50"
                style={{left: `${left}px`, top: `${top}px`}}
                onClick={(e) => e.stopPropagation()}
            >
                <MenuItem
                    label={t('newNote')}
                    icon={<FilePlus className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    onClick={() => act(() => onCreateFile(parent))}
                />
                <MenuItem
                    label={t('newFolder')}
                    icon={<FolderPlus className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    onClick={() => act(() => onCreateFolder(parent))}
                />
                <MenuItem
                    label={t('rename')}
                    shortcut="F2"
                    icon={<Edit3 className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    onClick={() => act(() => onRename(node.path))}
                />
                <MenuItem
                    label={t('delete')}
                    shortcut="Del"
                    icon={<Trash2 className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />}
                    onClick={() => act(() => onDelete(node.path))}
                    destructive
                />
            </div>
        </div>
    )
}

function MenuItem({
    label,
    shortcut,
    icon,
    onClick,
    destructive,
}: {
    label: string
    shortcut?: string
    icon?: React.ReactNode
    onClick: () => void
    destructive?: boolean
}) {
    return (
        <button
            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                destructive ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-200'
            }`}
            onClick={onClick}
        >
            <div className="flex items-center gap-2 min-w-0">
                {icon && <span className="shrink-0">{icon}</span>}
                <span className="truncate">{label}</span>
            </div>
            {shortcut && (
                <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">
                    {shortcut}
                </span>
            )}
        </button>
    )
}

