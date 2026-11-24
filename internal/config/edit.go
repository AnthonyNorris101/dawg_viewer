package config

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"
)

func SaveChannel(file, name string, meta ChannelMeta, cal *Calibration) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("channel name is empty")
	}
	if meta.Color != "" && !colorRe.MatchString(meta.Color) {
		return fmt.Errorf("colour %q is not like #ff8800", meta.Color)
	}
	if cal != nil {
		if _, err := cal.Converter(); err != nil {
			return fmt.Errorf("calibration: %w", err)
		}
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	lines := strings.Split(string(b), "\n")

	metaText, err := flowMap(metaFields(meta))
	if err != nil {
		return err
	}
	if metaText == "{}" {
		metaText = ""
	}
	lines, err = setEntry(lines, "channels", name, metaText)
	if err != nil {
		return err
	}

	calText := ""
	if cal != nil {
		if calText, err = flowMap(calFields(*cal)); err != nil {
			return err
		}
	}
	if lines, err = setEntry(lines, "calibrations", name, calText); err != nil {
		return err
	}

	out := []byte(strings.Join(lines, "\n"))
	var check Profile
	dec := yaml.NewDecoder(bytes.NewReader(out))
	dec.KnownFields(true)
	if err := dec.Decode(&check); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("the edited profile would not load (%v); nothing was saved", err)
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

var colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type field struct {
	key string
	val any
}

func metaFields(m ChannelMeta) []field {
	var f []field
	add := func(k string, v any, keep bool) {
		if keep {
			f = append(f, field{k, v})
		}
	}
	add("label", m.Label, m.Label != "")
	add("unit", m.Unit, m.Unit != "")
	if m.Precision != nil {
		add("precision", *m.Precision, true)
	}
	add("color", m.Color, m.Color != "")
	add("group", m.Group, m.Group != "")
	add("pos", m.Pos, len(m.Pos) == 2)
	add("pinned", m.Pinned, m.Pinned)
	add("large", m.Large, m.Large)
	add("order", m.Order, m.Order != 0)
	for _, x := range []struct {
		k string
		v *float64
	}{{"warn_min", m.WarnMin}, {"warn_max", m.WarnMax}, {"crit_min", m.CritMin}, {"crit_max", m.CritMax}} {
		if x.v != nil {
			add(x.k, *x.v, true)
		}
	}
	return f
}

func calFields(c Calibration) []field {
	f := []field{{"type", c.Type}}
	switch c.Type {
	case "linear":
		f = append(f, field{"mult", c.Mult})
		if c.Div != 0 && c.Div != 1 {
			f = append(f, field{"div", c.Div})
		}
		f = append(f, field{"add", c.Add})
	case "poly":
		if len(c.Coeffs) > 0 {
			f = append(f, field{"coeffs", c.Coeffs})
		}
		if c.Degree > 0 {
			f = append(f, field{"degree", c.Degree})
		}
		if len(c.Points) > 0 {
			f = append(f, field{"points", c.Points})
		}
	case "table":
		f = append(f, field{"points", c.Points})
	case "steinhart_f":
		f = append(f, field{"points", c.Points})
		if c.RFixed != 0 {
			f = append(f, field{"r_fixed", c.RFixed})
		}
		if c.ADCMax != 0 {
			f = append(f, field{"adc_max", c.ADCMax})
		}
		if c.ThermistorToGround != nil {
			f = append(f, field{"thermistor_to_ground", *c.ThermistorToGround})
		}
	}
	return f
}

func flowMap(fields []field) (string, error) {
	n := &yaml.Node{Kind: yaml.MappingNode, Style: yaml.FlowStyle}
	for _, f := range fields {
		var k, v yaml.Node
		if err := k.Encode(f.key); err != nil {
			return "", err
		}
		if fl, ok := f.val.(float64); ok {
			v = yaml.Node{Kind: yaml.ScalarNode, Tag: "!!float", Value: strconv.FormatFloat(fl, 'g', -1, 64)}
			if !strings.ContainsAny(v.Value, ".eEn") {
				v.Value += ".0"
			}
		} else if err := v.Encode(f.val); err != nil {
			return "", err
		}
		v.Style |= yaml.FlowStyle
		n.Content = append(n.Content, &k, &v)
	}
	out, err := yaml.Marshal(n)
	if err != nil {
		return "", err
	}
	s := strings.TrimSpace(string(out))
	if inner, ok := strings.CutPrefix(s, "{"); ok && s != "{}" {
		s = "{ " + strings.TrimSuffix(inner, "}") + " }"
	}
	return s, nil
}

func indentOf(l string) int {
	return len(l) - len(strings.TrimLeft(l, " "))
}

func isTop(l string) bool {
	t := strings.TrimSpace(l)
	return t != "" && !strings.HasPrefix(t, "#") && indentOf(l) == 0
}

func entryKey(l string) (string, bool) {
	if indentOf(l) != 2 {
		return "", false
	}
	t := strings.TrimSpace(l)
	if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "-") {
		return "", false
	}
	var m map[string]yaml.Node
	if err := yaml.Unmarshal([]byte(t+"\n"), &m); err == nil && len(m) == 1 {
		for k := range m {
			return k, true
		}
	}
	i := strings.Index(t, ":")
	if i <= 0 {
		return "", false
	}
	var k string
	if yaml.Unmarshal([]byte(t[:i]), &k) != nil {
		return "", false
	}
	return k, true
}

func setEntry(lines []string, section, key, value string) ([]string, error) {
	keyText, err := yaml.Marshal(key)
	if err != nil {
		return nil, err
	}
	newLine := "  " + strings.TrimSpace(string(keyText)) + ": " + value

	head := -1
	for i, l := range lines {
		if isTop(l) && (strings.HasPrefix(l, section+":")) {
			head = i
			break
		}
	}
	if head < 0 {
		if value == "" {
			return lines, nil
		}
		for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
			lines = lines[:len(lines)-1]
		}
		return append(lines, "", section+":", newLine, ""), nil
	}
	rest := strings.TrimSpace(strings.TrimPrefix(lines[head], section+":"))
	if rest != "" && !strings.HasPrefix(rest, "#") {
		if rest != "{}" {
			return nil, fmt.Errorf("can't edit %q: it isn't written as one entry per line", section)
		}
		lines[head] = section + ":"
	}
	end := len(lines)
	for i := head + 1; i < len(lines); i++ {
		if isTop(lines[i]) {
			end = i
			break
		}
	}

	at, stop := -1, -1
	last := head
	for i := head + 1; i < end; i++ {
		t := strings.TrimSpace(lines[i])
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		last = i
		if k, ok := entryKey(lines[i]); ok && k == key && at < 0 {
			at = i
			stop = i + 1
			for stop < end && indentOf(lines[stop]) > 2 && strings.TrimSpace(lines[stop]) != "" {
				stop++
			}
		}
	}

	out := append([]string(nil), lines[:0]...)
	switch {
	case at >= 0 && value == "":
		out = append(append(out, lines[:at]...), lines[stop:]...)
	case at >= 0:
		out = append(append(append(out, lines[:at]...), newLine), lines[stop:]...)
	case value == "":
		return lines, nil
	default:
		for last+1 < end && indentOf(lines[last+1]) > 2 && strings.TrimSpace(lines[last+1]) != "" {
			last++
		}
		out = append(append(append(out, lines[:last+1]...), newLine), lines[last+1:]...)
	}
	return out, nil
}

func SaveCar(file string, car Car) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var vals []field
	for _, f := range []struct {
		key string
		v   float64
	}{
		{"mass", car.Mass}, {"wheelbase", car.Wheelbase}, {"cg_height", car.CGHeight},
		{"rear_weight", car.RearWeight}, {"tire_radius", car.TireRadius}, {"tire_mu", car.TireMu},
		{"primary", car.Primary},
	} {
		if f.v != 0 {
			vals = append(vals, field{f.key, f.v})
		}
	}
	block := []string{"car:"}
	for _, f := range vals {
		text, err := flowValue(f.val)
		if err != nil {
			return err
		}
		block = append(block, "  "+f.key+": "+text)
	}
	if len(car.Gears) > 0 {
		parts := make([]string, len(car.Gears))
		for i, g := range car.Gears {
			parts[i] = strconv.FormatFloat(g, 'g', -1, 64)
		}
		block = append(block, "  gears: ["+strings.Join(parts, ", ")+"]")
	}
	for _, f := range []struct {
		key string
		v   float64
	}{
		{"final_drive", car.FinalDrive}, {"redline", car.Redline}, {"launch_gear", car.LaunchGear},
		{"slip_low", car.SlipLow}, {"slip_high", car.SlipHigh}, {"target_g", car.TargetG},
		{"cla", car.ClA}, {"cda", car.CdA}, {"aero_front", car.AeroFront},
		{"air_density", car.AirDensity},
	} {
		if f.v != 0 {
			block = append(block, "  "+f.key+": "+strconv.FormatFloat(f.v, 'g', -1, 64))
		}
	}

	lines := strings.Split(string(b), "\n")
	head := -1
	for i, l := range lines {
		if isTop(l) && strings.HasPrefix(l, "car:") {
			head = i
			break
		}
	}
	var out []string
	if head < 0 {
		for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
			lines = lines[:len(lines)-1]
		}
		out = append(lines, "", "# Car specs used by the analysis tools (Car tab in the app).")
		if len(block) > 1 {
			out = append(out, block...)
		}
		out = append(out, "")
	} else {
		end := len(lines)
		for i := head + 1; i < len(lines); i++ {
			if isTop(lines[i]) {
				end = i
				break
			}
		}
		for end > head+1 && strings.TrimSpace(lines[end-1]) == "" {
			end--
		}
		out = append(out, lines[:head]...)
		if len(block) > 1 {
			out = append(out, block...)
		}
		out = append(out, lines[end:]...)
	}

	text := []byte(strings.Join(out, "\n"))
	var check Profile
	dec := yaml.NewDecoder(bytes.NewReader(text))
	dec.KnownFields(true)
	if err := dec.Decode(&check); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("the edited profile would not load (%v); nothing was saved", err)
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, text, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

func flowValue(v any) (string, error) {
	if f, ok := v.(float64); ok {
		return strconv.FormatFloat(f, 'g', -1, 64), nil
	}
	out, err := yaml.Marshal(v)
	return strings.TrimSpace(string(out)), err
}
