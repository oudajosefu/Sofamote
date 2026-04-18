# Remote Media Control

A phone-to-laptop remote for controlling the video that is currently playing
on your laptop's focused browser tab. Designed for the "laptop lid closed,
HDMI to TV" setup: instead of opening a screen-sharing app every time you
want to pause or seek, you pull up a PWA on your phone and tap a button.

The laptop runs a tiny Node.js server on your WiFi network. The server
translates taps in the phone UI into real OS-level keystrokes (space,
arrow keys, `f`, `m`, `j`/`l`, etc.) delivered to the focused browser
window. Because it speaks the browser's native keyboard shortcuts, it
works on every streaming site — Netflix, YouTube, Disney+, HBO, anything
— without DRM issues.

## How it works

```
phone PWA  ─── WebSocket on LAN ───▶  laptop (Node.js)
                                         │
                                         ▼
                          focused browser window ◀ keystroke
```

1. The laptop server serves the mobile PWA over HTTP on the LAN.
2. The phone loads the PWA, connects over WebSocket, and sends commands
   like `{ type: "action", name: "playPause", profile: "youtube" }`.
3. The server maps the action through a per-site profile to a keystroke
   (e.g. YouTube play/pause is `k`, Netflix is `space`) and delivers it
   via [`@nut-tree-fork/nut-js`](https://www.npmjs.com/package/@nut-tree-fork/nut-js).

## Requirements

- Windows laptop (target platform; should also work on macOS/Linux with
  minor tweaks).
- Node.js 20 LTS or newer.
- Phone on the same WiFi network.

## Install & run

```bash
npm install
npm start
```

The server prints a QR code in the console. Scan it with your phone —
the URL looks like `http://192.168.x.y:7337/?t=<token>`. The phone loads
the PWA, stores the token, and can be added to your home screen for
one-tap access.

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

| Button       | Default   | YouTube profile   | Netflix profile |
| ------------ | --------- | ----------------- | --------------- |
| Play / Pause | `space`   | `k`               | `space`         |
| −10s / +10s  | `←` / `→` | `j` / `l`         | `←` / `→`       |
| −30s / +30s  | 3×arrow   | `shift+←` / `→`   | 3×arrow         |
| Volume       | `↑` / `↓` | `↑` / `↓`         | `↑` / `↓`       |
| Mute         | `m`       | `m`               | `m`             |
| Fullscreen   | `f`       | `f`               | `f`             |
| Captions     | `c`       | `c`               | `c`             |
| Next episode | —         | `shift+n`         | `shift+n`       |
| Speed −/+    | —         | `shift+,` / `shift+.` | —           |

## Layout

```
server/   Node + TS. HTTP + WebSocket + keystroke simulation.
client/   Vite + React PWA. Served from the laptop, installs to phone.
```

## Security

The server generates a 128-bit random token on first launch and persists
it to `%APPDATA%/remote-media-control/config.json`. Every WebSocket
upgrade must present the same token (checked in constant time) or the
connection is rejected with HTTP 401. The token is embedded in the QR
code URL, so anyone who can see the QR can pair.

If you want to reset the pairing (e.g. your phone was lost), delete
that config file and restart the server. All previously paired devices
will stop working.

## Verifying end-to-end

1. `npm start` on the laptop. Confirm the console prints a QR and
   `Listening on http://<LAN-IP>:7337`.
2. Open a streaming site on the laptop, start a video, click into the
   player so it has focus.
3. Scan the QR from your phone. The PWA should load and the status dot
   should turn green.
4. Tap **Play/Pause** — video pauses. Tap **+10s** — video scrubs.
5. Switch profile to **YouTube** on a YouTube tab; confirm `k` is used
   instead of `space`.
6. Close the lid. Confirm the remote still controls playback.
7. Toggle phone airplane mode briefly; PWA should auto-reconnect.
