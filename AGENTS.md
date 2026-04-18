# Agent Instructions

## Project overview

Remote media control — a phone-to-laptop remote for controlling video playback via OS-level keystrokes. Phone PWA connects over WebSocket on the LAN to a Node.js server that translates taps into keystrokes delivered to the focused browser window. See [README.md](README.md) for full details.

## Architecture

- **npm workspaces monorepo**: root `package.json` defines `server/` and `client/` workspaces.
- **Server** (`server/`): Node.js, TypeScript, ESM. Raw `http` module serves static files + QR endpoint. `ws` handles WebSocket. `@nut-tree-fork/nut-js` for OS keyboard automation. `systray2` for tray icon. `zod` validates incoming WS messages.
- **Client** (`client/`): React 18, Vite, TypeScript. Builds to `client/dist/`, served by the server as a PWA. Touch-optimized with `onPointerDown`, haptic feedback via `navigator.vibrate`.
- **Types are duplicated** between `server/src/types.ts` (Zod schemas) and `client/src/types.ts` (plain TS types). Keep them in sync manually when modifying the protocol.

## Build & run

```bash
npm install          # install all workspace deps
npm start            # build client + start server (production)
npm run dev:server   # tsx watch (separate terminal)
npm run dev:client   # vite dev server (separate terminal)
```

Server listens on port `7337` (override via `PORT` env var).

## Code conventions

- **No semicolons**, **double quotes**, ESM (`"type": "module"`) everywhere.
- **Named exports only** — no default exports (exception: `vite.config.ts`).
- **TypeScript strict mode** with `noUncheckedIndexedAccess: true` — handle `undefined` on indexed access.
- Server imports use `.js` extensions (NodeNext module resolution).
- React components: PascalCase filenames. Hooks: `useX.ts`. Everything else: `camelCase.ts`.
- Arrow functions for callbacks; `function` declarations for top-level module exports.
- Use `onPointerDown` (not `onClick`) for touch buttons in the client.

## Key patterns

- **WebSocket protocol**: Client sends `action`-type commands only (e.g. `{ type: "action", name: "playPause", profile: "youtube" }`). Server supports `key`, `combo`, and `action` types internally.
- **Profiles** (`server/src/profiles.ts`): Map `ActionName` → keystroke recipe per site. `resolveAction()` falls back to `generic` profile.
- **State** (`server/src/state.ts`): `AppState` extends `EventEmitter`, persists config to `~/.config/remote-media-control/config.json` (or `%APPDATA%` on Windows). Emits `"active"` and `"autoLaunch"` events.
- **Token auth**: Pairing uses a crypto-random token in the URL query param. Server validates with **constant-time comparison** (`timingSafeEqual`). Client stores token in `localStorage`.
- **Reconnection**: Client `useSocket` hook implements exponential backoff (500ms → 15s cap) with a command queue that flushes on reconnect.

## Security notes

- Token comparison must use `timingSafeEqual` — never use `===` for token checks.
- Static file serving has path-traversal protection (`normalize` + `startsWith`). Maintain this guard.
- The server is LAN-only with no CORS headers. Do not expose externally.
