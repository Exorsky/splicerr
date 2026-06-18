# Splicerr v1.0.14 — DAW Bridge

Temporary fork of [Robert-K/splicerr](https://github.com/Robert-K/splicerr) that restores functionality and adds DAW bridge sync.

## New

- Splicerr Bridge plugin for DAW sync, bundled as AU and VST3.
- Bridge installer in Settings with Install/Reinstall/Uninstall actions.
- DAW transport sync for play/stop, BPM, bar position, loops, and one-shot triggers.
- DAW-mode drag-and-drop for the currently selected sample stretched to the host BPM.

## Fixes

- The app preview is muted automatically while connected to the DAW.
- Bridge audio now renders directly inside the DAW plugin.
- Waveform and player progress now follow the plugin's real sample cursor.
- One-shot waveform progress now resets between bar triggers instead of looking permanently active.
- Closing the macOS window now hides it and reopening Splicerr brings the main window back.
- Bridge installer labels are now in English.

## Included from previous releases

- Collections: create local collections, Likes, tag filtering, export to `.zip`, and toast notifications.
- Transpose: shift samples by key or by semitones, tempo-preserving, applied to both preview playback and exported WAV.
- Drag-and-drop crash fix on macOS Sequoia and the Cloudflare 403 fix.

## Downloads

- Windows: `.exe` installer or `.msi`
- macOS: `.dmg` for Apple Silicon and Intel
- Linux: `.AppImage`, `.deb`, `.rpm`

Once the headers fix is merged upstream, please switch back to the original repo. All credit to the original authors.
