import Systray2 from "systray2";
import { exec } from "node:child_process";
import { ACTIVE_ICON_BASE64, INACTIVE_ICON_BASE64 } from "./icons.js";

type Menu = Systray2.Menu;
type MenuItem = Systray2.MenuItem;
type ClickEvent = Systray2.ClickEvent;

interface SysTrayInstance {
  onClick(listener: (e: ClickEvent) => void): Promise<SysTrayInstance>;
  sendAction(action: { type: "update-menu"; menu: Menu }): Promise<SysTrayInstance>;
  kill(exitNode?: boolean): Promise<void>;
}

const SysTray = (Systray2 as unknown as { default: unknown }).default as new (conf: {
  menu: Menu;
  debug?: boolean;
  copyDir?: boolean | string;
}) => SysTrayInstance;

const ITEM_IDS = {
  active: 0,
  autoLaunch: 1,
  showQr: 3,
  quit: 5
} as const;

export interface TrayOptions {
  pairingUrl: string;
  initialActive: boolean;
  initialAutoLaunch: boolean;
  onToggleActive: () => void;
  onToggleAutoLaunch: () => Promise<void> | void;
  onQuit: () => void;
}

export interface TrayHandle {
  setActive(active: boolean): Promise<void>;
  setAutoLaunch(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => {
    // fire and forget
  });
}

function icon(active: boolean): string {
  return active ? ACTIVE_ICON_BASE64 : INACTIVE_ICON_BASE64;
}

function tooltip(active: boolean, pairingUrl: string): string {
  return `Remote Media Control — ${active ? "Active" : "Paused"}\n${pairingUrl}`;
}

function buildMenu(active: boolean, autoLaunch: boolean, pairingUrl: string): Menu {
  const items: MenuItem[] = [
    { title: "Active (forwarding keystrokes)", tooltip: "Toggle keystroke forwarding", checked: active, enabled: true },
    { title: "Launch on startup", tooltip: "Run Remote Media Control when you log in", checked: autoLaunch, enabled: true },
    { title: "---", tooltip: "", enabled: false, checked: false },
    { title: "Show pairing QR…", tooltip: "Open the QR page in your browser", checked: false, enabled: true },
    { title: "---", tooltip: "", enabled: false, checked: false },
    { title: "Quit", tooltip: "Stop the server and exit", checked: false, enabled: true }
  ];
  return {
    icon: icon(active),
    title: "Remote Media Control",
    tooltip: tooltip(active, pairingUrl),
    items
  };
}

export async function startTray(opts: TrayOptions): Promise<TrayHandle> {
  let active = opts.initialActive;
  let autoLaunch = opts.initialAutoLaunch;

  const tray = new SysTray({
    menu: buildMenu(active, autoLaunch, opts.pairingUrl),
    copyDir: false
  });

  await tray.onClick(async (action: ClickEvent) => {
    switch (action.seq_id) {
      case ITEM_IDS.active:
        opts.onToggleActive();
        break;
      case ITEM_IDS.autoLaunch:
        await opts.onToggleAutoLaunch();
        break;
      case ITEM_IDS.showQr:
        openInBrowser(`${opts.pairingUrl.split("?")[0]}qr.png`);
        break;
      case ITEM_IDS.quit:
        opts.onQuit();
        break;
      default:
        break;
    }
  });

  async function refreshMenu(): Promise<void> {
    await tray.sendAction({
      type: "update-menu",
      menu: buildMenu(active, autoLaunch, opts.pairingUrl)
    });
  }

  return {
    async setActive(next: boolean) {
      active = next;
      await refreshMenu();
    },
    async setAutoLaunch(next: boolean) {
      autoLaunch = next;
      await refreshMenu();
    },
    async dispose() {
      try {
        await tray.kill(false);
      } catch {
        // already gone
      }
    }
  };
}
