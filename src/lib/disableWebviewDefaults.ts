/**
 * Disables browser-like WebView defaults that hurt desktop-app UX:
 * - The native context menu (Back, Forward, Reload, Save as, Inspect...).
 *   Only the default action is cancelled, so the app's own onContextMenu
 *   handlers still open their menus.
 * - Reload shortcuts (F5, Ctrl/Cmd+R, Ctrl/Cmd+Shift+R), which would reset
 *   the app state, including unsaved editor content.
 */
export function disableWebviewDefaults(): void {
    window.addEventListener('contextmenu', (e) => e.preventDefault(), {capture: true})

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase()
        if (key === 'f5' || ((e.ctrlKey || e.metaKey) && key === 'r')) {
            e.preventDefault()
        }
    })
}
