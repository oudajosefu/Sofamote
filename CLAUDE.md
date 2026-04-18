# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install client dependencies
npm install

# Production: build client (Vite) then build server (Cargo release)
npm run build

# Production: build everything then run the server
npm start

# Development: run server (debug build, no hot-reload)
npm run dev:server
# or directly:
cargo run --manifest-path server/Cargo.toml

# Development: run Vite dev server for client
npm run dev:client
```

**Prerequisite:** The Rust toolchain must be installed (`rustup`). `cargo` must be on PATH.

There are no test or lint scripts configured.

## Architecture

This is a monorepo. The client is an npm workspace (`client/`); the server is a Rust crate (`server/`).

**What it does:** Turns a phone into a media remote for a laptop. The phone loads a PWA that sends button-press commands over WebSocket (LAN); the laptop server translates them into OS-level keystrokes targeting the focused browser window.

### Server (`server/src/`)

Rust binary using `tokio` + `axum`. Single-threaded tray event loop on the main thread; async HTTP/WebSocket server on a background thread. Key modules:

- **`main.rs`** — entry point; initializes state, spawns tokio runtime on background thread, runs tray event loop on main thread, prints pairing QR in console/debug flows, and opens the QR once on first Windows release launch after the server is ready
- **`state.rs`** — `AppState`: `Arc<RwLock<Inner>>` + `broadcast::Sender<StateEvent>`; single source of truth for `token`, `is_active`, `auto_launch`; persists on every mutation
- **`config.rs`** — reads/writes `%APPDATA%/sofamote/config.json` (Windows) or `~/.config/sofamote/config.json` (Linux/macOS)
- **`ws.rs`** — WebSocket upgrade handler; validates token (constant-time via `subtle`), sends hello + state on connect, dispatches `Command` objects, receives `StateEvent` broadcasts
- **`http.rs`** — axum router: embedded static files via `rust-embed` for the SPA + `/qr.png` endpoint (generates QR PNG via `qrcode` + `image` crates)
- **`profiles.rs`** — maps `ActionName` → `ActionRecipe` per site profile (GENERIC, YOUTUBE, NETFLIX); `resolve_action()` is the lookup entry point
- **`keystrokes.rs`** — wraps `enigo`; exposes `tap(key, mods)` and `combo(keys)`; called via `spawn_blocking` since `Enigo` is not `Send`
- **`tray.rs`** — system tray via `tray-icon` + `muda`; Active toggle, Launch on Startup, Show QR, Quit; icons embedded at compile time from `assets/`
- **`autolaunch.rs`** — platform-specific startup registration: Windows registry `Run` entry pointed directly at the packaged GUI executable; Linux `.desktop` file; macOS LaunchAgent plist
- **`types.rs`** — serde types for all wire-format messages (`Command`, `ServerMessage`, `ActionName`, `ProfileName`, etc.)
- **`net.rs`** — LAN IP detection via `local-ip-address`

### Client (`client/src/`)

React 18 + TypeScript + Vite PWA. No routing library — `App.tsx` conditionally renders either a pairing screen or `RemoteUI`.

- **`App.tsx`** — owns token state (URL param → localStorage), creates the WebSocket via `useSocket`
- **`RemoteUI.tsx`** — button grid (play/pause, seek ±10s/±30s, volume, mute, fullscreen, captions, speed, next episode)
- **`useSocket.ts`** — WebSocket hook; handles auto-reconnect, command queuing, and server state messages
- **`pairing.ts`** — token storage helpers and WS URL builder

### Data flow

```
Phone button tap
  → useSocket sends { type: "action", name: "playPause", profile: "youtube" }
  → ws.rs validates token (constant-time) + deserializes Command via serde
  → profiles.rs resolve_action() → ActionRecipe
  → keystrokes.rs tap()/combo() via spawn_blocking → enigo → OS keystrokes
  → server broadcasts { type: "state", active } back to all WS clients
```

### Thread model

```
main thread:           tray event loop (OS message pump, ~60 Hz poll)
background thread:     tokio runtime → axum HTTP/WS server
channel (mpsc):        tray → tokio  (TrayCmd: SetActive, SetAutoLaunch)
channel (broadcast):   tokio → tray  (StateEvent: ActiveChanged)
channel (oneshot):     tray → tokio  (shutdown on Quit)
```

### Key design details

- **Port 7337** — both HTTP (serving client SPA) and WebSocket upgrade on the same server
- **Token auth** — 128-bit random token generated once, stored in config, embedded in QR. WebSocket connections pass it as `?t=<token>`; comparison is constant-time (`subtle` crate).
- **`is_active` flag** — tray toggle that arms/disarms keystroke forwarding without disconnecting clients; server broadcasts state changes so PWA updates its indicator dot
- **Per-site profiles** — `profiles.rs` defines separate key mappings for YouTube, Netflix, and a generic fallback; the client sends the profile name with each command
- **Windows release app model** — non-debug Windows builds use the GUI subsystem, so the installed app and release executable live in the tray without opening a console window
- **Auto-launch** — Windows: registry `Run` key points directly at the packaged executable; Linux: `.desktop` in `~/.config/autostart`; macOS: LaunchAgent plist
- **Icon generation** — `build.rs` generates `assets/icon-active.png`, `assets/icon-inactive.png`, and `assets/app-icon.ico` at compile time; `tray.rs` embeds the PNG tray icons and Windows packaging reuses the `.ico`
