import { useMemo } from "react";
import { RemoteUI } from "./RemoteUI";
import { FullControlUI } from "./FullControlUI";
import { TrackpadUI } from "./TrackpadUI";
import { useSocket } from "./useSocket";
import { useInterfaceSelection } from "./useInterfaceSelection";
import { buildWsUrl, rememberToken } from "./pairing";
import type { InterfaceName } from "./types";

const INTERFACE_LABELS: Record<InterfaceName, string> = {
  media: "Media Remote",
  fullControl: "Full Control",
  trackpad: "Trackpad",
};

export function App() {
  const token = useMemo(() => rememberToken(), []);
  const url = useMemo(() => (token ? buildWsUrl(token) : null), [token]);
  const { state, active, profiles, bindings, send } = useSocket({ url });
  const [iface, setIface] = useInterfaceSelection();

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
        <select
          className="profile"
          value={iface}
          onChange={(e) => setIface(e.target.value as InterfaceName)}
        >
          {(Object.keys(INTERFACE_LABELS) as InterfaceName[]).map((name) => (
            <option key={name} value={name}>
              {INTERFACE_LABELS[name]}
            </option>
          ))}
        </select>
        <span className="status">
          <span className="dot" style={{ background: dot }} />
          {statusLabel}
        </span>
      </header>

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
    </div>
  );
}
