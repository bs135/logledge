import type {ReactNode} from 'react'
import {Clock, FilePlus, HelpCircle, Pin, Search, TextSearch} from 'lucide-react'
import {useI18n} from '../i18n'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

interface EmptyStateProps {
    /** Pinned and recent notes that still exist (see switcherSections). */
    pinned: string[]
    recent: string[]
    /** True when the vault has no Markdown notes at all. */
    vaultIsEmpty: boolean
    onOpen: (path: string) => void
    onNewNote: () => void
    onQuickSwitcher: () => void
    onSearch: () => void
    onHelp: () => void
}

function noteTitle(path: string): string {
    return (path.split('/').pop() || path).replace(/\.(md|markdown)$/i, '')
}

function folderOf(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

// EmptyState fills the editor area while a vault is open but no note is: quick actions,
// pinned and recent notes, and the main shortcuts.
export function EmptyState({pinned, recent, vaultIsEmpty, onOpen, onNewNote, onQuickSwitcher, onSearch, onHelp}: EmptyStateProps) {
    const {t} = useI18n()
    const notes = [
        ...pinned.map((path) => ({path, pinned: true})),
        ...recent.map((path) => ({path, pinned: false})),
    ].slice(0, 8)

    return (
        <div className="flex h-full overflow-y-auto">
            <div className="m-auto w-full max-w-md px-6 py-10 select-none">
                <div className="mb-6 flex items-center gap-3">
                    <img src="/icon.svg" alt="" className="h-9 w-9 opacity-90" />
                    <div>
                        <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-100">
                            {vaultIsEmpty ? t('emptyVaultTitle') : t('emptyStateTitle')}
                        </h2>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {vaultIsEmpty ? t('emptyVaultDesc') : t('emptyStateDesc')}
                        </p>
                    </div>
                </div>

                <div className="space-y-1">
                    <Action icon={<FilePlus className="h-4 w-4" />} label={t('newNote')} primary={vaultIsEmpty} onClick={onNewNote} />
                    {!vaultIsEmpty && (
                        <>
                            <Action icon={<Search className="h-4 w-4" />} label={t('emptyStateQuickSwitcher')} keys={`${MOD}+P`} onClick={onQuickSwitcher} />
                            <Action icon={<TextSearch className="h-4 w-4" />} label={t('emptyStateSearch')} keys={`${MOD}+Shift+F`} onClick={onSearch} />
                        </>
                    )}
                </div>

                {notes.length > 0 && (
                    <div className="mt-6">
                        <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                            {pinned.length > 0 ? t('emptyStatePinnedRecent') : t('switcherRecent')}
                        </h3>
                        <ul>
                            {notes.map(({path, pinned: isPinned}) => (
                                <li key={path}>
                                    <button
                                        onClick={() => onOpen(path)}
                                        title={path}
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                                    >
                                        {isPinned ? (
                                            <Pin className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
                                        ) : (
                                            <Clock className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                                        )}
                                        <span className="truncate">{noteTitle(path)}</span>
                                        {folderOf(path) && (
                                            <span className="ml-auto shrink-0 max-w-[45%] truncate text-xs text-neutral-400 dark:text-neutral-500">
                                                {folderOf(path)}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="mt-6 border-t border-neutral-200 dark:border-neutral-800 pt-4">
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-2 text-xs text-neutral-500 dark:text-neutral-400">
                        <Kbd>{`${MOD}+Click`}</Kbd>
                        <span>{t('emptyStateTipLink')}</span>
                        <Kbd>[[</Kbd>
                        <span>{t('emptyStateTipComplete')}</span>
                        <Kbd>{IS_MAC ? '⌘⌥← / →' : 'Alt+← / →'}</Kbd>
                        <span>{t('emptyStateTipNav')}</span>
                        <Kbd>{`${MOD}+\\`}</Kbd>
                        <span>{t('toggleSidebarDesc')}</span>
                    </div>
                    <button
                        onClick={onHelp}
                        className="mt-3 flex items-center gap-1.5 px-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        <HelpCircle className="h-3.5 w-3.5" />
                        {t('emptyStateAllShortcuts')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function Action({
    icon,
    label,
    keys,
    primary,
    onClick,
}: {
    icon: ReactNode
    label: string
    keys?: string
    primary?: boolean
    onClick: () => void
}) {
    return (
        <button
            onClick={onClick}
            className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                primary
                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                    : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
        >
            <span className={primary ? 'text-white' : 'text-neutral-500 dark:text-neutral-400'}>{icon}</span>
            <span className="flex-1">{label}</span>
            {keys && <Kbd>{keys}</Kbd>}
        </button>
    )
}

function Kbd({children}: {children: ReactNode}) {
    return (
        <kbd className="whitespace-nowrap rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
            {children}
        </kbd>
    )
}
