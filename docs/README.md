# Dawg Viewer documentation

The code is kept free of comments; the reasoning behind it lives here.

| Document | Covers |
|---|---|
| [architecture.md](architecture.md) | How the whole system fits together: data model, what runs where, how backend and frontend talk, concurrency |
| [backend.md](backend.md) | The Go packages one by one and the decisions inside them |
| [frontend.md](frontend.md) | The React app: live store, plots, follow mode, why most updates bypass React |
| [configuration.md](configuration.md) | The config folder, settings and device profiles |
| [device-protocol.md](device-protocol.md) | What a device (ILTM, UNO Q) must send for the app to read it |
| [development.md](development.md) | just commands, the simulator, tests, CI and releases |
