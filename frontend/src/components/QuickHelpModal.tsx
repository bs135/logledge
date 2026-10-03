import {useEffect} from 'react'
import {X, FolderGit2, Keyboard, BookOpen} from 'lucide-react'

interface QuickHelpModalProps {
    onClose: () => void
}

export function QuickHelpModal({onClose}: QuickHelpModalProps) {
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 select-none">
            <div
                className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-5 py-3">
                    <div className="flex items-center gap-2.5">
                        <img src="/icon.svg" alt="Logledge" className="h-5 w-5" />
                        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Quick Help</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-neutral-700 dark:text-neutral-300">
                    {/* App info */}
                    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50 p-3.5 flex items-center justify-between">
                        <div>
                            <h3 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">Logledge</h3>
                            <p className="text-neutral-600 dark:text-neutral-400 mt-0.5">Modern Markdown note-taking with native Git synchronization.</p>
                            <p className="text-neutral-500 mt-1 text-[11px]">Version 0.1.1 • Wails v2 + React + Milkdown Crepe</p>
                        </div>
                        <a
                            href="https://github.com/bs135/logledge"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:hover:text-white px-3 py-1.5 transition-colors"
                        >
                            <FolderGit2 className="h-3.5 w-3.5 mr-1.5" />
                            <span>GitHub</span>
                        </a>
                    </div>

                    {/* Shortcuts */}
                    <div>
                        <h4 className="flex items-center font-semibold text-neutral-800 dark:text-neutral-200 uppercase tracking-wider text-[11px] mb-2">
                            <Keyboard className="h-3.5 w-3.5 mr-1.5 text-neutral-500" />
                            <span>Keyboard Shortcuts</span>
                        </h4>
                        <div className="grid grid-cols-2 gap-2">
                            <ShortcutItem keys="Ctrl + P" desc="Quick Switcher (find note)" />
                            <ShortcutItem keys="Ctrl + Shift + F" desc="Global full-text search" />
                            <ShortcutItem keys="Ctrl + B" desc="Toggle left sidebar" />
                            <ShortcutItem keys="Ctrl + ," desc="Open Settings & Sync" />
                            <ShortcutItem keys="Enter / Blur" desc="Save inline note title" />
                            <ShortcutItem keys="Esc" desc="Close modals & menus" />
                        </div>
                    </div>

                    {/* Markdown Tips */}
                    <div>
                        <h4 className="flex items-center font-semibold text-neutral-800 dark:text-neutral-200 uppercase tracking-wider text-[11px] mb-2">
                            <BookOpen className="h-3.5 w-3.5 mr-1.5 text-neutral-500" />
                            <span>Markdown & Live Preview</span>
                        </h4>
                        <div className="space-y-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/30 p-3 text-[11px]">
                            <div className="flex justify-between">
                                <span className="font-mono text-neutral-700 dark:text-neutral-400"># Heading 1, ## Heading 2</span>
                                <span className="text-neutral-500">Sans-serif titles</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-mono text-neutral-700 dark:text-neutral-400">**bold**, *italic*, ~~strike~~</span>
                                <span className="text-neutral-500">Text formatting</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-mono text-neutral-700 dark:text-neutral-400">- [ ] Todo task</span>
                                <span className="text-neutral-500">Interactive checkbox</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-mono text-neutral-700 dark:text-neutral-400">```lang ... ```</span>
                                <span className="text-neutral-500">Syntax highlighted code</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-mono text-neutral-700 dark:text-neutral-400">| Table | Col |</span>
                                <span className="text-neutral-500">Markdown tables</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-mono text-neutral-700 dark:text-neutral-400">$E = mc^2$</span>
                                <span className="text-neutral-500">KaTeX Math formulas</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t border-neutral-200 dark:border-neutral-800 px-5 py-3 flex justify-end">
                    <button
                        onClick={onClose}
                        className="rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 px-4 py-1.5 text-xs font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

function ShortcutItem({keys, desc}: {keys: string; desc: string}) {
    return (
        <div className="flex items-center justify-between rounded border border-neutral-200 dark:border-neutral-800/80 bg-neutral-50 dark:bg-neutral-950/40 px-2.5 py-1.5">
            <span className="text-neutral-600 dark:text-neutral-400">{desc}</span>
            <kbd className="rounded bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-800 dark:text-neutral-200">{keys}</kbd>
        </div>
    )
}
