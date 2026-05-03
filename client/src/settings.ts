import type { InterfaceName } from "./types";

export interface Settings {
  defaultInterface: InterfaceName;
  hapticFeedback: boolean;
  trackpadMoveSensitivity: number;
  trackpadScrollSensitivity: number;
  trackpadScrollNatural: boolean;
  trackpadTapMaxMovement: number;
  trackpadTapMaxDurationMs: number;
  trackpadDoubleTapWindowMs: number;
  trackpadDoubleTapMaxDistance: number;
  trackpadTwoFingerTapMaxDurationMs: number;
  trackpadTwoFingerTapMaxMovement: number;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultInterface: "media",
  hapticFeedback: true,
  trackpadMoveSensitivity: 1.5,
  trackpadScrollSensitivity: 0.15,
  trackpadScrollNatural: true,
  trackpadTapMaxMovement: 5,
  trackpadTapMaxDurationMs: 200,
  trackpadDoubleTapWindowMs: 300,
  trackpadDoubleTapMaxDistance: 30,
  trackpadTwoFingerTapMaxDurationMs: 250,
  trackpadTwoFingerTapMaxMovement: 12,
};

const STORAGE_KEY = "rmc.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (private mode, quota); silently ignore
  }
}
