# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies (root + workspaces)
npm install

# Production: build client then start server
npm start

# Development: run server with hot reload (tsx watch)
npm run dev:server

# Development: run Vite dev server for client
npm run dev:client

# Build client only (tsc + vite build)
npm run build
```

There are no test or lint scripts configured.

## Architecture

This is an npm workspaces monorepo with two packages: `server/` and `client/`.

**What it does:** Turns a phone into a media remote for a laptop. The phone loads a PWA that sends button-press commands over WebSocket (LAN); the laptop server translates them into OS-level keystrokes targeting the focused browser window.

### Server (`server/src/`)

Node.js + TypeScript, native ES modules, no framework. Key modules:

- **`index.ts`** — entry point; starts HTTP + WebSocket, renders pairing QR in terminal, initializes tray
- **`state.ts`** — `AppState` class; single source of truth for `token`, `isActive`, `autoLaunch`; delegates persistence to `config.ts`
- **`config.ts`** — reads/writes `%APPDATA%/remote-media-control/config.json` (or `XDG_CONFIG_HOME` on Linux)
- **`ws.ts`** — WebSocket handler; validates token (constant-time), dispatches `Command` objects, broadcasts state changes
- **`http.ts`** — serves compiled client SPA + `/qr.png` endpoint
- **`profiles.ts`** — maps `ActionName` → keystroke per site profile (GENERIC, YOUTUBE, NETFLIX); `resolveAction()` is the lookup entry point
- **`keystrokes.ts`** — wraps `@nut-tree-fork/nut-js`; exposes `tap(key)` and `combo(modifiers, key)`
- **`tray.ts`** — systray menu (Active toggle, Launch on Startup, Show QR, Quit); updates icon color (green/amber)
- **`types.ts`** — Zod schemas for all wire-format types (`Command`, `ServerMessage`, `ActionName`, `ProfileName`)

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
  → ws.ts validates token + parses Command via Zod
  → profiles.ts resolveAction() → keystroke definition
  → keystrokes.ts tap()/combo() → @nut-tree-fork/nut-js → OS
  → server broadcasts { type: "state", isActive } back to all clients
```

### Key design details

- **Port 7337** — both HTTP (serving client) and WebSocket upgrade on the same server
- **Token auth** — 128-bit random token generated once, stored in config, embedded in QR. WebSocket connections pass it as a query param; comparison is constant-time.
- **`isActive` flag** — tray toggle that arms/disarms keystroke forwarding without disconnecting clients; server broadcasts state changes so PWA updates its indicator dot
- **Per-site profiles** — `profiles.ts` defines separate key mappings for YouTube, Netflix, and a generic fallback; the client sends the profile name with each command
- **Auto-launch** — uses `auto-launch` npm package + writes a VBScript wrapper so the terminal window stays hidden on Windows startup
