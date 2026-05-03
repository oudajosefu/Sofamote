import { useCallback } from "react";
import { useSettings } from "./SettingsContext";

export interface Haptics {
  tap: () => void;
  dragStart: () => void;
}

export function useHaptics(): Haptics {
  const { settings } = useSettings();
  const enabled = settings.hapticFeedback;

  const tap = useCallback(() => {
    if (!enabled) return;
    if (typeof navigator.vibrate === "function") navigator.vibrate(15);
  }, [enabled]);

  const dragStart = useCallback(() => {
    if (!enabled) return;
    if (typeof navigator.vibrate === "function") navigator.vibrate([10, 30, 25]);
  }, [enabled]);

  return { tap, dragStart };
}
