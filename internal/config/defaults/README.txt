Dawg Viewer configuration folder
================================

settings.yaml   App settings: which device to connect to, refresh rate, etc.
devices/        One YAML file per device the app can read data from. Copy a
                file and change its "id" to add a new car, logger or simulator.
cache/          Written by the app: the last known signal names for each
                device, and which built-in device profiles you've been given.
                Safe to delete; built-in profiles you removed come back once.
logs/           Downloaded and converted logs, and backups of live sessions
                (unless settings.yaml says otherwise). "Run-1 sample.csv" is
                a real G26 log that comes with the app; delete it if you
                don't want it, it is not written again.
maps/           Written by the app: map imagery downloaded for the track maps,
                kept so the maps still work with no internet. Safe to delete.
presets/        Setups made in the app (sheets, plots, made channels, track,
                launch, Sim, damper and split settings), one file each. The
                app saves the setup in use as you work. Copy them to share.
session.json    Written by the app: which setup is in use, the last log, the
                view that is not a setup, and small choices such as the map
                background. Safe to delete; the app then starts fresh.
tracks/         Tracks saved from the simulator's Lap page, one file each.
                Copy them to share a track.
track-search/   Written by the app: answers from online track searches, kept
                so the same search works with no internet. Safe to delete.

All files are plain text and can be edited with any editor. Restart the app,
or use "Reload" in the live view, to pick up changes.

Where the app looks for this folder, in order:
  1. The folder given with --config <folder> or the DAWG_CONFIG environment
     variable.
  2. A folder named "dawg_config" next to the app (next to the .app bundle on
     macOS). Put one there to make a portable copy you can carry on a USB
     stick or share with the team.
  3. Your user configuration folder:
       Windows  %AppData%\DawgViewer
       macOS    ~/Library/Application Support/DawgViewer
       Linux    ~/.config/DawgViewer
     The app creates this with default files on first run.
