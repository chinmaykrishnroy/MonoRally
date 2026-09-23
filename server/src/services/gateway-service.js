import {
  CLIENT_TIMEOUT_MS,
  GATEWAY_ID,
  HEARTBEAT_MS,
  INPUT_PACKET,
  INPUT_RATE_LIMIT_PER_SECOND,
  PADDLE_MAX_SPEED,
  PORT,
  W
} from "../config.js";
import { epochNow } from "../input-timeline.js";
import { cleanName, cleanSession, requestedTeam } from "../utils.js";
import { closeClient, send, sendBinary, sendPing } from "../ws.js";

/**
 * GatewayService
 * Terminates client WebSocket connections, enforces authentication & rate limits,
 * forwards client inputs to the designated simulation worker, and distributes
 * physics snapshots from the message bus to connected client sockets.
 */
export class GatewayService {
  constructor({
    bus,
    sessionStore,
    presenceStore,
    rateLimiter,
    workerRegistry,
    gatewayId = GATEWAY_ID,
    port = PORT
  }) {
    this.bus = bus;
    this.sessionStore = sessionStore;
    this.presenceStore = presenceStore;
    this.rateLimiter = rateLimiter;
    this.workerRegistry = workerRegistry;
    this.gatewayId = gatewayId;
    this.port = port;

    this.clients = new Map(); // clientId -> client object
    this.heartbeatTimer = null;
    this.subscriptions = [];
  }

  async start() {
    // 1. Subscribe to unicast messages targeting clients on this gateway
    this.subscriptions.push(
      await this.bus.subscribe(`gateway.${this.gatewayId}.client.*.send`, (data, replyTo, subject) => {
        const parts = subject.split(".");
        const clientId = parts[3];
        const client = this.clients.get(clientId);
        if (client) {
          if (data?.t === "matchmaker.assigned") {
            client.roomCode = data.roomCode;
            this.bus.publish(`room.${data.roomCode}.command`, {
              action: "join",
              clientId: client.id,
              gatewayId: this.gatewayId,
              name: client.name,
              sessionId: client.sessionId,
              teamPreference: client.teamPreference,
              protocol: client.protocol
            });
            return;
          }
          send(client, data);
        }
      })
    );

    // 2. Subscribe to room snapshot broadcasts (binary 30 Hz snapshots)
    this.subscriptions.push(
      await this.bus.subscribe("room.*.snapshots", (binaryPayload, replyTo, subject) => {
        const parts = subject.split(".");
        const roomCode = parts[1];
        for (const client of this.clients.values()) {
          if (client.roomCode === roomCode && client.alive && !client.socket.destroyed) {
            sendBinary(client, binaryPayload);
          }
        }
      })
    );

    // 3. Subscribe to room event broadcasts (JSON events like roster, score, replay)
    this.subscriptions.push(
      await this.bus.subscribe("room.*.events", (eventData, replyTo, subject) => {
        const parts = subject.split(".");
        const roomCode = parts[1];
        for (const client of this.clients.values()) {
          if (client.roomCode === roomCode && client.alive && !client.socket.destroyed) {
            send(client, eventData);
          }
        }
      })
    );

    // 4. Client WebSocket heartbeats
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatClients();
    }, HEARTBEAT_MS);
  }

  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const client of this.clients.values()) {
      closeClient(client, 1001, "gateway shutting down");
    }
    this.clients.clear();
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }

  handleClientConnected(client) {
    client.gatewayId = this.gatewayId;
    client.roomCode = null;
    client.inputWindowStartedAt = performance.now();
    client.inputCount = 0;
    client.inputLimitedAt = 0;
    this.clients.set(client.id, client);
  }

  handleClientDisconnected(client) {
    if (!client.alive) return;
    client.alive = false;
    this.cancelQuick(client);

    if (client.roomCode) {
      this.bus.publish(`room.${client.roomCode}.command`, {
        action: "leave",
        clientId: client.id,
        gatewayId: this.gatewayId
      });
      client.roomCode = null;
    }

    this.clients.delete(client.id);
  }

  heartbeatClients() {
    const now = performance.now();
    for (const client of this.clients.values()) {
      if (now - client.lastPong > CLIENT_TIMEOUT_MS) {
        closeClient(client, 1001, "heartbeat timeout");
        this.handleClientDisconnected(client);
        continue;
      }
      sendPing(client);
    }
  }

  handleMessage(client, msg) {
    if (msg.t === "clockProbe") {
      const t1 = epochNow();
      send(client, {
        t: "clockProbe",
        id: Number(msg.id) || 0,
        t0: Number(msg.t0) || 0,
        t1,
        t2: epochNow(),
        groupId: Number(msg.groupId) || 0,
        groupIndex: Number(msg.groupIndex) === 1 ? 1 : 0
      });
      return;
    }

    if (msg.t === "hello") {
      client.teamPreference = requestedTeam(msg.name);
      client.name = cleanName(msg.name);
      client.sessionId = cleanSession(msg.sessionId);
      client.playerId = String(msg.playerId || "").trim() || null;
      client.protocol = Math.max(1, Math.min(4, Number(msg.protocol) || 1));
      send(client, { t: "hello", id: client.id, name: client.name, port: this.port, protocol: client.protocol });
      return;
    }

    if (msg.t === "ping") {
      send(client, { t: "pong", id: Number(msg.id) || 0, at: Number(msg.at) || 0 });
      return;
    }

    if (msg.t === "quick") {
      this.joinQuick(client, msg.mode === "2v2" ? "2v2" : "1v1");
      return;
    }

    if (msg.t === "cancelQuick") {
      this.cancelQuick(client);
      return;
    }

    if (msg.t === "createRoom") {
      this.createRoom(client, msg.mode === "2v2" ? "2v2" : "1v1", msg.visibility === "public" ? "public" : "private");
      return;
    }

    if (msg.t === "joinRoom") {
      this.joinRoom(client, String(msg.code || "").toUpperCase(), msg.role === "spectator");
      return;
    }

    if (msg.t === "leaveRoom") {
      this.leaveRoom(client);
      return;
    }

    if (msg.t === "selectSlot") {
      if (client.roomCode) {
        this.bus.publish(`room.${client.roomCode}.command`, {
          action: "selectSlot",
          clientId: client.id,
          gatewayId: this.gatewayId,
          slot: Number(msg.slot)
        });
      }
      return;
    }

    if (msg.t === "fillAi") {
      if (client.roomCode) {
        this.bus.publish(`room.${client.roomCode}.command`, {
          action: "fillAi",
          clientId: client.id,
          gatewayId: this.gatewayId
        });
      }
      return;
    }

    if (msg.t === "replayRoom") {
      if (client.roomCode) {
        this.bus.publish(`room.${client.roomCode}.command`, {
          action: "replayRoom",
          clientId: client.id,
          gatewayId: this.gatewayId
        });
      }
      return;
    }

    if (msg.t === "cheer") {
      if (client.roomCode) {
        this.bus.publish(`room.${client.roomCode}.command`, {
          action: "cheer",
          clientId: client.id,
          gatewayId: this.gatewayId,
          emoji: msg.emoji,
          name: client.name
        });
      }
      return;
    }

    if (msg.t === "input") {
      this.handleInput(client, Number(msg.x), Number.isInteger(msg.sequence) ? msg.sequence : null, Number.isInteger(msg.serverTime) ? msg.serverTime : null);
      return;
    }
  }

  handleBinaryMessage(client, data) {
    if (data.length < 3 || data[0] !== INPUT_PACKET) return;
    const encoded = data.readUInt16BE(1);
    const sequence = data.length >= 5 ? data.readUInt16BE(3) : null;
    const serverTime = data.length >= 9 ? data.readUInt32BE(5) : null;
    const observedX = data.length >= 14 ? (data.readUInt16BE(9) / 65535) * W : null;
    const observedVx = data.length >= 14 ? (data.readInt16BE(11) / 32767) * PADDLE_MAX_SPEED : null;
    const timestampTrusted = data.length >= 14 && (data[13] & 1) !== 0;

    this.handleInput(client, encoded / 65535, sequence, serverTime, observedX, observedVx, timestampTrusted);
  }

  handleInput(client, x, sequence = null, serverTime = null, observedX = null, observedVx = null, timestampTrusted = false) {
    if (!this.allowClientInput(client)) return;
    if (!client.roomCode) return;

    this.bus.publish(`room.${client.roomCode}.input`, {
      clientId: client.id,
      x,
      sequence,
      serverTime,
      observedX,
      observedVx,
      timestampTrusted
    });
  }

  allowClientInput(client) {
    const now = performance.now();
    if (now - client.inputWindowStartedAt >= 1000) {
      client.inputWindowStartedAt = now;
      client.inputCount = 0;
    }
    client.inputCount += 1;
    if (client.inputCount <= INPUT_RATE_LIMIT_PER_SECOND) return true;
    if (now - client.inputLimitedAt > 2000) {
      client.inputLimitedAt = now;
      send(client, { t: "error", message: "Input rate limited" });
    }
    return false;
  }

  joinQuick(client, mode) {
    this.leaveRoom(client);
    send(client, { t: "quickWait", mode });
    this.bus.publish("matchmaker.queue.join", {
      clientId: client.id,
      gatewayId: this.gatewayId,
      mode,
      name: client.name,
      teamPreference: client.teamPreference,
      sessionId: client.sessionId,
      playerId: client.playerId,
      protocol: client.protocol
    });
  }

  cancelQuick(client) {
    this.bus.publish("matchmaker.queue.leave", { clientId: client.id });
  }

  async createRoom(client, mode, visibility) {
    this.leaveRoom(client);
    try {
      const res = await this.bus.request(
        "matchmaker.allocate_room",
        {
          mode,
          visibility
        },
        3000
      );
      if (res?.ok && res.roomCode) {
        client.roomCode = res.roomCode;
        send(client, { t: "roomCreated", code: res.roomCode, mode });
        this.bus.publish(`room.${res.roomCode}.command`, {
          action: "join",
          clientId: client.id,
          gatewayId: this.gatewayId,
          name: client.name,
          sessionId: client.sessionId,
          playerId: client.playerId,
          teamPreference: client.teamPreference,
          protocol: client.protocol,
          spectator: false
        });
      } else {
        send(client, { t: "error", message: res?.error || "Failed to create room" });
      }
    } catch (err) {
      send(client, { t: "error", message: "Room allocation timeout" });
    }
  }

  async joinRoom(client, code, spectator = false) {
    this.leaveRoom(client);
    client.roomCode = code;
    this.bus.publish(`room.${code}.command`, {
      action: "join",
      clientId: client.id,
      gatewayId: this.gatewayId,
      name: client.name,
      sessionId: client.sessionId,
      playerId: client.playerId,
      teamPreference: client.teamPreference,
      protocol: client.protocol,
      spectator
    });
  }

  leaveRoom(client) {
    if (client.roomCode) {
      this.bus.publish(`room.${client.roomCode}.command`, {
        action: "leave",
        clientId: client.id,
        gatewayId: this.gatewayId
      });
      client.roomCode = null;
    }
  }
}
