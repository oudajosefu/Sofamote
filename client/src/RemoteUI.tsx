import { useCallback, useEffect, useState } from "react";
import type { ActionBindings, ActionName, Command, ConnectionState, ProfileName } from "./types";

interface Props {
  state: ConnectionState;
  active: boolean;
  profiles: ProfileName[];
  bindings: ActionBindings;
  send: (cmd: Command) => void;
}

interface ButtonSpec {
  action: ActionName;
  ariaLabel: string;
  className: string;
  label: string;
}

const PROFILE_LABELS: Record<ProfileName, string> = {
  auto: "Auto",
  generic: "Generic",
  youtube: "YouTube",
  netflix: "Netflix"
};

const BUTTONS: ButtonSpec[] = [
  { action: "volDown", ariaLabel: "Volume down", className: "btn small", label: "V−" },
  { action: "volUp", ariaLabel: "Volume up", className: "btn small", label: "V+" },
  { action: "mute", ariaLabel: "Mute", className: "btn small", label: "Mute" },
  { action: "seekBack30", ariaLabel: "Back 30 seconds", className: "btn seek", label: "−30s" },
  { action: "playPause", ariaLabel: "Play/Pause", className: "btn primary", label: "▶︎‖" },
  { action: "seekFwd30", ariaLabel: "Forward 30 seconds", className: "btn seek", label: "+30s" },
  { action: "seekBack10", ariaLabel: "Back 10 seconds", className: "btn", label: "−10s" },
  { action: "fullscreen", ariaLabel: "Fullscreen", className: "btn", label: "⛶" },
  { action: "seekFwd10", ariaLabel: "Forward 10 seconds", className: "btn", label: "+10s" },
  { action: "captions", ariaLabel: "Captions", className: "btn small", label: "CC" },
  { action: "speedDown", ariaLabel: "Slower", className: "btn small", label: "−speed" },
  { action: "speedUp", ariaLabel: "Faster", className: "btn small", label: "+speed" },
  {
    action: "nextEpisode",
    ariaLabel: "Next episode",
    className: "btn small wide",
    label: "Next episode"
  }
];

function hapticTap(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(15);
}

export function RemoteUI({ state, active, profiles, bindings, send }: Props) {
  const [profile, setProfile] = useState<ProfileName>("auto");
  const profileBindings = bindings[profile] ?? {};

  useEffect(() => {
    if (profiles.includes(profile)) return;
    const nextProfile = profiles[0];
    if (nextProfile) setProfile(nextProfile);
  }, [profile, profiles]);

  const fire = useCallback(
    (name: ActionName) => {
      if (!bindings[profile]?.[name]) return;
      hapticTap();
      send({ type: "action", name, profile });
    },
    [bindings, send, profile]
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
          {profiles.map((profileName) => (
            <option key={profileName} value={profileName}>
              {PROFILE_LABELS[profileName]}
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
        {BUTTONS.map((button) => {
          const keyHint = profileBindings[button.action];
          const disabled = keyHint === undefined;

          return (
            <button
              key={button.action}
              className={button.className}
              onPointerDown={() => fire(button.action)}
              aria-label={button.ariaLabel}
              disabled={disabled}
            >
              <span className="btn-content">
                <span className="btn-key" aria-hidden="true">
                  {keyHint ?? "—"}
                </span>
                <span className="btn-main">{button.label}</span>
              </span>
            </button>
          );
        })}
      </main>
    </div>
  );
}
