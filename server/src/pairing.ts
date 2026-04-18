import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface PersistedConfig {
  token: string;
}

function configPath(): string {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "remote-media-control", "config.json");
}

export function loadOrCreateToken(): string {
  const path = configPath();
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as PersistedConfig;
      if (typeof parsed.token === "string" && parsed.token.length >= 32) {
        return parsed.token;
      }
    } catch {
      // fall through and regenerate
    }
  }
  const token = randomBytes(16).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ token } satisfies PersistedConfig, null, 2));
  return token;
}

export function tokenFromRequestUrl(url: string | undefined): string | null {
  if (!url) return null;
  const idx = url.indexOf("?");
  if (idx === -1) return null;
  const params = new URLSearchParams(url.slice(idx + 1));
  return params.get("t");
}
