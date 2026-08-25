import { COACH_KEY, H, W, clamp, config, settings } from "./core/shared.js";
import { LocalGame } from "./game/local-game.js";
import { createClockSync } from "./network/clock-sync.js";
import { presentationDelayMs } from "./network/presentation.js";
import { parseStatePacket as parseBinaryStatePacket } from "./network/protocol.js";
import { createNetwork } from "./network/socket.js";
import { clearResumeRoom, readResumeRoom, saveResumeRoom, sessionId } from "./platform/session.js";
import { createRenderer, stagingSlots } from "./rendering/renderer.js";
import { createAudio } from "./ui/audio.js";
import { collectDom } from "./ui/dom.js";
import { createErrorUi } from "./ui/error-ui.js";
import { createLeaderboardUi } from "./ui/leaderboard.js";
import { createPlayFlow } from "./ui/play-flow.js";
import { createSettingsUi } from "./ui/settings-ui.js";

const state = {
  ws: null,
  pending: [],
  connecting: false,
  connectionState: "connecting",
  clientId: null,
  online: false,
  local: false,
  role: "lobby",
  team: "bottom",
  slot: -1,
  room: null,
  roster: [],
  playerScores: new Map(),
  draggingSlot: false,
  quickMode: "1v1",
  lastNetState: null,
  netBuffer: [],
  renderDelay: 25,
  lastHitStamp: 0,
  lastPowerStamp: "",
  lastMissTotal: 0,
  lastBumpSignature: "",
  inputX: 0.5,
  lastInputSentAt: 0,
  lastInputSentX: 0.5,
  inputSequence: 0,
  latencyMs: null,
  networkDegraded: false,
  lastSnapshotReceivedAt: 0,
  clockOffsetMs: 0,
  clockJitterMs: 0,
  clockSynced: false,
  predictedPaddleX: W / 2,
  predictedPaddleVx: 0,
  keys: new Set(),
  effects: [],
  presentationTimers: new Set(),
  lastTime: performance.now(),
  localGame: null,
  deferredInstall: null,
  thunderDone: false,
  gameOverSoundFor: "",
  audio: null,
  autoFillAi: false,
  sessionMoved: false
};

const SESSION_ID = sessionId();

const elements = collectDom();
const errorUi = createErrorUi({ config, state });
const leaderboardUi = createLeaderboardUi({ one: elements.leaderboard1v1, two: elements.leaderboard2v2 });
leaderboardUi.refresh();
const {
  $,
  bottomControlInput,
  canvas,
  copyRoomGameBtn,
  controlCoach,
  ctx,
  dismissCoach,
  fillAiBtn,
  game,
  infoBtn,
  installBtn,
  leaveBtn,
  menu,
  modeLabel,
  missesEl,
  networkBadge,
  nameInput,
  overlay,
  renderDelayInput,
  replayBtn,
  roomCode,
  roomBadge,
  roomValue,
  settingsBtn,
  settingsName,
  aiDifficulty,
  soundInput,
  statusEl,
  timerEl
} = elements;
const dom = {
  fillAiBtn,
  matchResult: elements.matchResult,
  missesEl,
  nameInput,
  replayBtn,
  resultScore: elements.resultScore,
  resultTitle: elements.resultTitle,
  statusEl,
  timerEl
};
const { playGameOver, playMiss, playPower, playRumble, playStrike, playWall, unlockAudio } = createAudio({ state, settings });
const { closeModal, ensureHandle, loadConfig, loadSettings, openModal, saveSettings } = createSettingsUi({ elements, state });
const renderer = createRenderer({
  ctx,
  state,
  dom,
  playRumble,
  nameForSlot,
  localPerformanceForServerTimestamp: (timestamp) => clock.localPerformanceForServerTimestamp(timestamp)
});
const clock = createClockSync({
  intervalMs: () => config.clockSyncIntervalMs,
  onUpdate: ({ offset, rtt, jitter, synced }) => {
    state.clockOffsetMs = offset;
    state.clockJitterMs = jitter;
    state.clockSynced = synced;
    state.latencyMs = Math.round(rtt);
    state.networkDegraded = rtt >= 180 || jitter >= 50;
    networkBadge.textContent = `${state.networkDegraded ? "! " : ""}${Math.round(rtt)} ms`;
    networkBadge.dataset.quality = state.networkDegraded ? "poor" : rtt < 80 ? "good" : rtt < 160 ? "fair" : "slow";
    networkBadge.dataset.tooltip = `Round trip ${Math.round(rtt)} ms; clock jitter ${Math.round(jitter)} ms`;
  }
});
const network = createNetwork({
  handleServer,
  helloMessage,
  nameForSlot,
  onOpen: maybeResumeRoom,
  onClose: () => {
    if (state.sessionMoved) return;
    clock.stop();
    state.connectionState = "reconnecting";
    state.networkDegraded = true;
    networkBadge.dataset.quality = "poor";
    networkBadge.textContent = "! offline";
    if (!state.local) statusEl.textContent = "Connection lost. Reconnecting...";
    playFlow?.finishJoin?.("Connection lost. Reconnecting...");
  },
  onConnecting: () => {
    state.connectionState = "connecting";
  },
  onProtocolError: (error) => {
    statusEl.textContent = "The connection protocol failed.";
    errorUi.show(error || "The connection protocol could not be decoded");
  },
  parseBinaryStatePacket,
  state
});
const { connect, send } = network;
const playFlow = createPlayFlow({
  elements,
  actions: {
    copyRoomLink,
    create: (mode, visibility) => {
      unlockAudio();
      send(helloMessage());
      send({ t: "createRoom", mode, visibility });
      playFlow.setStatus(`Creating a ${visibility} ${mode} room...`);
    },
    join: (code, role) => {
      unlockAudio();
      send(helloMessage());
      send({ t: "joinRoom", code, role });
      playFlow.setStatus(role === "spectator" ? `Opening room ${code}...` : `Joining room ${code}...`);
    },
    modeChanged: (mode) => {
      state.quickMode = mode;
      saveSettings();
    },
    practice: (mode) => {
      unlockAudio();
      if (mode === "1v1") {
        startLocal("Practice / 1v1");
        return;
      }
      state.autoFillAi = true;
      send(helloMessage());
      send({ t: "createRoom", mode: "2v2", visibility: "private" });
      playFlow.setStatus("Preparing a 2v2 AI practice match...");
    },
    quick: (mode) => {
      unlockAudio();
      send(helloMessage());
      send({ t: "quick", mode });
    },
    requestRooms: requestPublicRooms
  }
});

async function requestPublicRooms({ append = false, offset = 0, status = "waiting" } = {}) {
  try {
    const query = new URLSearchParams({ offset: String(offset), status });
    const response = await fetch(`/rooms.json?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Room directory returned ${response.status}`);
    const payload = await response.json();
    playFlow.updateRooms(payload.rooms || [], { append, hasMore: payload.hasMore, nextOffset: payload.nextOffset, status });
  } catch {
    playFlow.roomsLoadFailed();
  }
}

connect();
loadConfig();
loadSettings();
playFlow.setMode(state.quickMode);
applyRoomFromUrl();
bindUi();
registerPwa();
requestAnimationFrame(frame);

function bindUi() {
  settingsBtn.addEventListener("click", () => openModal("settings"));
  infoBtn.addEventListener("click", () => openModal("info"));
  copyRoomGameBtn.addEventListener("click", copyRoomLink);
  replayBtn.addEventListener("click", replayGame);
  fillAiBtn.addEventListener("click", () => {
    fillAiBtn.hidden = true;
    statusEl.textContent = "filling empty seats...";
    send({ t: "fillAi" });
  });
  leaveBtn.addEventListener("click", leaveGame);
  dismissCoach.addEventListener("click", dismissControlCoach);
  $("installBtn").addEventListener("click", async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    $("installBtn").hidden = true;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!overlay.classList.contains("hidden")) closeModal();
      return;
    }
    if (!isGameInput(event)) return;
    event.preventDefault();
    dismissControlCoach();
    state.keys.add(event.key.toLowerCase());
    unlockAudio();
  });
  window.addEventListener("keyup", (event) => {
    if (!isPlayingActive()) return;
    state.keys.delete(event.key.toLowerCase());
  });

  const updatePointer = (event) => {
    if (!isPlayingActive()) return;
    dismissControlCoach();
    const point = renderer.clientToCourt(event.clientX, event.clientY);
    state.inputX = clamp(point.x / W, 0, 1);
    if (state.online && state.role === "player") sendInput();
  };
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    unlockAudio();
    if (!trySelectStagingSlot(event)) updatePointer(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.draggingSlot) updatePointer(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (state.draggingSlot) trySelectStagingSlot(event);
    state.draggingSlot = false;
  });

  window.addEventListener("pointerdown", handleBottomHalfControl);
  window.addEventListener("pointermove", handleBottomHalfControl);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closeModal();
  });
  for (const button of document.querySelectorAll("[data-close-modal]")) {
    button.addEventListener("click", closeModal);
  }
  settingsName.addEventListener("input", () => {
    nameInput.value = settingsName.value;
    saveSettings();
  });
  aiDifficulty.addEventListener("change", () => {
    config.aiDifficulty = aiDifficulty.value;
    saveSettings();
  });
  renderDelayInput.addEventListener("input", () => {
    state.renderDelay = Number(renderDelayInput.value) || state.renderDelay;
    config.renderDelayMs = state.renderDelay;
    saveSettings();
  });
  bottomControlInput.addEventListener("change", () => {
    settings.bottomHalfControl = bottomControlInput.checked;
    saveSettings();
  });
  soundInput.addEventListener("change", () => {
    settings.sound = soundInput.checked;
    saveSettings();
  });
  nameInput.addEventListener("input", () => {
    settingsName.value = nameInput.value;
    saveSettings();
  });
}

function helloMessage() {
  return { t: "hello", name: ensureHandle(), sessionId: SESSION_ID, protocol: 4 };
}

function sendInput() {
  if (state.ws?.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  const interval = 1000 / (Number(config.inputSendHz) || 60);
  if (now - state.lastInputSentAt < interval) return;
  if (Math.abs(state.inputX - state.lastInputSentX) < 0.001 && now - state.lastInputSentAt < 100) return;
  if (state.ws.bufferedAmount > (Number(config.inputBufferLimitBytes) || 2048)) return;
  state.lastInputSentAt = now;
  state.lastInputSentX = state.inputX;
  state.inputSequence = (state.inputSequence + 1) & 0xffff;
  const packet = new Uint8Array(9);
  const encoded = Math.round(clamp(state.inputX, 0, 1) * 65535);
  packet[0] = 1;
  packet[1] = encoded >> 8;
  packet[2] = encoded & 255;
  packet[3] = state.inputSequence >> 8;
  packet[4] = state.inputSequence & 255;
  const serverTime = clock.serverTimestamp32();
  packet[5] = serverTime >>> 24;
  packet[6] = serverTime >>> 16;
  packet[7] = serverTime >>> 8;
  packet[8] = serverTime & 255;
  state.ws.send(packet);
}

function handleServer(msg) {
  if (!msg) return;
  if (clock.handle(msg)) return;
  if (msg.t === "hello") state.clientId = msg.id;
  if (msg.t === "quickWait") playFlow.setStatus(`Finding a ${msg.mode || state.quickMode} quick match...`);
  if (msg.t === "quickFallback") playFlow.setStatus("AI players filled the empty seats.");
  if (msg.t === "matched") playFlow.setStatus(`Match found. Room ${msg.code}.`);
  if (msg.t === "roomCreated") {
    roomCode.value = msg.code;
    playFlow.setStatus(`Room ${msg.code} is ready.`);
  }
  if (msg.t === "roster") {
    state.roster = msg.players || [];
    for (const player of state.roster) state.playerScores.set(player.slot, Math.max(0, Number(player.score) || 0));
    const self = state.roster.find((player) => player.id === state.clientId);
    if (self) {
      state.slot = self.slot;
      state.team = self.team || state.team;
    }
  }
  if (msg.t === "slotSelected") {
    state.slot = msg.slot;
    state.team = msg.team;
  }
  if (msg.t === "resumed") statusEl.textContent = "Rejoined the match.";
  if (msg.t === "sessionMoved") {
    state.sessionMoved = true;
    leaveGame();
    playFlow.setStatus(msg.message || "This match moved to another tab");
    return;
  }
  if (msg.t === "joined") {
    playFlow.finishJoin();
    state.online = true;
    state.local = false;
    state.role = msg.role;
    state.team = msg.team || "spectator";
    state.slot = Number.isInteger(msg.slot) ? msg.slot : 0;
    state.room = msg.code;
    state.roster = [];
    state.playerScores.clear();
    state.thunderDone = false;
    state.gameOverSoundFor = "";
    state.netBuffer = [];
    state.lastNetState = onlinePlaceholder(msg.mode);
    state.lastHitStamp = 0;
    state.lastPowerStamp = "";
    state.lastMissTotal = 0;
    state.lastBumpSignature = "";
    state.inputX = 0.5;
    state.predictedPaddleX = W / 2;
    state.predictedPaddleVx = 0;
    if (msg.role === "player") saveResumeRoom(msg.code);
    showGame(msg.role === "spectator" ? `Spectating · ${msg.mode}` : msg.mode);
    roomBadge.hidden = false;
    roomValue.textContent = msg.code;
    networkBadge.hidden = false;
    copyRoomGameBtn.hidden = msg.role !== "player";
    statusEl.textContent = msg.role === "spectator" ? "Spectating." : "Waiting for players...";
    if (state.autoFillAi && msg.role === "player" && msg.mode === "2v2") {
      state.autoFillAi = false;
      send({ t: "fillAi" });
      statusEl.textContent = "Preparing AI players...";
    }
  }
  if (msg.t === "state") {
    const ownPlayer = msg.players?.find((player) => player.slot === state.slot);
    if (ownPlayer && state.role === "player") state.team = ownPlayer.team || state.team;
    const matchJustStarted = state.lastNetState?.status !== "running" && msg.status === "running";
    const missTotal = Number(msg.misses?.top || 0) + Number(msg.misses?.bottom || 0);
    if (missTotal > state.lastMissTotal) {
      const delayMs = snapshotPresentationDelayMs(msg);
      playMiss(delayMs / 1000);
      scheduleImpactVisual(state.room, delayMs, () => pulseShake("miss-shake"));
    }
    state.lastMissTotal = missTotal;
    let hadNewHit = false;
    if (msg.lastHit && msg.lastHit.at !== state.lastHitStamp) {
      state.lastHitStamp = msg.lastHit.at;
      const delayMs = presentationDelayMs({
        encodedTimestamp: msg.lastHit.at,
        protocol: msg.protocol,
        synced: state.clockSynced,
        toLocalPerformance: (timestamp) => clock.localPerformanceForServerTimestamp(timestamp)
      });
      const roomAtHit = state.room;
      playStrike(0.3, delayMs / 1000);
      scheduleImpactVisual(roomAtHit, delayMs, () => {
        hitEffect(msg.lastHit.x, renderer.toViewY(msg.lastHit.y, msg));
        pulseShake("impact-shake");
      });
      hadNewHit = true;
    }
    if (msg.lastHit && Number.isInteger(msg.lastHit.slot)) {
      state.playerScores.set(msg.lastHit.slot, Math.max(0, Number(msg.lastHit.score) || 0));
    }
    for (const player of msg.players || []) player.score = state.playerScores.get(player.slot) || 0;
    maybePlayWall(msg, hadNewHit);
    const powerStamp = msg.lastPower ? `${msg.lastPower.type}:${msg.lastPower.at}` : "";
    if (powerStamp && powerStamp !== state.lastPowerStamp) {
      state.lastPowerStamp = powerStamp;
      playPower();
    }
    state.lastNetState = msg;
    const receivedAt = performance.now();
    state.lastSnapshotReceivedAt = receivedAt;
    const timelineAt = msg.protocol >= 3 ? clock.localPerformanceForServerTimestamp(msg.serverNow) : receivedAt;
    if (ownPlayer && state.role === "player") reconcilePredictedPaddle(ownPlayer.x);
    const buffered = { receivedAt, timelineAt, snapshot: msg };
    if (msg.status === "ended") {
      state.netBuffer = [buffered];
      state.keys.clear();
      state.predictedPaddleVx = 0;
    } else {
      state.netBuffer.push(buffered);
    }
    if (state.netBuffer.length > 24) state.netBuffer.splice(0, state.netBuffer.length - 24);
    maybePlayGameOver(msg);
    if (matchJustStarted && state.role === "player") showControlCoach();
  }
  if (msg.t === "replayStarted") {
    state.netBuffer = [];
    state.lastNetState = onlinePlaceholder(msg.mode);
    state.lastMissTotal = 0;
    state.lastBumpSignature = "";
    state.gameOverSoundFor = "";
    resetRoundVisuals();
    statusEl.textContent = state.role === "spectator" ? "Spectating." : "Drag to move, or use A/D or the arrow keys.";
  }
  if (msg.t === "error") {
    playFlow.finishJoin(msg.message);
    playFlow.setStatus(msg.message);
    statusEl.textContent = msg.message;
    if (msg.fatal) errorUi.show(msg.message, { errorId: msg.errorId });
  }
}

function onlinePlaceholder(mode = "1v1") {
  const players = [];
  if (state.role === "player") {
    players.push({
      id: `slot-${state.slot}`,
      name: nameInput.value.trim() || "you",
      team: state.team || "bottom",
      slot: state.slot,
      x: state.inputX * W,
      w: 140,
      vx: 0,
      ack: 0,
      laser: false,
      emp: false
    });
  }
  return {
    t: "state",
    protocol: 3,
    serverNow: 0,
    mode,
    status: "waiting",
    elapsed: 0,
    missLimit: mode === "2v2" ? config.missLimit2v2 : config.missLimit1v1,
    misses: { top: 0, bottom: 0 },
    winner: null,
    players,
    balls: [],
    power: null,
    lastHit: null,
    lastPower: null,
    countdown: 0,
    spectators: 0
  };
}

async function copyRoomLink() {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) {
    playFlow.setStatus("Create a room or enter a room code first.");
    statusEl.textContent = "Create a room or enter a room code first.";
    return;
  }
  const url = `${location.origin}/?room=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(url);
    playFlow.setStatus(`Copied the invite link for room ${code}.`);
    statusEl.textContent = `Copied the invite link for room ${code}.`;
  } catch {
    roomCode.select();
    playFlow.setStatus(`Room code ${code} is selected and ready to copy.`);
    statusEl.textContent = `Room code ${code} is selected and ready to copy.`;
  }
}

function startLocal(label) {
  const handle = ensureHandle();
  state.online = false;
  state.local = true;
  state.role = "player";
  state.team = "bottom";
  state.slot = 0;
  state.predictedPaddleX = W / 2;
  state.predictedPaddleVx = 0;
  state.localGame = newLocalGame();
  state.localGame.players[0].name = handle;
  resetRoundVisuals();
  showGame(label);
  roomBadge.hidden = true;
  showControlCoach();
  networkBadge.hidden = true;
  statusEl.textContent = "Practice match. Five misses loses.";
}

function showGame(label) {
  modeLabel.textContent = label;
  document.body.classList.add("game-active");
  menu.classList.add("hidden");
  game.classList.remove("hidden");
}

function showControlCoach() {
  try {
    controlCoach.classList.toggle("hidden", localStorage.getItem(COACH_KEY) === "done");
  } catch {
    controlCoach.classList.remove("hidden");
  }
}

function dismissControlCoach() {
  if (controlCoach.classList.contains("hidden")) return;
  controlCoach.classList.add("hidden");
  try {
    localStorage.setItem(COACH_KEY, "done");
  } catch {
    // The hint can still close when storage is unavailable.
  }
}

function leaveGame() {
  send({ t: "leaveRoom" });
  clearResumeRoom();
  state.online = false;
  state.local = false;
  state.lastNetState = null;
  state.netBuffer = [];
  state.localGame = null;
  state.room = null;
  state.role = "lobby";
  state.autoFillAi = false;
  state.keys.clear();
  resetRoundVisuals();
  document.body.classList.remove("game-active");
  game.classList.add("hidden");
  menu.classList.remove("hidden");
  replayBtn.hidden = true;
  fillAiBtn.hidden = true;
  copyRoomGameBtn.hidden = true;
  networkBadge.hidden = true;
  roomBadge.hidden = true;
  roomValue.textContent = "------";
  dom.matchResult.classList.add("hidden");
  controlCoach.classList.add("hidden");
  playFlow.reset();
  leaderboardUi.refresh();
}

function replayGame() {
  if (state.local) {
    const label = modeLabel.textContent || "AI mode";
    state.localGame = newLocalGame();
    resetRoundVisuals();
    replayBtn.hidden = true;
    modeLabel.textContent = label;
    statusEl.textContent = "Practice replay.";
    return;
  }
  if (state.online && state.role === "player") {
    replayBtn.hidden = true;
    statusEl.textContent = "Requesting a replay...";
    send({ t: "replayRoom" });
  }
}

function resetRoundVisuals() {
  state.thunderDone = false;
  state.gameOverSoundFor = "";
  state.effects = [];
  for (const timer of state.presentationTimers) window.clearTimeout(timer);
  state.presentationTimers.clear();
  state.keys.clear();
  dom.matchResult.classList.add("hidden");
  renderer.clearThunder();
}

function newLocalGame() {
  return new LocalGame({
    getInputX: () => state.inputX,
    hitEffect,
    playMiss,
    playPower,
    playStrike,
    playWall
  });
}

function maybeResumeRoom() {
  state.connectionState = "online";
  clock.reset();
  clock.start(send);
  if (state.local || state.pending.length) return;
  const code = readResumeRoom();
  if (!code) return;
  send({ t: "resumeRoom", code });
  window.setTimeout(() => {
    if (!state.online && state.ws?.readyState === WebSocket.OPEN && readResumeRoom() === code) send({ t: "resumeRoom", code });
  }, 350);
  window.setTimeout(() => {
    if (!state.online && state.ws?.readyState === WebSocket.OPEN && readResumeRoom() === code) send({ t: "resumeRoom", code });
  }, 1100);
}

function frame(now) {
  try {
    const dt = Math.min(0.034, (now - state.lastTime) / 1000);
    state.lastTime = now;
    if (state.localGame) state.localGame.update(dt);
    if (state.localGame?.status === "ended") maybePlayGameOver(state.localGame.snapshot());
    if (state.keys.size && isPlayingActive()) {
      if (state.keys.has("arrowleft") || state.keys.has("a")) state.inputX -= dt * 1.35;
      if (state.keys.has("arrowright") || state.keys.has("d")) state.inputX += dt * 1.35;
      state.inputX = clamp(state.inputX, 0, 1);
      if (state.online && state.role === "player") sendInput();
    }
    if (state.online && state.role === "player" && state.lastNetState?.status === "running") {
      advancePredictedPaddle(dt);
      sendInput();
    }
    renderer.draw(state.localGame?.snapshot() || renderer.interpolatedNetState() || state.lastNetState);
  } catch (error) {
    statusEl.textContent = `game error: ${error.message}`;
  }
  requestAnimationFrame(frame);
}

function advancePredictedPaddle(dt) {
  const own = state.lastNetState?.players?.find((player) => player.slot === state.slot);
  const width = own?.w || 140;
  const minX = width / 2 + 4;
  const maxX = W - width / 2 - 4;
  const target = clamp(state.inputX * W, minX, maxX);
  const maxSpeed = Number(config.paddleMaxSpeed) || 4200;
  const acceleration = Number(config.paddleAcceleration) || 30000;
  const desiredVelocity = clamp((target - state.predictedPaddleX) * 18, -maxSpeed, maxSpeed);
  const step = acceleration * dt;
  if (state.predictedPaddleVx < desiredVelocity) state.predictedPaddleVx = Math.min(desiredVelocity, state.predictedPaddleVx + step);
  else state.predictedPaddleVx = Math.max(desiredVelocity, state.predictedPaddleVx - step);
  const next = clamp(state.predictedPaddleX + state.predictedPaddleVx * dt, minX, maxX);
  if ((target - state.predictedPaddleX) * (target - next) <= 0) {
    state.predictedPaddleX = target;
    state.predictedPaddleVx = 0;
  } else {
    state.predictedPaddleX = next;
  }
}

function reconcilePredictedPaddle(authoritativeX) {
  if (!Number.isFinite(authoritativeX)) return;
  if (!Number.isFinite(state.predictedPaddleX)) {
    state.predictedPaddleX = authoritativeX;
    return;
  }
  const error = authoritativeX - state.predictedPaddleX;
  state.predictedPaddleX += error * (Math.abs(error) > 180 ? 0.55 : 0.08);
}

function handleBottomHalfControl(event) {
  if (!settings.bottomHalfControl || !isPlayingActive()) return;
  if (state.role === "spectator" || isStaging2v2()) return;
  if (!event.isPrimary || event.clientY < window.innerHeight / 2) return;
  if (event.type === "pointermove" && !(event.buttons & 1)) return;
  if (event.target?.closest?.("button, input, select, textarea, .modal, .overlay")) return;

  const point = renderer.clientToCourt(event.clientX, event.clientY);
  state.inputX = clamp(point.x / W, 0, 1);
  if (state.online && state.role === "player") sendInput();
}

function trySelectStagingSlot(event) {
  if (!isStaging2v2()) return false;
  const point = canvasPoint(event);
  if (event.type === "pointerdown") {
    state.draggingSlot = true;
    return true;
  }
  if (event.type !== "pointerup") return true;

  const slot = stagingSlots().findIndex((rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h);
  if (slot >= 0 && state.online && state.role === "player") send({ t: "selectSlot", slot });
  return true;
}

function isStaging2v2(snapshot = state.lastNetState) {
  return state.online && snapshot?.mode === "2v2" && snapshot?.status === "waiting";
}

function canvasPoint(event) {
  return renderer.clientToCourt(event.clientX, event.clientY);
}

function isGameInput(event) {
  if (!isPlayingActive()) return false;
  if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return false;
  return ["arrowleft", "arrowright", "a", "d"].includes(event.key.toLowerCase());
}

function isGameplayActive() {
  return !game.classList.contains("hidden") && (state.local || state.online);
}

function isPlayingActive() {
  if (!isGameplayActive()) return false;
  if (state.local) return state.localGame?.status === "running";
  return state.online && state.role === "player" && state.lastNetState?.status === "running";
}

function hitEffect(x, y) {
  state.effects.push({ x, y, r: 8, createdAt: performance.now(), duration: 320, spin: Math.random() * Math.PI * 2 });
}

function scheduleImpactVisual(room, delayMs, callback) {
  if (delayMs <= 1) {
    if (state.online && state.room === room) callback();
    return;
  }
  const timer = window.setTimeout(() => {
    state.presentationTimers.delete(timer);
    if (state.online && state.room === room) callback();
  }, delayMs);
  state.presentationTimers.add(timer);
}

function nameForSlot(slot) {
  const player = state.roster.find((entry) => entry.slot === slot);
  return player?.name || (slot >= 0 ? `p${slot + 1}` : "player");
}

function registerPwa() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstall = event;
    $("installBtn").hidden = false;
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function maybePlayGameOver(snapshot) {
  if (!snapshot || snapshot.status !== "ended" || !snapshot.winner) return;
  const key = `${snapshot.mode}:${snapshot.winner}:${snapshot.misses.top}:${snapshot.misses.bottom}`;
  if (state.gameOverSoundFor === key) return;
  state.gameOverSoundFor = key;
  const ownTeam = state.local ? "bottom" : state.team;
  playGameOver(snapshot.winner === ownTeam);
}

function maybePlayWall(snapshot, hadNewHit) {
  if (!snapshot?.balls?.length) return;
  const signature = snapshot.balls
    .filter((ball) => ball.bump)
    .map((ball) => `${Math.round(ball.x / 12)}:${Math.round(ball.y / 12)}`)
    .join("|");
  if (!signature) {
    state.lastBumpSignature = "";
    return;
  }
  if (hadNewHit) {
    state.lastBumpSignature = signature;
    return;
  }
  if (signature === state.lastBumpSignature) return;
  state.lastBumpSignature = signature;
  const delayMs = snapshotPresentationDelayMs(snapshot);
  playWall(delayMs / 1000);
  scheduleImpactVisual(state.room, delayMs, () => pulseShake("impact-shake"));
}

function snapshotPresentationDelayMs(snapshot) {
  const presentationTimestamp = (Number(snapshot?.serverNow || 0) + (Number(config.hitPresentationDelayMs) || 90)) >>> 0;
  return presentationDelayMs({
    encodedTimestamp: presentationTimestamp,
    protocol: snapshot?.protocol,
    synced: state.clockSynced,
    toLocalPerformance: (timestamp) => clock.localPerformanceForServerTimestamp(timestamp)
  });
}

function pulseShake(className) {
  document.body.classList.remove(className);
  requestAnimationFrame(() => {
    document.body.classList.add(className);
    window.setTimeout(() => document.body.classList.remove(className), className === "miss-shake" ? 190 : 120);
  });
}

function applyRoomFromUrl() {
  const code = new URLSearchParams(location.search).get("room");
  if (!code) return;
  playFlow.openPrivateCode(code);
}
