# Sofamote

A phone-to-laptop remote for controlling the video that is currently playing
on your laptop's focused browser tab. Designed for the "laptop lid closed,
HDMI to TV" setup: instead of opening a screen-sharing app every time you
want to pause or seek, you pull up a PWA on your phone and tap a button.

The laptop runs a tiny Rust server on your WiFi network. The server
translates taps in the phone UI into real OS-level keystrokes (space,
arrow keys, `f`, `m`, `j`/`l`, etc.) delivered to the focused browser
window. Because it speaks the browser's native keyboard shortcuts, it
works on every streaming site — Netflix, YouTube, Disney+, HBO, anything
— without DRM issues.

## How it works

```
phone PWA  ─── WebSocket on LAN ───▶  laptop (Rust server)
                                         │
                                         ▼
                          focused browser window ◀ keystroke
```

1. The laptop server serves the mobile PWA over HTTP on the LAN.
2. The phone loads the PWA, connects over WebSocket, and sends commands
   like `{ type: "action", name: "playPause", profile: "youtube" }`.
3. The server maps the action through a per-site profile to a keystroke
   (e.g. YouTube play/pause is `k`, Netflix is `space`) and delivers it
   via [`enigo`](https://crates.io/crates/enigo).

## Download

[Install Sofamote from the latest GitHub release](https://github.com/oudajosefu/remote-media-control/releases/latest)

Release downloads currently ship as:

- Windows: `.msi` installer and portable `sofamote.exe`
- macOS: `.dmg`
- Linux: `.deb`

## End-user requirements

- Laptop and phone on the same WiFi network.
- A browser tab with the video player focused on the laptop.
- Windows is the most polished target today, with macOS and Linux
  release artifacts also published from GitHub Actions.

## End-user installation

### Windows

Download either the `.msi` installer or the `sofamote.exe` asset from
the latest release page.

| Download | Best for | What changes |
| -------- | -------- | ------------ |
| `.msi` installer | Most Windows end users | Installs Sofamote into Program Files, creates a Start Menu shortcut, and gives you a normal uninstall path in Windows. |
| `sofamote.exe` | Portable or no-install usage | Runs directly with no installer and no uninstall entry. Keep it in a permanent folder before enabling **Launch on startup**. |

On Windows, debug runs still print a QR code in the console. The
installed app and direct release executable behave the same after
launch: both are release builds, both run as a background tray app with
no console window, and both open the pairing QR in your browser on the
first Windows release launch. The difference is installation behavior,
not runtime behavior.

For regular Windows use, prefer the `.msi` installer. If you use the
portable `sofamote.exe`, move it out of Downloads first. The
**Launch on startup** toggle stores the current executable path in the
Windows `Run` registry key, so moving or deleting a portable copy later
will break startup.

To get started:

1. Download the asset you want from the latest release page.
2. Run the installer or launch `sofamote.exe`.
3. When Windows Firewall prompts, allow access on **private networks
   only**.
4. Scan the QR code URL that opens in your browser. The phone will load
   the PWA, store the token, and can then be added to the home screen
   for one-tap use.

### macOS

1. Download the `.dmg` from the latest release page.
2. Open the DMG and move `Sofamote.app` into `/Applications` if you want
   a normal app install.
3. Launch Sofamote from Applications.
4. Pair your phone from the QR flow the app opens or from the tray/menu
   bar item afterward.

When Apple release credentials are configured in GitHub Actions, the DMG
is built from a signed app bundle, notarized with Apple, and stapled
before upload. Those notarized releases should avoid Gatekeeper's
"unidentified developer" warning.

### Linux

1. Download the `.deb` from the latest release page.
2. Install it with your package manager, for example:

```bash
sudo apt install ./path-to-downloaded.deb
```

3. Launch Sofamote from your application menu or by running `sofamote`.
4. Pair your phone from the QR flow.

The published Linux package targets Debian/Ubuntu-style systems.

## Development setup

### Prerequisites

- Git
- Rust toolchain (`rustup`) with `cargo` on PATH
- Node.js 20 with npm
- Phone on the same WiFi network as the development machine

On Ubuntu/Debian, install the Linux desktop dependencies used by the
tray icon and keyboard automation layers before building the server:

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  libxdo-dev \
  libxcb-shape0-dev \
  libxcb-xfixes0-dev
```

### Clone and install

```bash
git clone https://github.com/oudajosefu/remote-media-control.git
cd remote-media-control
npm install
```

### Run in development

Start the Rust server and the Vite dev client in separate terminals:

```bash
npm run dev:server
npm run dev:client
```

Useful commands:

```bash
npm run build
npm start
```

`npm run dev:server` runs the Rust server in debug mode. On Windows,
debug runs print the pairing QR in the console. Release-mode Windows
builds run as a tray app with no console window and open the pairing QR
in the browser once on first launch.

### Build distributable packages locally

Install the platform-specific Cargo packaging tool first:

```bash
cargo install cargo-wix      # Windows
cargo install cargo-bundle   # macOS
cargo install cargo-deb      # Linux
```

Then use the matching package script:

```bash
npm run package:win
npm run package:mac
npm run package:linux
```

## Release packaging

The repo is licensed under the MIT License. The root [LICENSE](LICENSE)
file is the canonical license text, and the Windows MSI displays those
same MIT terms during installation instead of placeholder copy.

When GitHub Actions release credentials are configured, Windows release
builds sign both `sofamote.exe` and the generated MSI. That improves the
publisher/trust experience, but brand-new releases can still need time
to build Microsoft SmartScreen reputation.

## Automated releases

Use the root release command when you are ready to cut a new version:

```bash
npm run release -- patch
npm run release -- minor --dry-run
npm run release -- 0.3.1
```

The command must be run from a **clean `main` branch checkout** with an
`origin` remote configured. It verifies that every repo-owned version
reference is in sync, updates them together, runs `npm run build`, then
creates a `chore(release): vX.Y.Z` commit and a lightweight `vX.Y.Z`
tag.

After a successful run it pushes `main`, then pushes the new tag.
GitHub Actions releases are triggered by that tag push because
[`.github/workflows/release.yml`](.github/workflows/release.yml) listens
for `v*` tags.

## System tray

The server lives as a tray icon so it can run quietly in the background.
The tray menu (right-click the icon) has:

- **Active (forwarding keystrokes)** — toggle. When checked, the tray
  icon shows a **green dot** overlay and the server turns phone taps
  into real keystrokes. When unchecked, the WebSocket connection stays
  open so your phone reconnects instantly, but commands are acked as
  `suppressed` and no keystrokes are sent. This is the "arm/disarm"
  switch — use it so stray taps don't pause your movie when you're not
  trying to remote-control.
- **Launch on startup** — toggle. On Windows, writes the current release
  executable path directly into
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` so the app starts
  hidden in the tray without a console window.
- **Show pairing QR…** — opens `/qr.png` in your default browser so
  you can re-pair a phone after the one-time first-launch handoff.
- **Quit** — gracefully stops the server.

The PWA reflects active state: the status dot is **green** when the
server is active, **amber** when the server is connected but paused
(with a banner suggesting you flip the tray toggle), and **red** when
offline.

## Laptop-side setup (Windows)

To keep the laptop running with its lid closed:

1. **Power Options → Choose what closing the lid does** → set to **Do
   nothing** on the plugged-in profile.
2. **Settings → Accounts → Sign-in options** → disable screen lock on
   inactivity (or make the timeout long). Keystrokes won't be delivered
   to a locked session.
3. On first run Windows Firewall will prompt for permission; allow it
   for **private networks only**.

## Controls

The default layout (override per site via the profile dropdown):

| Button       | Default   | YouTube profile       | Netflix profile |
| ------------ | --------- | --------------------- | --------------- |
| Play / Pause | `space`   | `k`                   | `space`         |
| −10s / +10s  | `←` / `→` | `j` / `l`             | `←` / `→`       |
| −30s / +30s  | 3×arrow   | `shift+←` / `shift+→` | 3×arrow         |
| Volume       | `↑` / `↓` | `↑` / `↓`             | `↑` / `↓`       |
| Mute         | `m`       | `m`                   | `m`             |
| Fullscreen   | `f`       | `f`                   | `f`             |
| Captions     | `c`       | `c`                   | `c`             |
| Next episode | —         | `shift+n`             | `shift+n`       |
| Speed −/+    | —         | `shift+,` / `shift+.` | —               |

## Layout

```
server/   Rust binary. HTTP + WebSocket + keystroke simulation.
client/   Vite + React PWA. Served from the laptop, installs to phone.
```

## Security

The server generates a 128-bit random token on first launch and persists
it to `%APPDATA%/sofamote/config.json`. Every WebSocket
upgrade must present the same token (checked in constant time) or the
connection is rejected with HTTP 401. The token is embedded in the QR
code URL, so anyone who can see the QR can pair.

If you want to reset the pairing (e.g. your phone was lost), delete
that config file and restart the server. All previously paired devices
will stop working.

## Verifying end-to-end

1. On Windows, launch the installed app, the downloaded `sofamote.exe`,
   or a local `target\release\sofamote.exe` build and confirm no console
   window appears, the tray icon appears, and the first release launch
   opens the pairing QR in the browser once. For console-first
   debugging, run `npm run dev:server` and confirm it prints the QR and
   logs `Listening on http://<LAN-IP>:7337`.
2. Right-click the tray icon → **Active** to toggle forwarding on.
   The icon should show a green dot overlay.
3. Open a streaming site on the laptop, start a video, click into the
   player so it has focus.
4. Scan the QR from your phone. The PWA should load, the status dot
   should turn green, and the layout should say "active".
5. Tap **Play/Pause** — video pauses. Tap **+10s** — video scrubs.
6. Right-click the tray icon → uncheck **Active**. The PWA dot should
   turn amber with a "paused" banner; taps should no longer move the
   video.
7. Right-click the tray icon → check **Launch on startup**, reboot,
   and confirm the server comes up automatically in the tray with no
   console window on Windows.
8. Switch profile to **YouTube** on a YouTube tab; confirm `k` is used
   instead of `space`.
9. Close the lid. Confirm the remote still controls playback.
10. Toggle phone airplane mode briefly; PWA should auto-reconnect.
