import AutoLaunch from "auto-launch";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const APP_NAME = "Remote Media Control";

function startupDir(): string {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "remote-media-control");
}

function writeWindowsWrapper(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, "index.js");
  const wrapper = join(startupDir(), "start.vbs");
  const node = process.execPath.replace(/"/g, '""');
  const script = `Set sh = CreateObject("WScript.Shell")\nsh.Run """${node}"" ""${entry.replace(/"/g, '""')}""", 0, False\n`;
  mkdirSync(dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, script);
  return wrapper;
}

function launcherPath(): string {
  if (process.platform === "win32") return writeWindowsWrapper();
  return process.execPath;
}

function createLauncher(): AutoLaunch {
  return new AutoLaunch({
    name: APP_NAME,
    path: launcherPath(),
    isHidden: true
  });
}

export async function setAutoLaunch(enabled: boolean): Promise<void> {
  const launcher = createLauncher();
  const already = await launcher.isEnabled();
  if (enabled && !already) await launcher.enable();
  if (!enabled && already) await launcher.disable();
}

export async function isAutoLaunchEnabled(): Promise<boolean> {
  try {
    return await createLauncher().isEnabled();
  } catch {
    return false;
  }
}
