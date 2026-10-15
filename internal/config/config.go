// Package config finds, seeds and loads the app's plain-text configuration:
// settings.yaml plus one YAML profile per device in devices/. See
// defaults/README.txt for the user-facing description.
package config

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"go.yaml.in/yaml/v3"
)

//go:embed defaults
var defaults embed.FS

const (
	PortableDirName = "dawg_config"
	userDirName     = "DawgViewer"
	EnvVar          = "DAWG_CONFIG"
)

// Dir is the configuration folder in use and how it was chosen.
type Dir struct {
	Path string `json:"path"`
	// Source is "override", "portable" or "user".
	Source string `json:"source"`
}

// Locate picks the configuration folder: override (from --config or the
// DAWG_CONFIG variable), then a portable "dawg_config" folder next to the app,
// then the per-user config folder. The folder is created and seeded with the
// default files if it doesn't exist yet.
func Locate(override string) (Dir, error) {
	if override == "" {
		override = os.Getenv(EnvVar)
	}
	if override != "" {
		abs, err := filepath.Abs(override)
		if err != nil {
			return Dir{}, err
		}
		return Dir{abs, "override"}, seed(abs)
	}

	if appDir, err := appDir(); err == nil {
		p := filepath.Join(appDir, PortableDirName)
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return Dir{p, "portable"}, seed(p)
		}
	}

	base, err := os.UserConfigDir()
	if err != nil {
		return Dir{}, fmt.Errorf("no user config folder: %w", err)
	}
	p := filepath.Join(base, userDirName)
	return Dir{p, "user"}, seed(p)
}

// appDir is the folder the user sees the app in: the executable's folder, or
// the folder holding the .app bundle on macOS.
func appDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := filepath.Dir(exe)
	if runtime.GOOS == "darwin" {
		if i := strings.Index(dir, ".app"+string(filepath.Separator)+"Contents"); i >= 0 {
			return filepath.Dir(dir[:i+len(".app")]), nil
		}
	}
	return dir, nil
}

// seed writes any missing top-level default files, and the default device
// profiles if there is no devices/ folder yet. Existing files are never
// overwritten, and deleted profiles stay deleted.
func seed(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	_, statErr := os.Stat(filepath.Join(dir, "devices"))
	seedDevices := errors.Is(statErr, fs.ErrNotExist)

	return fs.WalkDir(defaults, "defaults", func(p string, d fs.DirEntry, err error) error {
		if err != nil || p == "defaults" {
			return err
		}
		rel := strings.TrimPrefix(p, "defaults/")
		if strings.HasPrefix(rel, "devices") && !seedDevices {
			return nil
		}
		dst := filepath.Join(dir, filepath.FromSlash(rel))
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		if _, err := os.Stat(dst); err == nil {
			return nil
		}
		b, err := defaults.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, b, 0o644)
	})
}

// Settings is settings.yaml.
type Settings struct {
	Device         string  `yaml:"device" json:"device"`
	FrameRate      int     `yaml:"frame_rate" json:"frameRate"`
	HistoryMinutes int     `yaml:"history_minutes" json:"historyMinutes"`
	StaleAfterS    float64 `yaml:"stale_after_s" json:"staleAfterS"`
	LogsDir        string  `yaml:"logs_dir" json:"logsDir"`
}

func (s *Settings) applyDefaults() {
	if s.FrameRate <= 0 {
		s.FrameRate = 20
	}
	if s.FrameRate > 120 {
		s.FrameRate = 120
	}
	if s.HistoryMinutes <= 0 {
		s.HistoryMinutes = 30
	}
	if s.StaleAfterS <= 0 {
		s.StaleAfterS = 2
	}
	if s.LogsDir == "" {
		s.LogsDir = "logs"
	}
}

// LoadSettings reads settings.yaml, filling in defaults for anything missing.
func LoadSettings(dir string) (Settings, error) {
	var s Settings
	err := readYAML(filepath.Join(dir, "settings.yaml"), &s)
	s.applyDefaults()
	return s, err
}

// SaveDevice records the chosen device in settings.yaml by rewriting only the
// "device:" line, so the user's comments and layout stay exactly as they were.
func SaveDevice(dir, id string) error {
	p := filepath.Join(dir, "settings.yaml")
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	value, err := yaml.Marshal(id)
	if err != nil {
		return err
	}
	line := "device: " + strings.TrimSpace(string(value))
	lines := strings.Split(string(b), "\n")
	replaced := false
	for i, l := range lines {
		if strings.HasPrefix(l, "device:") {
			lines[i] = line
			replaced = true
			break
		}
	}
	if !replaced {
		lines = append([]string{line}, lines...)
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Profile describes one device the app can read data from (devices/*.yaml).
type Profile struct {
	ID           string                 `yaml:"id" json:"id"`
	Name         string                 `yaml:"name" json:"name"`
	Address      string                 `yaml:"address" json:"address"`
	Telemetry    Telemetry              `yaml:"telemetry" json:"telemetry"`
	Discovery    Discovery              `yaml:"discovery" json:"discovery"`
	Commands     Commands               `yaml:"commands" json:"commands"`
	Rename       map[int]string         `yaml:"rename" json:"-"`
	Combine      []Combine              `yaml:"combine" json:"-"`
	Calibrations map[string]Calibration `yaml:"calibrations" json:"-"`
	Channels     map[string]ChannelMeta `yaml:"channels" json:"channels"`
	// File is the profile's path on disk.
	File string `yaml:"-" json:"file"`
}

type Telemetry struct {
	Listen string `yaml:"listen" json:"listen"`
}

type Discovery struct {
	Enabled  bool   `yaml:"enabled" json:"enabled"`
	Port     int    `yaml:"port" json:"port"`
	Request  string `yaml:"request" json:"request"`
	DeviceID string `yaml:"device_id" json:"deviceId"`
}

type Commands struct {
	Port     int                `yaml:"port" json:"port"`
	PadTo    int                `yaml:"pad_to" json:"padTo"`
	NameSync string             `yaml:"name_sync" json:"nameSync"`
	List     map[string]Command `yaml:"list" json:"list"`
}

type Command struct {
	ID          uint8  `yaml:"id" json:"id"`
	Data        uint8  `yaml:"data" json:"data"`
	Description string `yaml:"description" json:"description"`
}

type Combine struct {
	Name string `yaml:"name"`
	Hi   string `yaml:"hi"`
	Lo   string `yaml:"lo"`
}

type Calibration struct {
	Type               string       `yaml:"type"`
	Mult               float64      `yaml:"mult"`
	Div                float64      `yaml:"div"`
	Add                float64      `yaml:"add"`
	Points             [][2]float64 `yaml:"points"`
	RFixed             float64      `yaml:"r_fixed"`
	ADCMax             float64      `yaml:"adc_max"`
	ThermistorToGround *bool        `yaml:"thermistor_to_ground"`
}

// ChannelMeta controls how a channel is displayed.
type ChannelMeta struct {
	Label     string   `yaml:"label" json:"label,omitempty"`
	Unit      string   `yaml:"unit" json:"unit,omitempty"`
	Precision *int     `yaml:"precision" json:"precision,omitempty"`
	Pinned    bool     `yaml:"pinned" json:"pinned,omitempty"`
	Large     bool     `yaml:"large" json:"large,omitempty"`
	Order     int      `yaml:"order" json:"order"`
	WarnMin   *float64 `yaml:"warn_min" json:"warnMin,omitempty"`
	WarnMax   *float64 `yaml:"warn_max" json:"warnMax,omitempty"`
	CritMin   *float64 `yaml:"crit_min" json:"critMin,omitempty"`
	CritMax   *float64 `yaml:"crit_max" json:"critMax,omitempty"`
}

func (p *Profile) applyDefaults() {
	if p.Name == "" {
		p.Name = p.ID
	}
	if p.Telemetry.Listen == "" {
		p.Telemetry.Listen = "0.0.0.0:5002"
	}
	if p.Discovery.Port == 0 {
		p.Discovery.Port = 4999
	}
	if p.Discovery.Request == "" {
		p.Discovery.Request = "UGAMS_DISCOVER"
	}
	if p.Commands.Port == 0 {
		p.Commands.Port = 2002
	}
}

// ProfileError reports a device file that couldn't be used.
type ProfileError struct {
	File string `json:"file"`
	Err  string `json:"error"`
}

// LoadProfiles reads every devices/*.yaml file, sorted by name. Broken files
// are reported in the second return value instead of stopping the others.
func LoadProfiles(dir string) ([]Profile, []ProfileError) {
	files, _ := filepath.Glob(filepath.Join(dir, "devices", "*.yaml"))
	more, _ := filepath.Glob(filepath.Join(dir, "devices", "*.yml"))
	files = append(files, more...)
	sort.Strings(files)

	var out []Profile
	var bad []ProfileError
	seen := map[string]string{}
	for _, f := range files {
		var p Profile
		if err := readYAML(f, &p); err != nil {
			bad = append(bad, ProfileError{f, err.Error()})
			continue
		}
		if p.ID == "" {
			bad = append(bad, ProfileError{f, `missing "id"`})
			continue
		}
		if other, dup := seen[p.ID]; dup {
			bad = append(bad, ProfileError{f, fmt.Sprintf("id %q is already used by %s", p.ID, filepath.Base(other))})
			continue
		}
		seen[p.ID] = f
		p.File = f
		p.applyDefaults()
		out = append(out, p)
	}
	return out, bad
}

// LoadNames returns the cached signal names for a device.
func LoadNames(dir, profileID string) map[uint8]string {
	names := map[uint8]string{}
	_ = readYAML(namesPath(dir, profileID), &names)
	return names
}

// SaveNames caches the signal names learned from a device.
func SaveNames(dir, profileID string, names map[uint8]string) error {
	p := namesPath(dir, profileID)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	var n yaml.Node
	if err := n.Encode(names); err != nil {
		return err
	}
	n.HeadComment = "Signal names last received from " + profileID + ". Written by the app; safe to delete."
	return writeYAML(p, &n)
}

func namesPath(dir, profileID string) string {
	safe := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '.' {
			return '_'
		}
		return r
	}, profileID)
	return filepath.Join(dir, "cache", safe+".names.yaml")
}

// ResolvePath makes p absolute relative to the config folder.
func ResolvePath(dir, p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(dir, p)
}

func readYAML(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	if err := dec.Decode(v); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return nil
}

func writeYAML(path string, v any) error {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(v); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
