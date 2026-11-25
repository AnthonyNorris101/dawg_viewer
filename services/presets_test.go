package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dawg_viewer/internal/config"
)

func TestPresets(t *testing.T) {
	s := &LiveService{dir: config.Dir{Path: t.TempDir()}}
	if ps, err := s.Presets(); err != nil || len(ps) != 0 {
		t.Fatalf("empty dir: %v %v", ps, err)
	}
	p, err := s.SavePreset(" Endurance: wet ", `{"dawgViewerSetup":1}`)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Endurance_ wet" {
		t.Fatalf("name %q", p.Name)
	}
	if _, err := s.SavePreset("bad", "{"); err == nil {
		t.Fatal("invalid JSON saved")
	}
	if _, err := s.SavePreset("  ", "{}"); err == nil {
		t.Fatal("blank name saved")
	}
	got, err := s.LoadPreset(p.Name)
	if err != nil || got != `{"dawgViewerSetup":1}` {
		t.Fatalf("load: %q %v", got, err)
	}
	ps, _ := s.Presets()
	if len(ps) != 1 || ps[0].Name != p.Name {
		t.Fatalf("list: %+v", ps)
	}
	if err := s.DeletePreset(p.Name); err != nil {
		t.Fatal(err)
	}
	if ps, _ := s.Presets(); len(ps) != 0 {
		t.Fatalf("not deleted: %+v", ps)
	}
	if _, err := s.LoadPreset("../../etc/passwd"); err == nil {
		t.Fatal("path escaped the presets folder")
	}
}

func TestSession(t *testing.T) {
	dir := t.TempDir()
	s := &LiveService{dir: config.Dir{Path: dir}}
	if got, err := s.LoadSession(); err != nil || got != "" {
		t.Fatalf("no session yet: %q %v", got, err)
	}
	if err := s.SaveSession("{"); err == nil {
		t.Fatal("invalid JSON saved")
	}
	first := `{"dawgViewerSession":1,"setup":"Endurance"}`
	if err := s.SaveSession(first); err != nil {
		t.Fatal(err)
	}
	second := `{"dawgViewerSession":1,"setup":""}`
	if err := s.SaveSession(second); err != nil {
		t.Fatal(err)
	}
	if got, err := s.LoadSession(); err != nil || got != second {
		t.Fatalf("load: %q %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "session.json")); err != nil {
		t.Fatalf("session is not in the config folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "session.json.tmp")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file left behind: %v", err)
	}
	if ps, _ := s.Presets(); len(ps) != 0 {
		t.Fatalf("the session shows up as a setup: %+v", ps)
	}
}

func TestSavedTracks(t *testing.T) {
	s := NewLiveService(t.TempDir())
	if ts, err := s.SavedTracks(); err != nil || len(ts) != 0 {
		t.Fatalf("a new folder lists %d tracks, err %v", len(ts), err)
	}
	saved, err := s.SaveTrack(" Autocross: day 1 ", `{"version":1,"kind":"segments"}`)
	if err != nil || saved.Name != "Autocross_ day 1" || saved.Modified == 0 {
		t.Fatalf("saved = %+v, err %v", saved, err)
	}
	if _, err := s.SaveTrack("bad", "{"); err == nil || !strings.Contains(err.Error(), "track") {
		t.Fatalf("err = %v, want a refusal that names the track", err)
	}
	if _, err := s.SaveTrack(" ", "{}"); err == nil {
		t.Fatal("want an error for an empty name")
	}
	got, err := s.LoadTrack(saved.Name)
	if err != nil || got != `{"version":1,"kind":"segments"}` {
		t.Fatalf("loaded %q, err %v", got, err)
	}
	if ps, _ := s.Presets(); len(ps) != 0 {
		t.Fatal("a saved track must not show up as a setup")
	}
	if ts, _ := s.SavedTracks(); len(ts) != 1 || ts[0].Name != saved.Name {
		t.Fatalf("listed %+v", ts)
	}
	if err := s.DeleteTrack(saved.Name); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTrack(saved.Name); err != nil {
		t.Fatalf("deleting twice: %v", err)
	}
	if ts, _ := s.SavedTracks(); len(ts) != 0 {
		t.Fatalf("still listed after delete: %+v", ts)
	}
}
