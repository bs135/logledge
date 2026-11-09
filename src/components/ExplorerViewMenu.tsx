import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Check, Settings2, SlidersHorizontal} from 'lucide-react'
import {useI18n} from '../i18n'
import {DEFAULT_TREE_SORT, type TreeSort, type TreeSortBy, type TreeSortDirection} from '../lib/treeSort'
import type {FileFilterConfig} from '../lib/types'

type OptionLabel = 'sortNameAsc' | 'sortNameDesc' | 'sortModifiedDesc' | 'sortModifiedAsc' | 'sortCreatedDesc' | 'sortCreatedAsc'

const OPTIONS: {by: TreeSortBy; direction: TreeSortDirection; label: OptionLabel}[][] = [
    [
        {by: 'name', direction: 'asc', label: 'sortNameAsc'},
        {by: 'name', direction: 'desc', label: 'sortNameDesc'},
    ],
    [
        {by: 'modified', direction: 'desc', label: 'sortModifiedDesc'},
        {by: 'modified', direction: 'asc', label: 'sortModifiedAsc'},
    ],
    [
        {by: 'created', direction: 'desc', label: 'sortCreatedDesc'},
        {by: 'created', direction: 'asc', label: 'sortCreatedAsc'},
    ],
]

interface ExplorerViewMenuProps {
    sort: TreeSort
    onChangeSort: (sort: TreeSort) => void
    filter: FileFilterConfig
    onToggleFilter: () => void
    /** Opens Settings › Filter. */
    onEditFilter: () => void
    /** Class of the toggle button, to match the other explorer header buttons. */
    buttonClassName: string
    /** Used instead when the view differs from the default (sorted or unfiltered). */
    activeButtonClassName: string
}

// Gap kept between the menu and the window edges.
const VIEWPORT_MARGIN = 8

/** The extensions the filter keeps or hides, for the menu's hint line. */
function filterSummary(filter: FileFilterConfig): string {
    const list = (filter.mode === 'blacklist' ? filter.blacklist : filter.whitelist) || []
    return list.map((e) => e.trim()).filter(Boolean).join(', ')
}

// ExplorerViewMenu is the explorer header's "view options" button: everything about how
// the file tree is shown — sort order, folders first, and the file-type filter — in one
// menu, leaving the other header buttons for actions (new note, new folder).
export function ExplorerViewMenu({
    sort,
    onChangeSort,
    filter,
    onToggleFilter,
    onEditFilter,
    buttonClassName,
    activeButtonClassName,
}: ExplorerViewMenuProps) {
    const {t} = useI18n()
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    // The menu is position:fixed so the sidebar's overflow:hidden cannot clip it;
    // its place is computed from the button and kept inside the window.
    const [pos, setPos] = useState<{left: number; top: number} | null>(null)

    useLayoutEffect(() => {
        if (!open) {
            setPos(null)
            return
        }
        const button = buttonRef.current?.getBoundingClientRect()
        const menu = menuRef.current
        if (!button || !menu) return
        const {width, height} = menu.getBoundingClientRect()
        // Right-aligned with the button when there is room, else pushed right.
        const left = Math.min(
            Math.max(VIEWPORT_MARGIN, button.right - width),
            window.innerWidth - width - VIEWPORT_MARGIN,
        )
        // Below the button, or above it when it would overflow the bottom.
        const below = button.bottom + 4
        const top = below + height > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, button.top - height - 4) : below
        setPos({left, top})
    }, [open])
    const isDefault =
        sort.by === DEFAULT_TREE_SORT.by &&
        sort.direction === DEFAULT_TREE_SORT.direction &&
        sort.foldersFirst === DEFAULT_TREE_SORT.foldersFirst &&
        filter.enabled

    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        // A fixed menu would drift from its button: close it on resize.
        const onResize = () => setOpen(false)
        window.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        window.addEventListener('resize', onResize)
        return () => {
            window.removeEventListener('mousedown', onDown)
            window.removeEventListener('keydown', onKey)
            window.removeEventListener('resize', onResize)
        }
    }, [open])

    const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
    const separator = <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" role="separator" />
    const check = (on: boolean) => <Check className={`h-3.5 w-3.5 shrink-0 ${on ? 'text-blue-500' : 'invisible'}`} />
    const summary = filterSummary(filter)

    return (
        <div className="relative" ref={ref}>
            <button
                ref={buttonRef}
                onClick={() => setOpen((o) => !o)}
                title={t('explorerViewOptions')}
                aria-label={t('explorerViewOptions')}
                aria-haspopup="menu"
                aria-expanded={open}
                className={isDefault ? buttonClassName : activeButtonClassName}
            >
                <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            {open && (
                <div
                    ref={menuRef}
                    role="menu"
                    // Measured once before it is shown (hidden until positioned).
                    style={pos ? {left: pos.left, top: pos.top} : {left: 0, top: 0, visibility: 'hidden'}}
                    className="fixed z-50 min-w-[220px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 shadow-lg shadow-black/10 dark:shadow-black/50 normal-case tracking-normal font-normal"
                >
                    {OPTIONS.map((group, gi) => (
                        <div key={gi}>
                            {gi > 0 && separator}
                            {group.map((o) => {
                                const selected = sort.by === o.by && sort.direction === o.direction
                                return (
                                    <button
                                        key={o.label}
                                        role="menuitemradio"
                                        aria-checked={selected}
                                        className={item}
                                        onClick={() => {
                                            onChangeSort({...sort, by: o.by, direction: o.direction})
                                            setOpen(false)
                                        }}
                                    >
                                        {check(selected)}
                                        {t(o.label)}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                    {separator}
                    <button
                        role="menuitemcheckbox"
                        aria-checked={sort.foldersFirst}
                        className={item}
                        onClick={() => onChangeSort({...sort, foldersFirst: !sort.foldersFirst})}
                    >
                        {check(sort.foldersFirst)}
                        {t('sortFoldersFirst')}
                    </button>
                    <button role="menuitemcheckbox" aria-checked={filter.enabled} className={`${item} items-start`} onClick={onToggleFilter}>
                        {check(filter.enabled)}
                        <span className="min-w-0">
                            <span className="block">{t('viewApplyFilter')}</span>
                            {summary && (
                                <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                                    {(filter.mode === 'blacklist' ? t('viewFilterHides') : t('viewFilterShows')).replace('{list}', summary)}
                                </span>
                            )}
                        </span>
                    </button>
                    {separator}
                    <button
                        role="menuitem"
                        className={item}
                        onClick={() => {
                            setOpen(false)
                            onEditFilter()
                        }}
                    >
                        <Settings2 className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        {t('viewEditFilter')}
                    </button>
                </div>
            )}
        </div>
    )
}
