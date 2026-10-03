import {useState} from 'react'
import type {DragEvent} from 'react'
import {vault} from '../../wailsjs/go/models'

const NOTE_EXTENSIONS = ['.md', '.markdown', '.txt']

function isNoteFile(name: string): boolean {
    const lower = name.toLowerCase()
    return NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function filterNode(node: vault.Node, onlyNotes: boolean): vault.Node | null {
    if (!onlyNotes) return node
    if (!node.isDir) {
        return isNoteFile(node.name) ? node : null
    }
    const filteredChildren = (node.children || [])
        .map((child) => filterNode(child, onlyNotes))
        .filter((child): child is vault.Node => child !== null)

    return vault.Node.createFrom({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        children: filteredChildren,
    })
}

interface FileTreeProps {
    root: vault.Node
    selectedPath: string | null
    onlyNotes?: boolean
    onSelectFile: (path: string) => void
    onCreateFile: (parentRelPath: string) => void
    onCreateFolder: (parentRelPath: string) => void
    onRename: (relPath: string) => void
    onDelete: (relPath: string) => void
    onMove: (srcRelPath: string, destParentRelPath: string) => void
}

// FileTree renders an arbitrarily nested file and folder tree, supporting
// folder collapse/expand, context menu (right-click), and drag-and-drop movement.
export function FileTree({onlyNotes = true, ...props}: FileTreeProps) {
    const filteredRoot = filterNode(props.root, onlyNotes) || props.root
    return (
        <div className="select-none text-sm">
            {filteredRoot.children?.map((child) => (
                <TreeEntry key={child.path} node={child} depth={0} rootPath={filteredRoot.path} {...props} />
            ))}
        </div>
    )
}

interface TreeEntryProps extends Omit<FileTreeProps, 'root'> {
    node: vault.Node
    depth: number
    rootPath: string
}

function TreeEntry({node, depth, rootPath, selectedPath, onSelectFile, onCreateFile, onCreateFolder, onRename, onDelete, onMove}: TreeEntryProps) {
    const [open, setOpen] = useState(depth < 1)
    const [menuPos, setMenuPos] = useState<{x: number; y: number} | null>(null)
    const [dragOver, setDragOver] = useState(false)

    const isSelected = !node.isDir && node.path === selectedPath

    function handleClick() {
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

    return (
        <div>
            <div
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
                onClick={handleClick}
                onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenuPos({x: e.clientX, y: e.clientY})
                }}
                className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-neutral-800 ${
                    isSelected ? 'bg-neutral-700' : ''
                } ${dragOver ? 'outline outline-1 outline-blue-500' : ''}`}
                style={{paddingLeft: `${depth * 14 + 8}px`}}
            >
                <span className="w-3 text-neutral-500">{node.isDir ? (open ? '▾' : '▸') : ''}</span>
                <span className="truncate">{node.isDir ? '📁' : '📄'} {node.name}</span>
            </div>

            {menuPos && (
                <ContextMenu
                    position={menuPos}
                    onClose={() => setMenuPos(null)}
                    node={node}
                    onCreateFile={onCreateFile}
                    onCreateFolder={onCreateFolder}
                    onRename={onRename}
                    onDelete={onDelete}
                />
            )}

            {node.isDir && open && node.children?.map((child) => (
                <TreeEntry
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    rootPath={rootPath}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    onCreateFile={onCreateFile}
                    onCreateFolder={onCreateFolder}
                    onRename={onRename}
                    onDelete={onDelete}
                    onMove={onMove}
                />
            ))}
        </div>
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
                className="absolute z-50 min-w-[160px] rounded border border-neutral-700 bg-neutral-800 py-1 shadow-lg shadow-black/50"
                style={{left: `${left}px`, top: `${top}px`}}
                onClick={(e) => e.stopPropagation()}
            >
                <MenuItem label="New note" onClick={() => act(() => onCreateFile(parent))} />
                <MenuItem label="New folder" onClick={() => act(() => onCreateFolder(parent))} />
                <MenuItem label="Rename" onClick={() => act(() => onRename(node.path))} />
                <MenuItem label="Delete" onClick={() => act(() => onDelete(node.path))} destructive />
            </div>
        </div>
    )
}

function MenuItem({label, onClick, destructive}: {label: string; onClick: () => void; destructive?: boolean}) {
    return (
        <button
            className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-700 ${
                destructive ? 'text-red-400' : 'text-neutral-200'
            }`}
            onClick={onClick}
        >
            {label}
        </button>
    )
}
