import {useEffect, useState} from 'react'
import {ChevronDown, ChevronRight, FileText, Hash, Search} from 'lucide-react'
import {useI18n} from '../i18n'
import {allTags, notesWithTag, onEvent} from '../lib/api'
import {buildTagTree, type TagNode} from '../lib/tags'

// Index updates come in bursts (a reindex after sync touches many notes).
const REFRESH_DEBOUNCE_MS = 300

interface TagsViewProps {
    onOpenNote: (path: string) => void
    /** Opens Global Search with "tag:<tag>". */
    onSearchTag: (tag: string) => void
}

function noteTitle(path: string): string {
    return (path.split('/').pop() || path).replace(/\.(md|markdown)$/i, '')
}

// TagsView is the Tags tab of the right panel: every tag in the vault as a tree
// (nested tags under their parent) with note counts; expand a tag to list its notes.
export function TagsView({onOpenNote, onSearchTag}: TagsViewProps) {
    const {t} = useI18n()
    const [tree, setTree] = useState<TagNode[] | null>(null)
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
        allTags()
            .then((counts) => !cancelled && setTree(buildTagTree(counts)))
            .catch(() => !cancelled && setTree([]))
        return () => {
            cancelled = true
        }
    }, [indexVersion])

    if (tree === null) return null
    if (tree.length === 0) return <p className="px-2 py-3 text-xs text-neutral-400 dark:text-neutral-500">{t('tagsNone')}</p>
    return (
        <ul>
            {tree.map((node) => (
                <TagRow key={node.tag} node={node} depth={0} indexVersion={indexVersion} onOpenNote={onOpenNote} onSearchTag={onSearchTag} />
            ))}
        </ul>
    )
}

function TagRow({
    node,
    depth,
    indexVersion,
    onOpenNote,
    onSearchTag,
}: {
    node: TagNode
    depth: number
    indexVersion: number
    onOpenNote: (path: string) => void
    onSearchTag: (tag: string) => void
}) {
    const {t} = useI18n()
    const [open, setOpen] = useState(false)
    const [notes, setNotes] = useState<string[] | null>(null)

    // Notes are loaded when the tag is expanded (and again when the index changes).
    useEffect(() => {
        if (!open) return
        let cancelled = false
        notesWithTag(node.tag)
            .then((paths) => !cancelled && setNotes(paths))
            .catch(() => !cancelled && setNotes([]))
        return () => {
            cancelled = true
        }
    }, [open, node.tag, indexVersion])

    const pad = {paddingLeft: `${4 + depth * 12}px`}
    return (
        <li>
            <div className="group flex items-center rounded hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60" style={pad}>
                <button
                    onClick={() => setOpen((o) => !o)}
                    className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-[13px] text-neutral-700 dark:text-neutral-300"
                    title={`#${node.tag}`}
                >
                    {open ? <ChevronDown className="h-3 w-3 shrink-0 text-neutral-400" /> : <ChevronRight className="h-3 w-3 shrink-0 text-neutral-400" />}
                    <Hash className="h-3 w-3 shrink-0 text-sky-500 dark:text-sky-400" />
                    <span className="truncate">{node.name}</span>
                    {node.count > 0 && <span className="ml-1 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">{node.count}</span>}
                </button>
                <button
                    onClick={() => onSearchTag(node.tag)}
                    title={t('tagSearch')}
                    className="mr-1 shrink-0 rounded p-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                    <Search className="h-3 w-3" />
                </button>
            </div>
            {open && (
                <ul>
                    {node.children.map((child) => (
                        <TagRow key={child.tag} node={child} depth={depth + 1} indexVersion={indexVersion} onOpenNote={onOpenNote} onSearchTag={onSearchTag} />
                    ))}
                    {notes?.map((path) => (
                        <li key={path}>
                            <button
                                onClick={() => onOpenNote(path)}
                                title={path}
                                style={{paddingLeft: `${20 + depth * 12}px`}}
                                className="flex w-full items-center gap-1.5 rounded py-0.5 pr-2 text-left text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-100"
                            >
                                <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
                                <span className="truncate">{noteTitle(path)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    )
}
