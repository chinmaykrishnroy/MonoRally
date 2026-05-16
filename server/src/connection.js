import crypto from "node:crypto";
import { ALLOWED_ORIGINS, PORT } from "./config.js";
import { handleFrames, send } from "./ws.js";

export function attachWebSocketServer(server, { broadcastRooms, clients, onBinary, onDisconnect, onMessage }) {
  server.on("upgrade", (req, socket) => {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);

    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n"));

    const client = {
      id: crypto.randomUUID(),
      name: "player",
      socket,
      room: null,
      role: "lobby",
      inputX: 0.5,
      protocol: 1,
      teamPreference: null,
      sessionId: "",
      buffer: Buffer.alloc(0),
      lastSeen: performance.now(),
      lastPong: performance.now(),
      inputWindowStartedAt: 0,
      inputCount: 0,
      inputLimitedAt: 0,
      alive: true
    };
    clients.set(client.id, client);
    send(client, { t: "hello", id: client.id, port: PORT });
    broadcastRooms();

    socket.on("data", (chunk) =>
      handleFrames(client, chunk, {
        onBinary,
        onMessage,
        onError: (target, message) => send(target, { t: "error", message })
      })
    );
    socket.on("close", () => onDisconnect(client));
    socket.on("error", () => onDisconnect(client));
  });
}
