import { EventEmitter } from "node:events";
import { loadOrCreateConfig, saveConfig, type PersistedConfig } from "./config.js";

type Listener = (active: boolean) => void;

export class AppState extends EventEmitter {
  private cfg: PersistedConfig;

  constructor() {
    super();
    this.cfg = loadOrCreateConfig();
  }

  get token(): string {
    return this.cfg.token;
  }

  get isActive(): boolean {
    return this.cfg.isActive;
  }

  get autoLaunch(): boolean {
    return this.cfg.autoLaunch;
  }

  setActive(next: boolean): void {
    if (this.cfg.isActive === next) return;
    this.cfg = { ...this.cfg, isActive: next };
    saveConfig(this.cfg);
    this.emit("active", next);
  }

  toggleActive(): boolean {
    this.setActive(!this.cfg.isActive);
    return this.cfg.isActive;
  }

  setAutoLaunch(next: boolean): void {
    if (this.cfg.autoLaunch === next) return;
    this.cfg = { ...this.cfg, autoLaunch: next };
    saveConfig(this.cfg);
    this.emit("autoLaunch", next);
  }

  onActiveChange(fn: Listener): void {
    this.on("active", fn);
  }
}
