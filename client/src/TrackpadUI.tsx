import { useCallback, useEffect, useRef } from "react";
import type { Command, ConnectionState } from "./types";
import { useSettings } from "./SettingsContext";
import { useHaptics } from "./haptics";

interface Props {
  send: (cmd: Command) => void;
  state: ConnectionState;
  active: boolean;
}

const MOVE_INTERVAL_MS = 16;

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
  const { settings } = useSettings();
  const haptics = useHaptics();

  // Settings change frequently while the user tunes them; pointer handlers fire at high frequency.
  // Reading via a ref avoids re-binding the handlers (and breaking pointer capture) on every change.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const hapticsRef = useRef(haptics);
  useEffect(() => {
    hapticsRef.current = haptics;
  }, [haptics]);

  const pointers = useRef(
    new Map<number, { x: number; y: number; startX: number; startY: number; startTime: number }>()
  );
  const downInfo = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragPointerId = useRef<number | null>(null);
  const multiTouchActive = useRef(false);
  const twoFingerTapCandidate = useRef(false);
  const lastMoveTime = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const now = Date.now();
      const s = settingsRef.current;
      const entry = {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        startTime: now,
      };
      pointers.current.set(e.pointerId, entry);

      if (pointers.current.size === 1) {
        downInfo.current = { time: now, x: e.clientX, y: e.clientY };

        const prev = lastTap.current;
        if (prev) {
          const elapsed = now - prev.time;
          const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
          if (elapsed < s.trackpadDoubleTapWindowMs && dist < s.trackpadDoubleTapMaxDistance) {
            dragging.current = true;
            dragPointerId.current = e.pointerId;
            lastTap.current = null;
            hapticsRef.current.dragStart();
            send({ type: "mouseButton", button: "left", action: "press" });
          }
        }
      } else if (pointers.current.size === 2 && !dragging.current) {
        let firstStartTime = now;
        for (const [id, p] of pointers.current) {
          if (id !== e.pointerId) firstStartTime = p.startTime;
        }
        if (now - firstStartTime < s.trackpadTwoFingerTapMaxDurationMs) {
          twoFingerTapCandidate.current = true;
        }
        multiTouchActive.current = true;
        lastTap.current = null;
      } else {
        multiTouchActive.current = true;
        twoFingerTapCandidate.current = false;
        lastTap.current = null;
      }
    },
    [send]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const s = settingsRef.current;

      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.current.set(e.pointerId, {
        ...prev,
        x: e.clientX,
        y: e.clientY,
      });

      if (twoFingerTapCandidate.current) {
        const totalMoved =
          Math.abs(e.clientX - prev.startX) + Math.abs(e.clientY - prev.startY);
        if (totalMoved > s.trackpadTwoFingerTapMaxMovement) {
          twoFingerTapCandidate.current = false;
        }
      }

      const now = Date.now();
      if (now - lastMoveTime.current < MOVE_INTERVAL_MS) return;
      lastMoveTime.current = now;

      if (dragging.current) {
        const scaledX = Math.round(dx * s.trackpadMoveSensitivity);
        const scaledY = Math.round(dy * s.trackpadMoveSensitivity);
        if (scaledX !== 0 || scaledY !== 0) {
          send({ type: "mouseMove", dx: scaledX, dy: scaledY });
        }
        return;
      }

      if (pointers.current.size === 1) {
        const scaledX = Math.round(dx * s.trackpadMoveSensitivity);
        const scaledY = Math.round(dy * s.trackpadMoveSensitivity);
        if (scaledX !== 0 || scaledY !== 0) {
          send({ type: "mouseMove", dx: scaledX, dy: scaledY });
        }
      } else if (pointers.current.size === 2) {
        const direction = s.trackpadScrollNatural ? 1 : -1;
        const scrollY = Math.round(dy * s.trackpadScrollSensitivity) * direction;
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
      const startedMultiTouch = multiTouchActive.current;
      const liftedEntry = pointers.current.get(e.pointerId);
      const s = settingsRef.current;

      if (dragging.current && dragPointerId.current === e.pointerId) {
        dragging.current = false;
        dragPointerId.current = null;
        hapticsRef.current.tap();
        send({ type: "mouseButton", button: "left", action: "release" });
        pointers.current.delete(e.pointerId);
        if (pointers.current.size === 0) {
          downInfo.current = null;
          multiTouchActive.current = false;
          twoFingerTapCandidate.current = false;
        }
        lastTap.current = null;
        return;
      }

      if (
        twoFingerTapCandidate.current &&
        pointers.current.size === 2 &&
        liftedEntry
      ) {
        const elapsed = Date.now() - liftedEntry.startTime;
        const moved =
          Math.abs(e.clientX - liftedEntry.startX) +
          Math.abs(e.clientY - liftedEntry.startY);
        if (
          elapsed < s.trackpadTwoFingerTapMaxDurationMs &&
          moved < s.trackpadTwoFingerTapMaxMovement
        ) {
          hapticsRef.current.tap();
          send({ type: "mouseClick", button: "right" });
        }
        twoFingerTapCandidate.current = false;
      }

      if (
        !startedMultiTouch &&
        pointers.current.size === 1 &&
        down
      ) {
        const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
        const elapsed = Date.now() - down.time;
        if (moved < s.trackpadTapMaxMovement && elapsed < s.trackpadTapMaxDurationMs) {
          hapticsRef.current.tap();
          send({ type: "mouseClick", button: "left" });
          lastTap.current = { time: Date.now(), x: e.clientX, y: e.clientY };
        } else {
          lastTap.current = null;
        }
      } else if (startedMultiTouch) {
        lastTap.current = null;
      }

      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) {
        downInfo.current = null;
        multiTouchActive.current = false;
        twoFingerTapCandidate.current = false;
      }
    },
    [send]
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (dragging.current && dragPointerId.current === e.pointerId) {
        dragging.current = false;
        dragPointerId.current = null;
        send({ type: "mouseButton", button: "left", action: "release" });
      }
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) {
        downInfo.current = null;
        multiTouchActive.current = false;
        twoFingerTapCandidate.current = false;
      }
    },
    [send]
  );

  const toggleDragLock = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      dragPointerId.current = null;
      hapticsRef.current.tap();
      send({ type: "mouseButton", button: "left", action: "release" });
    } else {
      dragging.current = true;
      dragPointerId.current = null;
      hapticsRef.current.dragStart();
      send({ type: "mouseButton", button: "left", action: "press" });
    }
  }, [send]);

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
      >
        <div className="trackpad-hint">
          Drag to move · Tap to click · Two-finger tap to right-click · Two-finger drag to scroll · Double-tap-and-hold to drag
        </div>
      </div>

      <div className="trackpad-bar">
        <button
          className="btn small"
          onPointerDown={() => {
            hapticsRef.current.tap();
            send({ type: "mouseClick", button: "right" });
          }}
        >
          <span className="btn-main">Right Click</span>
        </button>
        <button
          className="btn small"
          onPointerDown={() => {
            hapticsRef.current.tap();
            toggleDragLock();
          }}
        >
          <span className="btn-main">Hold Drag</span>
        </button>
        <button className="btn small" onPointerDown={showKeyboard}>
          <span className="btn-main">⌨︎ Keyboard</span>
        </button>
        <button
          className="btn small"
          onPointerDown={() => {
            hapticsRef.current.tap();
            send({ type: "mouseClick", button: "left" });
          }}
        >
          <span className="btn-main">Left Click</span>
        </button>
      </div>

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
