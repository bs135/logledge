import {useEffect, useRef, useState} from 'react'
import type {KeyboardEvent} from 'react'
import {QuickSwitch} from '../../wailsjs/go/main/App'
import {Search, FileText} from 'lucide-react'
import {useI18n} from '../i18n'

interface QuickSwitcherProps {
    onOpen: (path: string) => void
    onClose: () => void
}

// QuickSwitcher is the Command Palette (Ctrl+P): quickly finds files by name
// using fuzzy search, opening immediately on Enter or result click.
export function QuickSwitcher({onOpen, onClose}: QuickSwitcherProps) {
    const {t} = useI18n()
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<string[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => {
            QuickSwitch(query)
                .then((paths) => {
                    setResults(paths || [])
                    setActiveIndex(0)
                })
                .catch(() => setResults([]))
        }, 100)
        return () => clearTimeout(timer)
    }, [query])

    function openAt(index: number) {
        const path = results[index]
        if (path) onOpen(path)
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            onClose()
        } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((i) => Math.min(i + 1, results.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            openAt(activeIndex)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24" onClick={onClose}>
            <div
                className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center border-b border-neutral-200 dark:border-neutral-700 px-3">
                    <Search className="h-4 w-4 text-neutral-400 shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('quickSwitcherPlaceholder')}
                        className="w-full bg-transparent px-3 py-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none"
                    />
                </div>
                <ul className="max-h-80 overflow-y-auto py-1">
                    {results.map((path, i) => (
                        <li key={path}>
                            <button
                                className={`flex items-center w-full truncate px-4 py-2 text-left text-sm transition-colors ${
                                    i === activeIndex
                                        ? 'bg-blue-600 text-white'
                                        : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                                }`}
                                onMouseEnter={() => setActiveIndex(i)}
                                onClick={() => openAt(i)}
                            >
                                <FileText className={`h-3.5 w-3.5 mr-2 shrink-0 ${i === activeIndex ? 'text-white' : 'text-neutral-400'}`} />
                                <span className="truncate">{path}</span>
                            </button>
                        </li>
                    ))}
                    {results.length === 0 && (
                        <li className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">{t('noNotesFound')}</li>
                    )}
                </ul>
            </div>
        </div>
    )
}
