import {AlertTriangle, Check, Circle, Loader2, XCircle} from 'lucide-react'
import {useI18n} from '../i18n'
import {readingMinutes} from '../lib/textStats'
import type {EditorStats} from './Editor'

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'deleted' | 'error'

interface EditorStatusProps {
    stats: EditorStats
    saveState: SaveState
    /** Error message shown as the tooltip of the "Save failed" state. */
    saveError?: string
}

function fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
}

// EditorStatus is the right side of the bottom status bar while a note is open: whether
// the note is saved, and its word/character counts (selection / whole note when text is
// selected) with an estimated reading time.
export function EditorStatus({stats, saveState, saveError}: EditorStatusProps) {
    const {t, lang} = useI18n()
    const num = (n: number) => n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')
    const {doc, selection} = stats

    const words = selection
        ? fill(t('statusWordsSelected'), {selected: num(selection.words), count: num(doc.words)})
        : fill(doc.words === 1 ? t('statusWord') : t('statusWords'), {count: num(doc.words)})
    const chars = selection
        ? fill(t('statusCharsSelected'), {selected: num(selection.chars), count: num(doc.chars)})
        : fill(doc.chars === 1 ? t('statusChar') : t('statusChars'), {count: num(doc.chars)})
    const minutes = readingMinutes(doc.words)

    return (
        <div className="flex min-w-0 items-center gap-3 select-none tabular-nums">
            <SaveIndicator state={saveState} error={saveError} />
            <span className="h-3 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden />
            <span className="truncate">{words}</span>
            <span className="hidden sm:inline truncate">{chars}</span>
            {minutes > 0 && (
                <span className="hidden md:inline truncate">{fill(t('statusReading'), {count: num(minutes)})}</span>
            )}
        </div>
    )
}

function SaveIndicator({state, error}: {state: SaveState; error?: string}) {
    const {t} = useI18n()
    const icon = 'h-3 w-3 shrink-0'
    switch (state) {
        case 'saving':
            return (
                <span className="flex items-center gap-1">
                    <Loader2 className={`${icon} animate-spin`} />
                    {t('saveSaving')}
                </span>
            )
        case 'unsaved':
            return (
                <span className="flex items-center gap-1">
                    <Circle className={`${icon} fill-current`} />
                    {t('saveUnsaved')}
                </span>
            )
        case 'conflict':
            return (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className={icon} />
                    {t('saveConflict')}
                </span>
            )
        case 'deleted':
            return (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className={icon} />
                    {t('saveDeleted')}
                </span>
            )
        case 'error':
            return (
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400" title={error}>
                    <XCircle className={icon} />
                    {t('saveError')}
                </span>
            )
        default:
            return (
                <span className="flex items-center gap-1">
                    <Check className={icon} />
                    {t('saveSaved')}
                </span>
            )
    }
}
