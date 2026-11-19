package services

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Preset struct {
	Name     string `json:"name"`
	Modified int64  `json:"modified"`
}

const maxPresetBytes = 4 << 20

func (s *LiveService) presetDir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return filepath.Join(s.dir.Path, "presets")
}

func presetFile(dir, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("give the setup a name")
	}
	if len(name) > 80 {
		return "", errors.New("the setup name is too long")
	}
	clean := strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, name)
	clean = strings.TrimRight(clean, ". ")
	if clean == "" {
		return "", errors.New("give the setup a name")
	}
	return filepath.Join(dir, clean+".json"), nil
}

func (s *LiveService) Presets() ([]Preset, error) {
	entries, err := os.ReadDir(s.presetDir())
	if errors.Is(err, os.ErrNotExist) {
		return []Preset{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []Preset{}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".json") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, Preset{
			Name:     strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())),
			Modified: info.ModTime().UnixMilli(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	return out, nil
}

func (s *LiveService) SavePreset(name, data string) (Preset, error) {
	dir := s.presetDir()
	file, err := presetFile(dir, name)
	if err != nil {
		return Preset{}, err
	}
	if len(data) > maxPresetBytes || !json.Valid([]byte(data)) {
		return Preset{}, errors.New("the setup isn't valid JSON")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Preset{}, err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, []byte(data), 0o644); err != nil {
		return Preset{}, err
	}
	if err := os.Rename(tmp, file); err != nil {
		_ = os.Remove(tmp)
		return Preset{}, err
	}
	info, err := os.Stat(file)
	if err != nil {
		return Preset{}, err
	}
	return Preset{
		Name:     strings.TrimSuffix(filepath.Base(file), ".json"),
		Modified: info.ModTime().UnixMilli(),
	}, nil
}

func (s *LiveService) LoadPreset(name string) (string, error) {
	file, err := presetFile(s.presetDir(), name)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(file)
	if err != nil {
		return "", err
	}
	if info.Size() > maxPresetBytes {
		return "", errors.New("the setup file is too big")
	}
	b, err := os.ReadFile(file)
	return string(b), err
}

func (s *LiveService) DeletePreset(name string) error {
	file, err := presetFile(s.presetDir(), name)
	if err != nil {
		return err
	}
	err = os.Remove(file)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
