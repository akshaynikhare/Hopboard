// RealtimeClipboard desktop — the native shell.
//
// The design constraint, and the reason this file is short: Rust never sees a
// frame, a room hash, or a key. It does exactly four things the web platform
// forbids a page from doing, hands the results to the webview, and stays out of
// the way. Everything else — the protocol, the encryption, the transport, the
// entire UI — is the same `src/` the website serves, loaded unmodified.
//
// That is what keeps the wire protocol at two implementations (this app's
// JavaScript, and the Python relay) no matter how many platforms ship. A Rust
// client would have been a second place for the crypto to be subtly wrong.
//
// What this file owns:
//   1. Watching the system clipboard in the background. The only thing here
//      that the browser version genuinely cannot do, and the whole product.
//   2. Writing incoming clips to the system clipboard without needing focus.
//   3. A tray icon, a global hotkey, and launch-at-login.
//   4. Refusing to be started twice.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::MacosLauncher;

/// How long after we WRITE the clipboard we refuse to read it back.
///
/// The mirror of TEXT.SUPPRESS_MS in src/core/config.js, and it exists on this
/// side too rather than trusting the JS window alone. The loop it prevents is:
/// a clip arrives, we write it to the clipboard, our own watcher sees a "new"
/// value, and sends it straight back — forever, across every device in the
/// session (docs/CLIPBOARD-FLOW.md §6).
///
/// In a browser that loop was bounded by the poller only running while focused.
/// A background watcher has no such bound, which is why this guard is here at
/// the source rather than only downstream.
const ECHO_SUPPRESS: Duration = Duration::from_millis(1500);

/// What we last put on the clipboard ourselves, and when.
#[derive(Default)]
struct Echo {
    text: Option<String>,
    at: Option<Instant>,
}

struct Watcher {
    echo: Mutex<Echo>,
}

impl Watcher {
    /// True if this value is one we just wrote, and should not be re-sent.
    fn is_own(&self, text: &str) -> bool {
        let echo = self.echo.lock().unwrap();
        match (&echo.text, echo.at) {
            (Some(last), Some(at)) => last == text && at.elapsed() < ECHO_SUPPRESS,
            _ => false,
        }
    }

    fn remember(&self, text: &str) {
        let mut echo = self.echo.lock().unwrap();
        echo.text = Some(text.to_owned());
        echo.at = Some(Instant::now());
    }
}

/// Write an incoming clip to the system clipboard.
///
/// Called from the webview when a clip arrives. The ordering is the invariant
/// from docs/ARCHITECTURE.md §5: remember FIRST, write SECOND. Reversed, the
/// watcher thread can observe the new value before we have recorded it, and the
/// storm starts.
#[tauri::command]
fn set_clipboard(text: String, watcher: State<Watcher>, app: AppHandle) -> Result<(), String> {
    watcher.remember(&text);
    tauri_plugin_clipboard_manager::ClipboardExt::clipboard(&app)
        .write_text(text)
        .map_err(|e| e.to_string())
}

/// Poll the clipboard and emit what changes.
///
/// Polling rather than the OS change notifications, and that is a considered
/// choice rather than laziness. The native APIs differ per platform
/// (AddClipboardFormatListener, NSPasteboard changeCount, XFixes) and none of
/// them exists on GNOME Wayland at all — there is no clipboard-monitoring
/// portal, so no application can watch it there. A 400 ms poll of an in-process
/// value is cheap, behaves identically everywhere it works, and degrades to
/// "nothing happens" where the platform forbids reading rather than to a
/// per-platform failure. `clipboard-master` is the upgrade path if the cost
/// ever shows up in a measurement.
fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<String> = None;
        loop {
            std::thread::sleep(Duration::from_millis(400));

            let current = match tauri_plugin_clipboard_manager::ClipboardExt::clipboard(&app)
                .read_text()
            {
                Ok(t) => t,
                // Not an error worth reporting: a clipboard holding an image or
                // a file list has no text, and that is most of the time.
                Err(_) => continue,
            };

            if current.is_empty() || last.as_deref() == Some(current.as_str()) {
                continue;
            }
            last = Some(current.clone());

            // Ours, from a clip we just applied. Dropping it here is the first
            // of the three guards in docs/CLIPBOARD-FLOW.md §6.
            if app.state::<Watcher>().is_own(&current) {
                continue;
            }

            // The webview decides what to do with it — including whether the
            // session is in Manual mode, which is checked there because that is
            // where the setting lives.
            let _ = app.emit("clipboard://text", current);
        }
    });
}

fn main() {
    tauri::Builder::default()
        // Two instances would fight over one clipboard, each seeing the other's
        // writes as new values. Not a nuisance — a loop.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            // Started hidden. The point of launching at login is that it is
            // already watching, not that it is in your way at 9am.
            Some(vec!["--hidden"]),
        ))
        .manage(Watcher { echo: Mutex::new(Echo::default()) })
        .invoke_handler(tauri::generate_handler![set_clipboard])
        .setup(|app| {
            spawn_watcher(app.handle().clone());

            // Closing the window hides it rather than quitting: this is an app
            // whose job is to keep running. Quit lives in the tray menu, so
            // "how do I stop it watching my clipboard" has a visible answer.
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start RealtimeClipboard");
}
