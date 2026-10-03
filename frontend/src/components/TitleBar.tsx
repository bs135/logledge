import {useEffect, useRef, useState} from 'react'
import {
    Quit,
    WindowHide,
    WindowIsMaximised,
    WindowMinimise,
    WindowToggleMaximise,
} from '../../wailsjs/runtime/runtime'
import {GetVaultList, SelectVaultFolder, SwitchVault} from '../../wailsjs/go/main/App'
import {config} from '../../wailsjs/go/models'
import {useI18n} from '../i18n'
import type {ThemeMode} from '../hooks/useTheme'
import {
    PanelLeft,
    ChevronDown,
    Check,
    Plus,
    Settings,
    Search,
    Moon,
    Sun,
    SunMoon,
    HelpCircle,
    Minus,
    Square,
    Copy,
    X,
} from 'lucide-react'

interface TitleBarProps {
    vaultPath: string | null
    selectedPath: string | null
    sidebarOpen: boolean
    theme?: ThemeMode
    onToggleSidebar: () => void
    onOpenQuickSwitcher: () => void
    onOpenSettings: () => void
    onOpenHelp: () => void
    onToggleTheme?: () => void
    onVaultSwitched?: (path: string) => void
}

export function TitleBar({
    vaultPath,
    selectedPath,
    sidebarOpen,
    theme,
    onToggleSidebar,
    onOpenQuickSwitcher,
    onOpenSettings,
    onOpenHelp,
    onToggleTheme,
    onVaultSwitched,
}: TitleBarProps) {
    const {t, lang} = useI18n()
    const [isMaximised, setIsMaximised] = useState(false)
    const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false)
    const [vaults, setVaults] = useState<config.VaultEntry[]>([])
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let timer: ReturnType<typeof setInterval>
        async function checkMaximised() {
            try {
                const max = await WindowIsMaximised()
                setIsMaximised(max)
            } catch {
                // ignore
            }
        }
        checkMaximised()
        timer = setInterval(checkMaximised, 500)
        return () => clearInterval(timer)
    }, [])

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setVaultDropdownOpen(false)
            }
        }
        if (vaultDropdownOpen) {
            GetVaultList().then((list) => setVaults(list || []))
            window.addEventListener('mousedown', handleClickOutside)
            return () => window.removeEventListener('mousedown', handleClickOutside)
        }
    }, [vaultDropdownOpen])

    const vaultName = vaultPath ? vaultPath.split(/[/\\]/).filter(Boolean).pop() : null
    const noteName = selectedPath ? selectedPath.split('/').pop()?.replace(/\.md$/, '') : null

    async function handleSwitch(targetPath: string) {
        setVaultDropdownOpen(false)
        if (targetPath === vaultPath) return
        try {
            await SwitchVault(targetPath)
            onVaultSwitched?.(targetPath)
        } catch {
            // ignore
        }
    }

    async function handleOpenNewVault() {
        setVaultDropdownOpen(false)
        try {
            const chosen = await SelectVaultFolder()
            if (chosen) {
                onVaultSwitched?.(chosen)
            }
        } catch {
            // ignore
        }
    }

    return (
        <header
            className="flex h-9 w-full select-none items-center justify-between border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-2 text-xs text-neutral-700 dark:text-neutral-300"
            style={{['--wails-draggable' as string]: 'drag'}}
            onDoubleClick={() => WindowToggleMaximise()}
        >
            {/* Left section: Logo, Sidebar Toggle, Vault & Note info */}
            <div className="flex items-center gap-2" style={{['--wails-draggable' as string]: 'no-drag'}}>
                <img src="/icon.svg" alt="Logledge" className="h-4 w-4" />
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">Logledge</span>

                <button
                    onClick={onToggleSidebar}
                    title={sidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
                    className="flex h-6 w-6 items-center justify-center rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                >
                    <PanelLeft className="h-4 w-4" />
                </button>

                {vaultName && (
                    <div className="relative flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500" ref={dropdownRef}>
                        <span>/</span>
                        <button
                            onClick={() => setVaultDropdownOpen((o) => !o)}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                            title={vaultPath ?? ''}
                        >
                            <span className="max-w-[140px] truncate font-medium">{vaultName}</span>
                            <ChevronDown className="h-3 w-3 opacity-70" />
                        </button>

                        {/* Vault Switcher Dropdown */}
                        {vaultDropdownOpen && (
                            <div className="absolute top-7 left-3 z-50 w-64 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1.5 shadow-2xl text-xs">
                                <div className="px-2 py-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                                    {t('vaultsSection')}
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-0.5 my-1">
                                    {vaults.map((v) => {
                                        const isCurrent = v.path === vaultPath
                                        return (
                                            <button
                                                key={v.path}
                                                onClick={() => handleSwitch(v.path)}
                                                className={`w-full flex items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${
                                                    isCurrent
                                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-600/30 dark:text-blue-300 font-medium'
                                                        : 'text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                                                }`}
                                            >
                                                <div className="min-w-0 pr-2">
                                                    <div className="truncate font-medium">{v.name}</div>
                                                    <div className="truncate text-[10px] text-neutral-400 dark:text-neutral-500 opacity-80" title={v.path}>
                                                        {v.path}
                                                    </div>
                                                </div>
                                                {isCurrent && <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                                            </button>
                                        )
                                    })}
                                </div>
                                <div className="border-t border-neutral-200 dark:border-neutral-800 pt-1 mt-1 flex flex-col gap-0.5">
                                    <button
                                        onClick={handleOpenNewVault}
                                        className="w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                                    >
                                        <Plus className="h-3.5 w-3.5 text-neutral-500" />
                                        <span>{t('addVault')}</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setVaultDropdownOpen(false)
                                            onOpenSettings()
                                        }}
                                        className="w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                                    >
                                        <Settings className="h-3.5 w-3.5 text-neutral-500" />
                                        <span>{lang === 'vi' ? 'Quản lý Vault trong Cài đặt…' : 'Manage Vaults in Settings…'}</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {noteName && (
                            <>
                                <span>/</span>
                                <span className="max-w-[180px] truncate text-neutral-900 dark:text-neutral-100 font-medium" title={noteName}>
                                    {noteName}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Center section: Quick Search Bar trigger */}
            {vaultPath && (
                <div
                    className="flex cursor-pointer items-center gap-2 rounded border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950/60 px-3 py-1 text-neutral-600 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
                    style={{['--wails-draggable' as string]: 'no-drag'}}
                    onClick={onOpenQuickSwitcher}
                >
                    <Search className="h-3.5 w-3.5" />
                    <span className="text-[11px]">{t('quickSwitcher')}</span>
                    <kbd className="rounded bg-neutral-200 dark:bg-neutral-800 px-1 py-0.2 text-[10px] text-neutral-600 dark:text-neutral-400">Ctrl+P</kbd>
                </div>
            )}

            {/* Right section: Theme Switcher, Help, Settings, Window Controls */}
            <div className="flex items-center" style={{['--wails-draggable' as string]: 'no-drag'}}>
                {onToggleTheme && (
                    <button
                        onClick={onToggleTheme}
                        title={
                            theme === 'dark'
                                ? (lang === 'vi' ? 'Giao diện: Tối (Bấm để đổi sang Sáng)' : 'Theme: Dark (Click for Light)')
                                : theme === 'light'
                                ? (lang === 'vi' ? 'Giao diện: Sáng (Bấm để đổi sang Hệ thống)' : 'Theme: Light (Click for System)')
                                : (lang === 'vi' ? 'Giao diện: Hệ thống (Bấm để đổi sang Tối)' : 'Theme: System (Click for Dark)')
                        }
                        className="flex h-7 w-7 items-center justify-center rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                    >
                        {theme === 'dark' ? (
                            <Moon className="h-4 w-4" />
                        ) : theme === 'light' ? (
                            <Sun className="h-4 w-4" />
                        ) : (
                            <SunMoon className="h-4 w-4" />
                        )}
                    </button>
                )}

                <button
                    onClick={onOpenSettings}
                    title={t('settings')}
                    className="flex h-7 w-7 items-center justify-center rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                >
                    <Settings className="h-4 w-4" />
                </button>
                <button
                    onClick={onOpenHelp}
                    title="Help"
                    className="flex h-7 w-7 items-center justify-center rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                >
                    <HelpCircle className="h-4 w-4" />
                </button>

                <div className="ml-1 h-4 w-px bg-neutral-300 dark:bg-neutral-800" />

                {/* Window Control Buttons */}
                <button
                    onClick={() => WindowMinimise()}
                    title="Minimize"
                    className="flex h-9 w-10 items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >
                    <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={() => WindowToggleMaximise()}
                    title={isMaximised ? 'Restore' : 'Maximize'}
                    className="flex h-9 w-10 items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >
                    {isMaximised ? (
                        <Copy className="h-3 w-3 rotate-180" />
                    ) : (
                        <Square className="h-3 w-3" />
                    )}
                </button>
                <button
                    onClick={(e) => {
                        if (e.ctrlKey || e.shiftKey) {
                            Quit()
                        } else {
                            WindowHide()
                        }
                    }}
                    title={lang === 'vi' ? 'Thu nhỏ xuống khay hệ thống (Giữ Ctrl để Thoát)' : 'Hide to system tray (Hold Ctrl to Quit)'}
                    className="flex h-9 w-10 items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-red-600 hover:text-white transition-colors"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </header>
    )
}

