import {
  ALLOWED_ORIGINS,
  CLIENT_TIMEOUT_MS,
  HEARTBEAT_MS,
  H,
  INPUT_RATE_LIMIT_PER_SECOND,
  INPUT_PACKET,
  MAX_SPECTATORS,
  PORT,
  QUICK_AI_DIFFICULTY,
  QUICK_MATCH_FALLBACK_MS,
  TICK,
  W
} from "./config.js";
import { createBroadcasters } from "./broadcasting.js";
import { attachWebSocketServer } from "./connection.js";
import { createHttpServer } from "./http.js";
import {
  advanceBalls,
  beginCountdown,
  checkWin,
  countdownValue,
  empStrength,
  laserStrength,
  launchServe,
  paddleWidth,
  updateBotTargets
} from "./physics.js";
import { createRoomLifecycle } from "./room-lifecycle.js";
import { clamp, cleanName, cleanSession, generatedName, rand, requestedTeam, startingXForSlot } from "./utils.js";
import { broadcast, closeClient, send, sendPing } from "./ws.js";

const rooms = new Map();
const clients = new Map();
const quickQueues = { "1v1": [], "2v2": [] };
const stateMechanics = { countdownValue, empStrength, laserStrength, paddleWidth };
const { makeRoom, startRoom } = createRoomLifecycle(rooms);
const { broadcastRooms, broadcastRoster, pruneRooms, publicRooms, publishState } = createBroadcasters({
  checkPresenceWin,
  clients,
  rooms,
  stateMechanics
});

const server = createHttpServer();
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

setInterval(() => {
  for (const room of rooms.values()) tickRoom(room);
}, TICK);

setInterval(() => {
  broadcastRooms();
  pruneRooms();
}, 1000);

setInterval(() => {
  heartbeatClients();
}, HEARTBEAT_MS);

function handleMessage(client, msg) {
  if (msg.t === "hello") {
    client.teamPreference = requestedTeam(msg.name);
    client.name = cleanName(msg.name);
    client.sessionId = cleanSession(msg.sessionId);
    client.protocol = Number(msg.protocol) >= 2 ? 2 : 1;
    send(client, { t: "hello", id: client.id, name: client.name, port: PORT, protocol: client.protocol });
  }
  if (msg.t === "quick") joinQuick(client, msg.mode === "2v2" ? "2v2" : "1v1");
  if (msg.t === "cancelQuick") leaveQuick(client);
  if (msg.t === "createRoom") createRoom(client, msg.mode === "2v2" ? "2v2" : "1v1");
  if (msg.t === "joinRoom") joinRoom(client, String(msg.code || "").toUpperCase(), msg.role === "spectator");
  if (msg.t === "resumeRoom") resumeRoom(client, String(msg.code || "").toUpperCase());
  if (msg.t === "leaveRoom") leaveRoom(client);
  if (msg.t === "replayRoom") replayRoom(client);
  if (msg.t === "selectSlot") selectSlot(client, Number(msg.slot));
  if (msg.t === "fillAi") fillRoomWithAi(client);
  if (msg.t === "input") {
    updateClientInput(client, Number(msg.x));
  }
  if (msg.t === "rooms") send(client, { t: "rooms", rooms: publicRooms() });
}

function handleBinaryMessage(client, data) {
  if (data.length < 3 || data[0] !== INPUT_PACKET) return;
  const encoded = data.readUInt16BE(1);
  updateClientInput(client, encoded / 65535);
}

function updateClientInput(client, x) {
  if (!allowClientInput(client)) return;
  client.inputX = clamp(x, 0, 1);
  if (client.room) {
    const player = client.room.players.find((p) => p.clientId === client.id);
    if (player) player.targetX = client.inputX * W;
  }
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
  client.role = "quick";
  client.quickMode = mode;
  quickQueues[mode] = quickQueues[mode].filter((entry) => entry.alive && !entry.room);
  quickQueues[mode].push(client);
  send(client, { t: "quickWait", mode });

  const maxPlayers = mode === "2v2" ? 4 : 2;
  if (quickQueues[mode].length >= maxPlayers) {
    startQuickMatch(mode, quickQueues[mode].splice(0, maxPlayers));
    return;
  }

  setTimeout(() => {
    finalizeQuickQueue(mode);
  }, QUICK_MATCH_FALLBACK_MS);
}

function leaveQuick(client) {
  for (const mode of Object.keys(quickQueues)) {
    quickQueues[mode] = quickQueues[mode].filter((entry) => entry.id !== client.id);
  }
  if (client.role === "quick") client.role = "lobby";
}

function finalizeQuickQueue(mode) {
  const maxPlayers = mode === "2v2" ? 4 : 2;
  quickQueues[mode] = quickQueues[mode].filter((entry) => entry.alive && !entry.room);
  if (!quickQueues[mode].length) return;
  startQuickMatch(mode, quickQueues[mode].splice(0, maxPlayers));
}

function startQuickMatch(mode, realClients) {
  if (!realClients.length) return;
  const room = makeRoom(mode, true);
  room.quickAiDifficulty = QUICK_AI_DIFFICULTY;
  rooms.set(room.code, room);

  if (mode === "2v2") {
    const assignments =
      realClients.length === 1
        ? [0]
        : realClients.length === 2
          ? [0, 2]
          : realClients.length === 3
            ? [0, 1, 2]
            : [0, 2, 1, 3];
    realClients.forEach((client, index) => addPlayer(room, client, slotAssignment(assignments[index])));
  } else {
    realClients.forEach((client, index) => addPlayer(room, client, { slot: index, team: index === 0 ? "bottom" : "top" }));
  }

  for (let slot = 0; slot < room.maxPlayers; slot += 1) {
    if (!room.players.some((player) => player.slot === slot)) addBot(room, slot);
  }

  broadcastRoster(room);
  startRoom(room);
  for (const client of realClients) send(client, { t: "matched", code: room.code, mode });
  publishState(room, performance.now(), true);
  broadcastRooms();
}

function slotAssignment(slot) {
  return { slot, team: slot < 2 ? "bottom" : "top" };
}

function createRoom(client, mode) {
  leaveQuick(client);
  leaveRoom(client);
  const room = makeRoom(mode, false);
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
  const player = room.players.find((p) => p.sessionId === client.sessionId && p.disconnected);
  if (!player) return false;

  leaveRoom(client);
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
  if (room.players.length !== room.maxPlayers) {
    send(client, { t: "error", message: "Waiting for players to replay" });
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
  if (player && room.status === "running" && client.sessionId) {
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
    room.status = "ended";
    room.winner = remaining?.team || null;
    return;
  }

  const activeTop = room.players.some((p) => p.team === "top" && !p.disconnected);
  const activeBottom = room.players.some((p) => p.team === "bottom" && !p.disconnected);
  if (activeTop && activeBottom) return;
  room.status = "ended";
  room.winner = activeBottom ? "bottom" : activeTop ? "top" : null;
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

  for (const p of room.players) {
    if (p.disconnected) continue;
    const agility = laserStrength(p, now) > 0 ? 18 : 22;
    p.x += (p.targetX - p.x) * Math.min(1, dt * agility);
    p.x = clamp(p.x, paddleWidth(p, now) / 2 + 4, W - paddleWidth(p, now) / 2 - 4);
  }

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
  checkWin(room);
  if (room.status === "running" && room.pendingCountdown && room.balls.length === 0) {
    beginCountdown(room, now, room.mode === "2v2" ? "both" : room.lastMissTeam || "top");
    room.pendingCountdown = false;
    room.lastMissTeam = null;
  }
  publishState(room, now);
}
