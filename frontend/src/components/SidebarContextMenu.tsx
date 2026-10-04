import {useEffect} from 'react'
import {FilePlus, FolderPlus} from 'lucide-react'
import {useI18n} from '../i18n'

interface SidebarContextMenuProps {
    position: {x: number; y: number}
    onClose: () => void
    onCreateFile: () => void
    onCreateFolder: () => void
}

export function SidebarContextMenu({
    position,
    onClose,
    onCreateFile,
    onCreateFolder,
}: SidebarContextMenuProps) {
    const {t} = useI18n()

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onClose])

    const menuWidth = 160
    const menuHeight = 80
    const left = Math.max(10, Math.min(position.x, window.innerWidth - menuWidth - 10))
    const top = Math.max(10, Math.min(position.y, window.innerHeight - menuHeight - 10))

    function triggerAction(action: () => void) {
        onClose()
        action()
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
                className="absolute z-50 min-w-[160px] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 text-xs text-neutral-800 dark:text-neutral-200 shadow-xl shadow-black/10 dark:shadow-black/60"
                style={{left: `${left}px`, top: `${top}px`}}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-white transition-colors"
                    onClick={() => triggerAction(onCreateFile)}
                >
                    <FilePlus className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
                    <span>{t('newNote')}</span>
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-white transition-colors"
                    onClick={() => triggerAction(onCreateFolder)}
                >
                    <FolderPlus className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
                    <span>{t('newFolder')}</span>
                </button>
            </div>
        </div>
    )
}
