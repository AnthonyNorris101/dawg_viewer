package config

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const profileYAML = `# A device profile.
id: test
name: Test

# Comments stay.
calibrations:
  RadTemp:
    type: steinhart_f
    points: [[336, 266], [999, 176], [2924, 68]]
  GearRaw:
    type: gear

channels:
  RPM:      { label: RPM,           precision: 0, pinned: true, large: true, order: 0 }
  CLT1:     { label: Coolant Temp,  precision: 1, pinned: true, order: 3 }
`

func writeProfile(t *testing.T, text string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "test.yaml")
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func loadProfile(t *testing.T, path string) Profile {
	t.Helper()
	var p Profile
	if err := readYAML(path, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSaveChannelEditsInPlace(t *testing.T) {
	path := writeProfile(t, profileYAML)
	one := 1
	err := SaveChannel(path, "Damper FL", ChannelMeta{Label: "Damper FL", Unit: "mm", Precision: &one, Color: "#22d3ee", Group: "Suspension", Pos: []float64{0.3, 0.24}},
		&Calibration{Type: "linear", Mult: 0.0244, Add: -12.5})
	if err != nil {
		t.Fatal(err)
	}
	p := loadProfile(t, path)
	if c := p.Calibrations["Damper FL"]; c.Type != "linear" || c.Mult != 0.0244 || c.Add != -12.5 {
		t.Fatalf("calibration not saved: %+v", c)
	}
	if m := p.Channels["Damper FL"]; m.Unit != "mm" || m.Color != "#22d3ee" || m.Group != "Suspension" || *m.Precision != 1 || len(m.Pos) != 2 || m.Pos[1] != 0.24 {
		t.Fatalf("channel not saved: %+v", m)
	}
	if p.Calibrations["RadTemp"].Type != "steinhart_f" || !p.Channels["RPM"].Large {
		t.Fatal("other entries changed")
	}

	b, _ := os.ReadFile(path)
	text := string(b)
	for _, keep := range []string{"# A device profile.", "# Comments stay.", "  RPM:      { label: RPM,           precision: 0"} {
		if !strings.Contains(text, keep) {
			t.Errorf("lost %q:\n%s", keep, text)
		}
	}

	err = SaveChannel(path, "CLT1", ChannelMeta{Label: "Coolant", Precision: &one, Pinned: true, Order: 3, Group: "Engine"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	p = loadProfile(t, path)
	if m := p.Channels["CLT1"]; m.Label != "Coolant" || m.Group != "Engine" || !m.Pinned || m.Order != 3 {
		t.Fatalf("CLT1 not updated: %+v", m)
	}

	if err := SaveChannel(path, "Damper FL", ChannelMeta{}, nil); err != nil {
		t.Fatal(err)
	}
	p = loadProfile(t, path)
	if _, ok := p.Calibrations["Damper FL"]; ok {
		t.Fatal("calibration not removed")
	}
	if _, ok := p.Channels["Damper FL"]; ok {
		t.Fatal("empty channel entry kept")
	}
}

func TestSaveChannelAddsSections(t *testing.T) {
	path := writeProfile(t, "id: bare\n")
	if err := SaveChannel(path, "Oil Pres", ChannelMeta{Unit: "psi"}, &Calibration{Type: "linear", Mult: 2, Div: 10}); err != nil {
		t.Fatal(err)
	}
	p := loadProfile(t, path)
	if p.Channels["Oil Pres"].Unit != "psi" || p.Calibrations["Oil Pres"].Div != 10 {
		t.Fatalf("not saved: %+v %+v", p.Channels, p.Calibrations)
	}
}

func TestSaveChannelRejectsBadInput(t *testing.T) {
	path := writeProfile(t, profileYAML)
	if err := SaveChannel(path, "RPM", ChannelMeta{Color: "red"}, nil); err == nil {
		t.Error("bad colour accepted")
	}
	if err := SaveChannel(path, "RPM", ChannelMeta{}, &Calibration{Type: "magic"}); err == nil {
		t.Error("bad calibration accepted")
	}
	b, _ := os.ReadFile(path)
	if string(b) != profileYAML {
		t.Error("file changed after a rejected edit")
	}
}

func TestSaveCar(t *testing.T) {
	path := writeProfile(t, profileYAML)
	car := Car{Mass: 290, Wheelbase: 1.55, Gears: []float64{2.583, 2, 1.667}, FinalDrive: 3.08, SlipLow: 0.08, TargetG: 1.2, ClA: 3.1, CdA: 1.4, AeroFront: 0.42, AirDensity: 1.18}
	if err := SaveCar(path, car); err != nil {
		t.Fatal(err)
	}
	car.Mass = 285
	if err := SaveCar(path, car); err != nil {
		t.Fatal(err)
	}
	p := loadProfile(t, path)
	if p.Car.Mass != 285 || len(p.Car.Gears) != 3 || p.Car.FinalDrive != 3.08 || p.Car.SlipLow != 0.08 || p.Car.TargetG != 1.2 ||
		p.Car.ClA != 3.1 || p.Car.CdA != 1.4 || p.Car.AeroFront != 0.42 || p.Car.AirDensity != 1.18 {
		t.Fatalf("car not saved: %+v", p.Car)
	}
	if !p.Channels["RPM"].Large || p.Calibrations["RadTemp"].Type != "steinhart_f" {
		t.Fatal("other sections changed")
	}
	b, _ := os.ReadFile(path)
	if strings.Count(string(b), "car:") != 1 {
		t.Fatalf("car section duplicated:\n%s", b)
	}
}

func TestSaveFittedCalibrations(t *testing.T) {
	path := writeProfile(t, profileYAML)
	pts := [][2]float64{{400, 0}, {1200, 21}, {2400, 48}, {3600, 70}}
	poly := &Calibration{Type: "poly", Coeffs: []float64{-10.5, 0.026, -1.2e-6}, Degree: 2, Points: pts}
	if err := SaveChannel(path, "OilPres", ChannelMeta{Unit: "psi"}, poly); err != nil {
		t.Fatal(err)
	}
	if err := SaveChannel(path, "FuelLevel", ChannelMeta{Unit: "%"}, &Calibration{Type: "table", Points: pts}); err != nil {
		t.Fatal(err)
	}
	p := loadProfile(t, path)
	c := p.Calibrations["OilPres"]
	if c.Type != "poly" || len(c.Coeffs) != 3 || c.Coeffs[2] != -1.2e-6 || c.Degree != 2 || len(c.Points) != 4 {
		t.Fatalf("poly not saved: %+v", c)
	}
	conv, err := c.Converter()
	if err != nil || math.Abs(conv(1000)-(-10.5+26-1.2)) > 1e-9 {
		t.Fatalf("poly converter: %v", err)
	}
	tab, err := p.Calibrations["FuelLevel"].Converter()
	if err != nil || tab(1800) != 34.5 {
		t.Fatalf("table converter: %v", err)
	}
	fitted, err := Calibration{Type: "poly", Degree: 1, Points: [][2]float64{{0, 1}, {10, 21}}}.Converter()
	if err != nil || math.Abs(fitted(5)-11) > 1e-9 {
		t.Fatalf("poly from points: %v", err)
	}
}
