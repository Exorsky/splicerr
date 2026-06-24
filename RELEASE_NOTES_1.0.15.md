# Splicerr v1.0.15 - UI Refresh

Temporary fork of [Robert-K/splicerr](https://github.com/Robert-K/splicerr) that restores functionality and adds DAW bridge sync.

## New

- Refreshed macOS-style dark Liquid Glass interface based on the new UI mockup.
- Updated sidebar, search controls, filters, result rows, waveform surface, and floating player styling.
- Waveforms are larger and more prominent in the results list.
- Version bumped to `1.0.15`.

## Notes

- The bundled AU and VST3 bridge plugins remain included in the app bundle.

## Fixes

- Improved DAW-mode stability when switching samples with transpose enabled.
- Reduced memory pressure during pitch-shift and tempo-stretch rendering.
- Prevented overlapping DAW sample renders when changing samples quickly.
- DAW-mode sample selection no longer renders a muted local preview before loading the bridge.
- DAW bridge audio rendering now runs in a Web Worker so long pitch-shifted samples cannot block the UI thread.
- Changing samples while a bridge render is in progress now cancels the current worker job.
- Descrambled/transposed preview blobs are capped to prevent memory growth while browsing deep result lists.
- Rendered WAV files are written in chunks to avoid long UI-blocking filesystem IPC calls.
- Cached DAW renders no longer read the full WAV back into the WebView, avoiding freezes after several pitch-shifted samples.
- DAW-mode sample play buttons now start on the first click instead of requiring a second click after selection.
- Selecting a different sample in DAW mode now re-enables bridge playback if it had been paused from Splicerr.
- DAW bridge renders now use abortable temporary bytes instead of persistent app preview blobs.
- Audio decode for DAW bridge renders now uses isolated AudioContexts that are closed after each render.
- Audio channel transfer to the render Worker is chunked across animation frames to keep the UI responsive.
- Repeated DAW packets no longer repeatedly cancel the same in-flight render while waiting to load the latest selected sample.
- Pitch shift and tempo stretch for DAW bridge renders now run in one combined SoundTouch pass, cutting CPU and temporary buffer pressure when transpose is enabled.
- In-flight pitch renders are no longer force-terminated when selecting another sample; stale renders finish off-thread and are discarded, then only the latest selected sample is loaded.
- Cold sample audio downloads now prefer direct WebView fetch with Tauri HTTP fallback, avoiding large audio file transfers through Tauri IPC before pitch rendering.
- DAW bridge sample loading is briefly debounced so rapid clicks across new samples render only the final selected sample.
- Waveform fetches also prefer direct browser fetch and correctly clear loading state after failures.
- App preview pitch rendering now runs in the audio Worker instead of the UI thread, fixing freezes after changing transpose key during browsing.
- Changing transpose while connected to the DAW no longer reloads the muted local preview; the bridge re-renders the synced sample instead.
- In bridge playback, changing transpose key defers re-rendering the current sample; if another sample is selected immediately after, only the newly selected sample is rendered.

## Included from v1.0.14

- Splicerr Bridge plugin for DAW sync, bundled as AU and VST3.
- Bridge installer in Settings with Install/Reinstall/Uninstall actions.
- DAW transport sync for play/stop, BPM, bar position, loops, and one-shot triggers.
- DAW-mode drag-and-drop for the currently selected sample stretched to the host BPM.
- App preview mute while connected to the DAW.
- Bridge audio rendering directly inside the DAW plugin.
- Waveform and player progress following the plugin's real sample cursor.
- macOS window close/reopen fix.
