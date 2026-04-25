import { useCallback, useRef } from "react";
import type { Command, ConnectionState } from "./types";

interface Props {
  send: (cmd: Command) => void;
  state: ConnectionState;
  active: boolean;
}

const MOVE_SENSITIVITY = 1.5;
const SCROLL_SENSITIVITY = 0.15;
const MOVE_INTERVAL_MS = 16;
const TAP_MAX_MOVEMENT = 5;
const TAP_MAX_DURATION_MS = 200;

function hapticTap(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(15);
}

// Maps browser key names to server key names for special keys
const SPECIAL_KEYS: Record<string, string> = {
  Backspace: "backspace",
  Delete: "delete",
  Enter: "enter",
  Tab: "tab",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Escape: "escape",
};

export function TrackpadUI({ send, state, active }: Props) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const downInfo = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastMoveTime = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, pos);
    if (pointers.current.size === 1) {
      downInfo.current = { time: Date.now(), ...pos };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;

      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const now = Date.now();
      if (now - lastMoveTime.current < MOVE_INTERVAL_MS) return;
      lastMoveTime.current = now;

      if (pointers.current.size === 1) {
        const scaledX = Math.round(dx * MOVE_SENSITIVITY);
        const scaledY = Math.round(dy * MOVE_SENSITIVITY);
        if (scaledX !== 0 || scaledY !== 0) {
          send({ type: "mouseMove", dx: scaledX, dy: scaledY });
        }
      } else if (pointers.current.size === 2) {
        const scrollY = Math.round(dy * SCROLL_SENSITIVITY);
        if (scrollY !== 0) {
          send({ type: "mouseScroll", dx: 0, dy: scrollY });
        }
      }
    },
    [send]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const down = downInfo.current;
      if (pointers.current.size === 1 && down) {
        const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
        const elapsed = Date.now() - down.time;
        if (moved < TAP_MAX_MOVEMENT && elapsed < TAP_MAX_DURATION_MS) {
          hapticTap();
          send({ type: "mouseClick", button: "left" });
        }
      }
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) downInfo.current = null;
    },
    [send]
  );

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) downInfo.current = null;
  }, []);

  // Focus the hidden input to summon the phone's native keyboard.
  // Must fire in a synchronous pointer-down handler to satisfy iOS focus policy.
  const showKeyboard = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  }, []);

  const onInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const text = e.currentTarget.value;
      if (text.length > 0) {
        send({ type: "typeText", text });
        e.currentTarget.value = "";
      }
    },
    [send]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const key = SPECIAL_KEYS[e.key];
      if (key) {
        e.preventDefault();
        send({ type: "key", key, mods: [] });
      }
    },
    [send]
  );

  return (
    <div className="trackpad-ui">
      {state === "open" && !active && (
        <div className="banner">
          Server is paused. Click the tray icon on the laptop to activate.
        </div>
      )}

      <div
        className="trackpad-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      <div className="trackpad-bar">
        <button
          className="btn small"
          onPointerDown={() => {
            hapticTap();
            send({ type: "mouseClick", button: "right" });
          }}
        >
          <span className="btn-main">Right Click</span>
        </button>
        <button className="btn small" onPointerDown={showKeyboard}>
          <span className="btn-main">⌨︎ Keyboard</span>
        </button>
        <button
          className="btn small"
          onPointerDown={() => {
            hapticTap();
            send({ type: "mouseClick", button: "left" });
          }}
        >
          <span className="btn-main">Left Click</span>
        </button>
      </div>

      {/* Hidden input that summons the phone keyboard when focused */}
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onInput={onInput}
        onKeyDown={onKeyDown}
        style={{
          position: "absolute",
          opacity: 0,
          width: 1,
          height: 1,
          pointerEvents: "none",
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
}
