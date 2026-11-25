package config

import (
	"encoding/json"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeedAndLoadDefaults(t *testing.T) {
	dir := t.TempDir()
	d, err := Locate(dir)
	if err != nil {
		t.Fatal(err)
	}
	if d.Source != "override" || d.Path != dir {
		t.Fatalf("unexpected dir %+v", d)
	}

	s, err := LoadSettings(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s.Device != "g26-iltm" || s.FrameRate != 20 {
		t.Fatalf("settings: %+v", s)
	}
	if !s.BackupLive() {
		t.Fatal("live backup should be on by default")
	}
	off := false
	if (Settings{}).BackupLive() != true || (Settings{LiveBackup: &off}).BackupLive() {
		t.Fatal("live_backup: unset should mean on, false should mean off")
	}

	profiles, bad := LoadProfiles(dir)
	if len(bad) != 0 {
		t.Fatalf("default profiles failed to load: %+v", bad)
	}
	byID := map[string]Profile{}
	for _, p := range profiles {
		byID[p.ID] = p
	}
	iltm, ok := byID["g26-iltm"]
	if !ok {
		t.Fatal("g26-iltm profile missing")
	}
	if iltm.Rename[113] != "PosLong_L" || iltm.Commands.List["Name_Sync_Req"].ID != 3 {
		t.Fatalf("g26-iltm parsed wrong: %+v", iltm)
	}
	if fs := iltm.FileServer; fs == nil || fs.Port != 80 || fs.LogsDir != "/logs" || iltm.Commands.List[fs.Enable].ID != 6 {
		t.Fatalf("g26-iltm file server: %+v", iltm.FileServer)
	}
	if q, ok := byID["uno-q-sim"]; !ok || q.FileServer == nil || q.FileServer.Port != 8080 || q.Commands.List[q.FileServer.Disable].Data != 0 {
		t.Fatalf("uno-q-sim file server: %+v", q.FileServer)
	}
}

func TestSeedNeverOverwritesOrResurrects(t *testing.T) {
	dir := t.TempDir()
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	settings := filepath.Join(dir, "settings.yaml")
	if err := os.WriteFile(settings, []byte("device: mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "devices", "uno_q_sim.yaml")); err != nil {
		t.Fatal(err)
	}
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(settings); string(b) != "device: mine\n" {
		t.Fatalf("settings overwritten: %q", b)
	}
	if _, err := os.Stat(filepath.Join(dir, "devices", "uno_q_sim.yaml")); err == nil {
		t.Fatal("deleted profile was recreated")
	}
}

func TestBadProfilesAreReportedNotFatal(t *testing.T) {
	dir := t.TempDir()
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	dev := filepath.Join(dir, "devices")
	os.WriteFile(filepath.Join(dev, "typo.yaml"), []byte("id: x\nadress: 1.2.3.4\n"), 0o644)
	os.WriteFile(filepath.Join(dev, "noid.yaml"), []byte("name: nothing\n"), 0o644)
	os.WriteFile(filepath.Join(dev, "zdup.yaml"), []byte("id: g26-iltm\n"), 0o644)

	builtIn, _ := fs.ReadDir(defaults, "defaults/devices")
	profiles, bad := LoadProfiles(dir)
	if len(profiles) != len(builtIn) || len(bad) != 3 {
		t.Fatalf("got %d profiles, %d errors: %+v", len(profiles), len(bad), bad)
	}
	joined := ""
	for _, b := range bad {
		joined += b.Err + "\n"
	}
	for _, want := range []string{"adress", `missing "id"`, "already used"} {
		if !strings.Contains(joined, want) {
			t.Errorf("no error mentioning %q in:\n%s", want, joined)
		}
	}
}

func TestSaveDeviceKeepsComments(t *testing.T) {
	dir := t.TempDir()
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	if err := SaveDevice(dir, "uno-q-sim"); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSettings(dir)
	if err != nil || s.Device != "uno-q-sim" {
		t.Fatalf("device not saved: %+v %v", s, err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "settings.yaml"))
	want, _ := defaults.ReadFile("defaults/settings.yaml")
	if got := strings.Replace(string(b), "device: uno-q-sim", "device: g26-iltm", 1); got != string(want) {
		t.Fatalf("something besides the device line changed:\n%s", b)
	}
}

func TestNamesCacheRoundTrip(t *testing.T) {
	dir := t.TempDir()
	in := map[uint8]string{0: "Time_tx", 11: "RPM"}
	if err := SaveNames(dir, "g26-iltm", in); err != nil {
		t.Fatal(err)
	}
	out := LoadNames(dir, "g26-iltm")
	if len(out) != 2 || out[11] != "RPM" {
		t.Fatalf("got %v", out)
	}
}

func TestGearCalibration(t *testing.T) {
	conv, err := Calibration{Type: "gear"}.Converter()
	if err != nil {
		t.Fatal(err)
	}
	cases := map[float64]float64{
		386: 1, 684: 1,
		685: 0, 1064: 0,
		1065: 2, 1334: 2,
		1335: 3, 2013: 3,
		2014: 4, 2465: 4,
		2466: 5, 2999: 5,
		3000: 6, 3688: 6,
	}
	for raw, want := range cases {
		if got := conv(raw); got != want {
			t.Errorf("raw %v: got gear %v, want %v", raw, got, want)
		}
	}
	for _, raw := range []float64{0, 385, 3689, 4095} {
		if got := conv(raw); !math.IsNaN(got) {
			t.Errorf("raw %v: got gear %v, want no value", raw, got)
		}
	}
}

func TestDefaultProfilesShowOnlyTheTranslatedGear(t *testing.T) {
	dir := t.TempDir()
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	profiles, bad := LoadProfiles(dir)
	if len(bad) != 0 {
		t.Fatal(bad)
	}
	for _, p := range profiles {
		var pinned []string
		for name, m := range p.Channels {
			if m.Pinned && m.Label == "Gear" {
				pinned = append(pinned, name)
			}
		}
		if len(pinned) != 1 || pinned[0] != "GearRaw" || p.Calibrations["GearRaw"].Type != "gear" {
			t.Errorf("%s: gear cards %v, GearRaw calibration %q", p.ID, pinned, p.Calibrations["GearRaw"].Type)
		}
		if p.Channels["Gear"].Pinned {
			t.Errorf("%s: the untranslated ECU gear is still pinned", p.ID)
		}
	}
}

func TestNewBuiltInProfilesReachExistingFolders(t *testing.T) {
	dir := t.TempDir()
	dev := filepath.Join(dir, "devices")
	os.MkdirAll(dev, 0o755)
	os.WriteFile(filepath.Join(dev, "g26_iltm.yaml"), []byte("id: g26-iltm\nname: Mine\n"), 0o644)

	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dev, "g26_iltm.yaml")); string(b) != "id: g26-iltm\nname: Mine\n" {
		t.Fatalf("existing profile overwritten: %q", b)
	}
	builtIn, _ := fs.ReadDir(defaults, "defaults/devices")
	for _, e := range builtIn {
		if _, err := os.Stat(filepath.Join(dev, e.Name())); err != nil {
			t.Errorf("built-in profile %s not added to an existing folder", e.Name())
		}
	}

	os.Remove(filepath.Join(dev, "base_station.yaml"))
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dev, "base_station.yaml")); err == nil {
		t.Fatal("a profile the user deleted came back")
	}
}

func TestSaveLiveBackupKeepsComments(t *testing.T) {
	dir := t.TempDir()
	if _, err := Locate(dir); err != nil {
		t.Fatal(err)
	}
	if err := SaveLiveBackup(dir, false); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSettings(dir)
	if err != nil || s.BackupLive() {
		t.Fatalf("live_backup not saved: %+v %v", s, err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "settings.yaml"))
	want, _ := defaults.ReadFile("defaults/settings.yaml")
	if got := strings.Replace(string(b), "live_backup: false", "live_backup: true", 1); got != string(want) {
		t.Fatalf("something besides the live_backup line changed:\n%s", b)
	}

	old := filepath.Join(dir, "settings.yaml")
	if err := os.WriteFile(old, []byte("device: g26-iltm\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SaveLiveBackup(dir, true); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(old); string(b) != "device: g26-iltm\nlive_backup: true\n" {
		t.Fatalf("missing key should be added at the end:\n%s", b)
	}
}

func TestTrackSearchSettings(t *testing.T) {
	dir := t.TempDir()
	write := func(body string) Settings {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, "settings.yaml"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		s, err := LoadSettings(dir)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := write("device: logger\n")
	if s.TrackSearch.Geocoder != "" || len(s.TrackSearch.Servers()) == 0 {
		t.Fatalf("defaults = %+v, want name search off and the built-in Overpass servers", s.TrackSearch)
	}
	s = write("track_search:\n  geocoder: https://nominatim.example/search\n  overpass:\n    - https://overpass.example/api/interpreter\n")
	if s.TrackSearch.Geocoder != "https://nominatim.example/search" || len(s.TrackSearch.Servers()) != 1 || s.TrackSearch.Validate() != nil {
		t.Fatalf("got %+v", s.TrackSearch)
	}
	s = write("track_search:\n  overpass: []\n")
	if len(s.TrackSearch.Servers()) != 0 {
		t.Fatalf("overpass: [] must turn lookups off, got %v", s.TrackSearch.Servers())
	}
	s = write("track_search:\n  geocoder: nominatim.example\n")
	if s.TrackSearch.Validate() == nil {
		t.Fatal("want an error for an address without http(s)://")
	}
}

func TestStock(t *testing.T) {
	car := StockCar()
	if car.Mass != 277 || car.Redline != 13000 || len(car.Torque) != 19 || car.Tire["pdy1"] == 0 {
		t.Fatalf("stock car not read: %+v", car)
	}
	if car.AeroFront != 0 || len(car.Gears) != 0 {
		t.Fatalf("stock car carries values it has no source for: %+v", car)
	}
	var setup struct {
		Version int `json:"dawgViewerSetup"`
		Track   struct {
			Beacon *struct{ Lat, Lon float64 } `json:"beacon"`
		} `json:"track"`
		Dampers struct {
			File     string `json:"file"`
			Settings []struct {
				Shock  string `json:"shock"`
				Points []struct{ V, Comp, Reb float64 }
			} `json:"settings"`
		} `json:"dampers"`
	}
	if err := json.Unmarshal([]byte(StockSetup()), &setup); err != nil {
		t.Fatal(err)
	}
	if setup.Version != 1 || setup.Track.Beacon == nil || setup.Track.Beacon.Lat == 0 {
		t.Fatalf("stock setup: %+v", setup)
	}
	if len(setup.Dampers.Settings) != 18 || len(setup.Dampers.Settings[0].Points) == 0 || setup.Dampers.File == "" {
		t.Fatalf("stock damper table: %d settings from %q", len(setup.Dampers.Settings), setup.Dampers.File)
	}
}

func TestSampleLogIsOfferedOnce(t *testing.T) {
	dir := t.TempDir()
	if err := seed(dir); err != nil {
		t.Fatal(err)
	}
	s, _ := LoadSettings(dir)
	sample := SamplePath(dir, s)
	if sample == "" || filepath.Base(sample) != SampleLogName {
		t.Fatalf("sample log not written: %q", sample)
	}
	f, err := os.Open(sample)
	if err != nil {
		t.Fatal(err)
	}
	head := make([]byte, 28)
	_, err = io.ReadFull(f, head)
	f.Close()
	if err != nil || string(head) != "timestamp_ms,id,signal,value" {
		t.Fatalf("sample log does not start like a log: %q %v", head, err)
	}
	if err := os.Remove(sample); err != nil {
		t.Fatal(err)
	}
	if err := seed(dir); err != nil {
		t.Fatal(err)
	}
	if SamplePath(dir, s) != "" {
		t.Fatal("a deleted sample log came back")
	}
}
