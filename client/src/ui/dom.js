export function collectDom() {
  const $ = (id) => document.getElementById(id);
  const canvas = $("court");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true }) || canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;

  return {
    $,
    aiBtn: $("aiBtn"),
    bottomControlInput: $("bottomControlInput"),
    canvas,
    copyRoomGameBtn: $("copyRoomGameBtn"),
    copyRoomBtn: $("copyRoomBtn"),
    create1: $("create1"),
    create4: $("create4"),
    ctx,
    fillAiBtn: $("fillAiBtn"),
    game: $("game"),
    infoBtn: $("infoBtn"),
    infoModal: $("infoModal"),
    installBtn: $("installBtn"),
    joinPlayer: $("joinPlayer"),
    joinSpectator: $("joinSpectator"),
    leaveBtn: $("leaveBtn"),
    menu: $("menu"),
    missesEl: $("misses"),
    modeLabel: $("modeLabel"),
    nameInput: $("nameInput"),
    overlay: $("overlay"),
    quick1: $("quick1"),
    quick2: $("quick2"),
    quickBtn: $("quickBtn"),
    quickStatus: $("quickStatus"),
    renderDelayInput: $("renderDelayInput"),
    replayBtn: $("replayBtn"),
    roomCode: $("roomCode"),
    roomsRoot: $("rooms"),
    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    settingsName: $("settingsName"),
    aiDifficulty: $("aiDifficulty"),
    soundInput: $("soundInput"),
    statusEl: $("status"),
    timerEl: $("timer")
  };
}
