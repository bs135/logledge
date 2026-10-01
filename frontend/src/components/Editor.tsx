import {useEffect, useRef} from 'react'
import {Crepe} from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import {SaveAttachment} from '../../wailsjs/go/main/App'

interface EditorProps {
    /** Relative path (using "/") of the active note, used to compute relative image links. */
    path: string
    /** Initial Markdown content read from disk. */
    initialContent: string
    /** Called (internally debounced at 600ms) whenever content changes, for auto-save. */
    onChange: (markdown: string) => void
}

// Editor wraps Milkdown Crepe — an Obsidian-style WYSIWYG Live Preview editor,
// with out-of-the-box CommonMark+GFM support (tables, task lists, strikethrough),
// code block syntax highlighting (CodeMirror), and image paste/drag-and-drop into .attachments/.
export function Editor({path, initialContent, onChange}: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const crepeRef = useRef<Crepe | null>(null)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const pathRef = useRef(path)
    pathRef.current = path
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    return <div ref={containerRef} className="milkdown-container h-full overflow-y-auto" />
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
