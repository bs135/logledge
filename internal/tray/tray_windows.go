//go:build windows

package tray

import (
	"context"
	_ "embed"
	"encoding/binary"
	"runtime"
	"syscall"
	"unsafe"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"

	"logledge/internal/config"
)

//go:embed icon.ico
var embeddedIcon []byte

type Syncer interface {
	SyncNow() error
}

type LangProvider interface {
	GetLanguage() string
}

func getMenuLabels(lang string) (show, sync, quit string) {
	if lang == "en" {
		return "Open Logledge", "Sync Now", "Quit"
	}
	return "Mở Logledge", "Đồng bộ ngay", "Thoát"
}

var (
	modKernel32         = syscall.NewLazyDLL("kernel32.dll")
	procGetModuleHandle = modKernel32.NewProc("GetModuleHandleW")

	modUser32                   = syscall.NewLazyDLL("user32.dll")
	procRegisterClassExW        = modUser32.NewProc("RegisterClassExW")
	procCreateWindowExW         = modUser32.NewProc("CreateWindowExW")
	procDefWindowProcW          = modUser32.NewProc("DefWindowProcW")
	procDestroyWindow           = modUser32.NewProc("DestroyWindow")
	procPostQuitMessage         = modUser32.NewProc("PostQuitMessage")
	procGetMessageW             = modUser32.NewProc("GetMessageW")
	procTranslateMessage        = modUser32.NewProc("TranslateMessage")
	procDispatchMessageW        = modUser32.NewProc("DispatchMessageW")
	procPostMessageW            = modUser32.NewProc("PostMessageW")
	procLoadIconW               = modUser32.NewProc("LoadIconW")
	procCreatePopupMenu         = modUser32.NewProc("CreatePopupMenu")
	procAppendMenuW             = modUser32.NewProc("AppendMenuW")
	procTrackPopupMenu          = modUser32.NewProc("TrackPopupMenu")
	procDestroyMenu             = modUser32.NewProc("DestroyMenu")
	procGetCursorPos            = modUser32.NewProc("GetCursorPos")
	procSetForegroundWindow     = modUser32.NewProc("SetForegroundWindow")
	procGetSystemMetrics        = modUser32.NewProc("GetSystemMetrics")
	procCreateIconFromResourceEx = modUser32.NewProc("CreateIconFromResourceEx")
	procDestroyIcon             = modUser32.NewProc("DestroyIcon")

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

		hIcon := loadTrayIcon(hInstance)

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

					lang := "vi"
					if lp, ok := s.(LangProvider); ok {
						if l := lp.GetLanguage(); l != "" {
							lang = l
						}
					} else if cfg, err := config.Load(); err == nil && cfg.Language != "" {
						lang = cfg.Language
					}

					showText, syncText, quitText := getMenuLabels(lang)
					showLabel, _ := windows.UTF16PtrFromString(showText)
					syncLabel, _ := windows.UTF16PtrFromString(syncText)
					quitLabel, _ := windows.UTF16PtrFromString(quitText)

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
			if hIcon != 0 {
				procDestroyIcon.Call(uintptr(hIcon))
			}
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

// loadTrayIcon attempts to load the app icon from embedded icon.ico data at the optimal
// system icon size (SM_CXSMICON / SM_CYSMICON), falling back to PE resources or IDI_APPLICATION.
func loadTrayIcon(hInstance windows.Handle) windows.Handle {
	if len(embeddedIcon) >= 6 && binary.LittleEndian.Uint16(embeddedIcon[0:2]) == 0 && binary.LittleEndian.Uint16(embeddedIcon[2:4]) == 1 {
		count := int(binary.LittleEndian.Uint16(embeddedIcon[4:6]))
		if len(embeddedIcon) >= 6+count*16 {
			cxRet, _, _ := procGetSystemMetrics.Call(49) // SM_CXSMICON
			cyRet, _, _ := procGetSystemMetrics.Call(50) // SM_CYSMICON
			cx := int(cxRet)
			cy := int(cyRet)
			if cx <= 0 {
				cx = 16
			}
			if cy <= 0 {
				cy = 16
			}

			bestIdx := -1
			bestDiff := 999999
			for i := 0; i < count; i++ {
				offset := 6 + i*16
				w := int(embeddedIcon[offset])
				if w == 0 {
					w = 256
				}
				h := int(embeddedIcon[offset+1])
				if h == 0 {
					h = 256
				}
				diff := (w - cx)*(w - cx) + (h - cy)*(h - cy)
				if diff < bestDiff {
					bestDiff = diff
					bestIdx = i
				}
			}

			if bestIdx >= 0 {
				offset := 6 + bestIdx*16
				imgBytes := binary.LittleEndian.Uint32(embeddedIcon[offset+8 : offset+12])
				imgOffset := binary.LittleEndian.Uint32(embeddedIcon[offset+12 : offset+16])
				if int(imgOffset+imgBytes) <= len(embeddedIcon) {
					hIconRet, _, _ := procCreateIconFromResourceEx.Call(
						uintptr(unsafe.Pointer(&embeddedIcon[imgOffset])),
						uintptr(imgBytes),
						1,          // fIcon = TRUE
						0x00030000, // dwVersion
						uintptr(cx),
						uintptr(cy),
						0, // LR_DEFAULTCOLOR
					)
					if hIconRet != 0 {
						return windows.Handle(hIconRet)
					}
				}
			}
		}
	}

	// Fallback to PE resource 1
	if hInstance != 0 {
		hIconRet, _, _ := procLoadIconW.Call(uintptr(hInstance), 1)
		if hIconRet != 0 {
			return windows.Handle(hIconRet)
		}
	}

	// Fallback to IDI_APPLICATION
	hIconRet, _, _ := procLoadIconW.Call(0, 32512)
	return windows.Handle(hIconRet)
}
