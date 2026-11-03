// TEMPORARY (Tauri migration Phase 1–3): lets the unchanged Wails-based UI boot
// inside Tauri. The generated wailsjs/ bindings call window.runtime.* and
// window.go.main.App.*, which only the Wails webview injects. This shim maps
// the runtime calls the UI uses onto Tauri APIs and makes every backend call
// reject until the Rust commands exist. Removed in Phase 4 together with wailsjs/.
import {listen} from '@tauri-apps/api/event'
import {getCurrentWindow} from '@tauri-apps/api/window'
import {openUrl} from '@tauri-apps/plugin-opener'

type AnyFn = (...args: any[]) => any

const isTauri = '__TAURI_INTERNALS__' in window

function currentWindow() {
    return isTauri ? getCurrentWindow() : null
}

const runtime: Record<string, AnyFn> = {
    LogPrint: (m: string) => console.log(m),
    LogTrace: (m: string) => console.debug(m),
    LogDebug: (m: string) => console.debug(m),
    LogInfo: (m: string) => console.info(m),
    LogWarning: (m: string) => console.warn(m),
    LogError: (m: string) => console.error(m),
    LogFatal: (m: string) => console.error(m),

    EventsOnMultiple: (name: string, callback: AnyFn) => {
        if (!isTauri) {
            return () => {}
        }
        const unlisten = listen(name, (event) => callback(event.payload))
        return () => {
            unlisten.then((off) => off())
        }
    },
    EventsOff: () => {},
    EventsOffAll: () => {},

    WindowMinimise: () => currentWindow()?.minimize(),
    WindowToggleMaximise: () => currentWindow()?.toggleMaximize(),
    WindowIsMaximised: async () => (await currentWindow()?.isMaximized()) ?? false,
    WindowShow: () => currentWindow()?.show(),
    WindowUnminimise: () => currentWindow()?.unminimize(),
    // There is no tray yet (Phase 3), so hiding would leave no way back to the
    // window: minimize instead.
    WindowHide: () => currentWindow()?.minimize(),
    Quit: () => currentWindow()?.close(),

    WindowSetDarkTheme: () => currentWindow()?.setTheme('dark'),
    WindowSetLightTheme: () => currentWindow()?.setTheme('light'),
    WindowSetSystemDefaultTheme: () => currentWindow()?.setTheme(null),

    BrowserOpenURL: (url: string) => {
        if (isTauri) {
            openUrl(url)
        } else {
            window.open(url, '_blank', 'noopener')
        }
    },
    ClipboardSetText: async (text: string) => {
        await navigator.clipboard.writeText(text)
        return true
    },
}

// Any runtime function not mapped above is a no-op.
const runtimeProxy = new Proxy(runtime, {
    get: (target, prop: string) => target[prop] ?? (() => {}),
})

// Every bound Go method rejects until its Rust command is implemented (Phase 2).
const appProxy = new Proxy(
    {},
    {
        get: (_target, method: string) => () =>
            Promise.reject(`${method}: backend not available yet (Tauri migration in progress)`),
    },
)

export function installWailsShim(): void {
    const w = window as any
    if (w.go || w.runtime) {
        return // running inside Wails: keep the real bindings
    }
    w.runtime = runtimeProxy
    w.go = {main: {App: appProxy}}
}
