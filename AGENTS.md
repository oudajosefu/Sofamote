# Agent Instructions

## Project overview

Sofamote — a phone-to-laptop remote for controlling video playback via OS-level keystrokes. Phone PWA connects over WebSocket on the LAN to a Rust server that translates taps into keystrokes delivered to the focused browser window. See [README.md](README.md) for full details.

## Architecture

- **Monorepo**: root `package.json` defines `client/` as an npm workspace. `server/` is a Rust crate (Cargo).
- **Server** (`server/`): Rust binary using `tokio` + `axum`. `enigo` for OS keyboard automation. `tray-icon` + `muda` for system tray. `serde` deserializes incoming WS messages. Client assets are embedded in the binary via `rust-embed`.
- **Client** (`client/`): React 18, Vite, TypeScript. Builds to `client/dist/`, embedded into the server binary at compile time. Touch-optimized with `onPointerDown`, haptic feedback via `navigator.vibrate`.
- **Types are defined separately**: `server/src/types.rs` (serde enums) and `client/src/types.ts` (plain TS types). Keep them in sync manually when modifying the protocol.

## Build & run

```bash
npm install          # install client workspace deps
npm run build        # build client (Vite) + build server (Cargo release)
npm start            # build everything then run the server
npm run dev:server   # cargo run (debug build, separate terminal)
npm run dev:client   # vite dev server (separate terminal)
```

**Prerequisite:** The Rust toolchain must be installed (`rustup`). `cargo` must be on PATH.

Server listens on port `7337` (hardcoded constant in `main.rs`).

## Code conventions

### Client (TypeScript/React)

- **No semicolons**, **double quotes**, ESM (`"type": "module"`).
- **Named exports only** — no default exports (exception: `vite.config.ts`).
- **TypeScript strict mode** with `noUncheckedIndexedAccess: true` — handle `undefined` on indexed access.
- React components: PascalCase filenames. Hooks: `useX.ts`. Everything else: `camelCase.ts`.
- Arrow functions for callbacks; `function` declarations for top-level module exports.
- Use `onPointerDown` (not `onClick`) for touch buttons.

### Server (Rust)

- Standard Rust conventions. `snake_case` functions, `PascalCase` types.
- Serde `rename_all = "camelCase"` on all wire-format enums to match client expectations.

## Key patterns

- **WebSocket protocol**: Client sends `action`-type commands only (e.g. `{ type: "action", name: "playPause", profile: "youtube" }`). Server supports `key`, `combo`, and `action` command types internally.
- **Profiles** (`server/src/profiles.rs`): Map `ActionName` → `ActionRecipe` per site. `resolve_action()` falls back to `GENERIC` profile.
- **State** (`server/src/state.rs`): `AppState` wraps `Arc<RwLock<Inner>>` + `broadcast::Sender<StateEvent>`. Persists config to `%APPDATA%/sofamote/config.json` (Windows) or `~/.config/sofamote/config.json` (Linux/macOS). Broadcasts `StateEvent::ActiveChanged` via tokio broadcast channel.
- **Token auth**: Pairing uses a crypto-random token in the URL query param. Server validates with **constant-time comparison** (`subtle::ConstantTimeEq`). Client stores token in `localStorage`.
- **Reconnection**: Client `useSocket` hook implements exponential backoff (500ms → 15s cap) with a command queue that flushes on reconnect.

## Security notes

- Token comparison must use constant-time comparison (`subtle::ConstantTimeEq`) — never use `==` for token checks.
- Static file serving uses `rust-embed` (assets compiled into the binary). No path-traversal risk from filesystem access.
- The server is LAN-only with no CORS headers. Do not expose externally.
