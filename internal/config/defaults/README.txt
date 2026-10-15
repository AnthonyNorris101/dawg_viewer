Dawg Viewer configuration folder
================================

settings.yaml   App settings: which device to connect to, refresh rate, etc.
devices/        One YAML file per device the app can read data from. Copy a
                file and change its "id" to add a new car, logger or simulator.
cache/          Written by the app (e.g. the last known signal names for each
                device). Safe to delete.
logs/           Downloaded and converted logs (unless settings.yaml says
                otherwise).

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
