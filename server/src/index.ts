import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import qrTerminal from "qrcode-terminal";
import { createHttpServer } from "./http.js";
import { attachWebSocket } from "./ws.js";
import { AppState } from "./state.js";
import { getLanIp } from "./net.js";
import { startTray, type TrayHandle } from "./tray.js";
import { isAutoLaunchEnabled, setAutoLaunch } from "./autolaunch.js";

const PORT = Number(process.env.PORT ?? 7337);

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, "..", "..", "client", "dist");

const state = new AppState();
const ip = getLanIp();
const pairingUrl = `http://${ip}:${PORT}/?t=${state.token}`;

const http = createHttpServer({ port: PORT, clientDir, pairingUrl });
attachWebSocket(http, state.token, state);

let tray: TrayHandle | null = null;

async function shutdown(code: number = 0): Promise<void> {
  if (tray) await tray.dispose();
  http.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1500).unref();
}

http.listen(PORT, "0.0.0.0", async () => {
  console.log(`\nRemote Media Control listening on http://${ip}:${PORT}`);
  console.log(`Tray: ${state.isActive ? "ACTIVE" : "Paused"} — toggle from the tray icon to start forwarding keystrokes.`);
  console.log(`Pair your phone by scanning this QR:\n`);
  qrTerminal.generate(pairingUrl, { small: true });
  console.log(`\nOr open: ${pairingUrl}`);
  console.log(`Also available at: http://${ip}:${PORT}/qr.png`);

  const autoLaunch = await isAutoLaunchEnabled();
  if (autoLaunch !== state.autoLaunch) state.setAutoLaunch(autoLaunch);

  try {
    tray = await startTray({
      pairingUrl,
      initialActive: state.isActive,
      initialAutoLaunch: state.autoLaunch,
      onToggleActive: () => {
        state.toggleActive();
      },
      onToggleAutoLaunch: async () => {
        const next = !state.autoLaunch;
        try {
          await setAutoLaunch(next);
          state.setAutoLaunch(next);
        } catch (err) {
          console.error("Failed to toggle auto-launch:", err);
        }
      },
      onQuit: () => {
        void shutdown(0);
      }
    });

    state.onActiveChange(async (active) => {
      console.log(`[tray] Active → ${active ? "ON" : "OFF"}`);
      await tray?.setActive(active);
    });
    state.on("autoLaunch", async (enabled: boolean) => {
      await tray?.setAutoLaunch(enabled);
    });
  } catch (err) {
    console.warn("Tray unavailable — running without tray UI.", err);
  }
});

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
