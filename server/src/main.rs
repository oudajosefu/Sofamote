#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod autolaunch;
mod config;
mod http;
mod keystrokes;
mod net;
mod profiles;
mod state;
mod tray;
mod types;
mod ws;

use std::sync::{mpsc, Arc};
use std::time::Duration;

use state::{AppState, StateEvent};
use tray::TrayCmd;

const PORT: u16 = 7337;

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const AUTO_OPEN_PAIRING_QR_ON_STARTUP: bool = true;
#[cfg(not(all(target_os = "windows", not(debug_assertions))))]
const AUTO_OPEN_PAIRING_QR_ON_STARTUP: bool = false;

#[cfg(not(all(target_os = "windows", not(debug_assertions))))]
const PRINT_PAIRING_QR: bool = true;
#[cfg(all(target_os = "windows", not(debug_assertions)))]
const PRINT_PAIRING_QR: bool = false;

enum StartupSignal {
    Ready,
    Failed,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sofamote=info".into()),
        )
        .init();

    let cfg = config::load_or_create();
    let lan_ip = net::get_lan_ip();
    let pairing_url = format!("http://{}:{}/?t={}", lan_ip, PORT, cfg.token);

    if PRINT_PAIRING_QR {
        print_qr(&pairing_url);
    }

    let app_state = AppState::new(cfg.clone());
    let should_open_pairing_qr = AUTO_OPEN_PAIRING_QR_ON_STARTUP && !cfg.has_shown_pairing_qr;

    // Unbounded channel: tray main-thread → async tokio task.
    // UnboundedSender::send() is sync-safe (non-blocking).
    let (tray_tx, tray_rx) = tokio::sync::mpsc::unbounded_channel::<TrayCmd>();

    // Shutdown signal
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let (startup_tx, startup_rx) = mpsc::channel::<StartupSignal>();

    // Start tokio runtime on a background thread
    let state_bg = Arc::clone(&app_state);
    let pairing_url_bg = pairing_url.clone();
    let server_thread = std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async move {
            run_server(state_bg, tray_rx, pairing_url_bg, shutdown_rx, startup_tx).await;
        });
    });

    // Sync OS auto-launch state with config
    autolaunch::set_auto_launch(cfg.auto_launch).ok();

    // Build system tray on the main thread (required by OS message pump)
    let (tray_handle, menu_ids) = tray::build_tray(&pairing_url, cfg.is_active, cfg.auto_launch)
        .expect("failed to create system tray");

    // Track local state for sync main-thread use
    let mut active = cfg.is_active;
    let mut auto_launch_state = cfg.auto_launch;
    let mut state_rx = app_state.subscribe();
    let mut pairing_qr_pending = should_open_pairing_qr;

    let qr_url = format!(
        "{}qr.png",
        pairing_url.split('?').next().unwrap_or(&pairing_url)
    );

    // Main thread event loop.
    //
    // On Windows, tray-icon creates a hidden HWND on the calling thread.
    // That window must receive Win32 messages via PeekMessage/DispatchMessage
    // for right-click and menu events to fire — a plain sleep loop is not enough.
    run_event_loop(|| {
        if pairing_qr_pending {
            match startup_rx.try_recv() {
                Ok(StartupSignal::Ready) => {
                    pairing_qr_pending = false;
                    if open::that(&qr_url).is_ok() {
                        app_state.mark_pairing_qr_shown();
                    }
                }
                Ok(StartupSignal::Failed) | Err(mpsc::TryRecvError::Disconnected) => {
                    pairing_qr_pending = false;
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }

        // Apply state broadcasts from async tasks
        while let Ok(event) = state_rx.try_recv() {
            let StateEvent::ActiveChanged(v) = event;
            active = v;
            tray_handle.set_active(active);
        }

        // Process tray menu clicks
        if let Some(event) = tray::poll_menu_event() {
            if event.id == menu_ids.active {
                active = !active;
                tray_tx.send(TrayCmd::SetActive(active)).ok();
            } else if event.id == menu_ids.autolaunch {
                auto_launch_state = !auto_launch_state;
                tray_handle.set_auto_launch(auto_launch_state);
                tray_tx.send(TrayCmd::SetAutoLaunch(auto_launch_state)).ok();
            } else if event.id == menu_ids.show_qr {
                open::that(&qr_url).ok();
            } else if event.id == menu_ids.quit {
                return false; // exit loop
            }
        }

        true // continue
    });

    // Graceful shutdown
    drop(tray_handle);
    shutdown_tx.send(()).ok();
    // Give the server up to 1.5s to shut down, then exit regardless
    let _ = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        std::process::exit(0);
    });
    server_thread.join().ok();
}

async fn run_server(
    state: Arc<AppState>,
    mut tray_rx: tokio::sync::mpsc::UnboundedReceiver<TrayCmd>,
    pairing_url: String,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    startup_tx: mpsc::Sender<StartupSignal>,
) {
    // Task: apply tray commands to app state
    let state_for_cmds = Arc::clone(&state);
    tokio::spawn(async move {
        while let Some(cmd) = tray_rx.recv().await {
            match cmd {
                TrayCmd::SetActive(v) => state_for_cmds.set_active(v).await,
                TrayCmd::SetAutoLaunch(v) => {
                    state_for_cmds.set_auto_launch(v).await;
                    tokio::task::spawn_blocking(move || autolaunch::set_auto_launch(v))
                        .await
                        .ok();
                }
            }
        }
    });

    let router = http::build_router(state, pairing_url.clone());
    let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            startup_tx.send(StartupSignal::Failed).ok();
            tracing::error!("cannot bind port {PORT}: {e}");
            return;
        }
    };

    startup_tx.send(StartupSignal::Ready).ok();
    tracing::info!("Listening on port {PORT}");

    tokio::select! {
        res = axum::serve(listener, router) => {
            if let Err(e) = res { tracing::error!("server error: {e}"); }
        }
        _ = shutdown_rx => {
            tracing::info!("shutting down");
        }
    }
}

// On Windows: run a proper Win32 message pump so tray-icon's hidden HWND receives
// WM_RBUTTONUP and related messages that trigger the context menu.
// On other platforms: a plain sleep loop is sufficient.
#[cfg(target_os = "windows")]
fn run_event_loop<F: FnMut() -> bool>(mut tick: F) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE, WM_QUIT,
    };
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        loop {
            // Drain all pending Win32 messages so tray-icon's window can process them
            while PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    return;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if !tick() {
                return;
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn run_event_loop<F: FnMut() -> bool>(mut tick: F) {
    loop {
        if !tick() {
            return;
        }
        std::thread::sleep(Duration::from_millis(16));
    }
}

fn print_qr(url: &str) {
    use qrcode::render::unicode;
    use qrcode::QrCode;

    if let Ok(code) = QrCode::new(url.as_bytes()) {
        let rendered = code
            .render::<unicode::Dense1x2>()
            .dark_color(unicode::Dense1x2::Light)
            .light_color(unicode::Dense1x2::Dark)
            .build();
        println!("\n{}", rendered);
    }
    let base = url.split('?').next().unwrap_or(url);
    println!("Pairing URL : {}", url);
    println!("QR image    : {}qr.png\n", base);
}
