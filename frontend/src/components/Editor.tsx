import {useEffect, useRef} from 'react'
import {Crepe} from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import {SaveAttachment} from '../../wailsjs/go/main/App'

interface EditorProps {
    /** Đường dẫn tương đối (dùng "/") của note đang mở, dùng để tính link ảnh tương đối. */
    path: string
    /** Nội dung Markdown ban đầu đọc từ đĩa. */
    initialContent: string
    /** Gọi (debounced 600ms bên trong) mỗi khi nội dung thay đổi, để auto-save. */
    onChange: (markdown: string) => void
}

// Editor bọc Milkdown Crepe — trình soạn thảo WYSIWYG Live Preview kiểu
// Obsidian, hỗ trợ sẵn CommonMark+GFM (bảng, task list, strikethrough),
// syntax highlight code block (CodeMirror) và dán/kéo-thả ảnh vào .attachments/.
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
            // result là data URL "data:<mime>;base64,<data>" — chỉ lấy phần base64.
            resolve(result.substring(result.indexOf(',') + 1))
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
}
