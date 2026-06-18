# Splicerr Bridge

JUCE DAW bridge plugin for Splicerr.

The plugin reads the host playhead and sends UDP JSON packets to the Splicerr
app on `127.0.0.1:37651`. Splicerr listens automatically while the app is open
and uses those packets to sync preview play/stop, playback BPM, and the first
beat of each 4-bar phrase.

For DAW audio output, Splicerr renders the currently selected sample as a WAV
file and sends the file path to the plugin on the dynamic control port reported
in each sync packet. The plugin loads that WAV and renders it directly in the
DAW audio callback, locked to the host PPQ position. Loops follow the current
4-bar phrase phase; one-shot samples are detected by duration (up to 3 seconds)
and trigger once at the start of each bar, then play to completion.

## Build

```sh
cmake -S plugins/splicerr-daw-bridge -B plugins/splicerr-daw-bridge/build -DCMAKE_BUILD_TYPE=Release
cmake --build plugins/splicerr-daw-bridge/build --config Release
```

The CMake configure step downloads JUCE `8.0.13` with `FetchContent`.

On macOS, the build creates AU, VST3, and Standalone targets. With
`COPY_PLUGIN_AFTER_BUILD` enabled, JUCE also copies plugin bundles to the
standard user plugin folders when possible.

## Protocol

Example packet:

```json
{
  "source": "splicerr-bridge",
  "version": 1,
  "playing": true,
  "bpm": 128.0,
  "ppqPosition": 42.0,
  "timeInSeconds": 19.25,
  "packetSentAtMs": 1781808000000,
  "audioPort": 49231,
  "timeSignatureNumerator": 4,
  "timeSignatureDenominator": 4,
  "sampleRate": 48000.0
}
```

Sample load packet sent by the app to `audioPort`:

```json
{
  "source": "splicerr-app",
  "version": 1,
  "uuid": "sample-uuid",
  "path": "/absolute/path/to/rendered.wav",
  "oneShot": false,
  "durationMs": 8000,
  "sourceBpm": 120,
  "renderedBpm": 128
}
```
