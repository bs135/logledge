import React, {createContext, useContext, useEffect, useState} from 'react'
import {GetAppSettings} from '../../wailsjs/go/main/App'

export type Language = 'en' | 'vi'

export const translations = {
    en: {
        appName: 'Logledge',
        selectVaultPrompt: 'Select a folder to use as a Vault',
        selectVaultBtn: 'Choose Vault Folder',
        loading: 'Loading…',
        explorer: 'EXPLORER',
        onlyNotes: 'Only Notes (.md)',
        allFiles: 'All Files',
        newNote: 'New Note',
        newFolder: 'New Folder',
        rename: 'Rename',
        delete: 'Delete',
        moveToTrashConfirm: 'Move to trash?',
        selectNotePlaceholder: 'Select a note from the sidebar to start reading or editing',
        untitledNote: 'Untitled',
        quickSwitcher: 'Quick Switcher...',
        searchPrompt: 'Search notes...',
        settings: 'Settings',
        generalTab: 'General',
        vaultsTab: 'Vaults',
        appearanceTab: 'Appearance',
        syncTab: 'Git Sync',
        aboutTab: 'About',
        theme: 'Theme',
        themeDark: 'Dark',
        themeLight: 'Light',
        themeSystem: 'System Default',
        language: 'Language',
        languageEn: 'English',
        languageVi: 'Tiếng Việt (Vietnamese)',
        vaultsSection: 'Vault Management',
        currentVault: 'Current Vault',
        switchVault: 'Switch Vault',
        addVault: 'Add / Open New Vault',
        editVault: 'Edit Vault',
        addVaultModalTitle: 'Add / Open New Vault',
        editVaultModalTitle: 'Edit Vault',
        vaultDisplayName: 'Display Name',
        vaultDisplayNamePlaceholder: 'Defaults to folder name if empty',
        vaultFolderPath: 'Folder Path',
        repoURL: 'Repository URL',
        repoURLPlaceholder: 'https://github.com/owner/repo.git or git@github.com:...',
        branch: 'Branch',
        authMethod: 'Authentication Method',
        authPAT: 'Personal Access Token (HTTPS)',
        authSSH: 'SSH Key (OS SSH)',
        authNone: 'None (No remote sync)',
        personalAccessToken: 'Personal Access Token',
        patStoredInKeychain: 'stored in OS Keychain',
        patPlaceholder: 'Enter to save or replace token…',
        patHint: 'Token is saved securely to OS Keychain and used for HTTPS vaults.',
        saveVault: 'Save Vault',
        noGitConfigured: 'No Git configured',
        syncNow: 'Sync Now',
        active: 'Active',
        removeVault: 'Remove from list',
        shortcuts: 'Keyboard Shortcuts',
        markdownTips: 'Markdown & Live Preview',
        externalUpdateNotice: 'This note was updated remotely (Git Sync / Disk). Do you want to reload or keep your current draft?',
        reloadBtn: 'Reload',
        keepDraftBtn: 'Keep Draft',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select All',
        undo: 'Undo',
        redo: 'Redo',
        save: 'Save',
        close: 'Close',
        cancel: 'Cancel',
        help: 'Help',
        aboutAndHelp: 'About Logledge & Quick Help',
        quickSwitcherPlaceholder: 'Type a note name…',
        noNotesFound: 'No notes found',
        searchVaultPlaceholder: 'Search full text in Vault…',
        noResultsFound: 'No results found',
        syncNotConfigured: 'Sync not configured',
        syncIdle: 'Synced',
        syncSyncing: 'Syncing…',
        syncConflict: 'Sync conflict',
        syncOffline: 'Offline',
        syncError: 'Sync error',
        syncClickToSync: 'Click to sync now',
        syncConfigure: 'Configure sync',
        aboutLogledgeDesc: 'Modern Markdown note-taking with native Git synchronization.',
        quickSwitcherDesc: 'Quick Switcher (find note)',
        globalSearchDesc: 'Global full-text search',
        toggleSidebarDesc: 'Toggle left sidebar',
        settingsSyncDesc: 'Open Settings & Sync',
        saveTitleDesc: 'Save inline note title',
        closeModalsDesc: 'Close modals & menus',
        resizeSidebar: 'Drag to resize sidebar (Double click to reset)',
    },
    vi: {
        appName: 'Logledge',
        selectVaultPrompt: 'Chọn một thư mục để làm kho ghi chú (Vault)',
        selectVaultBtn: 'Chọn thư mục Vault',
        loading: 'Đang tải…',
        explorer: 'CÂY THƯ MỤC',
        onlyNotes: 'Chỉ file ghi chú (.md)',
        allFiles: 'Tất cả file',
        newNote: 'Ghi chú mới',
        newFolder: 'Thư mục mới',
        rename: 'Đổi tên',
        delete: 'Xóa',
        moveToTrashConfirm: 'Chuyển vào thùng rác?',
        selectNotePlaceholder: 'Chọn một ghi chú bên thanh trái để bắt đầu đọc hoặc chỉnh sửa',
        untitledNote: 'Chưa đặt tiêu đề',
        quickSwitcher: 'Tìm nhanh ghi chú...',
        searchPrompt: 'Tìm kiếm nội dung ghi chú...',
        settings: 'Cài đặt',
        generalTab: 'Cài đặt chung',
        vaultsTab: 'Kho lưu trữ',
        appearanceTab: 'Giao diện',
        syncTab: 'Đồng bộ Git',
        aboutTab: 'Giới thiệu',
        theme: 'Giao diện hiển thị',
        themeDark: 'Giao diện tối (Dark)',
        themeLight: 'Giao diện sáng (Light)',
        themeSystem: 'Theo hệ thống (System)',
        language: 'Ngôn ngữ hiển thị',
        languageEn: 'English (Tiếng Anh)',
        languageVi: 'Tiếng Việt',
        vaultsSection: 'Quản lý kho ghi chú (Multi-Vault)',
        currentVault: 'Vault hiện tại',
        switchVault: 'Chuyển Vault',
        addVault: 'Mở thêm Vault mới',
        editVault: 'Chỉnh sửa Vault',
        addVaultModalTitle: 'Thêm / Mở Vault mới',
        editVaultModalTitle: 'Chỉnh sửa thông tin Vault',
        vaultDisplayName: 'Tên hiển thị',
        vaultDisplayNamePlaceholder: 'Mặc định là tên thư mục nếu để trống',
        vaultFolderPath: 'Thư mục trên đĩa',
        repoURL: 'Repository URL',
        repoURLPlaceholder: 'https://github.com/owner/repo.git hoặc git@github.com:...',
        branch: 'Nhánh (Branch)',
        authMethod: 'Phương thức xác thực',
        authPAT: 'Personal Access Token (HTTPS)',
        authSSH: 'SSH Key (SSH của hệ điều hành)',
        authNone: 'Không đồng bộ (None)',
        personalAccessToken: 'Personal Access Token',
        patStoredInKeychain: 'đã lưu trong OS Keychain',
        patPlaceholder: 'Nhập để lưu hoặc thay thế token…',
        patHint: 'Token được lưu an toàn trong OS Keychain và dùng chung cho các Vault dạng HTTPS.',
        saveVault: 'Lưu thông tin Vault',
        noGitConfigured: 'Chưa cấu hình Git',
        syncNow: 'Đồng bộ ngay',
        active: 'Đang mở',
        removeVault: 'Xóa khỏi danh sách',
        shortcuts: 'Phím tắt thông dụng',
        markdownTips: 'Soạn thảo & Xem trực tiếp Markdown',
        externalUpdateNotice: 'Ghi chú này đã được cập nhật từ xa (Git Sync / Disk). Bạn muốn tải lại hay giữ bản nháp hiện tại?',
        reloadBtn: 'Tải lại',
        keepDraftBtn: 'Giữ bản nháp',
        cut: 'Cắt (Cut)',
        copy: 'Sao chép (Copy)',
        paste: 'Dán (Paste)',
        selectAll: 'Chọn tất cả',
        undo: 'Hoàn tác (Undo)',
        redo: 'Làm lại (Redo)',
        save: 'Lưu',
        close: 'Đóng',
        cancel: 'Hủy',
        help: 'Trợ giúp',
        aboutAndHelp: 'Giới thiệu & Hướng dẫn nhanh',
        quickSwitcherPlaceholder: 'Gõ tên ghi chú…',
        noNotesFound: 'Không tìm thấy ghi chú nào',
        searchVaultPlaceholder: 'Tìm kiếm toàn văn trong Vault…',
        noResultsFound: 'Không tìm thấy kết quả nào',
        syncNotConfigured: 'Chưa cấu hình đồng bộ',
        syncIdle: 'Đã đồng bộ',
        syncSyncing: 'Đang đồng bộ…',
        syncConflict: 'Có xung đột',
        syncOffline: 'Mất kết nối',
        syncError: 'Lỗi đồng bộ',
        syncClickToSync: 'Bấm để đồng bộ ngay',
        syncConfigure: 'Cấu hình đồng bộ',
        aboutLogledgeDesc: 'Ghi chú Markdown hiện đại tích hợp đồng bộ Git hai chiều.',
        quickSwitcherDesc: 'Tìm nhanh ghi chú',
        globalSearchDesc: 'Tìm kiếm toàn văn trong Vault',
        toggleSidebarDesc: 'Ẩn / hiện thanh thư mục bên trái',
        settingsSyncDesc: 'Mở Cài đặt & Đồng bộ',
        saveTitleDesc: 'Lưu tiêu đề & đổi tên file',
        closeModalsDesc: 'Đóng hộp thoại & menu',
        resizeSidebar: 'Kéo để co giãn thanh bên (Nhấp đúp để đặt lại)',
    },
}

export type TranslationKey = keyof typeof translations.en

interface I18nContextType {
    lang: Language
    setLanguage: (lang: Language) => void
    t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextType>({
    lang: 'vi',
    setLanguage: () => {},
    t: (key: TranslationKey) => translations.vi[key] || key,
})

export function I18nProvider({children}: {children: React.ReactNode}) {
    const [lang, setLang] = useState<Language>(() => {
        const saved = localStorage.getItem('logledge:lang') as Language
        return saved === 'en' || saved === 'vi' ? saved : 'vi'
    })

    useEffect(() => {
        GetAppSettings().then((cfg) => {
            if (cfg?.language === 'en' || cfg?.language === 'vi') {
                setLang(cfg.language)
                localStorage.setItem('logledge:lang', cfg.language)
            }
        }).catch(() => {})
    }, [])

    const setLanguage = (newLang: Language) => {
        setLang(newLang)
        localStorage.setItem('logledge:lang', newLang)
    }

    const t = (key: TranslationKey): string => {
        return translations[lang]?.[key] || translations.en[key] || key
    }

    return React.createElement(
        I18nContext.Provider,
        {value: {lang, setLanguage, t}},
        children
    )
}

export function useI18n() {
    return useContext(I18nContext)
}
