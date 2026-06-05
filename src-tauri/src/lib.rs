use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
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

/// Shared state correlating in-flight requests with the bridge webview's replies.
#[derive(Default)]
struct BridgeState {
    pending: Mutex<HashMap<u64, oneshot::Sender<String>>>,
    counter: AtomicU64,
    ready: AtomicBool,
    ready_notify: Notify,
}

#[derive(Clone, serde::Serialize)]
struct SpliceRequest {
    id: u64,
    body: String,
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

/// Called once by the bridge webview after it has loaded and wired up its listener.
#[tauri::command]
fn splice_bridge_ready(app: tauri::AppHandle) {
    let state = app.state::<BridgeState>();
    state.ready.store(true, Ordering::SeqCst);
    state.ready_notify.notify_waiters();
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
        .invoke_handler(tauri::generate_handler![
            splice_graphql,
            splice_response,
            splice_bridge_ready
        ])
        .setup(|app| {
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

            // DIAGNOSTIC (mac-test branch): auto-open DevTools on the main
            // window so console logs are visible in the unsigned test build.
            if let Some(main) = app.get_webview_window("main") {
                main.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
