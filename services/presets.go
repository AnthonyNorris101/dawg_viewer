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

type SavedTrack struct {
	Name     string `json:"name"`
	Modified int64  `json:"modified"`
}

const maxPresetBytes = 4 << 20

type library struct {
	folder string
	noun   string
}

var (
	presetLibrary  = library{folder: "presets", noun: "setup"}
	trackLibrary   = library{folder: "tracks", noun: "track"}
	sessionLibrary = library{folder: "", noun: "session"}
)

const sessionName = "session"

func (s *LiveService) libraryDir(l library) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return filepath.Join(s.dir.Path, l.folder)
}

func (l library) file(dir, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("give the " + l.noun + " a name")
	}
	if len(name) > 80 {
		return "", errors.New("the " + l.noun + " name is too long")
	}
	clean := strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, name)
	clean = strings.TrimRight(clean, ". ")
	if clean == "" {
		return "", errors.New("give the " + l.noun + " a name")
	}
	return filepath.Join(dir, clean+".json"), nil
}

func (l library) list(dir string) ([]Preset, error) {
	entries, err := os.ReadDir(dir)
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

func (l library) save(dir, name, data string) (Preset, error) {
	file, err := l.file(dir, name)
	if err != nil {
		return Preset{}, err
	}
	if len(data) > maxPresetBytes || !json.Valid([]byte(data)) {
		return Preset{}, errors.New("the " + l.noun + " isn't valid JSON")
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

func (l library) load(dir, name string) (string, error) {
	file, err := l.file(dir, name)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(file)
	if err != nil {
		return "", err
	}
	if info.Size() > maxPresetBytes {
		return "", errors.New("the " + l.noun + " file is too big")
	}
	b, err := os.ReadFile(file)
	return string(b), err
}

func (l library) remove(dir, name string) error {
	file, err := l.file(dir, name)
	if err != nil {
		return err
	}
	err = os.Remove(file)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *LiveService) Presets() ([]Preset, error) {
	return presetLibrary.list(s.libraryDir(presetLibrary))
}

func (s *LiveService) SavePreset(name, data string) (Preset, error) {
	return presetLibrary.save(s.libraryDir(presetLibrary), name, data)
}

func (s *LiveService) LoadPreset(name string) (string, error) {
	return presetLibrary.load(s.libraryDir(presetLibrary), name)
}

func (s *LiveService) DeletePreset(name string) error {
	return presetLibrary.remove(s.libraryDir(presetLibrary), name)
}

func (s *LiveService) LoadSession() (string, error) {
	data, err := sessionLibrary.load(s.libraryDir(sessionLibrary), sessionName)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	return data, err
}

func (s *LiveService) SaveSession(data string) error {
	_, err := sessionLibrary.save(s.libraryDir(sessionLibrary), sessionName, data)
	return err
}

func (s *LiveService) SavedTracks() ([]SavedTrack, error) {
	found, err := trackLibrary.list(s.libraryDir(trackLibrary))
	out := make([]SavedTrack, len(found))
	for i, f := range found {
		out[i] = SavedTrack(f)
	}
	return out, err
}

func (s *LiveService) SaveTrack(name, data string) (SavedTrack, error) {
	saved, err := trackLibrary.save(s.libraryDir(trackLibrary), name, data)
	return SavedTrack(saved), err
}

func (s *LiveService) LoadTrack(name string) (string, error) {
	return trackLibrary.load(s.libraryDir(trackLibrary), name)
}

func (s *LiveService) DeleteTrack(name string) error {
	return trackLibrary.remove(s.libraryDir(trackLibrary), name)
}
