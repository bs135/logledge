import {useEffect, useRef, useState} from 'react'
import {ArrowDownUp, Check} from 'lucide-react'
import {useI18n} from '../i18n'
import {DEFAULT_TREE_SORT, type TreeSort, type TreeSortBy, type TreeSortDirection} from '../lib/treeSort'

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

interface TreeSortMenuProps {
    sort: TreeSort
    onChange: (sort: TreeSort) => void
    /** Class of the toggle button, to match the other explorer header buttons. */
    buttonClassName: string
    activeButtonClassName: string
}

// TreeSortMenu is the explorer header button that picks the file-tree order.
export function TreeSortMenu({sort, onChange, buttonClassName, activeButtonClassName}: TreeSortMenuProps) {
    const {t} = useI18n()
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const isDefault =
        sort.by === DEFAULT_TREE_SORT.by &&
        sort.direction === DEFAULT_TREE_SORT.direction &&
        sort.foldersFirst === DEFAULT_TREE_SORT.foldersFirst

    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        window.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('mousedown', onDown)
            window.removeEventListener('keydown', onKey)
        }
    }, [open])

    const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((o) => !o)}
                title={t('sortTree')}
                aria-haspopup="menu"
                aria-expanded={open}
                className={isDefault ? buttonClassName : activeButtonClassName}
            >
                <ArrowDownUp className="h-3.5 w-3.5" />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-7 z-50 min-w-[200px] rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 shadow-lg shadow-black/10 dark:shadow-black/50 normal-case tracking-normal font-normal"
                >
                    {OPTIONS.map((group, gi) => (
                        <div key={gi}>
                            {gi > 0 && <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" role="separator" />}
                            {group.map((o) => {
                                const selected = sort.by === o.by && sort.direction === o.direction
                                return (
                                    <button
                                        key={o.label}
                                        role="menuitemradio"
                                        aria-checked={selected}
                                        className={item}
                                        onClick={() => {
                                            onChange({...sort, by: o.by, direction: o.direction})
                                            setOpen(false)
                                        }}
                                    >
                                        <Check className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-blue-500' : 'invisible'}`} />
                                        {t(o.label)}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                    <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" role="separator" />
                    <button
                        role="menuitemcheckbox"
                        aria-checked={sort.foldersFirst}
                        className={item}
                        onClick={() => onChange({...sort, foldersFirst: !sort.foldersFirst})}
                    >
                        <Check className={`h-3.5 w-3.5 shrink-0 ${sort.foldersFirst ? 'text-blue-500' : 'invisible'}`} />
                        {t('sortFoldersFirst')}
                    </button>
                </div>
            )}
        </div>
    )
}
