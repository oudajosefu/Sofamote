import { useMemo, useState } from "react";
import { RemoteUI } from "./RemoteUI";
import { FullControlUI } from "./FullControlUI";
import { TrackpadUI } from "./TrackpadUI";
import { SettingsUI } from "./SettingsUI";
import { SettingsProvider, useSettings } from "./SettingsContext";
import { useSocket } from "./useSocket";
import { buildWsUrl, rememberToken } from "./pairing";
import type { InterfaceName } from "./types";

const INTERFACE_OPTIONS: { value: InterfaceName; label: string; ariaName: string }[] = [
  { value: "media", label: "Media", ariaName: "Media Remote" },
  { value: "trackpad", label: "Trackpad", ariaName: "Trackpad" },
  { value: "fullControl", label: "Full", ariaName: "Full Control" },
];

export function App() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}

function AppShell() {
  const { settings } = useSettings();
  const token = useMemo(() => rememberToken(), []);
  const url = useMemo(() => (token ? buildWsUrl(token) : null), [token]);
  const { state, active, profiles, bindings, send } = useSocket({ url });
  const [iface, setIface] = useState<InterfaceName>(settings.defaultInterface);
  const [showSettings, setShowSettings] = useState(false);

  if (!token) {
    return (
      <div className="empty">
        <h1>Not paired</h1>
        <p>Scan the QR code printed in the server console to pair this device.</p>
      </div>
    );
  }

  let dot = "#ef4444";
  let statusLabel = "offline";
  if (state === "connecting") {
    dot = "#facc15";
    statusLabel = "connecting…";
  } else if (state === "open") {
    dot = active ? "#4ade80" : "#f59e0b";
    statusLabel = active ? "active" : "paused";
  }

  return (
    <div className="app">
      <header className="bar">
        <div
          className="mode-switcher"
          role="group"
          aria-label="Remote mode"
          aria-disabled={showSettings}
        >
          {INTERFACE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="mode-switcher-btn"
              aria-label={`Switch to ${option.ariaName} mode`}
              aria-pressed={iface === option.value}
              disabled={showSettings}
              onPointerDown={() => setIface(option.value)}
              onClick={() => setIface(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="bar-actions">
          <span className="status">
            <span className="dot" style={{ background: dot }} />
            {statusLabel}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={showSettings ? "Close settings" : "Open settings"}
            aria-pressed={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "✕" : "⚙"}
          </button>
        </span>
      </header>

      {showSettings ? (
        <SettingsUI onClose={() => setShowSettings(false)} />
      ) : (
        <>
          {iface === "media" && (
            <RemoteUI
              state={state}
              active={active}
              profiles={profiles}
              bindings={bindings}
              send={send}
            />
          )}
          {iface === "fullControl" && (
            <FullControlUI state={state} active={active} send={send} />
          )}
          {iface === "trackpad" && (
            <TrackpadUI state={state} active={active} send={send} />
          )}
        </>
      )}
    </div>
  );
}
