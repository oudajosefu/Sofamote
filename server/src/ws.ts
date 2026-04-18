import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { combo, tap } from "./keystrokes.js";
import { listProfiles, resolveAction } from "./profiles.js";
import { commandSchema, type ServerMessage } from "./types.js";
import { tokenFromRequestUrl } from "./config.js";
import type { AppState } from "./state.js";

const VERSION = "0.1.0";

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function send(socket: WebSocket, msg: ServerMessage): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // connection already gone
  }
}

export function attachWebSocket(
  http: HttpServer,
  token: string,
  state: AppState
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const provided = tokenFromRequestUrl(req.url);
    if (!provided || !constantTimeEq(provided, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  state.onActiveChange((active) => {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        send(client, { type: "state", active });
      }
    }
  });

  wss.on("connection", (ws) => {
    send(ws, { type: "hello", version: VERSION, profiles: listProfiles() });
    send(ws, { type: "state", active: state.isActive });

    ws.on("message", async (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        send(ws, { type: "error", message: "invalid json" });
        return;
      }
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) {
        send(ws, { type: "error", message: "invalid command" });
        return;
      }
      if (!state.isActive) {
        send(ws, { type: "ack", suppressed: true });
        return;
      }
      const cmd = parsed.data;
      try {
        if (cmd.type === "key") {
          await tap(cmd.key, cmd.mods ?? []);
        } else if (cmd.type === "combo") {
          await combo(cmd.keys);
        } else {
          const recipe = resolveAction(cmd.profile, cmd.name);
          if (!recipe) {
            send(ws, { type: "error", message: `unsupported action: ${cmd.name}` });
            return;
          }
          if (recipe.combo) {
            await combo(recipe.combo);
          } else if (recipe.key) {
            await tap(recipe.key, recipe.mods ?? []);
          }
        }
        send(ws, { type: "ack" });
      } catch (err) {
        send(ws, {
          type: "error",
          message: err instanceof Error ? err.message : "keystroke failed"
        });
      }
    });
  });

  return wss;
}
