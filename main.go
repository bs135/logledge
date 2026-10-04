package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func getWebviewUserDataPath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		cfgDir, err := os.UserConfigDir()
		if err == nil {
			appData = cfgDir
		}
	}
	if appData != "" {
		return filepath.Join(appData, "Logledge", "webview2")
	}
	return ""
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:             "Logledge",
		Width:             1024,
		Height:            768,
		Frameless:         true,
		HideWindowOnClose: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "logledge-app-single-instance-lock",
			OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
		},
		EnableDefaultContextMenu: false,
		Windows: &windows.Options{
			WebviewUserDataPath:               getWebviewUserDataPath(),
			DisableFramelessWindowDecorations: false,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
