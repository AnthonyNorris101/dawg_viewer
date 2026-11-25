package services

import (
	"context"
	"path/filepath"
	"sync"
	"time"

	"dawg_viewer/internal/tracks"
)

type TrackSearch struct {
	Online bool `json:"online"`
	ByName bool `json:"byName"`
}

const trackSearchTimeout = 40 * time.Second

type trackFinder struct {
	once   sync.Once
	finder *tracks.Finder
}

func (s *LiveService) finder() *tracks.Finder {
	s.tracks.once.Do(func() {
		s.tracks.finder = &tracks.Finder{
			UserAgent: "DawgViewer/" + Version + " (FSAE telemetry viewer; github.com/UGA-Motorsports-FSAE-IC/dawg_viewer)",
			Config: func() tracks.Config {
				s.mu.Lock()
				defer s.mu.Unlock()
				return s.settings.TrackSearch
			},
			Dir: func() string {
				s.mu.Lock()
				defer s.mu.Unlock()
				if s.dir.Path == "" {
					return ""
				}
				return filepath.Join(s.dir.Path, "track-search")
			},
		}
	})
	return s.tracks.finder
}

func (s *LiveService) FindTracks(query string) ([]tracks.Track, error) {
	ctx, cancel := context.WithTimeout(context.Background(), trackSearchTimeout)
	defer cancel()
	return s.finder().Search(ctx, query)
}

func (s *LiveService) TracksNear(lat, lon float64) ([]tracks.Track, error) {
	ctx, cancel := context.WithTimeout(context.Background(), trackSearchTimeout)
	defer cancel()
	return s.finder().Near(ctx, lat, lon)
}
