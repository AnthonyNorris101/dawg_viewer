package config

import (
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
	if _, ok := byID["uno-q-sim"]; !ok {
		t.Fatal("uno-q-sim profile missing")
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

	profiles, bad := LoadProfiles(dir)
	if len(profiles) != 2 || len(bad) != 3 {
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
