import { H, W, clamp, config, settings } from "./core/shared.js";
import { LocalGame } from "./game/local-game.js";
import { parseStatePacket as parseBinaryStatePacket } from "./network/protocol.js";
import { createNetwork } from "./network/socket.js";
import { clearResumeRoom, readResumeRoom, saveResumeRoom, sessionId } from "./platform/session.js";
import { createRenderer, stagingSlots } from "./rendering/renderer.js";
import { createAudio } from "./ui/audio.js";
import { collectDom } from "./ui/dom.js";
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
  draggingSlot: false,
  quickMode: "1v1",
  lastNetState: null,
  netBuffer: [],
  renderDelay: 90,
  lastHitStamp: 0,
  lastPowerStamp: "",
  lastMissTotal: 0,
  lastBumpSignature: "",
  inputX: 0.5,
  lastInputSentAt: 0,
  lastInputSentX: 0.5,
  keys: new Set(),
  effects: [],
  lastTime: performance.now(),
  localGame: null,
  deferredInstall: null,
  thunderDone: false,
  gameOverSoundFor: "",
  audio: null
};

const SESSION_ID = sessionId();

const elements = collectDom();
const {
  $,
  aiBtn,
  bottomControlInput,
  canvas,
  copyRoomGameBtn,
  copyRoomBtn,
  create1,
  create4,
  ctx,
  fillAiBtn,
  game,
  infoBtn,
  installBtn,
  joinPlayer,
  joinSpectator,
  leaveBtn,
  menu,
  modeLabel,
  missesEl,
  nameInput,
  overlay,
  quick1,
  quick2,
  quickBtn,
  quickStatus,
  renderDelayInput,
  replayBtn,
  roomCode,
  roomsRoot,
  settingsBtn,
  settingsName,
  aiDifficulty,
  soundInput,
  statusEl,
  timerEl
} = elements;
const dom = { statusEl, timerEl, missesEl, replayBtn, fillAiBtn, nameInput };
const { playGameOver, playMiss, playPower, playRumble, playStrike, playWall, unlockAudio } = createAudio({ state, settings });
const { closeModal, ensureHandle, loadConfig, loadSettings, openModal, saveSettings, setQuickMode } = createSettingsUi({ elements, state });
const renderer = createRenderer({ ctx, state, dom, playRumble, nameForSlot });
const network = createNetwork({
  handleServer,
  helloMessage,
  nameForSlot,
  onOpen: maybeResumeRoom,
  onClose: () => {
    state.connectionState = "reconnecting";
    if (!state.local) statusEl.textContent = "connection lost / reconnecting";
  },
  onConnecting: () => {
    state.connectionState = "connecting";
  },
  onProtocolError: () => {
    statusEl.textContent = "connection protocol changed / refreshing";
    location.reload();
  },
  parseBinaryStatePacket,
  state
});
const { connect, send } = network;

connect();
loadConfig();
loadSettings();
applyRoomFromUrl();
bindUi();
registerPwa();
requestAnimationFrame(frame);

function bindUi() {
  $("aiBtn").addEventListener("click", () => {
    unlockAudio();
    startLocal("AI mode");
  });
  $("quickBtn").addEventListener("click", () => {
    unlockAudio();
    send(helloMessage());
    send({ t: "quick", mode: state.quickMode });
    quickStatus.textContent = `waiting for ${state.quickMode} quick match...`;
  });
  quick1.addEventListener("click", () => setQuickMode("1v1"));
  quick2.addEventListener("click", () => setQuickMode("2v2"));
  $("create1").addEventListener("click", () => {
    unlockAudio();
    send(helloMessage());
    send({ t: "createRoom", mode: "1v1" });
  });
  $("create4").addEventListener("click", () => {
    unlockAudio();
    send(helloMessage());
    send({ t: "createRoom", mode: "2v2" });
  });
  $("joinPlayer").addEventListener("click", () => {
    unlockAudio();
    send(helloMessage());
    send({ t: "joinRoom", code: roomCode.value, role: "player" });
  });
  $("joinSpectator").addEventListener("click", () => {
    unlockAudio();
    send(helloMessage());
    send({ t: "joinRoom", code: roomCode.value, role: "spectator" });
  });
  settingsBtn.addEventListener("click", () => openModal("settings"));
  infoBtn.addEventListener("click", () => openModal("info"));
  copyRoomBtn.addEventListener("click", copyRoomLink);
  copyRoomGameBtn.addEventListener("click", copyRoomLink);
  replayBtn.addEventListener("click", replayGame);
  fillAiBtn.addEventListener("click", () => {
    fillAiBtn.hidden = true;
    statusEl.textContent = "filling empty seats...";
    send({ t: "fillAi" });
  });
  $("leaveBtn").addEventListener("click", leaveGame);
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
    state.keys.add(event.key.toLowerCase());
    unlockAudio();
  });
  window.addEventListener("keyup", (event) => {
    if (!isPlayingActive()) return;
    state.keys.delete(event.key.toLowerCase());
  });

  const updatePointer = (event) => {
    if (!isPlayingActive()) return;
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
  return { t: "hello", name: ensureHandle(), sessionId: SESSION_ID, protocol: 2 };
}

function sendInput() {
  if (state.ws?.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - state.lastInputSentAt < 8 && Math.abs(state.inputX - state.lastInputSentX) < 0.002) return;
  state.lastInputSentAt = now;
  state.lastInputSentX = state.inputX;
  const packet = new Uint8Array(3);
  const encoded = Math.round(clamp(state.inputX, 0, 1) * 65535);
  packet[0] = 1;
  packet[1] = encoded >> 8;
  packet[2] = encoded & 255;
  state.ws.send(packet);
}

function handleServer(msg) {
  if (!msg) return;
  if (msg.t === "hello") state.clientId = msg.id;
  if (msg.t === "quickWait") quickStatus.textContent = `waiting for ${msg.mode || state.quickMode} quick match...`;
  if (msg.t === "quickFallback") quickStatus.textContent = "AI filled empty seats";
  if (msg.t === "matched") quickStatus.textContent = `matched ${msg.mode || ""} / room ${msg.code}`;
  if (msg.t === "roomCreated") roomCode.value = msg.code;
  if (msg.t === "roster") {
    state.roster = msg.players || [];
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
  if (msg.t === "resumed") statusEl.textContent = "rejoined match";
  if (msg.t === "joined") {
    state.online = true;
    state.local = false;
    state.role = msg.role;
    state.team = msg.team || "spectator";
    state.slot = Number.isInteger(msg.slot) ? msg.slot : 0;
    state.room = msg.code;
    state.roster = [];
    state.thunderDone = false;
    state.gameOverSoundFor = "";
    state.netBuffer = [];
    state.lastNetState = onlinePlaceholder(msg.mode);
    state.lastHitStamp = 0;
    state.lastPowerStamp = "";
    state.lastMissTotal = 0;
    state.lastBumpSignature = "";
    if (msg.role === "player") saveResumeRoom(msg.code);
    showGame(`${msg.mode} / ${msg.role} / ${msg.code}`);
    copyRoomGameBtn.hidden = msg.role !== "player";
    statusEl.textContent = msg.role === "spectator" ? "spectating" : "waiting for players";
  }
  if (msg.t === "rooms") renderRooms(msg.rooms || []);
  if (msg.t === "state") {
    const missTotal = Number(msg.misses?.top || 0) + Number(msg.misses?.bottom || 0);
    if (missTotal > state.lastMissTotal) {
      playMiss();
      pulseShake("miss-shake");
    }
    state.lastMissTotal = missTotal;
    let hadNewHit = false;
    if (msg.lastHit && msg.lastHit.at !== state.lastHitStamp) {
      state.lastHitStamp = msg.lastHit.at;
      hitEffect(msg.lastHit.x, renderer.toViewY(msg.lastHit.y));
      playStrike(0.3);
      pulseShake("impact-shake");
      hadNewHit = true;
    }
    maybePlayWall(msg, hadNewHit);
    const powerStamp = msg.lastPower ? `${msg.lastPower.type}:${msg.lastPower.at}` : "";
    if (powerStamp && powerStamp !== state.lastPowerStamp) {
      state.lastPowerStamp = powerStamp;
      playPower();
    }
    state.lastNetState = msg;
    state.netBuffer.push({ receivedAt: performance.now(), snapshot: msg });
    if (state.netBuffer.length > 24) state.netBuffer.splice(0, state.netBuffer.length - 24);
    maybePlayGameOver(msg);
  }
  if (msg.t === "replayStarted") {
    state.netBuffer = [];
    state.lastNetState = onlinePlaceholder(msg.mode);
    state.lastMissTotal = 0;
    state.lastBumpSignature = "";
    state.gameOverSoundFor = "";
    resetRoundVisuals();
    statusEl.textContent = state.role === "spectator" ? "spectating" : "move with pointer, arrows, or A/D";
  }
  if (msg.t === "error") {
    quickStatus.textContent = msg.message;
    statusEl.textContent = msg.message;
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
      laser: false,
      emp: false
    });
  }
  return {
    t: "state",
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

function renderRooms(rooms) {
  const root = $("rooms");
  if (!rooms.length) {
    root.replaceChildren(emptyRoomNode());
    return;
  }
  root.replaceChildren();
  for (const room of rooms) {
    const item = document.createElement("button");
    item.className = "room";
    const label = document.createElement("span");
    const code = document.createElement("strong");
    code.textContent = room.code;
    label.append(code, ` ${room.mode} ${room.status}`);
    const count = document.createElement("span");
    count.textContent = `${room.players}/${room.maxPlayers} +${room.spectators}`;
    item.append(label, count);
    item.addEventListener("click", () => {
      roomCode.value = room.code;
      roomCode.focus();
    });
    root.appendChild(item);
  }
}

function emptyRoomNode() {
  const item = document.createElement("div");
  item.className = "room";
  const text = document.createElement("span");
  text.textContent = "no open rooms";
  const dash = document.createElement("span");
  dash.textContent = "--";
  item.append(text, dash);
  return item;
}

async function copyRoomLink() {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) {
    quickStatus.textContent = "create or enter a room code first";
    statusEl.textContent = "create or enter a room code first";
    return;
  }
  const url = `${location.origin}/?room=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(url);
    quickStatus.textContent = `copied room link ${code}`;
    statusEl.textContent = `copied room link ${code}`;
  } catch {
    roomCode.select();
    quickStatus.textContent = `room code ${code} ready to copy`;
    statusEl.textContent = `room code ${code} ready to copy`;
  }
}

function startLocal(label) {
  const handle = ensureHandle();
  state.online = false;
  state.local = true;
  state.role = "player";
  state.team = "bottom";
  state.slot = 0;
  state.localGame = newLocalGame();
  state.localGame.players[0].name = handle;
  resetRoundVisuals();
  showGame(label);
  statusEl.textContent = "AI mode / 5 misses loses";
}

function showGame(label) {
  modeLabel.textContent = label;
  document.body.classList.add("game-active");
  menu.classList.add("hidden");
  game.classList.remove("hidden");
}

function leaveGame() {
  send({ t: "leaveRoom" });
  clearResumeRoom();
  state.online = false;
  state.local = false;
  state.lastNetState = null;
  state.netBuffer = [];
  state.localGame = null;
  state.keys.clear();
  resetRoundVisuals();
  document.body.classList.remove("game-active");
  game.classList.add("hidden");
  menu.classList.remove("hidden");
  replayBtn.hidden = true;
  fillAiBtn.hidden = true;
  copyRoomGameBtn.hidden = true;
}

function replayGame() {
  if (state.local) {
    const label = modeLabel.textContent || "AI mode";
    state.localGame = newLocalGame();
    resetRoundVisuals();
    replayBtn.hidden = true;
    modeLabel.textContent = label;
    statusEl.textContent = "AI mode / replay";
    return;
  }
  if (state.online && state.role === "player") {
    replayBtn.hidden = true;
    statusEl.textContent = "requesting replay...";
    send({ t: "replayRoom" });
  }
}

function resetRoundVisuals() {
  state.thunderDone = false;
  state.gameOverSoundFor = "";
  state.effects = [];
  state.keys.clear();
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
  if (state.local || state.pending.length) return;
  const code = readResumeRoom();
  if (code) send({ t: "resumeRoom", code });
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
    renderer.draw(state.localGame?.snapshot() || renderer.interpolatedNetState() || state.lastNetState);
  } catch (error) {
    statusEl.textContent = `game error: ${error.message}`;
  }
  requestAnimationFrame(frame);
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
  state.effects.push({ x, y, r: 8, life: 18, max: 18, spin: Math.random() * Math.PI * 2 });
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
  if (hadNewHit || !snapshot?.balls?.length) return;
  const signature = snapshot.balls
    .filter((ball) => ball.bump)
    .map((ball) => `${Math.round(ball.x / 12)}:${Math.round(ball.y / 12)}`)
    .join("|");
  if (!signature) {
    state.lastBumpSignature = "";
    return;
  }
  if (signature === state.lastBumpSignature) return;
  state.lastBumpSignature = signature;
  playWall();
  pulseShake("impact-shake");
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
  roomCode.value = code.toUpperCase().replace(/[^\w-]/g, "").slice(0, 6);
}
