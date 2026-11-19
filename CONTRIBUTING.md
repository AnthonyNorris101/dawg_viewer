# Contributing

Thanks for helping improve Dawg Viewer. Keep changes focused, preserve existing device and log formats, and include tests when behavior changes.

## Set up

Install Go, Node.js, the Wails v3 CLI, and [just](https://just.systems). From the repository root:

```sh
just install
just simulate
```

Run `just` to see available commands. Before submitting a change, run `just test` when practical. Go service changes may require regenerating frontend bindings with `just bindings`.

## Documentation

Update the relevant guide when a change affects user workflows, configuration, device compatibility, architecture, development, or releases. Keep the README concise and link to detailed guides. AI contributors should follow [the documentation guidelines](docs/ai-documentation-guidelines.md).

See [docs/development.md](docs/development.md) for CI and release details, and [docs/README.md](docs/README.md) for the documentation index.
