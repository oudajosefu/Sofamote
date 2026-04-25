import { useCallback } from "react";
import type { Command, ConnectionState } from "./types";

interface Props {
  send: (cmd: Command) => void;
  state: ConnectionState;
  active: boolean;
}

interface ControlButton {
  label: string;
  key: string;
  mods?: string[];
}

interface Section {
  title: string;
  buttons: ControlButton[];
}

function hapticTap(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(15);
}

const SECTIONS: Section[] = [
  {
    title: "Navigation",
    buttons: [
      { label: "←", key: "left" },
      { label: "↑", key: "up" },
      { label: "↓", key: "down" },
      { label: "→", key: "right" },
      { label: "Home", key: "home" },
      { label: "End", key: "end" },
      { label: "PgUp", key: "pageUp" },
      { label: "PgDn", key: "pageDown" },
    ],
  },
  {
    title: "Editing",
    buttons: [
      { label: "Sel All", key: "a", mods: ["ctrl"] },
      { label: "Copy", key: "c", mods: ["ctrl"] },
      { label: "Cut", key: "x", mods: ["ctrl"] },
      { label: "Paste", key: "v", mods: ["ctrl"] },
      { label: "Undo", key: "z", mods: ["ctrl"] },
      { label: "Redo", key: "z", mods: ["ctrl", "shift"] },
      { label: "⌫", key: "backspace" },
      { label: "Del→", key: "delete" },
    ],
  },
  {
    title: "Browser",
    buttons: [
      { label: "Back", key: "left", mods: ["alt"] },
      { label: "Fwd", key: "right", mods: ["alt"] },
      { label: "New Tab", key: "t", mods: ["ctrl"] },
      { label: "Close Tab", key: "w", mods: ["ctrl"] },
      { label: "Reopen", key: "t", mods: ["ctrl", "shift"] },
      { label: "Refresh", key: "r", mods: ["ctrl"] },
      { label: "DevTools", key: "f12" },
    ],
  },
  {
    title: "Windows",
    buttons: [
      { label: "Alt+Tab", key: "tab", mods: ["alt"] },
      { label: "Minimize", key: "down", mods: ["win"] },
      { label: "Maximize", key: "up", mods: ["win"] },
      { label: "Desktop", key: "d", mods: ["win"] },
      { label: "Task View", key: "tab", mods: ["win"] },
      { label: "Snap ←", key: "left", mods: ["win"] },
      { label: "Snap →", key: "right", mods: ["win"] },
    ],
  },
  {
    title: "Media",
    buttons: [
      { label: "▶︎‖", key: "space" },
      { label: "V+", key: "up", mods: ["alt"] },
      { label: "V−", key: "down", mods: ["alt"] },
      { label: "Mute", key: "m" },
    ],
  },
];

export function FullControlUI({ send, state, active }: Props) {
  const fire = useCallback(
    (key: string, mods: string[] = []) => {
      hapticTap();
      send({ type: "key", key, mods });
    },
    [send]
  );

  return (
    <div className="full-control">
      {state === "open" && !active && (
        <div className="banner">
          Server is paused. Click the tray icon on the laptop to activate.
        </div>
      )}
      <div className="fc-sections">
        {SECTIONS.map((section) => (
          <div key={section.title} className="fc-section">
            <div className="fc-section-label">{section.title}</div>
            <div className="fc-grid">
              {section.buttons.map((btn, i) => (
                <button
                  key={i}
                  className="btn small"
                  onPointerDown={() => fire(btn.key, btn.mods)}
                >
                  <span className="btn-main">{btn.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
