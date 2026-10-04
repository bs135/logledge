package main

import (
	"context"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestOnSecondInstanceLaunchNilContext(t *testing.T) {
	app := NewApp()
	showCalled := false
	unminimiseCalled := false
	origShow := windowShowFunc
	origUnminimise := windowUnminimiseFunc
	defer func() {
		windowShowFunc = origShow
		windowUnminimiseFunc = origUnminimise
	}()
	windowShowFunc = func(ctx context.Context) { showCalled = true }
	windowUnminimiseFunc = func(ctx context.Context) { unminimiseCalled = true }

	// When ctx is nil and times out waiting, it should not call show/unminimise and not panic.
	app.onSecondInstanceLaunch(options.SecondInstanceData{
		Args:             []string{"--test"},
		WorkingDirectory: "C:\\",
	})

	if showCalled || unminimiseCalled {
		t.Error("expected WindowShow and WindowUnminimise not to be called when ctx is nil")
	}
}

func TestOnSecondInstanceLaunchWithContext(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	showCalled := false
	unminimiseCalled := false
	origShow := windowShowFunc
	origUnminimise := windowUnminimiseFunc
	defer func() {
		windowShowFunc = origShow
		windowUnminimiseFunc = origUnminimise
	}()
	windowShowFunc = func(ctx context.Context) { showCalled = true }
	windowUnminimiseFunc = func(ctx context.Context) { unminimiseCalled = true }

	app.onSecondInstanceLaunch(options.SecondInstanceData{
		Args:             []string{},
		WorkingDirectory: "C:\\",
	})

	if !showCalled {
		t.Error("expected WindowShow to be called")
	}
	if !unminimiseCalled {
		t.Error("expected WindowUnminimise to be called")
	}
}


