import {
  ALLOWED_ORIGINS,
  CLIENT_TIMEOUT_MS,
  HEARTBEAT_MS,
  H,
  INPUT_HISTORY_MS,
  INPUT_FUTURE_TOLERANCE_MS,
  INPUT_RATE_LIMIT_PER_SECOND,
  INPUT_PACKET,
  LEADERBOARD_FILE,
  MAX_SPECTATORS,
  PORT,
  PADDLE_ACCELERATION,
  PADDLE_MAX_SPEED,
  QUICK_AI_DIFFICULTY,
  QUICK_MATCH_FALLBACK_MS,
  TICK,
  W
} from "./config.js";
import { createBroadcasters } from "./broadcasting.js";
import { attachWebSocketServer } from "./connection.js";
import { createHttpServer } from "./http.js";
import { epochNow, normalizeInputTime, recordInputSample } from "./input-timeline.js";
import { createLeaderboard } from "./leaderboard.js";
import {
  advanceBalls,
  advancePaddles,
  beginCountdown,
  checkWin,
  countdownValue,
  empStrength,
  laserStrength,
  launchServe,
  paddleWidth,
  updateBotTargets
} from "./physics.js";
import { canReplayRoom, createRoomLifecycle } from "./room-lifecycle.js";
import { clamp, cleanName, cleanSession, generatedName, rand, requestedTeam, startingXForSlot } from "./utils.js";
import { broadcast, closeClient, send, sendPing } from "./ws.js";

const rooms = new Map();
const clients = new Map();
const stateMechanics = { countdownValue, empStrength, laserStrength, paddleWidth };
const { makeRoom, startRoom } = createRoomLifecycle(rooms);
const { broadcastRooms, broadcastRoster, pruneRooms, publicRoomPage, publicRooms, publishState } = createBroadcasters({
  checkPresenceWin,
  clients,
  rooms,
  stateMechanics
});

const leaderboard = createLeaderboard(LEADERBOARD_FILE);
const server = createHttpServer({ leaderboard, publicRoomPage });
attachWebSocketServer(server, {
  broadcastRooms,
  clients,
  onBinary: handleBinaryMessage,
  onDisconnect: disconnect,
  onMessage: handleMessage
});

server.listen(PORT, () => {
  console.log(`MonoRally is running at http://localhost:${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});

const physicsTimer = setInterval(() => {
  for (const room of rooms.values()) tickRoom(room);
}, TICK);

const directoryTimer = setInterval(() => {
  broadcastRooms();
  pruneRooms();
}, 1000);

const heartbeatTimer = setInterval(() => {
  heartbeatClients();
}, HEARTBEAT_MS);

let shuttingDown = false;
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(physicsTimer);
  clearInterval(directoryTimer);
  clearInterval(heartbeatTimer);
  for (const client of clients.values()) client.socket.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 4000).unref();
}

function handleMessage(client, msg) {
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
    client.protocol = Math.max(1, Math.min(4, Number(msg.protocol) || 1));
    send(client, { t: "hello", id: client.id, name: client.name, port: PORT, protocol: client.protocol });
  }
  if (msg.t === "quick") joinQuick(client, msg.mode === "2v2" ? "2v2" : "1v1");
  if (msg.t === "cancelQuick") cancelQuick(client);
  if (msg.t === "createRoom") createRoom(client, msg.mode === "2v2" ? "2v2" : "1v1", msg.visibility === "public" ? "public" : "private");
  if (msg.t === "joinRoom") joinRoom(client, String(msg.code || "").toUpperCase(), msg.role === "spectator");
  if (msg.t === "resumeRoom") resumeRoom(client, String(msg.code || "").toUpperCase());
  if (msg.t === "leaveRoom") leaveRoom(client);
  if (msg.t === "replayRoom") replayRoom(client);
  if (msg.t === "selectSlot") selectSlot(client, Number(msg.slot));
  if (msg.t === "fillAi") fillRoomWithAi(client);
  if (msg.t === "input") {
    updateClientInput(client, Number(msg.x), Number.isInteger(msg.sequence) ? msg.sequence : null, Number.isInteger(msg.serverTime) ? msg.serverTime : null);
  }
  if (msg.t === "ping") send(client, { t: "pong", id: Number(msg.id) || 0, at: Number(msg.at) || 0 });
  if (msg.t === "rooms") send(client, { t: "rooms", rooms: publicRooms() });
}

function handleBinaryMessage(client, data) {
  if (data.length < 3 || data[0] !== INPUT_PACKET) return;
  const encoded = data.readUInt16BE(1);
  const sequence = data.length >= 5 ? data.readUInt16BE(3) : null;
  const serverTime = data.length >= 9 ? data.readUInt32BE(5) : null;
  updateClientInput(client, encoded / 65535, sequence, serverTime);
}

function updateClientInput(client, x, sequence = null, encodedServerTime = null) {
  if (!acceptInputSequence(client, sequence)) return;
  if (!allowClientInput(client)) return;
  const now = performance.now();
  client.inputX = clamp(x, 0, 1);
  if (client.room) {
    const player = client.room.players.find((p) => p.clientId === client.id);
    if (player) {
      player.targetX = client.inputX * W;
      player.lastInputAt = now;
      const eventAt = normalizeInputTime(encodedServerTime, now, INPUT_HISTORY_MS, INPUT_FUTURE_TOLERANCE_MS);
      const sampleDelay = clamp(now - eventAt, 0, INPUT_HISTORY_MS);
      if (Number.isFinite(player.inputDelayMs)) {
        const deviation = Math.abs(sampleDelay - player.inputDelayMs);
        player.inputDelayMs += (sampleDelay - player.inputDelayMs) * 0.12;
        player.inputJitterMs = (Number(player.inputJitterMs) || 0) * 0.82 + deviation * 0.18;
      } else {
        player.inputDelayMs = sampleDelay;
        player.inputJitterMs = 0;
      }
      recordInputSample(
        player,
        { x: player.targetX, eventAt, receivedAt: now, sequence },
        { acceleration: PADDLE_ACCELERATION, historyMs: INPUT_HISTORY_MS, maxSpeed: PADDLE_MAX_SPEED, now }
      );
      player.lastProcessedInputSequence = sequence;
    }
  }
}

function acceptInputSequence(client, sequence) {
  if (!Number.isInteger(sequence)) return true;
  const normalized = sequence & 0xffff;
  if (!Number.isInteger(client.lastInputSequence)) {
    client.lastInputSequence = normalized;
    return true;
  }
  const distance = (normalized - client.lastInputSequence + 0x10000) & 0xffff;
  if (distance === 0 || distance >= 0x8000) return false;
  client.lastInputSequence = normalized;
  return true;
}

function allowClientInput(client) {
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

function joinQuick(client, mode = "1v1") {
  leaveRoom(client);
  leaveQuick(client);
  let room = [...rooms.values()].find((candidate) => candidate.quick && candidate.mode === mode && candidate.status === "waiting" && candidate.players.length < candidate.maxPlayers);
  if (!room) {
    room = makeRoom(mode, true, "public");
    room.quickAiDifficulty = QUICK_AI_DIFFICULTY;
    room.quickDeadline = performance.now() + QUICK_MATCH_FALLBACK_MS;
    rooms.set(room.code, room);
    setTimeout(() => startQuickRoom(room), QUICK_MATCH_FALLBACK_MS);
  }
  send(client, { t: "quickWait", mode });
  if (!addQuickPlayer(room, client)) {
    send(client, { t: "error", message: "Quick match is already full" });
    if (!room.players.length) rooms.delete(room.code);
    return;
  }
  broadcastRoster(room);
  publishState(room, performance.now(), true);
  broadcastRooms();
  if (room.players.length === room.maxPlayers) startQuickRoom(room);
}

function leaveQuick(client) {
  if (client.role === "quick") client.role = "lobby";
}

function cancelQuick(client) {
  if (client.room?.quick && client.room.status === "waiting") {
    leaveRoom(client);
    return;
  }
  leaveQuick(client);
}

function addQuickPlayer(room, client) {
  const order = room.mode === "2v2" ? [0, 2, 1, 3] : [0, 1];
  const slot = order.find((candidate) => !room.players.some((player) => player.slot === candidate));
  if (!Number.isInteger(slot)) return false;
  addPlayer(room, client, slotAssignment(room.mode, slot));
  return true;
}

function startQuickRoom(room) {
  if (!room || room.status !== "waiting" || !rooms.has(room.code)) return;
  if (!room.players.length) {
    rooms.delete(room.code);
    broadcastRooms();
    return;
  }
  for (let slot = 0; slot < room.maxPlayers; slot += 1) {
    if (!room.players.some((player) => player.slot === slot)) addBot(room, slot);
  }

  broadcastRoster(room);
  startRoom(room);
  for (const player of room.players) {
    const realClient = player.clientId ? clients.get(player.clientId) : null;
    if (realClient) send(realClient, { t: "matched", code: room.code, mode: room.mode });
  }
  publishState(room, performance.now(), true);
  broadcastRooms();
}

function slotAssignment(mode, slot) {
  return {
    slot,
    team: mode === "2v2" ? (slot < 2 ? "bottom" : "top") : (slot === 0 ? "bottom" : "top")
  };
}

function createRoom(client, mode, visibility = "private") {
  leaveQuick(client);
  leaveRoom(client);
  const room = makeRoom(mode, false, visibility);
  rooms.set(room.code, room);
  addPlayer(room, client);
  broadcastRoster(room);
  publishState(room, performance.now(), true);
  send(client, { t: "roomCreated", code: room.code, mode });
  broadcastRooms();
}

function joinRoom(client, code, spectator) {
  leaveQuick(client);
  const room = rooms.get(code);
  if (!room) {
    send(client, { t: "error", message: "Room not found" });
    return;
  }
  if (!spectator && tryResumeRoom(client, room)) return;
  leaveRoom(client);
  if (spectator) {
    if (room.spectators.length >= MAX_SPECTATORS) {
      send(client, { t: "error", message: "Spectator limit reached" });
      return;
    }
    room.spectators.push(client);
    client.room = room;
    client.role = "spectator";
    send(client, { t: "joined", code: room.code, mode: room.mode, role: "spectator" });
  } else {
    if (room.status === "running") {
      send(client, { t: "error", message: "Match already running" });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      send(client, { t: "error", message: "Room is full" });
      return;
    }
    if (room.quick) {
      if (!addQuickPlayer(room, client)) {
        send(client, { t: "error", message: "Room is full" });
        return;
      }
      broadcastRoster(room);
      publishState(room, performance.now(), true);
      broadcastRooms();
      if (room.players.length === room.maxPlayers) startQuickRoom(room);
      return;
    }
    addPlayer(room, client);
  }
  if (room.players.length === room.maxPlayers && canStartRoom(room)) startRoom(room);
  broadcastRoster(room);
  publishState(room, performance.now(), true);
  broadcastRooms();
}

function resumeRoom(client, code) {
  leaveQuick(client);
  const room = rooms.get(code);
  if (!room) return;
  tryResumeRoom(client, room);
}

function tryResumeRoom(client, room) {
  if (!client.sessionId) return false;
  const player = room.players.find((p) => p.sessionId === client.sessionId);
  if (!player) return false;

  leaveRoom(client);
  if (player.clientId && player.clientId !== client.id) {
    const previousClient = clients.get(player.clientId);
    if (previousClient) {
      send(previousClient, { t: "sessionMoved", message: "This match moved to another tab" });
      previousClient.room = null;
      previousClient.role = "lobby";
      closeClient(previousClient, 4001, "session moved");
    }
  }
  player.clientId = client.id;
  player.id = client.id;
  player.name = client.name || player.name;
  player.disconnected = false;
  player.disconnectedAt = 0;
  client.room = room;
  client.role = "player";
  client.inputX = player.x / W;
  send(client, { t: "joined", code: room.code, mode: room.mode, role: "player", slot: player.slot, team: player.team, resumed: true });
  send(client, { t: "resumed", code: room.code, mode: room.mode });
  broadcastRoster(room);
  publishState(room, performance.now(), true);
  broadcastRooms();
  return true;
}

function replayRoom(client) {
  const room = client.room;
  const player = room?.players.find((p) => p.clientId === client.id);
  if (!room || !player) {
    send(client, { t: "error", message: "Only players can replay" });
    return;
  }
  if (room.status !== "ended") {
    send(client, { t: "error", message: "Replay is available after game over" });
    return;
  }
  if (!canReplayRoom(room, clients)) {
    send(client, { t: "error", message: "Replay is unavailable because a player left" });
    return;
  }
  startRoom(room);
  const recipients = [...room.players.map((p) => clients.get(p.clientId)).filter(Boolean), ...room.spectators];
  broadcast(recipients, { t: "replayStarted", code: room.code, mode: room.mode });
}

function addPlayer(room, client, assignment = null) {
  const joinSlot = room.players.length;
  const slot = assignment?.slot ?? (room.mode === "2v2" ? -1 : joinSlot);
  const team = assignment?.team ?? (room.mode === "2v2" ? null : chooseTeam(room, client, joinSlot));
  const x = team ? (room.mode === "2v2" && slot >= 0 ? startingXForSlot(slot) : startingX(room, team)) : W / 2;
  const player = {
    id: client.id,
    clientId: client.id,
    name: client.name,
    sessionId: client.sessionId,
    team,
    slot,
    disconnected: false,
    disconnectedAt: 0,
    x,
    targetX: x,
    prevX: x,
    vx: 0,
    returns: 0,
    inputHistory: [],
    lastInputAt: 0,
    lastInputEventAt: 0,
    lastProcessedInputSequence: null,
    laserActiveUntil: 0,
    laserFadeUntil: 0,
    empActiveUntil: 0,
    empFadeUntil: 0
  };
  room.players.push(player);
  client.room = room;
  client.role = "player";
  send(client, { t: "joined", code: room.code, mode: room.mode, role: "player", slot, team: player.team });
}

function addBot(room, slot, name = generatedName()) {
  const team = room.mode === "2v2" ? (slot < 2 ? "bottom" : "top") : slot === 0 ? "bottom" : "top";
  const id = `bot-${room.code}-${slot}`;
  const x = room.mode === "2v2" ? startingXForSlot(slot) : W / 2;
  room.players.push({
    id,
    clientId: null,
    name,
    sessionId: "",
    bot: true,
    aiPhase: Math.random() * Math.PI * 2,
    team,
    slot,
    disconnected: false,
    disconnectedAt: 0,
    x,
    targetX: x,
    prevX: x,
    vx: 0,
    returns: 0,
    inputHistory: [],
    lastInputAt: 0,
    lastInputEventAt: 0,
    lastProcessedInputSequence: null,
    laserActiveUntil: 0,
    laserFadeUntil: 0,
    empActiveUntil: 0,
    empFadeUntil: 0
  });
}

function fillRoomWithAi(client) {
  const room = client.room;
  const player = room?.players.find((p) => p.clientId === client.id);
  if (!room || !player || room.mode !== "2v2" || room.status !== "waiting") return;
  let aiIndex = room.players.filter((p) => p.bot).length + 1;
  for (let slot = 0; slot < room.maxPlayers && room.players.length < room.maxPlayers; slot += 1) {
    if (room.players.some((p) => p.slot === slot)) continue;
    addBot(room, slot, `ai-${aiIndex}`);
    aiIndex += 1;
  }
  broadcastRoster(room);
  if (canStartRoom(room)) startRoom(room);
  publishState(room, performance.now(), true);
  broadcastRooms();
}

function selectSlot(client, slot) {
  const room = client.room;
  const player = room?.players.find((p) => p.clientId === client.id);
  if (!room || !player || room.mode !== "2v2" || room.status !== "waiting") return;
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) {
    send(client, { t: "error", message: "Invalid team slot" });
    return;
  }
  if (room.players.some((p) => p.clientId !== client.id && p.slot === slot)) {
    send(client, { t: "error", message: "That team slot is taken" });
    return;
  }

  player.slot = slot;
  player.team = slot < 2 ? "bottom" : "top";
  player.x = startingXForSlot(slot);
  player.targetX = player.x;
  send(client, { t: "slotSelected", slot, team: player.team });
  broadcastRoster(room);
  if (room.players.length === room.maxPlayers && canStartRoom(room)) startRoom(room);
  publishState(room, performance.now(), true);
}

function canStartRoom(room) {
  if (room.status === "running") return false;
  if (room.mode !== "2v2") return room.players.length === room.maxPlayers;
  return room.players.length === room.maxPlayers && room.players.every((player) => player.slot >= 0);
}

function chooseTeam(room, client, slot) {
  if (room.mode !== "2v2") return slot === 0 ? "bottom" : "top";

  const requested = client.teamPreference;
  if (requested && teamCount(room, requested) < 2) return requested;

  const bottomCount = teamCount(room, "bottom");
  const topCount = teamCount(room, "top");
  if (bottomCount < topCount) return "bottom";
  if (topCount < bottomCount) return "top";
  return slot % 2 === 0 ? "bottom" : "top";
}

function teamCount(room, team) {
  return room.players.filter((player) => player.team === team).length;
}

function startingX(room, team) {
  if (room.mode !== "2v2") return W / 2;
  return W * (teamCount(room, team) === 0 ? 0.42 : 0.58);
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  room.players = room.players.filter((p) => p.clientId !== client.id);
  room.spectators = room.spectators.filter((s) => s.id !== client.id);
  client.room = null;
  client.role = "lobby";
  if (room.status === "running") checkPresenceWin(room);
  broadcastRoster(room);
  publishState(room, performance.now(), true);
  broadcastRooms();
}

function disconnect(client) {
  if (!client.alive) return;
  client.alive = false;
  leaveQuick(client);
  disconnectFromRoom(client);
  clients.delete(client.id);
  broadcastRooms();
}

function heartbeatClients() {
  const now = performance.now();
  for (const client of clients.values()) {
    if (now - client.lastPong > CLIENT_TIMEOUT_MS) {
      closeClient(client, 1001, "heartbeat timeout");
      disconnect(client);
      continue;
    }
    sendPing(client);
  }
}

function disconnectFromRoom(client) {
  const room = client.room;
  if (!room) return;
  const player = room.players.find((p) => p.clientId === client.id);
  const canResume = room.status === "running" || (room.quick && room.status === "waiting");
  if (player && canResume && client.sessionId) {
    player.disconnected = true;
    player.disconnectedAt = performance.now();
    player.clientId = null;
    player.id = null;
    client.room = null;
    client.role = "lobby";
    broadcastRoster(room);
    publishState(room, performance.now(), true);
    return;
  }
  leaveRoom(client);
}

function checkPresenceWin(room) {
  if (room.mode !== "2v2") {
    const remaining = room.players.find((p) => !p.disconnected);
    endRoomByPresence(room, remaining?.team || null);
    return;
  }

  const activeTop = room.players.some((p) => p.team === "top" && !p.disconnected);
  const activeBottom = room.players.some((p) => p.team === "bottom" && !p.disconnected);
  if (activeTop && activeBottom) return;
  endRoomByPresence(room, activeBottom ? "bottom" : activeTop ? "top" : null);
}

function endRoomByPresence(room, winner) {
  room.status = "ended";
  room.winner = winner;
  room.endedAt = performance.now();
  room.balls = [];
  room.power = null;
  room.countdownUntil = 0;
  room.pendingCountdown = false;
  room.nextPublishAt = 0;
  leaderboard.recordRoom(room);
}

function tickRoom(room) {
  if (!room.players.length && !room.spectators.length) return;
  const now = performance.now();
  const dt = Math.min(0.034, (now - room.lastTick) / 1000);
  room.lastTick = now;

  if (room.status !== "running") {
    publishState(room, now);
    return;
  }

  const elapsed = (now - room.startedAt) / 1000;
  updateBotTargets(room, now, dt);

  advancePaddles(room, now, dt);

  if (room.countdownUntil > now) {
    publishState(room, now);
    return;
  }
  if (room.countdownUntil) {
    launchServe(room, now);
    room.countdownUntil = 0;
    publishState(room, now);
    return;
  }

  if (!room.power && now >= room.nextPowerAt) {
    room.power = {
      type: ["multi", "laser", "emp"][Math.floor(Math.random() * 3)],
      x: W / 2 + rand(-140, 140),
      y: H / 2 + rand(-70, 70),
      r: 18
    };
  }

  advanceBalls(room, now, dt);
  checkWin(room, now);
  leaderboard.recordRoom(room);
  if (room.status === "running" && room.pendingCountdown && room.balls.length === 0) {
    beginCountdown(room, now, room.mode === "2v2" ? "both" : room.lastMissTeam || "top");
    room.pendingCountdown = false;
    room.lastMissTeam = null;
  }
  publishState(room, now);
}
