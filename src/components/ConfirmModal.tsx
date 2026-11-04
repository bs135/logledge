import {useEffect, useRef} from 'react'
import {Trash2, AlertTriangle} from 'lucide-react'
import {useI18n} from '../i18n'

export interface ConfirmModalProps {
    isOpen: boolean
    title?: string
    message?: string
    itemName?: string
    confirmLabel?: string
    cancelLabel?: string
    isDestructive?: boolean
    onConfirm: () => void
    onClose: () => void
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    itemName,
    confirmLabel,
    cancelLabel,
    isDestructive = true,
    onConfirm,
    onClose,
}: ConfirmModalProps) {
    const {t} = useI18n()
    const confirmBtnRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!isOpen) return
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        const timer = setTimeout(() => {
            confirmBtnRef.current?.focus()
        }, 50)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            clearTimeout(timer)
        }
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150"
            onClick={onClose}
        >
            <div
                className="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-2xl text-neutral-900 dark:text-neutral-100"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-start gap-3.5">
                    <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                            isDestructive
                                ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                                : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                        }`}
                    >
                        {isDestructive ? (
                            <Trash2 className="h-5 w-5" />
                        ) : (
                            <AlertTriangle className="h-5 w-5" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            {title || t('moveToTrashConfirm')}
                        </h3>
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                            {message || t('deleteModalDesc')}
                        </p>
                        {itemName && (
                            <div className="mt-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50 px-2.5 py-1.5 text-xs font-mono text-neutral-800 dark:text-neutral-200 truncate">
                                {itemName}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-3.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                    >
                        {cancelLabel || t('cancel')}
                    </button>
                    <button
                        ref={confirmBtnRef}
                        type="button"
                        onClick={onConfirm}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition-colors shadow-sm focus:outline-none focus:ring-2 ${
                            isDestructive
                                ? 'bg-red-600 hover:bg-red-500 focus:ring-red-500/50'
                                : 'bg-blue-600 hover:bg-blue-500 focus:ring-blue-500/50'
                        }`}
                    >
                        {confirmLabel || t('delete')}
                    </button>
                </div>
            </div>
        </div>
    )
}
