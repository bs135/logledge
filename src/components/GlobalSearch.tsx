import {useEffect, useMemo, useRef, useState} from 'react'
import type {KeyboardEvent, ReactNode} from 'react'
import {toast} from 'sonner'
import {grepNotes, replaceInNotes, searchNotes} from '../lib/api'
import type {SearchResult} from '../lib/types'
import {lineParts, replaceTotals, type GrepResult} from '../lib/grep'
import {CaseSensitive, ChevronDown, ChevronRight, FileText, Regex, Replace, Search, WholeWord} from 'lucide-react'
import {useI18n} from '../i18n'
import {ConfirmModal} from './ConfirmModal'

interface GlobalSearchProps {
    /** Opens a note, optionally at a 1-based line. */
    onOpen: (path: string, line?: number) => void
    onClose: () => void
    /** Query to start with, e.g. "tag:work" from a Ctrl+Clicked tag. */
    initialQuery?: string
    /** Saves pending edits of the open note before a replace reads the files. */
    onBeforeReplace: () => Promise<void>
    /** Notes changed by a replace (to reload the open one). */
    onReplaced: (paths: string[]) => void
}

/** One selectable row of the exact-mode result list. */
interface Row {
    path: string
    line?: number
}

// GlobalSearch (Ctrl+Shift+F) searches the vault. By default it is a ranked full-text
// search with snippets. Turning on case sensitivity (Aa), whole word, regex (.*) or replace switches
// to an exact, line-by-line search whose matches can be replaced across notes.
// `tag:name` and `path:folder` filter both modes.
export function GlobalSearch({onOpen, onClose, initialQuery = '', onBeforeReplace, onReplaced}: GlobalSearchProps) {
    const {t} = useI18n()
    const [query, setQuery] = useState(initialQuery)
    const [caseSensitive, setCaseSensitive] = useState(false)
    const [useRegex, setUseRegex] = useState(false)
    const [wholeWord, setWholeWord] = useState(false)
    const [replaceOpen, setReplaceOpen] = useState(false)
    const [replacement, setReplacement] = useState('')
    const [results, setResults] = useState<SearchResult[]>([])
    const [grep, setGrep] = useState<GrepResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [excluded, setExcluded] = useState<Set<string>>(new Set())
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [activeIndex, setActiveIndex] = useState(0)
    const [confirming, setConfirming] = useState(false)
    const [replacing, setReplacing] = useState(false)
    // Bumped to re-run the search (after a replace).
    const [searchSeq, setSearchSeq] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLUListElement>(null)
    const exact = caseSensitive || useRegex || wholeWord || replaceOpen

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    useEffect(() => {
        let cancelled = false
        const timer = setTimeout(() => {
            setError(null)
            if (!query.trim()) {
                setResults([])
                setGrep(null)
                return
            }
            if (exact) {
                grepNotes(query, caseSensitive, useRegex, wholeWord)
                    .then((r) => {
                        if (cancelled) return
                        setGrep(r)
                        setActiveIndex(0)
                    })
                    .catch((err) => {
                        if (cancelled) return
                        setGrep(null)
                        // "empty search": only filters typed so far, nothing to match yet.
                        const msg = String(err)
                        setError(msg.includes('empty search') ? null : msg)
                    })
            } else {
                searchNotes(query)
                    .then((r) => {
                        if (cancelled) return
                        setResults(r || [])
                        setActiveIndex(0)
                    })
                    .catch(() => !cancelled && setResults([]))
            }
        }, 150)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [query, exact, caseSensitive, useRegex, wholeWord, searchSeq])

    // A new search starts with every note selected for replacing.
    useEffect(() => setExcluded(new Set()), [query, caseSensitive, useRegex, wholeWord])

    const rows: Row[] = useMemo(() => {
        if (!exact) return results.map((r) => ({path: r.path}))
        const out: Row[] = []
        for (const f of grep?.files ?? []) {
            out.push({path: f.path})
            if (!collapsed.has(f.path)) for (const l of f.lines) out.push({path: f.path, line: l.line})
        }
        return out
    }, [exact, results, grep, collapsed])

    // Keep the active row in view when moving with the keyboard.
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-row="${activeIndex}"]`)?.scrollIntoView({block: 'nearest'})
    }, [activeIndex])

    function openRow(index: number) {
        const row = rows[index]
        if (row) onOpen(row.path, row.line)
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            onClose()
        } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((i) => Math.min(i + 1, rows.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter' && e.currentTarget === inputRef.current) {
            e.preventDefault()
            openRow(activeIndex)
        } else if (e.altKey && e.key.toLowerCase() === 'c') {
            e.preventDefault()
            setCaseSensitive((v) => !v)
        } else if (e.altKey && e.key.toLowerCase() === 'r') {
            e.preventDefault()
            setUseRegex((v) => !v)
        } else if (e.altKey && e.key.toLowerCase() === 'w') {
            e.preventDefault()
            setWholeWord((v) => !v)
        }
    }

    const totals = grep ? replaceTotals(grep.files, excluded) : {matches: 0, notes: 0}

    async function runReplace() {
        if (!grep) return
        setConfirming(false)
        setReplacing(true)
        try {
            await onBeforeReplace()
            const targets = grep.files.filter((f) => !excluded.has(f.path)).map((f) => ({path: f.path, expected: f.total}))
            const outcomes = await replaceInNotes(query, caseSensitive, useRegex, wholeWord, replacement, targets)
            const done = outcomes.filter((o) => !o.skipped)
            const skipped = outcomes.filter((o) => o.skipped)
            onReplaced(done.map((o) => o.path))
            const replaced = done.reduce((n, o) => n + o.replaced, 0)
            const message = t('replaceDone').replace('{count}', String(replaced)).replace('{notes}', String(done.length))
            if (skipped.length) {
                toast.warning(`${message} ${t('replaceSkipped').replace('{notes}', String(skipped.length))}`, {
                    description: skipped.map((o) => o.path).join(', '),
                })
            } else {
                toast.success(message)
            }
            setSearchSeq((s) => s + 1)
        } catch (err) {
            toast.error(t('replaceFailed') + String(err))
        } finally {
            setReplacing(false)
        }
    }

    const toggle = (on: boolean) =>
        `rounded p-1 transition-colors ${
            on
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-600/30 dark:text-blue-300'
                : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-200'
        }`

    const rowClass = (i: number) =>
        i === activeIndex ? 'bg-blue-600 text-white' : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'

    let rowIndex = -1
    let list: ReactNode
    if (!exact) {
        list = results.map((r, i) => (
            <li key={r.path}>
                <button
                    data-row={i}
                    className={`block w-full px-4 py-2 text-left text-sm transition-colors ${rowClass(i)}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => openRow(i)}
                >
                    <div className="flex items-center gap-1.5 truncate font-medium">
                        <FileText className={`h-3.5 w-3.5 shrink-0 ${i === activeIndex ? 'text-white' : 'text-neutral-400'}`} />
                        <span className="truncate">{r.title}</span>
                    </div>
                    {/* Tag-only searches ("tag:work") have no snippet. */}
                    {r.snippet && <div className="mt-0.5 truncate text-xs opacity-80">{highlightSnippet(r.snippet)}</div>}
                    <div className="mt-0.5 truncate text-xs opacity-50">{r.path}</div>
                </button>
            </li>
        ))
    } else {
        list = (grep?.files ?? []).map((f) => {
            const headerIndex = ++rowIndex
            const isCollapsed = collapsed.has(f.path)
            return (
                <li key={f.path}>
                    <div
                        data-row={headerIndex}
                        className={`flex items-center gap-1.5 px-2 py-1 text-sm transition-colors ${rowClass(headerIndex)}`}
                        onMouseEnter={() => setActiveIndex(headerIndex)}
                    >
                        <button
                            className="shrink-0 opacity-70"
                            onClick={() =>
                                setCollapsed((c) => {
                                    const next = new Set(c)
                                    if (next.has(f.path)) next.delete(f.path)
                                    else next.add(f.path)
                                    return next
                                })
                            }
                        >
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                        {replaceOpen && (
                            <input
                                type="checkbox"
                                checked={!excluded.has(f.path)}
                                title={t('replaceIncludeNote')}
                                onChange={(e) => {
                                    const include = e.target.checked
                                    setExcluded((ex) => {
                                        const next = new Set(ex)
                                        if (include) next.delete(f.path)
                                        else next.add(f.path)
                                        return next
                                    })
                                }}
                                className="shrink-0 accent-blue-600"
                            />
                        )}
                        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => openRow(headerIndex)}>
                            <span className="truncate font-medium">{f.path.split('/').pop()?.replace(/\.md$/i, '')}</span>
                            <span className="truncate text-xs opacity-50">{f.path}</span>
                            <span className="ml-auto shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700 px-1.5 text-[11px] text-neutral-700 dark:text-neutral-200">
                                {f.total}
                            </span>
                        </button>
                    </div>
                    {!isCollapsed && (
                        <ul>
                            {f.lines.map((l) => {
                                const i = ++rowIndex
                                return (
                                    <li key={l.line}>
                                        <button
                                            data-row={i}
                                            className={`flex w-full items-baseline gap-2 py-0.5 pl-9 pr-3 text-left text-xs transition-colors ${rowClass(i)}`}
                                            onMouseEnter={() => setActiveIndex(i)}
                                            onClick={() => openRow(i)}
                                        >
                                            <span className="w-8 shrink-0 text-right tabular-nums opacity-50">{l.line}</span>
                                            <span className="truncate font-mono">
                                                {lineParts(l.text, l.ranges).map((p, k) =>
                                                    p.match ? (
                                                        <mark
                                                            key={k}
                                                            className={`rounded px-0.5 ${
                                                                replaceOpen && replacement !== '' && !excluded.has(f.path)
                                                                    ? 'bg-red-200/70 line-through dark:bg-red-500/30'
                                                                    : 'bg-yellow-300/60 dark:bg-yellow-500/40'
                                                            } text-inherit`}
                                                        >
                                                            {p.text}
                                                        </mark>
                                                    ) : (
                                                        <span key={k}>{p.text}</span>
                                                    ),
                                                )}
                                            </span>
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </li>
            )
        })
    }

    const nothingFound = query.trim() && !error && (exact ? grep && grep.files.length === 0 : results.length === 0)

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24" onClick={onClose}>
            <div
                className="w-full max-w-2xl overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center border-b border-neutral-200 dark:border-neutral-700 pl-1 pr-2">
                    <button
                        onClick={() => setReplaceOpen((o) => !o)}
                        title={t('replaceToggle')}
                        className={`${toggle(replaceOpen)} mr-1`}
                        aria-pressed={replaceOpen}
                    >
                        <Replace className="h-4 w-4" />
                    </button>
                    <Search className="h-4 w-4 text-neutral-400 shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('searchVaultPlaceholder')}
                        className="w-full bg-transparent px-3 py-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none"
                    />
                    <button onClick={() => setCaseSensitive((v) => !v)} title={t('searchCaseSensitive')} className={toggle(caseSensitive)} aria-pressed={caseSensitive}>
                        <CaseSensitive className="h-4 w-4" />
                    </button>
                    <button onClick={() => setWholeWord((v) => !v)} title={t('searchWholeWord')} className={toggle(wholeWord)} aria-pressed={wholeWord}>
                        <WholeWord className="h-4 w-4" />
                    </button>
                    <button onClick={() => setUseRegex((v) => !v)} title={t('searchRegex')} className={toggle(useRegex)} aria-pressed={useRegex}>
                        <Regex className="h-4 w-4" />
                    </button>
                </div>
                {replaceOpen && (
                    <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-700 py-1.5 pl-9 pr-2">
                        <input
                            value={replacement}
                            onChange={(e) => setReplacement(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={useRegex ? t('replaceWithRegex') : t('replaceWith')}
                            className="w-full rounded border border-neutral-200 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 outline-none focus:border-blue-500"
                        />
                        <button
                            disabled={!grep || totals.matches === 0 || replacing}
                            onClick={() => setConfirming(true)}
                            className="shrink-0 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none"
                        >
                            {replacing ? t('replacing') : t('replaceAll')}
                        </button>
                    </div>
                )}
                {exact && grep && (
                    <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-700 px-4 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        <span>
                            {t('searchMatchSummary')
                                .replace('{count}', String(grep.files.reduce((n, f) => n + f.total, 0)))
                                .replace('{notes}', String(grep.files.length))}
                        </span>
                        {grep.truncated && <span className="text-amber-600 dark:text-amber-400">{t('searchTruncated')}</span>}
                    </div>
                )}
                {error && <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
                <ul ref={listRef} className="max-h-[28rem] overflow-y-auto py-1">
                    {list}
                    {nothingFound && <li className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">{t('noResultsFound')}</li>}
                </ul>
            </div>
            {/* Clicks on the confirm dialog's backdrop must not close the search too. */}
            <div onClick={(e) => e.stopPropagation()}>
            <ConfirmModal
                isOpen={confirming}
                isDestructive={false}
                title={t('replaceConfirmTitle')}
                message={t('replaceConfirmDesc')
                    .replace('{count}', String(totals.matches))
                    .replace('{notes}', String(totals.notes))}
                itemName={replacement === '' ? t('replaceWithNothing') : replacement}
                confirmLabel={t('replaceAll')}
                onConfirm={runReplace}
                onClose={() => setConfirming(false)}
            />
            </div>
        </div>
    )
}

// highlightSnippet converts segments wrapped in "**...**" (generated by
// FTS5 snippet()) into <mark> tags to highlight matching keywords.
function highlightSnippet(snippet: string) {
    const parts = snippet.split('**')
    return parts.map((part, i) =>
        i % 2 === 1 ? (
            <mark key={i} className="rounded bg-yellow-300/60 dark:bg-yellow-500/40 px-0.5 text-neutral-900 dark:text-yellow-100">
                {part}
            </mark>
        ) : (
            <span key={i}>{part}</span>
        ),
    )
}
