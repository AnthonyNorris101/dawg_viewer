# Contributing

Thanks for helping improve Dawg Viewer. This guide is the contributor hub: it links to setup, development workflow, documentation standards, and technical references. Keep changes focused, preserve existing device and log formats, and include tests when behavior changes.

## Set up

Install Go, Node.js, the Wails v3 CLI, and [just](https://just.systems). From the repository root:

```sh
just install
just simulate
```

Run `just` to see available commands. Before submitting a change, run `just test` when practical. Go service changes may require regenerating frontend bindings with `just bindings`.

## Documentation

Update the relevant guide when a change affects user workflows, configuration, device compatibility, architecture, development, or releases. Keep the root README focused on using the app; use the technical [documentation overview](docs/README.md) for implementation references. AI contributors should follow [the documentation guidelines](docs/ai-documentation-guidelines.md).

## Contributor references

- [Development workflow](docs/development.md): toolchain, commands, tests, CI, builds, and releases.
- [AI documentation guidelines](docs/ai-documentation-guidelines.md): source of truth, organization, and writing standards.
- [Technical overview](docs/README.md): repository map, interfaces, constraints, and links to implementation guides.
- [Architecture](docs/architecture.md): data flow, concurrency, timing, and memory ownership.
- [Backend guide](docs/backend.md): Go packages and services.
- [Frontend guide](docs/frontend.md): UI structure, rendering, and analysis ownership.
- [Configuration reference](docs/configuration.md): settings and device profiles.
- [Device protocol](docs/device-protocol.md): logger and relay interface.
- [User guide](docs/user-guide.md): application workflows and analysis tools.
