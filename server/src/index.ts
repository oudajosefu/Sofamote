import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import qrTerminal from "qrcode-terminal";
import { createHttpServer } from "./http.js";
import { attachWebSocket } from "./ws.js";
import { loadOrCreateToken } from "./pairing.js";
import { getLanIp } from "./net.js";

const PORT = Number(process.env.PORT ?? 7337);

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, "..", "..", "client", "dist");

const token = loadOrCreateToken();
const ip = getLanIp();
const pairingUrl = `http://${ip}:${PORT}/?t=${token}`;

const http = createHttpServer({ port: PORT, clientDir, pairingUrl });
attachWebSocket(http, token);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`\nRemote Media Control listening on http://${ip}:${PORT}`);
  console.log(`Pair your phone by scanning this QR:\n`);
  qrTerminal.generate(pairingUrl, { small: true });
  console.log(`\nOr open: ${pairingUrl}`);
  console.log(`Also available at: http://${ip}:${PORT}/qr.png`);
});

function shutdown(): void {
  http.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
