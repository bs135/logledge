import {useEffect, useRef, useState} from 'react'
import {Crepe} from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import {SaveAttachment} from '../../wailsjs/go/main/App'
import {EditorContextMenu} from './EditorContextMenu'

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

// Editor wraps Milkdown Crepe — an Obsidian-style WYSIWYG Live Preview editor,
// with out-of-the-box CommonMark+GFM support (tables, task lists, strikethrough),
// code block syntax highlighting (CodeMirror), and image paste/drag-and-drop into .attachments/.
export function Editor({path, initialContent, onContentChange, onChange, onRename}: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const crepeRef = useRef<Crepe | null>(null)
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
        let disposed = false

        const crepe = new Crepe({
            root: containerRef.current,
            defaultValue: initialContent,
            featureConfigs: {
                [Crepe.Feature.ImageBlock]: {
                    onUpload: async (file: File) => {
                        const base64 = await fileToBase64(file)
                        return await SaveAttachment(pathRef.current, file.name, base64)
                    },
                },
            },
        })

        crepe.create().then(() => {
            if (disposed) {
                crepe.destroy()
                return
            }
            crepe.on((listener) => {
                listener.markdownUpdated((_ctx, markdown) => {
                    onContentChangeRef.current?.(markdown)
                    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
                    saveTimerRef.current = setTimeout(() => onChangeRef.current(markdown), 600)
                })
            })
            crepeRef.current = crepe
        })

        return () => {
            disposed = true
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            crepeRef.current?.destroy()
            crepeRef.current = null
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
            <div className="px-6 pt-3 pb-1 border-b border-neutral-800/40 light:border-neutral-200">
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
                    className="w-full bg-transparent text-2xl font-bold tracking-tight text-neutral-100 placeholder-neutral-600 focus:outline-none light:text-neutral-900 light:placeholder-neutral-400"
                />
            </div>
            <div ref={containerRef} className="milkdown-container flex-1 overflow-y-auto" />
            {contextMenuPos && (
                <EditorContextMenu
                    position={contextMenuPos}
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
