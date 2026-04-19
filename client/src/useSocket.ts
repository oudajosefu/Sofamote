import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionBindings, Command, ConnectionState, ProfileName, ServerMessage } from "./types";

interface Options {
  url: string | null;
}

const EMPTY_BINDINGS: ActionBindings = {
  auto: {},
  generic: {},
  youtube: {},
  netflix: {}
};

const DEFAULT_PROFILES: ProfileName[] = ["auto", "generic", "youtube", "netflix"];

export function useSocket({ url }: Options) {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [active, setActive] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileName[]>(DEFAULT_PROFILES);
  const [bindings, setBindings] = useState<ActionBindings>(EMPTY_BINDINGS);
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Command[]>([]);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const shouldConnectRef = useRef(true);

  const flushQueue = useCallback(() => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (queueRef.current.length > 0) {
      const cmd = queueRef.current.shift();
      if (!cmd) break;
      ws.send(JSON.stringify(cmd));
    }
  }, []);

  const connect = useCallback(() => {
    if (!url) return;
    setState("connecting");
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      setState("open");
      flushQueue();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === "hello") {
          setProfiles(msg.profiles);
          setBindings(msg.bindings);
        }
        if (msg.type === "error") setLastError(msg.message);
        if (msg.type === "state") setActive(msg.active);
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      setState("closed");
      setActive(false);
      if (!shouldConnectRef.current) return;
      const delay = Math.min(15000, 500 * 2 ** retryRef.current);
      retryRef.current += 1;
      timerRef.current = window.setTimeout(connect, delay);
    };
    ws.onerror = () => {
      setLastError("connection error");
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [url, flushQueue]);

  useEffect(() => {
    shouldConnectRef.current = true;
    connect();
    return () => {
      shouldConnectRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  const send = useCallback(
    (cmd: Command) => {
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
      } else {
        queueRef.current.push(cmd);
      }
    },
    []
  );

  return { state, active, lastError, profiles, bindings, send };
}
