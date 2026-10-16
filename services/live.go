package services

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"dawg_viewer/internal/config"
	"dawg_viewer/internal/itv"
	"dawg_viewer/internal/link"
	"dawg_viewer/internal/live"
)

const (
	EventFrame    = "live:frame"
	EventStatus   = "live:status"
	EventChannels = "live:channels"
)

func init() {
	application.RegisterEvent[live.Frame](EventFrame)
	application.RegisterEvent[live.Status](EventStatus)
	application.RegisterEvent[[]live.Channel](EventChannels)
}

type ProfileSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	File string `json:"file"`
}

type Info struct {
	ConfigDir     config.Dir                    `json:"configDir"`
	Settings      config.Settings               `json:"settings"`
	Profiles      []ProfileSummary              `json:"profiles"`
	ProfileErrors []config.ProfileError         `json:"profileErrors"`
	Active        string                        `json:"active"`
	Channels      map[string]config.ChannelMeta `json:"channels"`
	SettingsError string                        `json:"settingsError"`
}

type LiveService struct {
	override string

	mu          sync.Mutex
	ctx         context.Context
	dir         config.Dir
	settings    config.Settings
	settingsErr error
	profiles    []config.Profile
	badProfiles []config.ProfileError
	active      *config.Profile
	session     *live.Session
}

func NewLiveService(configDir string) *LiveService {
	return &LiveService{override: configDir}
}

func (s *LiveService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ctx = ctx
	if err := s.loadLocked(); err != nil {
		return err
	}
	if id := s.settings.Device; id != "" {
		_ = s.connectLocked(id)
	}
	return nil
}

func (s *LiveService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
	return nil
}

func (s *LiveService) loadLocked() error {
	dir, err := config.Locate(s.override)
	if err != nil {
		return fmt.Errorf("config folder: %w", err)
	}
	s.dir = dir
	s.settings, s.settingsErr = config.LoadSettings(dir.Path)
	s.profiles, s.badProfiles = config.LoadProfiles(dir.Path)
	return nil
}

func (s *LiveService) Info() Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.infoLocked()
}

func (s *LiveService) infoLocked() Info {
	info := Info{
		ConfigDir:     s.dir,
		Settings:      s.settings,
		ProfileErrors: s.badProfiles,
		Channels:      map[string]config.ChannelMeta{},
	}
	if s.settingsErr != nil {
		info.SettingsError = s.settingsErr.Error()
	}
	for _, p := range s.profiles {
		info.Profiles = append(info.Profiles, ProfileSummary{p.ID, p.Name, p.File})
	}
	if s.active != nil {
		info.Active = s.active.ID
		info.Channels = s.active.Channels
	}
	return info
}

func (s *LiveService) Connect(profileID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.connectLocked(profileID); err != nil {
		return err
	}
	if s.settings.Device != profileID {
		s.settings.Device = profileID
		if err := config.SaveDevice(s.dir.Path, profileID); err != nil {
			return fmt.Errorf("connected, but couldn't save the choice: %w", err)
		}
	}
	return nil
}

func (s *LiveService) Disconnect() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *LiveService) Reload() (Info, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := ""
	if s.active != nil {
		id = s.active.ID
	}
	s.stopLocked()
	if err := s.loadLocked(); err != nil {
		return s.infoLocked(), err
	}
	if id == "" {
		id = s.settings.Device
	}
	var err error
	if id != "" {
		err = s.connectLocked(id)
	}
	return s.infoLocked(), err
}

func (s *LiveService) Status() live.Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session == nil {
		st := live.Status{State: "stopped", LastPacketMs: -1}
		if s.active != nil {
			st.Profile, st.ProfileName = s.active.ID, s.active.Name
		}
		return st
	}
	return s.session.Status()
}

func (s *LiveService) Channels() []live.Channel {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.session == nil {
		return nil
	}
	return s.session.Channels()
}

func (s *LiveService) OpenConfigFolder() error {
	s.mu.Lock()
	dir := s.dir.Path
	s.mu.Unlock()
	return application.Get().Env.OpenFileManager(dir, false)
}

func (s *LiveService) connectLocked(id string) error {
	var p *config.Profile
	for i := range s.profiles {
		if s.profiles[i].ID == id {
			p = &s.profiles[i]
		}
	}
	if p == nil {
		return fmt.Errorf("no device profile with id %q in %s", id, s.dir.Path)
	}
	s.stopLocked()
	s.active = p
	if s.ctx == nil {
		return errors.New("app not started")
	}
	sess, err := live.Start(s.ctx, live.Options{
		Profile:    *p,
		ConfigDir:  s.dir.Path,
		FrameRate:  s.settings.FrameRate,
		StaleAfter: time.Duration(s.settings.StaleAfterS * float64(time.Second)),
	}, emitter{})
	if err != nil {
		emitter{}.Status(live.Status{Profile: p.ID, ProfileName: p.Name, State: "error", Error: err.Error(), LastPacketMs: -1})
		return err
	}
	s.session = sess
	return nil
}

func (s *LiveService) stopLocked() {
	if s.session != nil {
		s.session.Stop()
		s.session = nil
	}
}

type emitter struct{}

func (emitter) Frame(f live.Frame)        { emit(EventFrame, f) }
func (emitter) Status(st live.Status)     { emit(EventStatus, st) }
func (emitter) Channels(c []live.Channel) { emit(EventChannels, c) }

func emit(name string, data any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data)
	}
}

type deviceTarget struct {
	profile   config.Profile
	addr      netip.Addr
	configDir string
	logsDir   string
	csvHz     int
}

func (s *LiveService) target() (deviceTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return deviceTarget{}, errors.New("no device selected; pick one in the Live tab")
	}
	t := deviceTarget{
		profile:   *s.active,
		configDir: s.dir.Path,
		logsDir:   config.ResolvePath(s.dir.Path, s.settings.LogsDir),
		csvHz:     s.settings.CSVRateHz,
	}
	if s.session != nil {
		t.addr, _ = netip.ParseAddr(s.session.Status().DeviceIP)
	}
	if !t.addr.IsValid() && s.active.Address != "" {
		t.addr, _ = netip.ParseAddr(s.active.Address)
	}
	return t, nil
}

func (t deviceTarget) sendCommand(ctx context.Context, name string) error {
	cmd, ok := t.profile.Commands.List[name]
	if !ok {
		return fmt.Errorf("command %q isn't in %s", name, filepath.Base(t.profile.File))
	}
	payload := itv.AppendU8(itv.AppendCmd(nil, 1, cmd.ID), 2, cmd.Data)
	return link.SendCommand(ctx, t.addr, t.profile.Commands.Port, payload, t.profile.Commands.PadTo)
}
