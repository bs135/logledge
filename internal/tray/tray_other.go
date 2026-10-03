//go:build !windows

package tray

import (
	"context"
)

type Syncer interface {
	SyncNow() error
}

type LangProvider interface {
	GetLanguage() string
}

func Start(ctx context.Context, s Syncer) func() {
	return func() {}
}
