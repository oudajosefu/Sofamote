import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface PersistedConfig {
  token: string;
  isActive: boolean;
  autoLaunch: boolean;
}

const DEFAULTS: Omit<PersistedConfig, "token"> = {
  isActive: false,
  autoLaunch: false
};

function configPath(): string {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "remote-media-control", "config.json");
}

function read(): PersistedConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PersistedConfig>;
    if (typeof raw.token !== "string" || raw.token.length < 32) return null;
    return {
      token: raw.token,
      isActive: typeof raw.isActive === "boolean" ? raw.isActive : DEFAULTS.isActive,
      autoLaunch: typeof raw.autoLaunch === "boolean" ? raw.autoLaunch : DEFAULTS.autoLaunch
    };
  } catch {
    return null;
  }
}

function write(cfg: PersistedConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

export function loadOrCreateConfig(): PersistedConfig {
  const existing = read();
  if (existing) return existing;
  const fresh: PersistedConfig = {
    token: randomBytes(16).toString("hex"),
    ...DEFAULTS
  };
  write(fresh);
  return fresh;
}

export function saveConfig(cfg: PersistedConfig): void {
  write(cfg);
}

export function tokenFromRequestUrl(url: string | undefined): string | null {
  if (!url) return null;
  const idx = url.indexOf("?");
  if (idx === -1) return null;
  const params = new URLSearchParams(url.slice(idx + 1));
  return params.get("t");
}

export type { PersistedConfig };
