import { useCallback, useState } from "react";
import type { ActionName, Command, ConnectionState, ProfileName } from "./types";

interface Props {
  state: ConnectionState;
  active: boolean;
  send: (cmd: Command) => void;
}

const PROFILES: { value: ProfileName; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "generic", label: "Generic" },
  { value: "youtube", label: "YouTube" },
  { value: "netflix", label: "Netflix" }
];

function hapticTap(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(15);
}

export function RemoteUI({ state, active, send }: Props) {
  const [profile, setProfile] = useState<ProfileName>("auto");

  const fire = useCallback(
    (name: ActionName) => {
      hapticTap();
      send({ type: "action", name, profile });
    },
    [send, profile]
  );

  let dot = "#ef4444";
  let label = "offline";
  if (state === "connecting") {
    dot = "#facc15";
    label = "connecting…";
  } else if (state === "open") {
    dot = active ? "#4ade80" : "#f59e0b";
    label = active ? "active" : "paused (tap tray icon)";
  }

  return (
    <div className="remote">
      <header className="bar">
        <select
          className="profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value as ProfileName)}
        >
          {PROFILES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="status">
          <span className="dot" style={{ background: dot }} />
          {label}
        </span>
      </header>

      {state === "open" && !active && (
        <div className="banner">
          Server is paused. Click the tray icon on the laptop to activate.
        </div>
      )}

      <main className="grid">
        <button className="btn small" onPointerDown={() => fire("volDown")} aria-label="Volume down">
          V−
        </button>
        <button className="btn small" onPointerDown={() => fire("volUp")} aria-label="Volume up">
          V+
        </button>
        <button className="btn small" onPointerDown={() => fire("mute")} aria-label="Mute">
          Mute
        </button>

        <button className="btn seek" onPointerDown={() => fire("seekBack30")} aria-label="Back 30 seconds">
          −30s
        </button>
        <button className="btn primary" onPointerDown={() => fire("playPause")} aria-label="Play/Pause">
          ▶︎‖
        </button>
        <button className="btn seek" onPointerDown={() => fire("seekFwd30")} aria-label="Forward 30 seconds">
          +30s
        </button>

        <button className="btn" onPointerDown={() => fire("seekBack10")} aria-label="Back 10 seconds">
          −10s
        </button>
        <button className="btn" onPointerDown={() => fire("fullscreen")} aria-label="Fullscreen">
          ⛶
        </button>
        <button className="btn" onPointerDown={() => fire("seekFwd10")} aria-label="Forward 10 seconds">
          +10s
        </button>

        <button className="btn small" onPointerDown={() => fire("captions")} aria-label="Captions">
          CC
        </button>
        <button className="btn small" onPointerDown={() => fire("speedDown")} aria-label="Slower">
          −speed
        </button>
        <button className="btn small" onPointerDown={() => fire("speedUp")} aria-label="Faster">
          +speed
        </button>

        <button
          className="btn small wide"
          onPointerDown={() => fire("nextEpisode")}
          aria-label="Next episode"
        >
          Next episode
        </button>
      </main>
    </div>
  );
}
