# Contributing to Sofamote

Thanks for helping make Sofamote easier to install, test, and extend. This is a small project, so the best contributions are focused, reproducible, and easy to review.

## Good first contributions

- Try the latest release on your OS and file an install/compatibility report.
- Add or verify a streaming-site profile.
- Improve setup, firewall, pairing, or Add to Home Screen docs.
- Tighten security or release-trust docs, especially around checksums and signing.

Look for issues labeled [`good first issue`](https://github.com/oudajosefu/sofamote/labels/good%20first%20issue) or [`help wanted`](https://github.com/oudajosefu/sofamote/labels/help%20wanted).

## Development setup

Prerequisites:

- Git
- Node.js 20 with npm
- Rust via `rustup`, with `cargo` on PATH
- A phone on the same WiFi network as the development machine for end-to-end testing

Install dependencies:

```bash
npm install
```

Run the Rust server and Vite client in separate terminals:

```bash
npm run dev:server
npm run dev:client
```

Build everything:

```bash
npm run build
```

On Ubuntu/Debian, install the desktop dependencies listed in the README before building the server.

## Code style

Client:

- TypeScript strict mode is enabled, including `noUncheckedIndexedAccess`.
- Use double quotes and no semicolons.
- Use named exports only, except `vite.config.ts`.
- Use `onPointerDown` for touch buttons.
- Component files use `PascalCase`; hooks use `useX.ts`; other files use `camelCase.ts`.

Server:

- Follow standard Rust style and run `cargo fmt` for Rust changes.
- Keep wire-format enums using `serde(rename_all = "camelCase")`.
- Keep token validation constant-time; do not replace it with `==`.

## Protocol and profile changes

Sofamote keeps wire types in both Rust and TypeScript. If you add or rename any command, action, key, modifier, or profile, update both:

- `server/src/types.rs`
- `client/src/types.ts`

For streaming profiles, also update the profile bindings in `server/src/profiles.rs`, add or update binding tests, and update the controls table in `README.md` when visible behavior changes.

Please verify shortcuts in a focused browser player before opening a PR. Include the OS, browser, streaming site, and any account/player state needed to reproduce the shortcut.

## Pull requests

Before opening a PR:

- Keep the change focused on one issue or behavior.
- Run `npm run build` for app changes.
- Include screenshots for visible UI changes.
- Mention any manual install, pairing, tray, or streaming-site testing you performed.
- Call out security-sensitive changes, especially auth tokens, LAN exposure, static serving, installer behavior, or OS-level input automation.

It is fine to open a small draft PR early if you want design feedback.

