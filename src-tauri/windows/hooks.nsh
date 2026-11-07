; NSIS hooks for the Tauri installer (bundle.windows.nsis.installerHooks).
;
; Logledge up to 0.5.0 was built with Wails, whose installer put the app in
; Program Files and registered it under a different uninstall key. Without
; this hook an upgrade would leave two copies (and two Start menu entries).
; The old uninstaller only removes its program files, shortcuts and WebView2
; cache; config.json and the keychain PAT are kept.

!include FileFunc.nsh

!define WAILS_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LogledgeLogledge"

; Runs the Wails uninstaller registered under ROOT (HKLM or HKCU), if any.
!macro REMOVE_WAILS_BUILD ROOT
  ReadRegStr $R0 ${ROOT} "${WAILS_UNINST_KEY}" "UninstallString"
  ${If} $R0 != ""
    ; UninstallString is quoted: "C:\...\uninstall.exe"
    StrCpy $R0 $R0 "" 1
    StrCpy $R0 $R0 -1
    ${GetParent} $R0 $R1
    ${If} ${FileExists} $R0
      DetailPrint "Removing the previous Logledge (Wails) installation..."
      ; ShellExecute so Windows can show the UAC prompt the old admin-level
      ; uninstaller needs. _?= runs it in place so the wait is real.
      ExecShellWait "open" "$R0" "/S _?=$R1"
      Delete "$R0"
      RMDir "$R1"
      ${GetParent} $R1 $R1
      RMDir "$R1"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  SetRegView 64
  !insertmacro REMOVE_WAILS_BUILD HKLM
  !insertmacro REMOVE_WAILS_BUILD HKCU
!macroend

; "Launch at startup" (src-tauri/src/autostart.rs) writes a per-user Run
; value. Remove it on a real uninstall so Windows doesn't try to start a
; missing exe at login; an upgrade (/UPDATE) keeps it.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Logledge"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Logledge"
  ${EndIf}
!macroend
