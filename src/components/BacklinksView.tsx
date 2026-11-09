import {useEffect, useState} from 'react'
import {ChevronDown, ChevronRight, FileText} from 'lucide-react'
import {useI18n} from '../i18n'
import {backlinks as fetchBacklinks, mentions as fetchMentions, onEvent} from '../lib/api'
import {groupBacklinks, snippetParts, type BacklinkGroup} from '../lib/backlinks'
import type {SearchResult} from '../lib/types'

// Index updates come in bursts (a reindex after sync touches many notes).
const REFRESH_DEBOUNCE_MS = 300

interface BacklinksViewProps {
    /** The open note. */
    path: string
    notePaths: string[]
    /** Opens a note, optionally at a 1-based line. */
    onOpen: (path: string, line?: number) => void
}

function noteTitle(path: string): string {
    return (path.split('/').pop() || path).replace(/\.(md|markdown)$/i, '')
}

function folderOf(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

// BacklinksView is the Backlinks tab of the right panel: notes that link to the open
// note (with the linking lines), and notes that mention its title without linking.
export function BacklinksView({path, notePaths, onOpen}: BacklinksViewProps) {
    const {t} = useI18n()
    const [linked, setLinked] = useState<BacklinkGroup[] | null>(null)
    const [mentions, setMentions] = useState<SearchResult[] | null>(null)
    const [showMentions, setShowMentions] = useState(false)
    // Bumped when the index changed, to refetch.
    const [indexVersion, setIndexVersion] = useState(0)

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const off = onEvent('search:indexed', () => {
            clearTimeout(timer)
            timer = setTimeout(() => setIndexVersion((v) => v + 1), REFRESH_DEBOUNCE_MS)
        })
        return () => {
            clearTimeout(timer)
            off()
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        fetchBacklinks(path)
            .then((refs) => !cancelled && setLinked(groupBacklinks(refs, path, notePaths)))
            .catch(() => !cancelled && setLinked([]))
        return () => {
            cancelled = true
        }
    }, [path, notePaths, indexVersion])

    // Unlinked mentions run a full-text query, so only while that section is open.
    useEffect(() => {
        if (!showMentions) return
        let cancelled = false
        fetchMentions(noteTitle(path))
            .then((res) => {
                if (cancelled) return
                const linkedSources = new Set((linked ?? []).map((g) => g.source))
                setMentions(res.filter((r) => r.path !== path && !linkedSources.has(r.path)))
            })
            .catch(() => !cancelled && setMentions([]))
        return () => {
            cancelled = true
        }
    }, [showMentions, path, linked])

    const heading = 'flex w-full items-center gap-1 px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500'

    return (
        <div className="space-y-3">
            <section>
                <h3 className={heading}>
                    {t('backlinksLinked')}
                    {linked && <span className="font-normal normal-case tracking-normal">({linked.length})</span>}
                </h3>
                {linked === null ? null : linked.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-500">{t('backlinksNone')}</p>
                ) : (
                    <ul className="space-y-1">
                        {linked.map((g) => (
                            <li key={g.source}>
                                <button
                                    onClick={() => onOpen(g.source)}
                                    title={g.source}
                                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
                                >
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                                    <span className="truncate">{noteTitle(g.source)}</span>
                                    {folderOf(g.source) && (
                                        <span className="ml-auto shrink-0 max-w-[45%] truncate text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
                                            {folderOf(g.source)}
                                        </span>
                                    )}
                                </button>
                                <ul>
                                    {g.mentions.map((m) => (
                                        <li key={m.line}>
                                            <button
                                                onClick={() => onOpen(g.source, m.line)}
                                                title={`${t('backlinksLine')} ${m.line}`}
                                                className="ml-5 block w-[calc(100%-1.25rem)] rounded px-2 py-0.5 text-left text-xs leading-snug text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 hover:text-neutral-800 dark:hover:text-neutral-200 line-clamp-2"
                                            >
                                                {m.context}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <button className={`${heading} hover:text-neutral-600 dark:hover:text-neutral-300`} onClick={() => setShowMentions((s) => !s)}>
                    {showMentions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {t('backlinksUnlinked')}
                    {showMentions && mentions && <span className="font-normal normal-case tracking-normal">({mentions.length})</span>}
                </button>
                {showMentions &&
                    mentions !== null &&
                    (mentions.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-500">{t('backlinksNoMentions')}</p>
                    ) : (
                        <ul className="space-y-1">
                            {mentions.map((r) => (
                                <li key={r.path}>
                                    <button
                                        onClick={() => onOpen(r.path)}
                                        title={r.path}
                                        className="block w-full rounded px-2 py-1 text-left hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
                                    >
                                        <span className="block truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-200">{noteTitle(r.path)}</span>
                                        <span className="block text-xs leading-snug text-neutral-500 dark:text-neutral-400 line-clamp-2">
                                            {snippetParts(r.snippet).map((p, i) =>
                                                p.match ? (
                                                    <mark key={i} className="rounded-sm bg-amber-100 dark:bg-amber-500/30 text-inherit">
                                                        {p.text}
                                                    </mark>
                                                ) : (
                                                    <span key={i}>{p.text}</span>
                                                ),
                                            )}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ))}
            </section>
        </div>
    )
}
