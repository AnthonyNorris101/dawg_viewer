package main

import (
	"flag"
	"fmt"
	"os"
	"regexp"
)

type spot struct {
	file string
	re   *regexp.Regexp
}

var spots = []spot{
	{"build/config.yml", regexp.MustCompile(`(?m)^(  version: ")([^"]*)(")`)},
	{"build/windows/info.json", regexp.MustCompile(`("file_version": ")([^"]*)(")`)},
	{"build/windows/info.json", regexp.MustCompile(`("ProductVersion": ")([^"]*)(")`)},
	{"build/darwin/Info.plist", regexp.MustCompile(`(<key>CFBundleShortVersionString</key>\s*<string>)([^<]*)(</string>)`)},
	{"build/darwin/Info.plist", regexp.MustCompile(`(<key>CFBundleVersion</key>\s*<string>)([^<]*)(</string>)`)},
	{"build/darwin/Info.dev.plist", regexp.MustCompile(`(<key>CFBundleShortVersionString</key>\s*<string>)([^<]*)(</string>)`)},
	{"build/darwin/Info.dev.plist", regexp.MustCompile(`(<key>CFBundleVersion</key>\s*<string>)([^<]*)(</string>)`)},
	{"build/linux/nfpm/nfpm.yaml", regexp.MustCompile(`(?m)^(version: ")([^"]*)(")`)},
}

var semver = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

func main() {
	check := flag.Bool("check", false, "fail if the files don't all have the same version")
	flag.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: setversion [-check] [X.Y.Z]")
		flag.PrintDefaults()
	}
	flag.Parse()

	if flag.NArg() == 0 {
		current, err := currentVersions()
		if err != nil {
			fail(err)
		}
		mismatch := false
		for _, c := range current {
			if c.version != current[0].version {
				mismatch = true
			}
		}
		if mismatch {
			for _, c := range current {
				fmt.Printf("  %-28s %s\n", c.file, c.version)
			}
			fail(fmt.Errorf("versions differ; run `just version X.Y.Z` to set them all"))
		}
		fmt.Println(current[0].version)
		return
	}
	if *check {
		fail(fmt.Errorf("-check takes no version"))
	}

	v := flag.Arg(0)
	if !semver.MatchString(v) {
		fail(fmt.Errorf("%q isn't a version like 1.2.3", v))
	}
	for _, s := range spots {
		b, err := os.ReadFile(s.file)
		if err != nil {
			fail(err)
		}
		if n := len(s.re.FindAllIndex(b, -1)); n != 1 {
			fail(fmt.Errorf("%s: expected one version field matching %s, found %d", s.file, s.re, n))
		}
		b = s.re.ReplaceAll(b, []byte("${1}"+v+"${3}"))
		if err := os.WriteFile(s.file, b, 0o644); err != nil {
			fail(err)
		}
	}
	fmt.Println("version set to", v)
}

type found struct {
	file    string
	version string
}

func currentVersions() ([]found, error) {
	var out []found
	for _, s := range spots {
		b, err := os.ReadFile(s.file)
		if err != nil {
			return nil, err
		}
		m := s.re.FindSubmatch(b)
		if m == nil {
			return nil, fmt.Errorf("%s: no version field matching %s", s.file, s.re)
		}
		out = append(out, found{s.file, string(m[2])})
	}
	return out, nil
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "setversion:", err)
	os.Exit(1)
}
