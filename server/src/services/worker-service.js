import {
  H,
  INPUT_FUTURE_TOLERANCE_MS,
  INPUT_HISTORY_MS,
  MAX_SPECTATORS,
  NETWORK_HZ,
  PADDLE_ACCELERATION,
  PADDLE_MAX_SPEED,
  QUICK_AI_DIFFICULTY,
  QUICK_MATCH_FALLBACK_MS,
  TICK,
  W,
  WORKER_CAPACITY_MAX_ROOMS
} from "../config.js";
import { classifyInputSequence, normalizeInputTime, recordInputSample } from "../input-timeline.js";
import { emitNetworkTelemetry } from "../network-telemetry.js";
import {
  advanceBalls,
  advancePaddles,
  beginCountdown,
  checkWin,
  countdownValue,
  empStrength,
  laserStrength,
  launchServe,
  overdriveStrength,
  paddleWidth,
  updateBotTargets
} from "../physics.js";
import { canReplayRoom, createRoomLifecycle } from "../room-lifecycle.js";
import { jsonState, scoredStatePacket } from "../serialization.js";
import { clamp, generatedName, rand, requestedTeam, startingXForSlot } from "../utils.js";
import { finalizeMatch } from "../match-finalizer.js";
import { evaluateRematchRequest, handlePlayerLeaveRematch } from "../rematch.js";
import { validateCheer } from "../cheer.js";
import { metrics } from "../metrics.js";
import { MemoryWorkerRegistry } from "../redis/worker-registry.js";

/**
 * WorkerService
 * Executes the 60 Hz physics simulation loop in RAM, manages assigned rooms,
 * evaluates continuous collision detection, and broadcasts snapshots at 30 Hz.
 */
export class WorkerService {
  constructor({
    bus,
    workerRegistry,
    roomDirectory = null,
    leaderboardRepository,
    playerRepository,
    matchRepository,
    workerId = `worker-${Math.random().toString(36).slice(2, 8)}`,
    maxRooms = WORKER_CAPACITY_MAX_ROOMS
  }) {
    this.bus = bus;
    this.workerRegistry = workerRegistry || new MemoryWorkerRegistry();
    this.roomDirectory = roomDirectory;
    this.leaderboard = leaderboardRepository;
    this.playerRepository = playerRepository;
    this.matchRepository = matchRepository;
    this.workerId = workerId;
    this.maxRooms = maxRooms;

    this.rooms = new Map();
    this.draining = false;
    this.messagesDelivered = 0;
    this.messagesConsumed = 0;
    this.stateMechanics = { countdownValue, empStrength, laserStrength, overdriveStrength, paddleWidth };
    const lifecycle = createRoomLifecycle(this.rooms);
    this.makeRoom = lifecycle.makeRoom;
    this.startRoom = lifecycle.startRoom;

    this.physicsTimer = null;
    this.heartbeatTimer = null;
    this.leaseTimer = null;
    this.subscriptions = [];
    this.tickSamples = [];
  }

  async start() {
    // 1. Register RPC for room allocations
    this.subscriptions.push(
      await this.bus.subscribe(`worker.${this.workerId}.allocate_room`, async (data, replyTo) => {
        if (!replyTo) return;
        const res = await this.allocateRoom(data);
        await this.bus.publish(replyTo, res);
      })
    );

    // 2. Subscribe to targeted room input stream (authoritative worker only)
    this.subscriptions.push(
      await this.bus.subscribe(`worker.${this.workerId}.room.*.input`, (data, replyTo, subject) => {
        this.messagesDelivered++;
        const parts = subject.split(".");
        const roomCode = parts[3];
        const room = this.rooms.get(roomCode);
        if (room) {
          this.messagesConsumed++;
          this.handleRoomInput(room, data);
        }
      })
    );

    // 3. Subscribe to targeted room commands (authoritative worker only)
    this.subscriptions.push(
      await this.bus.subscribe(`worker.${this.workerId}.room.*.command`, async (data, replyTo, subject) => {
        this.messagesDelivered++;
        const parts = subject.split(".");
        const roomCode = parts[3];
        const room = this.rooms.get(roomCode);
        if (room) {
          this.messagesConsumed++;
          await this.handleRoomCommand(room, data);
        }
      })
    );

    // 4. Start 60 Hz physics loop
    this.physicsTimer = setInterval(() => {
      this.tick();
    }, TICK);

    // 5. Start heartbeat loop
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, 3000);

    // 6. Start room lease renewal loop
    this.leaseTimer = setInterval(() => {
      this.renewLeases();
    }, 5000);

    await this.heartbeat();
  }

  async stop() {
    if (this.physicsTimer) clearInterval(this.physicsTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);

    // Release all room leases and clean directory
    for (const roomCode of this.rooms.keys()) {
      await this.workerRegistry.releaseRoomLease(roomCode, this.workerId);
      if (this.roomDirectory) {
        await this.roomDirectory.removeRoom(roomCode).catch(() => {});
      }
    }
    this.rooms.clear();

    await this.workerRegistry.unregisterWorker(this.workerId);

    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }

  async syncRoomDirectory(room) {
    if (!this.roomDirectory || !room) return;
    try {
      const coarseMeta = {
        code: room.code,
        workerId: this.workerId,
        mode: room.mode,
        status: room.status,
        visibility: room.visibility || "public",
        playerCount: room.players ? room.players.filter((p) => !p.disconnected).length : 0,
        maxPlayers: room.maxPlayers,
        spectatorCount: room.spectators ? room.spectators.length : 0,
        createdAt: room.createdAt || Date.now()
      };
      await this.roomDirectory.upsertRoom(coarseMeta);
    } catch {
      // Coarse directory sync error must not crash the simulation
    }
  }

  async heartbeat() {
    metrics.setWorkerCapacity(this.rooms.size, this.maxRooms);
    const breakdown = { waiting: 0, countdown: 0, running: 0, ended: 0 };
    for (const r of this.rooms.values()) {
      if (breakdown[r.status] !== undefined) breakdown[r.status]++;
    }
    metrics.setActiveRooms(this.rooms.size, breakdown);

    await this.workerRegistry.registerWorkerHeartbeat(
      {
        workerId: this.workerId,
        status: this.draining ? "draining" : "ready",
        activeRooms: this.rooms.size,
        maxRooms: this.maxRooms
      },
      10
    );
  }

  async drain(maxDrainTimeoutMs = 90000) {
    if (this.draining) return;
    this.draining = true;
    await this.workerRegistry.markWorkerDraining(this.workerId, Math.ceil(maxDrainTimeoutMs / 1000));
    await this.heartbeat();

    if (this.rooms.size === 0) {
      await this.stop();
      return;
    }

    return new Promise((resolve) => {
      let timer = null;
      const checkInterval = setInterval(async () => {
        if (this.rooms.size === 0) {
          clearInterval(checkInterval);
          if (timer) clearTimeout(timer);
          await this.stop();
          resolve();
        }
      }, 250);

      timer = setTimeout(async () => {
        clearInterval(checkInterval);
        await this.stop();
        resolve();
      }, maxDrainTimeoutMs);
    });
  }

  async renewLeases() {
    for (const room of this.rooms.values()) {
      await this.workerRegistry.renewRoomLease(room.code, this.workerId, 15);
      await this.syncRoomDirectory(room);
    }
  }

  async allocateRoom(config) {
    if (this.draining) {
      return { ok: false, error: "Worker is draining" };
    }
    if (this.rooms.size >= this.maxRooms) {
      return { ok: false, error: "Worker capacity reached" };
    }

    const mode = config.mode === "2v2" ? "2v2" : "1v1";
    const visibility = config.visibility || "public";
    const isQuick = Boolean(config.quick || config.isAiFallback);

    const room = this.makeRoom(mode, isQuick, visibility);
    const leaseAcquired = await this.workerRegistry.acquireRoomLease(room.code, this.workerId, 15);
    if (!leaseAcquired) {
      return { ok: false, error: "Failed to acquire room lease" };
    }

    this.rooms.set(room.code, room);

    if (config.initialPlayers && config.initialPlayers.length) {
      for (const p of config.initialPlayers) {
        this.addQuickPlayer(room, p);
      }
      if (config.isAiFallback) {
        for (let slot = 0; slot < room.maxPlayers; slot += 1) {
          if (!room.players.some((player) => player.slot === slot)) {
            this.addBot(room, slot);
          }
        }
      }
      if (room.players.length === room.maxPlayers) {
        this.startRoom(room);
      }
      this.broadcastRoster(room);
      this.publishState(room, performance.now(), true);
    }

    await this.syncRoomDirectory(room);

    return { ok: true, roomCode: room.code, workerId: this.workerId };
  }

  handleRoomInput(room, data) {
    const { clientId, x, sequence, serverTime, observedX, observedVx, timestampTrusted } = data;
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return;

    const sequenceState = classifyInputSequence(player.lastInputSequence, sequence);
    if (sequenceState.duplicate) return;
    if (sequenceState.historical && !timestampTrusted) return;

    const now = performance.now();
    const normalizedInput = clamp(Number(x) || 0, 0, 1);

    if (sequenceState.live) {
      player.targetX = normalizedInput * W;
      player.lastInputAt = now;
      if (Number.isInteger(sequenceState.normalized)) player.lastInputSequence = sequenceState.normalized;
    }

    const eventAt = normalizeInputTime(
      timestampTrusted ? serverTime : null,
      now,
      INPUT_HISTORY_MS,
      INPUT_FUTURE_TOLERANCE_MS
    );
    const sampleDelay = clamp(now - eventAt, 0, INPUT_HISTORY_MS);

    if (timestampTrusted && sequenceState.live && Number.isFinite(player.inputDelayMs)) {
      const deviation = Math.abs(sampleDelay - player.inputDelayMs);
      player.inputDelayMs += (sampleDelay - player.inputDelayMs) * 0.12;
      player.inputJitterMs = (Number(player.inputJitterMs) || 0) * 0.82 + deviation * 0.18;
    } else if (timestampTrusted && sequenceState.live) {
      player.inputDelayMs = sampleDelay;
      player.inputJitterMs = 0;
    }

    if (sequenceState.live) player.clockTrusted = timestampTrusted;

    recordInputSample(
      player,
      { x: normalizedInput * W, observedX, observedVx, eventAt, receivedAt: now, sequence: sequenceState.normalized },
      { acceleration: PADDLE_ACCELERATION, historyMs: INPUT_HISTORY_MS, maxSpeed: PADDLE_MAX_SPEED, now }
    );

    if (sequenceState.live) player.lastProcessedInputSequence = sequenceState.normalized;
    if (sequenceState.historical) {
      emitNetworkTelemetry("input.reordered", {
        room: room.code,
        slot: player.slot,
        sequence: sequenceState.normalized,
        latestSequence: player.lastInputSequence,
        eventAt,
        receivedAt: now,
        delayMs: sampleDelay
      });
    }
  }

  async handleRoomCommand(room, data) {
    const { action, clientId, gatewayId } = data;

    if (action === "join") {
      this.handleJoin(room, data);
    } else if (action === "leave") {
      this.handleLeave(room, clientId);
    } else if (action === "selectSlot") {
      this.handleSelectSlot(room, clientId, gatewayId, data.slot);
    } else if (action === "fillAi") {
      this.handleFillAi(room, clientId);
    } else if (action === "replayRoom") {
      this.handleReplay(room, clientId);
    } else if (action === "cheer") {
      this.handleCheer(room, clientId, data.emoji, data.name);
    }
  }

  handleJoin(room, data) {
    const { clientId, gatewayId, name, sessionId, spectator, teamPreference, protocol } = data;
    if (spectator) {
      if (room.spectators.length >= MAX_SPECTATORS) {
        this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, {
          t: "error",
          message: "Spectator limit reached"
        });
        return;
      }
      room.spectators.push({ id: clientId, clientId, gatewayId });
      this.syncRoomDirectory(room);
      this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, {
        t: "joined",
        code: room.code,
        mode: room.mode,
        role: "spectator"
      });
    } else {
      const canResume = Boolean(sessionId && room.players.some((p) => p.sessionId === sessionId && p.disconnected));
      if (!canResume) {
        if (room.status === "running") {
          this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, {
            t: "error",
            message: "Match already running"
          });
          return;
        }
        if (room.players.length >= room.maxPlayers) {
          this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, {
            t: "error",
            message: "Room is full"
          });
          return;
        }
      }

      this.addPlayer(room, { clientId, gatewayId, name, sessionId, playerId: data.playerId, teamPreference, protocol });
    }

    if (room.players.length === room.maxPlayers && this.canStartRoom(room)) {
      this.startRoom(room);
    }

    this.broadcastRoster(room);
    this.publishState(room, performance.now(), true);
    this.syncRoomDirectory(room);
  }

  handleLeave(room, clientId) {
    const player = room.players.find((p) => p.clientId === clientId);
    if (player && room.status === "running" && player.sessionId) {
      player.disconnected = true;
      player.disconnectedAt = performance.now();
      player.clientId = null;
      this.broadcastRoster(room);
      this.publishState(room, performance.now(), true);
      this.syncRoomDirectory(room);
      return;
    }

    const declined = handlePlayerLeaveRematch(room, clientId);
    if (declined) {
      this.broadcastRoomEvent(room, {
        t: "rematchDeclined",
        code: room.code,
        message: "A player left the room."
      });
    }
    room.players = room.players.filter((p) => p.clientId !== clientId);
    room.spectators = room.spectators.filter((s) => s.clientId !== clientId);
    if (room.status === "running") {
      this.checkPresenceWin(room);
    }
    this.broadcastRoster(room);
    this.publishState(room, performance.now(), true);
    this.syncRoomDirectory(room);
  }

  handleSelectSlot(room, clientId, gatewayId, slot) {
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player || room.mode !== "2v2" || room.status !== "waiting") return;
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) {
      this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, { t: "error", message: "Invalid team slot" });
      return;
    }
    if (room.players.some((p) => p.clientId !== clientId && p.slot === slot)) {
      this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, { t: "error", message: "That team slot is taken" });
      return;
    }

    player.slot = slot;
    player.team = slot < 2 ? "bottom" : "top";
    player.x = startingXForSlot(slot);
    player.targetX = player.x;

    this.bus.publish(`gateway.${gatewayId}.client.${clientId}.send`, {
      t: "slotSelected",
      slot,
      team: player.team
    });

    this.broadcastRoster(room);
    if (room.players.length === room.maxPlayers && this.canStartRoom(room)) {
      this.startRoom(room);
    }
    this.publishState(room, performance.now(), true);
    this.syncRoomDirectory(room);
  }

  handleFillAi(room, clientId) {
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player || room.mode !== "2v2" || room.status !== "waiting") return;
    let aiIndex = room.players.filter((p) => p.bot).length + 1;
    for (let slot = 0; slot < room.maxPlayers && room.players.length < room.maxPlayers; slot += 1) {
      if (room.players.some((p) => p.slot === slot)) continue;
      this.addBot(room, slot, `ai-${aiIndex}`);
      aiIndex += 1;
    }
    this.broadcastRoster(room);
    if (this.canStartRoom(room)) {
      this.startRoom(room);
    }
    this.publishState(room, performance.now(), true);
    this.syncRoomDirectory(room);
  }

  handleReplay(room, clientId) {
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player || room.status !== "ended") return;
    if (room.replayStarting) return;

    const humanPlayers = room.players.filter((p) => !p.bot && !p.disconnected && p.clientId);
    const res = evaluateRematchRequest(room, clientId, humanPlayers);

    if (!res.ok) return;

    if (!res.immediate) {
      this.broadcastRoomEvent(room, {
        t: "rematchStatus",
        code: room.code,
        acceptedBy: player.name,
        acceptedCount: res.acceptedCount,
        totalNeeded: res.totalNeeded,
        timeLeft: res.timeLeft
      });

      if (!room.rematchTimer) {
        room.rematchTimer = setTimeout(() => {
          if (!room) return;
          room.rematchConsent?.clear();
          room.rematchTimer = null;
          this.broadcastRoomEvent(room, {
            t: "rematchExpired",
            code: room.code,
            message: "Rematch request expired."
          });
        }, 15000);
      }
      return;
    }

    if (room.rematchTimer) {
      clearTimeout(room.rematchTimer);
      room.rematchTimer = null;
    }
    room.replayStarting = true;
    this.startRoom(room);
    this.broadcastRoomEvent(room, { t: "replayStarted", code: room.code, mode: room.mode });
    this.publishState(room, performance.now(), true);
    this.syncRoomDirectory(room);
    room.replayStarting = false;
  }

  handleCheer(room, clientId, emoji, name) {
    const check = validateCheer(emoji, this.clientCheerTimes?.get(clientId));
    if (!check.ok) return;
    if (!this.clientCheerTimes) this.clientCheerTimes = new Map();
    const now = performance.now();
    this.clientCheerTimes.set(clientId, now);

    this.broadcastRoomEvent(room, {
      t: "cheer",
      code: room.code,
      emoji,
      from: name || "Spectator",
      at: now
    });
  }

  addPlayer(room, client, assignment = null) {
    const existingPlayer = client.sessionId
      ? room.players.find((p) => p.sessionId === client.sessionId && p.disconnected)
      : null;

    if (existingPlayer) {
      existingPlayer.disconnected = false;
      existingPlayer.disconnectedAt = 0;
      existingPlayer.clientId = client.clientId;
      existingPlayer.id = client.clientId;
      existingPlayer.gatewayId = client.gatewayId;
      if (client.name) existingPlayer.name = client.name;

      this.bus.publish(`gateway.${client.gatewayId}.client.${client.clientId}.send`, {
        t: "joined",
        code: room.code,
        mode: room.mode,
        role: "player",
        slot: existingPlayer.slot,
        team: existingPlayer.team,
        resumed: true
      });
      return;
    }

    const joinSlot = room.players.length;
    const slot = assignment?.slot ?? (room.mode === "2v2" ? -1 : joinSlot);
    const team = assignment?.team ?? (room.mode === "2v2" ? null : this.chooseTeam(room, client, joinSlot));
    const x = team ? (room.mode === "2v2" && slot >= 0 ? startingXForSlot(slot) : this.startingX(room, team)) : W / 2;

    const player = {
      id: client.clientId,
      clientId: client.clientId,
      gatewayId: client.gatewayId,
      name: client.name,
      sessionId: client.sessionId,
      profileId: client.playerId || client.profileId || null,
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
    this.bus.publish(`gateway.${client.gatewayId}.client.${client.clientId}.send`, {
      t: "joined",
      code: room.code,
      mode: room.mode,
      role: "player",
      slot,
      team: player.team
    });
  }

  addQuickPlayer(room, client) {
    const order = room.mode === "2v2" ? [0, 2, 1, 3] : [0, 1];
    const slot = order.find((candidate) => !room.players.some((p) => p.slot === candidate));
    if (!Number.isInteger(slot)) return false;
    const assignment = {
      slot,
      team: room.mode === "2v2" ? (slot < 2 ? "bottom" : "top") : slot === 0 ? "bottom" : "top"
    };
    this.addPlayer(room, client, assignment);
    return true;
  }

  addBot(room, slot, name = generatedName()) {
    const team = room.mode === "2v2" ? (slot < 2 ? "bottom" : "top") : slot === 0 ? "bottom" : "top";
    const id = `bot-${room.code}-${slot}`;
    const x = room.mode === "2v2" ? startingXForSlot(slot) : W / 2;
    const botName = name.startsWith("[BOT]") ? name : `[BOT] ${name}`;
    room.players.push({
      id,
      clientId: null,
      gatewayId: null,
      name: botName,
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

  canStartRoom(room) {
    if (room.status === "running") return false;
    if (room.mode !== "2v2") return room.players.length === room.maxPlayers;
    return room.players.length === room.maxPlayers && room.players.every((p) => p.slot >= 0);
  }

  chooseTeam(room, client, slot) {
    if (room.mode !== "2v2") return slot === 0 ? "bottom" : "top";
    const requested = client.teamPreference;
    if (requested && this.teamCount(room, requested) < 2) return requested;
    const bottomCount = this.teamCount(room, "bottom");
    const topCount = this.teamCount(room, "top");
    if (bottomCount < topCount) return "bottom";
    if (topCount < bottomCount) return "top";
    return slot % 2 === 0 ? "bottom" : "top";
  }

  teamCount(room, team) {
    return room.players.filter((p) => p.team === team).length;
  }

  startingX(room, team) {
    if (room.mode !== "2v2") return W / 2;
    return W * (this.teamCount(room, team) === 0 ? 0.42 : 0.58);
  }

  getParticipatingGatewayIds(room) {
    const ids = new Set();
    if (room.players) {
      for (const p of room.players) {
        if (p.gatewayId && !p.disconnected) ids.add(p.gatewayId);
      }
    }
    if (room.spectators) {
      for (const s of room.spectators) {
        if (s.gatewayId) ids.add(s.gatewayId);
      }
    }
    return ids;
  }

  broadcastRoomEvent(room, eventData) {
    const gatewayIds = this.getParticipatingGatewayIds(room);
    for (const gid of gatewayIds) {
      this.bus.publish(`gateway.${gid}.room.${room.code}.events`, eventData);
    }
  }

  broadcastRoster(room) {
    const message = {
      t: "roster",
      room: room.code,
      mode: room.mode,
      players: room.players.filter((p) => !p.disconnected).map((p) => ({
        id: p.clientId || p.id,
        name: p.name,
        team: p.team,
        slot: p.slot,
        score: p.returns || 0,
        bot: Boolean(p.bot)
      }))
    };
    this.broadcastRoomEvent(room, message);
  }

  publishState(room, now, force = false) {
    if (!force && now < room.nextPublishAt) return;
    room.nextPublishAt = now + (room.status === "running" ? 1000 / NETWORK_HZ : 500);

    // Fast zero-overhead binary snapshot stream targeted only to participating gateways
    const binary = scoredStatePacket(room, now, this.stateMechanics);
    const gatewayIds = this.getParticipatingGatewayIds(room);
    for (const gid of gatewayIds) {
      this.bus.publish(`gateway.${gid}.room.${room.code}.snapshot`, binary);
    }
  }

  checkPresenceWin(room) {
    if (room.mode !== "2v2") {
      const remaining = room.players.find((p) => !p.disconnected);
      this.endRoomByPresence(room, remaining?.team || null);
      return;
    }
    const activeTop = room.players.some((p) => p.team === "top" && !p.disconnected);
    const activeBottom = room.players.some((p) => p.team === "bottom" && !p.disconnected);
    if (activeTop && activeBottom) return;
    this.endRoomByPresence(room, activeBottom ? "bottom" : activeTop ? "top" : null);
  }

  endRoomByPresence(room, winner) {
    room.status = "ended";
    room.winner = winner;
    room.endedAt = performance.now();
    room.balls = [];
    room.power = null;
    room.countdownUntil = 0;
    room.pendingCountdown = false;
    room.nextPublishAt = 0;

    finalizeMatch(room, {
      leaderboard: this.leaderboard,
      playerRepository: this.playerRepository,
      matchRepository: this.matchRepository
    });
    this.syncRoomDirectory(room);
  }

  recordTick(duration) {
    if (this.tickSamples.length < 10000) {
      this.tickSamples.push(duration);
    }
    metrics.recordTickDuration(duration);
  }

  getTickSamples() {
    return this.tickSamples;
  }

  tick() {
    for (const room of this.rooms.values()) {
      this.tickRoom(room);
    }
  }

  tickRoom(room) {
    if (!room.players.length && !room.spectators.length) return;
    const tickStart = performance.now();
    const now = tickStart;
    const dt = Math.min(0.034, (now - room.lastTick) / 1000);
    room.lastTick = now;

    if (room.status === "ended") {
      const endedDuration = now - (room.endedAt || now);
      if (this.draining || endedDuration > 15000) {
        this.rooms.delete(room.code);
        this.workerRegistry.releaseRoomLease(room.code, this.workerId);
        if (this.roomDirectory) {
          this.roomDirectory.removeRoom(room.code).catch(() => {});
        }
        this.recordTick(performance.now() - tickStart);
        return;
      }
      this.publishState(room, now);
      this.recordTick(performance.now() - tickStart);
      return;
    }

    if (room.status !== "running") {
      this.publishState(room, now);
      this.recordTick(performance.now() - tickStart);
      return;
    }

    updateBotTargets(room, now, dt);
    advancePaddles(room, now, dt);

    if (room.countdownUntil > now) {
      this.publishState(room, now);
      this.recordTick(performance.now() - tickStart);
      return;
    }
    if (room.countdownUntil) {
      launchServe(room, now);
      room.countdownUntil = 0;
      this.publishState(room, now);
      this.recordTick(performance.now() - tickStart);
      return;
    }

    if (!room.power && now >= room.nextPowerAt) {
      room.power = {
        type: ["multi", "laser", "emp", "overdrive"][Math.floor(Math.random() * 4)],
        x: W / 2 + rand(-140, 140),
        y: H / 2 + rand(-70, 70),
        r: 18
      };
    }

    const prevStatus = room.status;
    advanceBalls(room, now, dt);
    checkWin(room, now);
    finalizeMatch(room, {
      leaderboard: this.leaderboard,
      playerRepository: this.playerRepository,
      matchRepository: this.matchRepository
    });
    if (prevStatus !== room.status) {
      this.syncRoomDirectory(room);
    }

    if (room.status === "running" && room.pendingCountdown && room.balls.length === 0) {
      beginCountdown(room, now, room.mode === "2v2" ? "both" : room.lastMissTeam || "top");
      room.pendingCountdown = false;
      room.lastMissTeam = null;
    }

    this.publishState(room, now);
    this.recordTick(performance.now() - tickStart);
  }
}
