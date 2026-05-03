import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./settings";

type UpdateSettings = (patch: Partial<Settings>) => void;
type ResetSettings = () => void;

interface SettingsContextValue {
  settings: Settings;
  updateSettings: UpdateSettings;
  resetSettings: ResetSettings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const updateSettings = useCallback<UpdateSettings>((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback<ResetSettings>(() => {
    const next = { ...DEFAULT_SETTINGS };
    saveSettings(next);
    setSettings(next);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
