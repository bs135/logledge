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

interface TitleBarProps {
    vaultPath: string | null
    selectedPath: string | null
    sidebarOpen: boolean
    onToggleSidebar: () => void
    onOpenQuickSwitcher: () => void
    onOpenSettings: () => void
    onOpenHelp: () => void
    onVaultSwitched?: (path: string) => void
}

export function TitleBar({
    vaultPath,
    selectedPath,
    sidebarOpen,
    onToggleSidebar,
    onOpenQuickSwitcher,
    onOpenSettings,
    onOpenHelp,
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
            if (chosen && chosen !== vaultPath) {
                await SwitchVault(chosen)
                onVaultSwitched?.(chosen)
            }
        } catch {
            // ignore
        }
    }

    return (
        <header
            className="flex h-9 w-full select-none items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300 light:border-neutral-200 light:bg-neutral-100 light:text-neutral-700"
            style={{['--wails-draggable' as string]: 'drag'}}
            onDoubleClick={() => WindowToggleMaximise()}
        >
            {/* Left section: Logo, Sidebar Toggle, Vault & Note info */}
            <div className="flex items-center gap-2" style={{['--wails-draggable' as string]: 'no-drag'}}>
                <img src="/icon.svg" alt="Logledge" className="h-4 w-4" />
                <span className="font-semibold text-neutral-100 light:text-neutral-900">Logledge</span>

                <button
                    onClick={onToggleSidebar}
                    title={sidebarOpen ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
                    className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 light:hover:bg-neutral-200 light:text-neutral-600"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                    >
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <path d="M9 3v18" />
                    </svg>
                </button>

                {vaultName && (
                    <div className="relative flex items-center gap-1.5 text-neutral-400" ref={dropdownRef}>
                        <span>/</span>
                        <button
                            onClick={() => setVaultDropdownOpen((o) => !o)}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-800 hover:text-neutral-200 text-neutral-300 light:text-neutral-700 light:hover:bg-neutral-200 transition-colors"
                            title={vaultPath ?? ''}
                        >
                            <span className="max-w-[140px] truncate font-medium">{vaultName}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 opacity-70">
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>

                        {/* Vault Switcher Dropdown */}
                        {vaultDropdownOpen && (
                            <div className="absolute top-7 left-3 z-50 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-2xl light:border-neutral-300 light:bg-white text-xs">
                                <div className="px-2 py-1 text-[11px] font-semibold text-neutral-400 light:text-neutral-500 uppercase tracking-wider">
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
                                                        ? 'bg-blue-600/30 text-blue-300 light:bg-blue-50 light:text-blue-700 font-medium'
                                                        : 'hover:bg-neutral-800 text-neutral-200 light:text-neutral-800 light:hover:bg-neutral-100'
                                                }`}
                                            >
                                                <div className="min-w-0 pr-2">
                                                    <div className="truncate font-medium">{v.name}</div>
                                                    <div className="truncate text-[10px] text-neutral-400 opacity-80" title={v.path}>
                                                        {v.path}
                                                    </div>
                                                </div>
                                                {isCurrent && <span className="text-blue-400 shrink-0">✓</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                                <div className="border-t border-neutral-800 pt-1 mt-1 light:border-neutral-200 flex flex-col gap-0.5">
                                    <button
                                        onClick={handleOpenNewVault}
                                        className="w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 light:text-neutral-700 light:hover:bg-neutral-100"
                                    >
                                        <span>+</span>
                                        <span>{t('addVault')}</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setVaultDropdownOpen(false)
                                            onOpenSettings()
                                        }}
                                        className="w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-left text-neutral-400 hover:bg-neutral-800 light:text-neutral-500 light:hover:bg-neutral-100"
                                    >
                                        <span>⚙</span>
                                        <span>{lang === 'vi' ? 'Quản lý Vault trong Cài đặt…' : 'Manage Vaults in Settings…'}</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {noteName && (
                            <>
                                <span>/</span>
                                <span className="max-w-[180px] truncate text-neutral-100 font-medium light:text-neutral-900" title={noteName}>
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
                    className="flex cursor-pointer items-center gap-2 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-1 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 light:border-neutral-300 light:bg-white light:text-neutral-600 transition-colors"
                    style={{['--wails-draggable' as string]: 'no-drag'}}
                    onClick={onOpenQuickSwitcher}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-3 w-3"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.3-4.3" />
                    </svg>
                    <span className="text-[11px]">{t('quickSwitcher')}</span>
                    <kbd className="rounded bg-neutral-800 px-1 py-0.2 text-[10px] text-neutral-400 light:bg-neutral-200 light:text-neutral-600">Ctrl+P</kbd>
                </div>
            )}

            {/* Right section: Help, Settings, Window Controls */}
            <div className="flex items-center" style={{['--wails-draggable' as string]: 'no-drag'}}>
                <button
                    onClick={onOpenHelp}
                    title="About & Shortcuts (?)"
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 light:hover:bg-neutral-200 light:text-neutral-600"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-3.5 w-3.5"
                    >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <path d="M12 17h.01" />
                    </svg>
                </button>
                <button
                    onClick={onOpenSettings}
                    title={t('settings')}
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 light:hover:bg-neutral-200 light:text-neutral-600"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-3.5 w-3.5"
                    >
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                </button>

                <div className="ml-1 h-4 w-px bg-neutral-800 light:bg-neutral-300" />

                {/* Window Control Buttons */}
                <button
                    onClick={() => WindowMinimise()}
                    title="Minimize"
                    className="flex h-9 w-10 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 light:hover:bg-neutral-200 light:text-neutral-600 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
                        <path d="M4 12h16v1.5H4z" />
                    </svg>
                </button>
                <button
                    onClick={() => WindowToggleMaximise()}
                    title={isMaximised ? 'Restore' : 'Maximize'}
                    className="flex h-9 w-10 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 light:hover:bg-neutral-200 light:text-neutral-600 transition-colors"
                >
                    {isMaximised ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                            <rect x="5" y="7" width="11" height="11" rx="1" />
                            <path d="M8 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                            <rect x="4" y="4" width="16" height="16" rx="1" />
                        </svg>
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
                    className="flex h-9 w-10 items-center justify-center text-neutral-400 hover:bg-red-600 hover:text-white transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </header>
    )
}

