use std::collections::HashMap;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::{oneshot, Notify};

/// The Splice GraphQL endpoint. The hidden bridge webview is parked on this exact
/// URL so that its in-page `fetch("/graphql")` is same-origin.
const SPLICE_GRAPHQL_URL: &str = "https://surfaces-graphql.splice.com/graphql";

/// Label of the hidden webview that proxies requests through a real browser engine.
const BRIDGE_LABEL: &str = "splice-bridge";

/// Injected into the remote Splice page. It waits for the Tauri API to be present,
/// then relays `splice-request` events into a same-origin `fetch` and invokes
/// `splice_response` with the raw response text. Running the request from *inside*
/// the page's origin is what defeats Cloudflare: the request carries the page's
/// `__cf_bm` cookie and the real engine's TLS fingerprint, so it is never
/// challenged. (A native HTTP client — reqwest/curl/undici — always gets a 403
/// `cf-mitigated: challenge` regardless of headers.)
const BRIDGE_INIT_JS: &str = r#"
(function () {
  function apiReady() {
    return window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.core;
  }
  function start() {
    var event = window.__TAURI__.event;
    var core = window.__TAURI__.core;
    event.listen("splice-request", async function (e) {
      var id = e.payload.id;
      var body = e.payload.body;
      var op = "SamplesSearch";
      try { op = JSON.parse(body).operationName || op; } catch (_) {}
      try {
        var r = await fetch("/graphql", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "apollo-require-preflight": "true",
            "x-apollo-operation-name": op,
          },
          body: body,
        });
        var text = await r.text();
        if (!r.ok) {
          text = JSON.stringify({ errors: [{ message: "HTTP " + r.status + ": " + text.slice(0, 200) }] });
        }
        core.invoke("splice_response", { id: id, text: text });
      } catch (err) {
        core.invoke("splice_response", {
          id: id,
          text: JSON.stringify({ errors: [{ message: String(err) }] }),
        });
      }
    });
    core.invoke("splice_bridge_ready");
  }
  var timer = setInterval(function () {
    if (apiReady()) { clearInterval(timer); start(); }
  }, 50);
})();
"#;

/// Local UDP port used by the DAW bridge plugin. The plugin sends small JSON
/// packets here with host transport and tempo data.
const DAW_SYNC_PORT: u16 = 37651;
const BRIDGE_COMPONENT_RESOURCE: &str = "resources/plugins/Splicerr Bridge.component";
const BRIDGE_VST3_RESOURCE: &str = "resources/plugins/Splicerr Bridge.vst3";
const SYSTEM_COMPONENTS_DIR: &str = "/Library/Audio/Plug-Ins/Components";
const SYSTEM_VST3_DIR: &str = "/Library/Audio/Plug-Ins/VST3";

/// Shared state correlating in-flight requests with the bridge webview's replies.
#[derive(Default)]
struct BridgeState {
    pending: Mutex<HashMap<u64, oneshot::Sender<String>>>,
    counter: AtomicU64,
    ready: AtomicBool,
    ready_notify: Notify,
}

struct DawAudioState {
    socket: UdpSocket,
    counter: AtomicU64,
}

impl DawAudioState {
    fn new() -> Result<Self, String> {
        let socket = UdpSocket::bind(("127.0.0.1", 0))
            .map_err(|e| format!("Failed to bind DAW audio UDP sender: {e}"))?;

        Ok(Self {
            socket,
            counter: AtomicU64::new(0),
        })
    }
}

#[derive(Clone, serde::Serialize)]
struct SpliceRequest {
    id: u64,
    body: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DawSamplePacket {
    source: &'static str,
    version: u8,
    uuid: String,
    path: String,
    one_shot: bool,
    duration_ms: f64,
    source_bpm: Option<f64>,
    rendered_bpm: Option<f64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DawControlPacket {
    source: &'static str,
    version: u8,
    playback_enabled: bool,
}

/// Sends a GraphQL request to Splice by relaying it through the hidden bridge
/// webview (a real browser engine). Keeps the same name/signature the frontend
/// already invokes, so callers are unchanged.
#[tauri::command]
async fn splice_graphql(app: tauri::AppHandle, body: String) -> Result<String, String> {
    let state = app.state::<BridgeState>();

    // Wait for the bridge page to finish loading on first use. Build the
    // `notified()` future before re-checking the flag to avoid a lost wakeup.
    if !state.ready.load(Ordering::SeqCst) {
        let notified = state.ready_notify.notified();
        if !state.ready.load(Ordering::SeqCst) {
            tokio::time::timeout(Duration::from_secs(30), notified)
                .await
                .map_err(|_| "Splice bridge webview did not become ready".to_string())?;
        }
    }

    let id = state.counter.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(id, tx);

    app.emit_to(BRIDGE_LABEL, "splice-request", SpliceRequest { id, body })
        .map_err(|e| {
            state.pending.lock().unwrap().remove(&id);
            e.to_string()
        })?;

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(_)) => Err("Splice bridge dropped the response".into()),
        Err(_) => {
            state.pending.lock().unwrap().remove(&id);
            Err("Splice request timed out".into())
        }
    }
}

/// Called by the bridge webview with the raw response text for a request `id`.
#[tauri::command]
fn splice_response(app: tauri::AppHandle, id: u64, text: String) {
    let state = app.state::<BridgeState>();
    let sender = state.pending.lock().unwrap().remove(&id);
    if let Some(tx) = sender {
        let _ = tx.send(text);
    }
}

/// Opens the webview devtools for the main window. The `devtools` Cargo feature
/// keeps `open_devtools` available in release builds too, not just debug.
#[tauri::command]
fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.open_devtools();
    Ok(())
}

/// Called once by the bridge webview after it has loaded and wired up its listener.
#[tauri::command]
fn splice_bridge_ready(app: tauri::AppHandle) {
    let state = app.state::<BridgeState>();
    state.ready.store(true, Ordering::SeqCst);
    state.ready_notify.notify_waiters();
}

#[tauri::command]
fn daw_audio_chunk(
    app: tauri::AppHandle,
    audio_port: u16,
    channels: u8,
    frames: u16,
    samples_base64: String,
) -> Result<(), String> {
    if audio_port == 0 {
        return Err("DAW audio port is not ready".into());
    }

    if channels == 0 || channels > 2 {
        return Err("DAW audio packets support one or two channels".into());
    }

    let sample_bytes = base64::engine::general_purpose::STANDARD
        .decode(samples_base64)
        .map_err(|e| format!("Invalid DAW audio base64 packet: {e}"))?;

    let expected = channels as usize * frames as usize * std::mem::size_of::<f32>();
    if sample_bytes.len() != expected {
        return Err(format!(
            "Invalid DAW audio packet: expected {expected} bytes, got {}",
            sample_bytes.len()
        ));
    }

    let state = app.state::<DawAudioState>();
    let sequence = state.counter.fetch_add(1, Ordering::Relaxed);
    let mut packet = Vec::with_capacity(16 + sample_bytes.len());

    packet.extend_from_slice(b"SPAU");
    packet.extend_from_slice(&sequence.to_le_bytes());
    packet.push(channels);
    packet.push(0);
    packet.extend_from_slice(&frames.to_le_bytes());
    packet.extend_from_slice(&sample_bytes);

    state
        .socket
        .send_to(&packet, ("127.0.0.1", audio_port))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn daw_load_sample(
    app: tauri::AppHandle,
    audio_port: u16,
    uuid: String,
    path: String,
    one_shot: bool,
    duration_ms: f64,
    source_bpm: Option<f64>,
    rendered_bpm: Option<f64>,
) -> Result<(), String> {
    if audio_port == 0 {
        return Err("DAW audio/control port is not ready".into());
    }

    let packet = DawSamplePacket {
        source: "splicerr-app",
        version: 1,
        uuid,
        path,
        one_shot,
        duration_ms,
        source_bpm,
        rendered_bpm,
    };
    let payload =
        serde_json::to_vec(&packet).map_err(|e| format!("Invalid DAW sample packet: {e}"))?;
    let state = app.state::<DawAudioState>();
    let mut datagram = Vec::with_capacity(4 + payload.len());

    datagram.extend_from_slice(b"SPSM");
    datagram.extend_from_slice(&payload);

    state
        .socket
        .send_to(&datagram, ("127.0.0.1", audio_port))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn daw_set_playback_enabled(
    app: tauri::AppHandle,
    audio_port: u16,
    playback_enabled: bool,
) -> Result<(), String> {
    if audio_port == 0 {
        return Err("DAW audio/control port is not ready".into());
    }

    let packet = DawControlPacket {
        source: "splicerr-app",
        version: 1,
        playback_enabled,
    };
    let payload =
        serde_json::to_vec(&packet).map_err(|e| format!("Invalid DAW control packet: {e}"))?;
    let state = app.state::<DawAudioState>();
    let mut datagram = Vec::with_capacity(4 + payload.len());

    datagram.extend_from_slice(b"SPCT");
    datagram.extend_from_slice(&payload);

    state
        .socket
        .send_to(&datagram, ("127.0.0.1", audio_port))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn bridge_resource_path(app: &tauri::AppHandle, resource: &str) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to locate app resources: {e}"))?;
    let path = resource_dir.join(resource);

    if !path.exists() {
        return Err(format!("Bridge resource not found: {}", path.display()));
    }

    Ok(path)
}

fn plugin_install_script(source: &Path, destination_dir: &str) -> String {
    let destination = Path::new(destination_dir).join(
        source
            .file_name()
            .expect("bridge plugin resource must have a file name"),
    );
    let quoted_source = shell_quote(source);
    let quoted_destination = shell_quote(&destination);
    let quoted_destination_dir = shell_quote(Path::new(destination_dir));

    [
        format!("mkdir -p {quoted_destination_dir}"),
        format!("rm -rf {quoted_destination}"),
        format!("ditto {quoted_source} {quoted_destination}"),
        format!("xattr -cr {quoted_destination}"),
        format!("xattr -r -d com.apple.quarantine {quoted_destination} 2>/dev/null || true"),
        format!("codesign --force --deep --sign - {quoted_destination}"),
    ]
    .join(" && ")
}

fn plugin_remove_script(destination_dir: &str, bundle_name: &str) -> String {
    let destination = Path::new(destination_dir).join(bundle_name);
    format!("rm -rf {}", shell_quote(&destination))
}

fn bridge_plugins_installed_paths() -> bool {
    Path::new(SYSTEM_COMPONENTS_DIR)
        .join("Splicerr Bridge.component")
        .exists()
        && Path::new(SYSTEM_VST3_DIR)
            .join("Splicerr Bridge.vst3")
            .exists()
}

#[tauri::command]
fn bridge_plugins_installed() -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Ok(false);
    }

    #[cfg(target_os = "macos")]
    {
        Ok(bridge_plugins_installed_paths())
    }
}

#[tauri::command]
fn install_bridge_plugins(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("Bridge plugin installation is only supported on macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        let component = bridge_resource_path(&app, BRIDGE_COMPONENT_RESOURCE)?;
        let vst3 = bridge_resource_path(&app, BRIDGE_VST3_RESOURCE)?;
        let script = [
            plugin_install_script(&component, SYSTEM_COMPONENTS_DIR),
            plugin_install_script(&vst3, SYSTEM_VST3_DIR),
        ]
        .join(" && ");
        let osascript = format!(
            "do shell script {:?} with administrator privileges",
            script
        );
        let output = Command::new("osascript")
            .arg("-e")
            .arg(osascript)
            .output()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "Bridge installation failed: {}{}",
                stderr,
                stdout
            ));
        }

        Ok(format!(
            "Installed Splicerr Bridge to {SYSTEM_COMPONENTS_DIR} and {SYSTEM_VST3_DIR}"
        ))
    }
}

#[tauri::command]
fn uninstall_bridge_plugins() -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Bridge plugin uninstallation is only supported on macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        let script = [
            plugin_remove_script(SYSTEM_COMPONENTS_DIR, "Splicerr Bridge.component"),
            plugin_remove_script(SYSTEM_VST3_DIR, "Splicerr Bridge.vst3"),
        ]
        .join(" && ");
        let osascript = format!(
            "do shell script {:?} with administrator privileges",
            script
        );
        let output = Command::new("osascript")
            .arg("-e")
            .arg(osascript)
            .output()
            .map_err(|e| format!("Failed to launch uninstaller: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "Bridge uninstallation failed: {}{}",
                stderr,
                stdout
            ));
        }

        Ok("Removed Splicerr Bridge from the system Audio Plug-Ins folders".into())
    }
}

fn start_daw_sync_listener(app: tauri::AppHandle) -> Result<(), String> {
    let socket = UdpSocket::bind(("127.0.0.1", DAW_SYNC_PORT))
        .map_err(|e| format!("Failed to bind DAW sync UDP port {DAW_SYNC_PORT}: {e}"))?;

    std::thread::Builder::new()
        .name("splicerr-daw-sync".into())
        .spawn(move || {
            let mut buf = [0_u8; 2048];
            loop {
                match socket.recv_from(&mut buf) {
                    Ok((len, _addr)) => {
                        if let Ok(text) = std::str::from_utf8(&buf[..len]) {
                            let _ = app.emit_to("main", "daw-sync", text.to_string());
                        }
                    }
                    Err(err) => {
                        eprintln!("DAW sync UDP listener stopped: {err}");
                        break;
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Exclude the hidden bridge from window-state, otherwise the plugin
        // restores it as a visible window showing the parked GraphQL page.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&[BRIDGE_LABEL])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .manage(BridgeState::default())
        .manage(DawAudioState::new().expect("failed to initialize DAW audio sender"))
        .invoke_handler(tauri::generate_handler![
            splice_graphql,
            splice_response,
            splice_bridge_ready,
            daw_audio_chunk,
            daw_load_sample,
            daw_set_playback_enabled,
            bridge_plugins_installed,
            install_bridge_plugins,
            uninstall_bridge_plugins,
            open_devtools
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            start_daw_sync_listener(app.handle().clone())?;

            // Hidden webview parked on the Splice GraphQL host. Navigating here
            // (a 400 JSON page) makes Cloudflare hand out a `__cf_bm` cookie for
            // the host without an interactive challenge, after which same-origin
            // fetches from this page succeed.
            WebviewWindowBuilder::new(
                app,
                BRIDGE_LABEL,
                WebviewUrl::External(SPLICE_GRAPHQL_URL.parse().unwrap()),
            )
            .title("Splice bridge")
            .visible(false)
            .skip_taskbar(true)
            .initialization_script(BRIDGE_INIT_JS)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
        });
}
