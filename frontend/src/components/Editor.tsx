import {useEffect, useRef, useState} from 'react'
import {EditorState} from '@codemirror/state'
import {EditorView, keymap} from '@codemirror/view'
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands'
import {markdown, markdownLanguage} from '@codemirror/lang-markdown'
import {GFM, Strikethrough, Table, TaskList} from '@lezer/markdown'
import {defaultHighlightStyle, syntaxHighlighting} from '@codemirror/language'
import {SaveAttachment} from '../../wailsjs/go/main/App'
import {BrowserOpenURL} from '../../wailsjs/runtime'
import {EditorContextMenu} from './EditorContextMenu'
import {livePreview, notePathFacet} from './livePreview'
import {resolveCodeLanguage, syntaxHighlightExtension} from './syntaxHighlight'

interface EditorProps {
    /** Relative path (using "/") of the active note, used to compute relative image links. */
    path: string
    /** Initial Markdown content read from disk. */
    initialContent: string
    /** Immediate callback when content changes before debounce. */
    onContentChange?: (markdown: string) => void
    /** Called (internally debounced at 600ms) whenever content changes, for auto-save. */
    onChange: (markdown: string) => void
    /** Called when the inline note title is updated to rename the note file. */
    onRename?: (newName: string) => void
}

function toggleWrap(view: EditorView, before: string, after: string = before): boolean {
    const sel = view.state.selection.main
    const text = view.state.sliceDoc(sel.from, sel.to)
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
        // Unwrap
        view.dispatch({
            changes: {
                from: sel.from,
                to: sel.to,
                insert: text.slice(before.length, text.length - after.length),
            },
            selection: {
                anchor: sel.from,
                head: sel.to - before.length - after.length,
            },
        })
    } else {
        // Wrap
        view.dispatch({
            changes: {
                from: sel.from,
                to: sel.to,
                insert: `${before}${text}${after}`,
            },
            selection: {
                anchor: sel.from + before.length,
                head: sel.to + before.length,
            },
        })
    }
    return true
}

// Editor wraps CodeMirror 6 with Obsidian-style Live Preview (hybrid inline markdown editing),
// preserving lossless raw text documents, supporting image paste/drag-and-drop into .attachments/,
// and debounced auto-save at 600ms.
export function Editor({path, initialContent, onContentChange, onChange, onRename}: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onContentChangeRef = useRef(onContentChange)
    onContentChangeRef.current = onContentChange
    const pathRef = useRef(path)
    pathRef.current = path
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const initialTitle = path.split('/').pop()?.replace(/\.md$/, '') || ''
    const [title, setTitle] = useState(initialTitle)
    const [contextMenuPos, setContextMenuPos] = useState<{x: number; y: number} | null>(null)

    useEffect(() => {
        setTitle(path.split('/').pop()?.replace(/\.md$/, '') || '')
    }, [path])

    function handleTitleSubmit() {
        const trimmed = title.trim()
        const currentTitle = path.split('/').pop()?.replace(/\.md$/, '') || ''
        if (!trimmed || trimmed === currentTitle) {
            setTitle(currentTitle)
            return
        }
        // Sanitize invalid filename characters: / \ : * ? " < > |
        const sanitized = trimmed.replace(/[<>:"/\\|?*]/g, '_')
        onRename?.(sanitized.endsWith('.md') ? sanitized : sanitized + '.md')
    }

    useEffect(() => {
        if (!containerRef.current) return

        const editorTheme = EditorView.theme({
            '&': {
                height: '100%',
                backgroundColor: 'transparent',
            },
            '.cm-scroller': {
                overflow: 'auto',
                fontFamily: '"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
            },
        })

        const customKeymap = keymap.of([
            {
                key: 'Mod-b',
                run: (view) => toggleWrap(view, '**'),
            },
            {
                key: 'Mod-i',
                run: (view) => toggleWrap(view, '*'),
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
        ])

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const markdownText = update.state.doc.toString()
                onContentChangeRef.current?.(markdownText)
                if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
                saveTimerRef.current = setTimeout(() => {
                    onChangeRef.current(markdownText)
                }, 600)
            }
        })

        const state = EditorState.create({
            doc: initialContent,
            extensions: [
                history(),
                EditorView.lineWrapping,
                markdown({
                    base: markdownLanguage,
                    codeLanguages: resolveCodeLanguage,
                    extensions: [GFM, Table, TaskList, Strikethrough],
                }),
                syntaxHighlightExtension,
                syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
                notePathFacet.of(path),
                livePreview,
                customKeymap,
                editorTheme,
                updateListener,
            ],
        })

        const view = new EditorView({
            state,
            parent: containerRef.current,
        })
        viewRef.current = view

        // Handle image paste into editor
        async function onPaste(e: ClipboardEvent) {
            const items = e.clipboardData?.items
            if (!items) return
            for (let i = 0; i < items.length; i++) {
                const item = items[i]
                if (item.type.startsWith('image/')) {
                    e.preventDefault()
                    const file = item.getAsFile()
                    if (!file) continue
                    try {
                        const base64 = await fileToBase64(file)
                        const fileName = file.name || `image-${Date.now()}.png`
                        const relPath = await SaveAttachment(pathRef.current, fileName, base64)
                        const markdownImage = `![${fileName}](${encodeMarkdownPath(relPath)})\n`
                        view.dispatch(view.state.replaceSelection(markdownImage))
                    } catch (err) {
                        console.error('Failed to save pasted attachment:', err)
                    }
                    break
                }
            }
        }

        // Handle image drag & drop into editor. preventDefault() must run synchronously
        // (before any await) so the browser/CodeMirror default drop action never fires
        // once the image files are detected, instead of racing with the async save below.
        async function onDrop(e: DragEvent) {
            const files = e.dataTransfer?.files
            if (!files || files.length === 0) return
            const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
            if (imageFiles.length === 0) return
            e.preventDefault()
            for (const file of imageFiles) {
                try {
                    const base64 = await fileToBase64(file)
                    const relPath = await SaveAttachment(pathRef.current, file.name, base64)
                    const markdownImage = `![${file.name}](${encodeMarkdownPath(relPath)})\n`
                    view.dispatch(view.state.replaceSelection(markdownImage))
                } catch (err) {
                    console.error('Failed to save dropped attachment:', err)
                }
            }
        }

        function onEditorClick(e: MouseEvent) {
            if (e.ctrlKey || e.metaKey) {
                const target = (e.target as HTMLElement)?.closest?.('.cm-link') as HTMLElement | null
                const url = target?.getAttribute('data-url')
                if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                    e.preventDefault()
                    BrowserOpenURL(url)
                }
            }
        }

        const dom = view.dom
        dom.addEventListener('paste', onPaste)
        dom.addEventListener('drop', onDrop)
        dom.addEventListener('click', onEditorClick)

        return () => {
            dom.removeEventListener('paste', onPaste)
            dom.removeEventListener('drop', onDrop)
            dom.removeEventListener('click', onEditorClick)
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            view.destroy()
            viewRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path])

    return (
        <div
            className="flex h-full flex-col overflow-hidden"
            onContextMenu={(e) => {
                e.preventDefault()
                setContextMenuPos({x: e.clientX, y: e.clientY})
            }}
        >
            <div className="px-6 pt-3 pb-1 border-b border-neutral-200 dark:border-neutral-800/40">
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleTitleSubmit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            handleTitleSubmit()
                            e.currentTarget.blur()
                        }
                    }}
                    placeholder="Untitled"
                    className="w-full bg-transparent text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none"
                />
            </div>
            <div ref={containerRef} className="flex-1 overflow-hidden" />
            {contextMenuPos && (
                <EditorContextMenu
                    position={contextMenuPos}
                    view={viewRef.current}
                    onClose={() => setContextMenuPos(null)}
                />
            )}
        </div>
    )
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            // result is a data URL "data:<mime>;base64,<data>" — extract only the base64 portion.
            resolve(result.substring(result.indexOf(',') + 1))
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
}

// Percent-encodes each path segment (keeping "/" separators) so filenames containing
// spaces or other CommonMark-unsafe characters (e.g. "screen shot.png") still produce a
// valid Markdown image/link destination.
function encodeMarkdownPath(relPath: string): string {
    return relPath.split('/').map(encodeURIComponent).join('/')
}
