# Bridge plugin bundles

This directory holds the **Splicerr Bridge** audio plugin bundles that Tauri
ships as app resources. They are intentionally **not committed** — they are
built from source in [`plugins/splicerr-daw-bridge`](../../../plugins/splicerr-daw-bridge)
so that the shipped binaries provably match the auditable C++ source.

Expected contents after a build:

| Platform | Bundle(s) |
| --- | --- |
| macOS   | `Splicerr Bridge.component` (AU) + `Splicerr Bridge.vst3` |
| Windows | `Splicerr Bridge.vst3` |

## Build locally

```sh
cmake -B plugins/splicerr-daw-bridge/build -S plugins/splicerr-daw-bridge -DCMAKE_BUILD_TYPE=Release
cmake --build plugins/splicerr-daw-bridge/build --config Release
```

Then copy the produced bundles from
`plugins/splicerr-daw-bridge/build/SplicerrBridge_artefacts/Release/{AU,VST3}/`
into this folder. CI does this automatically during release builds.
