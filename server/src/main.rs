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

use std::sync::Arc;
use std::time::Duration;

use state::{AppState, StateEvent};
use tray::TrayCmd;

const PORT: u16 = 7337;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "remote_media_control=info".into()),
        )
        .init();

    let cfg = config::load_or_create();
    let lan_ip = net::get_lan_ip();
    let pairing_url = format!("http://{}:{}/?t={}", lan_ip, PORT, cfg.token);

    print_qr(&pairing_url);

    let app_state = AppState::new(cfg.clone());

    // Unbounded channel: tray main-thread → async tokio task.
    // UnboundedSender::send() is sync-safe (non-blocking).
    let (tray_tx, tray_rx) = tokio::sync::mpsc::unbounded_channel::<TrayCmd>();

    // Shutdown signal
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Resolve client/dist relative to the binary (works for both dev and release)
    let client_dir = resolve_client_dir();

    // Start tokio runtime on a background thread
    let state_bg = Arc::clone(&app_state);
    let pairing_url_bg = pairing_url.clone();
    let server_thread = std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async move {
            run_server(state_bg, tray_rx, client_dir, pairing_url_bg, shutdown_rx).await;
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

    let qr_url = format!(
        "{}qr.png",
        pairing_url.split('?').next().unwrap_or(&pairing_url)
    );

    // Main thread event loop — drives the OS tray message pump
    loop {
        // Apply any state broadcasts from async tasks
        while let Ok(event) = state_rx.try_recv() {
            match event {
                StateEvent::ActiveChanged(v) => {
                    active = v;
                    tray_handle.set_active(active);
                }
            }
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
                break;
            }
        }

        std::thread::sleep(Duration::from_millis(16));
    }

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
    client_dir: std::path::PathBuf,
    pairing_url: String,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) {
    // Task: apply tray commands to app state
    let state_for_cmds = Arc::clone(&state);
    tokio::spawn(async move {
        while let Some(cmd) = tray_rx.recv().await {
            match cmd {
                TrayCmd::SetActive(v) => state_for_cmds.set_active(v).await,
                TrayCmd::SetAutoLaunch(v) => {
                    state_for_cmds.set_auto_launch(v).await;
                    tokio::task::spawn_blocking(move || autolaunch::set_auto_launch(v)).await.ok();
                }
            }
        }
    });

    let router = http::build_router(state, client_dir, pairing_url.clone());
    let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}")).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("cannot bind port {PORT}: {e}");
            return;
        }
    };

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

fn resolve_client_dir() -> std::path::PathBuf {
    // When running via `cargo run`, the exe is in target/{debug,release}/
    // and client/dist is two levels up then into client/dist.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("../../client/dist");
            if candidate.exists() {
                return candidate.canonicalize().unwrap_or(candidate);
            }
        }
    }
    std::path::PathBuf::from("client/dist")
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
