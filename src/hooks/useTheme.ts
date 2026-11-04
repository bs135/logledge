import {useEffect, useState} from 'react'
import {getCurrentWindow, type Theme} from '@tauri-apps/api/window'
import {getAppSettings, saveAppSettings} from '../lib/api'

export type ThemeMode = 'dark' | 'light' | 'system'

/** Sets the native window theme (title bar, scrollbars); null follows the OS. */
function setNativeTheme(theme: Theme | null) {
    try {
        getCurrentWindow().setTheme(theme).catch(() => {})
    } catch {
        // not running inside Tauri (browser preview)
    }
}

export function useTheme() {
    const [theme, setThemeState] = useState<ThemeMode>(() => {
        const saved = localStorage.getItem('logledge:theme') as ThemeMode
        return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'dark'
    })

    function applyTheme(mode: ThemeMode) {
        let isDark = true
        if (mode === 'dark') {
            isDark = true
            setNativeTheme('dark')
        } else if (mode === 'light') {
            isDark = false
            setNativeTheme('light')
        } else {
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
            setNativeTheme(null)
        }

        const root = document.documentElement
        if (isDark) {
            root.classList.add('dark')
            root.classList.remove('light')
        } else {
            root.classList.add('light')
            root.classList.remove('dark')
        }
    }

    const setTheme = (mode: ThemeMode) => {
        setThemeState(mode)
        localStorage.setItem('logledge:theme', mode)
        applyTheme(mode)
        const lang = localStorage.getItem('logledge:lang') || 'vi'
        saveAppSettings(mode, lang).catch(() => {})
    }

    // Initialize from backend settings or localStorage
    useEffect(() => {
        applyTheme(theme)

        getAppSettings()
            .then((cfg) => {
                if (cfg?.theme && (cfg.theme === 'dark' || cfg.theme === 'light' || cfg.theme === 'system')) {
                    setThemeState(cfg.theme as ThemeMode)
                    localStorage.setItem('logledge:theme', cfg.theme)
                    applyTheme(cfg.theme as ThemeMode)
                }
            })
            .catch(() => {})

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        const handleChange = () => {
            const current = localStorage.getItem('logledge:theme') as ThemeMode
            if (current === 'system') {
                applyTheme('system')
            }
        }
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [])

    return {theme, setTheme}
}
