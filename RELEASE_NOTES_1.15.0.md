# Splicerr v1.15.0 — DAW Bridge + UI refresh

Temporary fork of [Robert-K/splicerr](https://github.com/Robert-K/splicerr) that
restores functionality and adds DAW bridge sync.

## New

- **Refreshed UI** — macOS-style dark "Liquid Glass" interface: updated sidebar,
  search, filters, result rows, waveform surface, and floating player, with larger
  and more prominent waveforms.
- **Splicerr Bridge plugin** for DAW sync — AU + VST3 on macOS, VST3 on Windows.
- **Bridge installer in Settings** with Install/Reinstall/Uninstall actions.
  Installs into the system plug-in folders so any DAW finds it; this asks for
  administrator rights (UAC on Windows, your password on macOS).
- **Clickable install path** in Settings — reveals the installed plugin in your
  file manager.
- DAW transport sync for play/stop, BPM, bar position, loops, and one-shot triggers.
- DAW-mode drag-and-drop for the currently selected sample stretched to the host BPM.

## Fixes

- DAW bridge audio rendering now runs in a **Web Worker**, so long pitch-shifted
  samples no longer freeze the UI.
- Pitch shift and tempo stretch run in one combined SoundTouch pass; renders are
  abortable and cancel stale jobs when you switch samples quickly.
- Lower memory pressure while browsing — capped preview blobs, chunked WAV writes,
  isolated AudioContexts closed after each render, and cached renders no longer read
  full WAVs back into the WebView.
- Cold audio/waveform downloads prefer a direct WebView fetch (with Tauri HTTP
  fallback), avoiding large transfers through IPC before rendering.
- DAW-mode play buttons start on the first click; selecting a sample re-enables
  bridge playback; changing transpose re-renders the synced sample instead of the
  muted local preview.
- The app preview is muted automatically while connected to the DAW.
- Bridge audio renders directly inside the DAW plugin; waveform and player progress
  follow the plugin's real sample cursor.
- One-shot waveform progress resets between bar triggers.
- (macOS) Closing the window hides it and reopening brings it back.

## Build & transparency

- The Splicerr Bridge plugin is **built from source in CI**, not shipped as a
  prebuilt binary — so the bundled plugin matches the public C++ in
  `plugins/splicerr-daw-bridge`.

## Credits

- The UI refresh and DAW-mode stability work in this release come from
  [@dre4moff](https://github.com/dre4moff)'s pull request — thank you!
- All credit to the original authors — please ⭐ the original
  [splicedd](https://github.com/ascpixi/splicedd) and
  [splicerr](https://github.com/Robert-K/splicerr).
