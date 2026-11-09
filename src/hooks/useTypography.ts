import {useCallback, useEffect, useState} from 'react'
import {normalizeTypography, typographyCssVars, type Typography} from '../lib/typography'

const STORAGE_KEY = 'logledge:typography'

function load(): Typography {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return normalizeTypography(raw ? JSON.parse(raw) : null)
    } catch {
        return normalizeTypography(null)
    }
}

// useTypography holds the editor typography settings (app-wide, like the theme), applies
// them as CSS variables on <html> and persists them in localStorage.
export function useTypography() {
    const [typography, setTypographyState] = useState<Typography>(load)

    useEffect(() => {
        const style = document.documentElement.style
        for (const [name, value] of Object.entries(typographyCssVars(typography))) {
            style.setProperty(name, value)
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(typography))
        } catch {
            // Storage unavailable: settings apply for this session only.
        }
    }, [typography])

    const setTypography = useCallback((update: (t: Typography) => Typography) => {
        setTypographyState((t) => normalizeTypography(update(t)))
    }, [])

    return {typography, setTypography}
}
