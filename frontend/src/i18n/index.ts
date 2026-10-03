import React, {createContext, useContext, useState} from 'react'

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
