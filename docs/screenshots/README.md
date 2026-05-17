# Screenshot checklist

The top-level [README.md](../../README.md) references five images from this
directory. Until you capture them, the README will show broken-image
placeholders on GitHub. Drop the files in with the **exact filenames
below** and they'll light up.

| # | Filename | Used in | What to capture | Suggested width |
|---|----------|---------|-----------------|-----------------|
| 1 | `hero.png` | Demo strip under the hero | Real photo, ~30° from above. Laptop open (or open enough to see the screen) playing a fullscreen Netflix/YouTube video; TV showing the same content in the background; phone held in the foreground showing the Sofamote remote with the **green** status dot. No device mockup frames — a real photo is more inviting than a clean render. | Aim for ~1600px wide; README renders at 100% / max ~960px |
| 2 | `remote-ui.png` | Features section, right column **and** Pairing step 2 | Phone-frame screenshot of the `RemoteUI` in portrait. Profile dropdown set to **YouTube**, green status dot, all 11 buttons visible (play/pause, ±10s, ±30s, volume, mute, fullscreen, captions, speed, next episode). Use a generic dark phone frame (e.g. via [shots.so](https://shots.so) or [mockuphone.com](https://mockuphone.com)) — don't use a specific brand's silhouette. | ~560px (renders at 280px @2x) |
| 3 | `pair-qr.png` | Pairing step 1 | Browser window cropped tight to the `/qr.png` page only. Light or dark — pick whichever shows the QR most clearly. | ~640px (renders at 320px @2x) |
| 4 | `pair-connected.png` | Pairing step 3 | Same phone frame style as `remote-ui.png`, but **cropped to the top of the UI** — show the status dot (green) and the "active" label. Don't show the buttons. | ~560px (renders at 280px @2x) |
| 5 | `tray-menu.png` | System tray section | Windows tray with the Sofamote icon's right-click menu open. **Active (forwarding keystrokes)** checked; the **green-dot overlay** on the tray icon should be visible. Crop to just the tray area + the menu. | ~760px (renders at 380px @2x) |

## Tips

- **Use @2x resolution** so the images look sharp on retina/HiDPI
  displays. The "renders at" widths above already account for this.
- **Compress before committing** — run PNGs through
  [squoosh.app](https://squoosh.app) or `pngquant`. Each image should
  ideally be under 200 KB; the hero can go up to ~500 KB.
- **Crop tight.** Whitespace around the subject makes the README feel
  less polished. Aim for the smallest crop that still tells the story.
- **Match the brand color** (`#0a0a0a` background, white play triangle)
  where possible — e.g. use a black phone frame, dark browser theme for
  the QR shot.
- For the hero photo, **a real environment** (couch, TV stand, throw
  pillow in the corner) sells the "lid-closed sofa setup" use case
  better than a sterile desk shot.
