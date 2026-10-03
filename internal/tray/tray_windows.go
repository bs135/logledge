//go:build windows

package tray

import (
	"context"
	"runtime"
	"syscall"
	"unsafe"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

type Syncer interface {
	SyncNow() error
}

var (
	modKernel32         = syscall.NewLazyDLL("kernel32.dll")
	procGetModuleHandle = modKernel32.NewProc("GetModuleHandleW")

	modUser32               = syscall.NewLazyDLL("user32.dll")
	procRegisterClassExW    = modUser32.NewProc("RegisterClassExW")
	procCreateWindowExW     = modUser32.NewProc("CreateWindowExW")
	procDefWindowProcW      = modUser32.NewProc("DefWindowProcW")
	procDestroyWindow       = modUser32.NewProc("DestroyWindow")
	procPostQuitMessage     = modUser32.NewProc("PostQuitMessage")
	procGetMessageW         = modUser32.NewProc("GetMessageW")
	procTranslateMessage    = modUser32.NewProc("TranslateMessage")
	procDispatchMessageW    = modUser32.NewProc("DispatchMessageW")
	procPostMessageW        = modUser32.NewProc("PostMessageW")
	procLoadIconW           = modUser32.NewProc("LoadIconW")
	procCreatePopupMenu     = modUser32.NewProc("CreatePopupMenu")
	procAppendMenuW         = modUser32.NewProc("AppendMenuW")
	procTrackPopupMenu      = modUser32.NewProc("TrackPopupMenu")
	procDestroyMenu         = modUser32.NewProc("DestroyMenu")
	procGetCursorPos        = modUser32.NewProc("GetCursorPos")
	procSetForegroundWindow = modUser32.NewProc("SetForegroundWindow")

	modShell32          = syscall.NewLazyDLL("shell32.dll")
	procShellNotifyIconW = modShell32.NewProc("Shell_NotifyIconW")
)

const (
	wmUser            = 0x0400
	wmTray            = wmUser + 101
	wmCommand         = 0x0111
	wmDestroy         = 0x0002
	wmLButtonUp       = 0x0202
	wmLButtonDblClk   = 0x0203
	wmRButtonUp       = 0x0205
	wmNull            = 0x0000

	nimAdd    = 0x00000000
	nimDelete = 0x00000002

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	mfString    = 0x00000000
	mfSeparator = 0x00000800

	tpmBottomAlign = 0x0020
	tpmRightAlign  = 0x0008

	idShow = 1001
	idSync = 1002
	idQuit = 1003
)

type point struct {
	x, y int32
}

type msg struct {
	hwnd    windows.HWND
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     windows.Handle
	hIcon         windows.Handle
	hCursor       windows.Handle
	hbrBackground windows.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       windows.Handle
}

type notifyIconDataW struct {
	cbSize            uint32
	hWnd              windows.HWND
	uID               uint32
	uFlags            uint32
	uCallbackMessage  uint32
	hIcon             windows.Handle
	szTip             [128]uint16
	dwState           uint32
	dwStateMask       uint32
	szInfo            [256]uint16
	uTimeoutOrVersion uint32
	szInfoTitle       [64]uint16
	dwInfoFlags       uint32
	guidItem          windows.GUID
	hBalloonIcon      windows.Handle
}

// Start registers and displays a system tray icon with a popup menu.
// Returns a cleanup function that removes the tray icon upon application shutdown.
func Start(ctx context.Context, s Syncer) func() {
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})

	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(doneCh)

		hInstanceRet, _, _ := procGetModuleHandle.Call(0)
		hInstance := windows.Handle(hInstanceRet)

		className, _ := windows.UTF16PtrFromString("LogledgeTrayWindow")
		windowTitle, _ := windows.UTF16PtrFromString("Logledge Tray")

		// Try loading app icon from resource 1; fallback to standard application icon (32512)
		hIconRet, _, _ := procLoadIconW.Call(uintptr(hInstance), 1)
		if hIconRet == 0 {
			hIconRet, _, _ = procLoadIconW.Call(0, 32512)
		}
		hIcon := windows.Handle(hIconRet)

		var hwnd windows.HWND
		var nid notifyIconDataW

		wndProc := syscall.NewCallback(func(h windows.HWND, message uint32, wParam, lParam uintptr) uintptr {
			switch message {
			case wmTray:
				switch lParam {
				case wmLButtonUp, wmLButtonDblClk:
					wailsRuntime.WindowShow(ctx)
					wailsRuntime.WindowUnminimise(ctx)
					return 0
				case wmRButtonUp:
					hMenuRet, _, _ := procCreatePopupMenu.Call()
					hMenu := windows.Handle(hMenuRet)
					if hMenu == 0 {
						return 0
					}
					defer procDestroyMenu.Call(uintptr(hMenu))

					showLabel, _ := windows.UTF16PtrFromString("Hiển thị Logledge / Show Logledge")
					syncLabel, _ := windows.UTF16PtrFromString("Đồng bộ ngay / Sync Now")
					quitLabel, _ := windows.UTF16PtrFromString("Thoát / Quit")

					procAppendMenuW.Call(uintptr(hMenu), mfString, uintptr(idShow), uintptr(unsafe.Pointer(showLabel)))
					procAppendMenuW.Call(uintptr(hMenu), mfString, uintptr(idSync), uintptr(unsafe.Pointer(syncLabel)))
					procAppendMenuW.Call(uintptr(hMenu), mfSeparator, 0, 0)
					procAppendMenuW.Call(uintptr(hMenu), mfString, uintptr(idQuit), uintptr(unsafe.Pointer(quitLabel)))

					var pt point
					procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
					procSetForegroundWindow.Call(uintptr(h))
					procTrackPopupMenu.Call(
						uintptr(hMenu),
						tpmRightAlign|tpmBottomAlign,
						uintptr(pt.x),
						uintptr(pt.y),
						0,
						uintptr(h),
						0,
					)
					procPostMessageW.Call(uintptr(h), wmNull, 0, 0)
					return 0
				}
			case wmCommand:
				cmdID := int(wParam & 0xFFFF)
				switch cmdID {
				case idShow:
					wailsRuntime.WindowShow(ctx)
					wailsRuntime.WindowUnminimise(ctx)
					return 0
				case idSync:
					if s != nil {
						go s.SyncNow()
					}
					return 0
				case idQuit:
					wailsRuntime.Quit(ctx)
					return 0
				}
			case wmDestroy:
				procPostQuitMessage.Call(0)
				return 0
			}
			ret, _, _ := procDefWindowProcW.Call(uintptr(h), uintptr(message), wParam, lParam)
			return ret
		})

		wcls := wndClassExW{
			cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
			lpfnWndProc:   wndProc,
			hInstance:     hInstance,
			lpszClassName: className,
			hIcon:         hIcon,
		}
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wcls)))

		hwndRet, _, _ := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(windowTitle)),
			0,
			0, 0, 0, 0,
			0, 0,
			uintptr(hInstance),
			0,
		)
		hwnd = windows.HWND(hwndRet)
		if hwnd == 0 {
			return
		}

		nid = notifyIconDataW{
			cbSize:           uint32(unsafe.Sizeof(notifyIconDataW{})),
			hWnd:             hwnd,
			uID:              1,
			uFlags:           nifMessage | nifIcon | nifTip,
			uCallbackMessage: wmTray,
			hIcon:            hIcon,
		}
		tipChars, _ := windows.UTF16FromString("Logledge")
		copy(nid.szTip[:], tipChars)

		procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))

		// Watch for stopCh to destroy window
		go func() {
			<-stopCh
			procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
			procPostMessageW.Call(uintptr(hwnd), wmDestroy, 0, 0)
		}()

		var m msg
		for {
			ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if ret == 0 || int32(ret) == -1 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()

	return func() {
		select {
		case <-stopCh:
		default:
			close(stopCh)
			<-doneCh
		}
	}
}
