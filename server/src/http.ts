import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { toBuffer } from "qrcode";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.end("not found");
}

async function serveStatic(
  clientDir: string,
  urlPath: string,
  res: ServerResponse
): Promise<void> {
  const safe = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = resolve(clientDir, "." + (safe.startsWith("/") ? safe : "/" + safe));
  if (!abs.startsWith(clientDir)) {
    notFound(res);
    return;
  }
  let target = abs;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
  } catch {
    target = join(clientDir, "index.html");
  }
  try {
    const body = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    res.end(body);
  } catch {
    notFound(res);
  }
}

export interface HttpOptions {
  port: number;
  clientDir: string;
  pairingUrl: string;
}

export function createHttpServer(opts: HttpOptions) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (url.startsWith("/qr.png")) {
      try {
        const png = await toBuffer(opts.pairingUrl, { width: 512, margin: 1 });
        res.setHeader("Content-Type", "image/png");
        res.end(png);
      } catch {
        res.statusCode = 500;
        res.end("qr failed");
      }
      return;
    }
    const pathOnly = url.split("?")[0] ?? "/";
    await serveStatic(opts.clientDir, pathOnly, res);
  });
}
