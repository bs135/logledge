import {useEffect, useRef, useState} from 'react'
import type {KeyboardEvent} from 'react'
import {QuickSwitch} from '../../wailsjs/go/main/App'

interface QuickSwitcherProps {
    onOpen: (path: string) => void
    onClose: () => void
}

// QuickSwitcher là Command Palette (Ctrl+P): tìm nhanh file theo tên bằng
// fuzzy search, mở ngay khi Enter hoặc click vào kết quả.
export function QuickSwitcher({onOpen, onClose}: QuickSwitcherProps) {
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
                className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Gõ tên ghi chú…"
                    className="w-full border-b border-neutral-700 bg-transparent px-4 py-3 text-sm text-neutral-100 outline-none"
                />
                <ul className="max-h-80 overflow-y-auto py-1">
                    {results.map((path, i) => (
                        <li key={path}>
                            <button
                                className={`block w-full truncate px-4 py-2 text-left text-sm ${
                                    i === activeIndex ? 'bg-blue-600 text-white' : 'text-neutral-200 hover:bg-neutral-700'
                                }`}
                                onMouseEnter={() => setActiveIndex(i)}
                                onClick={() => openAt(i)}
                            >
                                {path}
                            </button>
                        </li>
                    ))}
                    {results.length === 0 && (
                        <li className="px-4 py-3 text-sm text-neutral-500">Không tìm thấy ghi chú nào</li>
                    )}
                </ul>
            </div>
        </div>
    )
}
