import {useEffect, useState} from 'react'
import {Toaster} from 'sonner'

type ResolvedTheme = 'light' | 'dark'

function readTheme(): ResolvedTheme {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * App-wide toast host. Mounted once at the root so any module can call
 * `toast(...)` from `sonner`. Follows the `dark`/`light` class applied to
 * <html> by useTheme, and sits above the bottom status bar.
 */
export function AppToaster() {
    const [theme, setTheme] = useState<ResolvedTheme>(readTheme)

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(readTheme()))
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
        return () => observer.disconnect()
    }, [])

    return (
        <Toaster
            theme={theme}
            position="bottom-right"
            offset={{bottom: 40, right: 16}}
            closeButton
            toastOptions={{style: {fontFamily: 'inherit'}}}
        />
    )
}
