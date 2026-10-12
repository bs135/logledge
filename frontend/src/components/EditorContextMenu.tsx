import {useEffect} from 'react'
import {Scissors, Copy, Clipboard, CheckSquare, Undo2, Redo2} from 'lucide-react'
import {EditorView} from '@codemirror/view'
import {undo, redo, selectAll} from '@codemirror/commands'
import {useI18n} from '../i18n'

interface EditorContextMenuProps {
    position: {x: number; y: number}
    onClose: () => void
    view?: EditorView | null
}

export function EditorContextMenu({position, onClose, view}: EditorContextMenuProps) {
    const {t} = useI18n()
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onClose])

    const menuWidth = 180
    const menuHeight = 240
    const left = Math.max(10, Math.min(position.x, window.innerWidth - menuWidth - 10))
    const top = Math.max(10, Math.min(position.y, window.innerHeight - menuHeight - 10))

    function triggerAction(action: () => void) {
        action()
        onClose()
    }

    async function handleCopy() {
        if (view) {
            const sel = view.state.sliceDoc(
                view.state.selection.main.from,
                view.state.selection.main.to
            )
            if (sel) {
                await navigator.clipboard.writeText(sel)
            }
        } else {
            const sel = window.getSelection()?.toString()
            if (sel) {
                await navigator.clipboard.writeText(sel)
            }
        }
    }

    async function handleCut() {
        if (view) {
            const sel = view.state.sliceDoc(
                view.state.selection.main.from,
                view.state.selection.main.to
            )
            if (sel) {
                await navigator.clipboard.writeText(sel)
                view.dispatch(view.state.replaceSelection(''))
            }
        } else {
            const sel = window.getSelection()?.toString()
            if (sel) {
                await navigator.clipboard.writeText(sel)
                document.execCommand('delete')
            }
        }
    }

    async function handlePaste() {
        try {
            const text = await navigator.clipboard.readText()
            if (text) {
                if (view) {
                    view.dispatch(view.state.replaceSelection(text))
                } else {
                    document.execCommand('insertText', false, text)
                }
            }
        } catch {
            document.execCommand('paste')
        }
    }

    function handleSelectAll() {
        if (view) {
            selectAll(view)
        } else {
            document.execCommand('selectAll')
        }
    }

    function handleUndo() {
        if (view) {
            undo(view)
        } else {
            document.execCommand('undo')
        }
    }

    function handleRedo() {
        if (view) {
            redo(view)
        } else {
            document.execCommand('redo')
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 select-none"
            onClick={onClose}
            onContextMenu={(e) => {
                e.preventDefault()
                onClose()
            }}
        >
            <div
                className="absolute z-50 min-w-[170px] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 text-xs text-neutral-800 dark:text-neutral-200 shadow-xl shadow-black/10 dark:shadow-black/60"
                style={{left: `${left}px`, top: `${top}px`}}
                onClick={(e) => e.stopPropagation()}
            >
                <ContextMenuItem
                    label={t('cut')}
                    icon={<Scissors className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    shortcut="Ctrl+X"
                    onClick={() => triggerAction(handleCut)}
                />
                <ContextMenuItem
                    label={t('copy')}
                    icon={<Copy className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    shortcut="Ctrl+C"
                    onClick={() => triggerAction(handleCopy)}
                />
                <ContextMenuItem
                    label={t('paste')}
                    icon={<Clipboard className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    shortcut="Ctrl+V"
                    onClick={() => triggerAction(handlePaste)}
                />
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                <ContextMenuItem
                    label={t('selectAll')}
                    icon={<CheckSquare className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    shortcut="Ctrl+A"
                    onClick={() => triggerAction(handleSelectAll)}
                />
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                <ContextMenuItem
                    label={t('undo')}
                    icon={<Undo2 className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    shortcut="Ctrl+Z"
                    onClick={() => triggerAction(handleUndo)}
                />
                <ContextMenuItem
                    label={t('redo')}
                    icon={<Redo2 className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />}
                    shortcut="Ctrl+Y"
                    onClick={() => triggerAction(handleRedo)}
                />
            </div>
        </div>
    )
}

function ContextMenuItem({
    label,
    icon,
    shortcut,
    onClick,
}: {
    label: string
    icon?: React.ReactNode
    shortcut?: string
    onClick: () => void
}) {
    return (
        <button
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-white transition-colors"
            onClick={onClick}
        >
            <div className="flex items-center gap-2">
                {icon && <span className="shrink-0">{icon}</span>}
                <span>{label}</span>
            </div>
            {shortcut && <span className="ml-4 text-[10px] text-neutral-500 dark:text-neutral-400">{shortcut}</span>}
        </button>
    )
}
