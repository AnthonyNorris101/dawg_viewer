package services

import (
	"net/http"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"

	"dawg_viewer/internal/maptiles"
)

func NewMapTiles(live *LiveService) *maptiles.Server {
	return &maptiles.Server{
		UserAgent: "DawgViewer/" + Version + " (FSAE telemetry viewer)",
		Dir: func() string {
			live.mu.Lock()
			defer live.mu.Unlock()
			if live.dir.Path == "" {
				return ""
			}
			return filepath.Join(live.dir.Path, "maps")
		},
		Sources: func() []maptiles.Source {
			live.mu.Lock()
			defer live.mu.Unlock()
			sources, _ := maptiles.Merge(live.settings.MapSources)
			return sources
		},
	}
}

func AssetMiddleware(logs *LogService, tiles *maptiles.Server) application.Middleware {
	return func(next http.Handler) http.Handler {
		return logs.data.Middleware(tiles.Middleware(next))
	}
}
