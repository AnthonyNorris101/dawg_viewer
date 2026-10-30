set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

# List the available commands
default:
    @just --list --unsorted

# Install Go and frontend dependencies
install:
    go mod download
    npm --prefix frontend install

# Run the app with hot reload
run:
    wails3 dev

# Run the app fed by the logger simulator; closing the app stops it (e.g. `just simulate -rate 20`)
[unix]
simulate *args: build-sim
    bin/iltm-sim {{ args }} & sim=$!; trap 'kill $sim 2>/dev/null' EXIT INT TERM; wails3 dev

# Run the app fed by the logger simulator; closing the app stops it (e.g. `just simulate -rate 20`)
[windows]
simulate *args: build-sim
    $sim = Start-Process -FilePath bin/iltm-sim.exe {{ if args == "" { "" } else { "-ArgumentList '" + args + "'" } }} -NoNewWindow -PassThru; try { wails3 dev } finally { Stop-Process -Id $sim.Id -ErrorAction SilentlyContinue }

# Run only the simulated logger, e.g. alongside an already running or built app
sim *args:
    go run ./cmd/iltm-sim {{ args }}

[private]
build-sim:
    go build -o bin/iltm-sim{{ if os_family() == "windows" { ".exe" } else { "" } }} ./cmd/iltm-sim

# Run every test and check: Go tests, then frontend tests, types, lint and formatting
test: test-go test-web

# Go tests only (pass a package to narrow it, e.g. `just test-go ./internal/live`)
test-go *pkgs="./...":
    go vet {{ pkgs }}
    go test {{ pkgs }}

# Go tests with the race detector (needs a C compiler)
test-race *pkgs="./...":
    go test -race {{ pkgs }}

# Frontend tests, type check, lint and formatting check
test-web:
    npm --prefix frontend run test
    npm --prefix frontend run typecheck
    npm --prefix frontend run lint
    npm --prefix frontend run format:check

# Fuzz the ITV decoder for a while (default 30s)
fuzz time="30s":
    go test ./internal/itv -run '^$' -fuzz FuzzDecode -fuzztime {{ time }}

# Format Go and frontend code
fmt:
    gofmt -w internal services cmd main.go
    npm --prefix frontend run format

# Regenerate the TypeScript bindings after changing Go services
bindings:
    wails3 generate bindings -clean=true -ts -i

# Show the app version, or set it everywhere (e.g. `just version 0.2.0`)
version *new:
    go run ./cmd/setversion {{ new }}

# Build the app for this OS into bin/
build:
    wails3 build

# Build an installer/package for this OS
package:
    wails3 package

# Delete build output
[unix]
clean:
    rm -rf bin frontend/dist .task

# Delete build output
[windows]
clean:
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue bin, frontend/dist, .task
