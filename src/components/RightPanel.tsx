import {useEffect, useRef, useState} from 'react'
import {ArrowUpToLine, ListTree, X} from 'lucide-react'
import {useI18n} from '../i18n'
import {outlineIndents, type OutlineItem} from '../lib/outline'

export const RIGHT_PANEL_DEFAULT_WIDTH = 260
export const RIGHT_PANEL_MIN_WIDTH = 180
export const RIGHT_PANEL_MAX_WIDTH = 560

export type RightPanelTab = 'outline'

interface RightPanelProps {
    width: number
    onWidthChange: (width: number) => void
    onClose: () => void
    /** Null when no note is open. */
    outline: OutlineItem[] | null
    /** Index into `outline` of the heading being read, or -1 (before the first heading). */
    activeIndex: number
    onSelectHeading: (item: OutlineItem) => void
    onSelectTop: () => void
}

// RightPanel is the collapsible, resizable panel on the right of the editor. Its tabs
// hold note-related views; the first one is the outline of the open note.
export function RightPanel({width, onWidthChange, onClose, outline, activeIndex, onSelectHeading, onSelectTop}: RightPanelProps) {
    const {t} = useI18n()
    const [tab, setTab] = useState<RightPanelTab>('outline')
    const [resizing, setResizing] = useState(false)
    const listRef = useRef<HTMLUListElement>(null)

    // Keep the highlighted heading in view while the note scrolls.
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
        el?.scrollIntoView({block: 'nearest'})
    }, [activeIndex])

    function startResize(e: React.MouseEvent) {
        if (e.button !== 0) return
        e.preventDefault()
        const startX = e.clientX
        const startWidth = width
        setResizing(true)
        const prevCursor = document.body.style.cursor
        const prevSelect = document.body.style.userSelect
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        const onMove = (ev: MouseEvent) => {
            const maxAllowed = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, window.innerWidth - 320))
            // Dragging left widens the panel.
            const next = Math.min(maxAllowed, Math.max(RIGHT_PANEL_MIN_WIDTH, startWidth + startX - ev.clientX))
            onWidthChange(Math.round(next))
        }
        const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            window.removeEventListener('blur', onUp)
            document.body.style.cursor = prevCursor
            document.body.style.userSelect = prevSelect
            setResizing(false)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        window.addEventListener('blur', onUp)
    }

    const indents = outline ? outlineIndents(outline) : []

    return (
        <>
            <div
                role="separator"
                aria-orientation="vertical"
                title={t('resizeSidebar')}
                onMouseDown={startResize}
                onDoubleClick={() => onWidthChange(RIGHT_PANEL_DEFAULT_WIDTH)}
                className="relative w-px shrink-0 select-none bg-neutral-200 dark:bg-neutral-800 cursor-col-resize group"
            >
                <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-20 cursor-col-resize" />
                <div
                    className={`absolute inset-y-0 -left-[1px] w-[3px] pointer-events-none transition-colors ${
                        resizing ? 'bg-blue-500' : 'group-hover:bg-blue-500/80 dark:group-hover:bg-blue-400/80'
                    }`}
                />
            </div>
            <aside
                style={{width: `${width}px`}}
                className="flex shrink-0 flex-col overflow-hidden bg-neutral-50/50 dark:bg-neutral-900/40"
                aria-label={t('rightPanel')}
            >
                <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1">
                    <button
                        onClick={() => setTab('outline')}
                        className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                            tab === 'outline'
                                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-medium'
                                : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
                        }`}
                    >
                        <ListTree className="h-3.5 w-3.5" />
                        {t('outlineTab')}
                    </button>
                    <button
                        onClick={onClose}
                        title={t('closeRightPanel')}
                        className="ml-auto rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-1.5">
                    {outline === null ? (
                        <p className="px-2 py-3 text-xs text-neutral-400 dark:text-neutral-500">{t('outlineNoNote')}</p>
                    ) : (
                        <ul ref={listRef}>
                            {/* Jump to the top of the note; highlighted before the first heading. */}
                            <li>
                                <button
                                    data-active={activeIndex === -1}
                                    onClick={onSelectTop}
                                    title={t('outlineTop')}
                                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] transition-colors ${
                                        activeIndex === -1
                                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300 font-medium'
                                            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
                                    }`}
                                >
                                    <ArrowUpToLine className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{t('outlineTopLabel')}</span>
                                </button>
                            </li>
                            {outline.length === 0 && (
                                <li className="px-2 py-3 text-xs text-neutral-400 dark:text-neutral-500">{t('outlineEmpty')}</li>
                            )}
                            {outline.map((item, i) => {
                                const active = i === activeIndex
                                return (
                                    <li key={`${item.from}-${i}`}>
                                        <button
                                            data-active={active}
                                            onClick={() => onSelectHeading(item)}
                                            title={item.text}
                                            style={{paddingLeft: `${8 + indents[i] * 12}px`}}
                                            className={`block w-full truncate rounded py-1 pr-2 text-left text-[13px] transition-colors ${
                                                active
                                                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300 font-medium'
                                                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
                                            } ${item.level === 1 ? 'font-semibold' : ''}`}
                                        >
                                            {item.text}
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            </aside>
        </>
    )
}
