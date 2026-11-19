package services

import (
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
