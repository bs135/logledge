//go:build !windows

package tray

import (
	"context"
)

type Syncer interface {
	SyncNow() error
}

func Start(ctx context.Context, s Syncer) func() {
	return func() {}
}
