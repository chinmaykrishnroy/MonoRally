export function createPlayFlow({ elements, actions }) {
  const {
    aiBtn,
    browseRoomsBtn,
    copyRoomBtn,
    createPrivateBtn,
    flowBackBtn,
    flowStatus,
    flowTitle,
    hostPublicBtn,
    joinPlayer,
    joinSpectator,
    modeStep,
    nameInput,
    onlineBtn,
    onlineStep,
    playFlow,
    playHome,
    playBtn,
    privateRoomBtn,
    privateStep,
    publicJoinPlayer,
    publicJoinSpectator,
    publicRoomCode,
    quick1,
    quick2,
    quickBtn,
    roomCode,
    roomLiveTab,
    roomsRoot,
    roomsStep,
    roomWaitingTab
  } = elements;

  let mode = "1v1";
  let view = "home";
  let roomTab = "waiting";
  let rooms = [];
  const titles = {
    mode: "Choose your match",
    online: "How would you like to play?",
    private: "Private room",
    rooms: "Public rooms"
  };

  function bind() {
    playBtn.addEventListener("click", () => show("mode"));
    flowBackBtn.addEventListener("click", goBack);
    quick1.addEventListener("click", () => setMode("1v1"));
    quick2.addEventListener("click", () => setMode("2v2"));
    aiBtn.addEventListener("click", () => actions.practice(mode));
    onlineBtn.addEventListener("click", () => show("online"));
    quickBtn.addEventListener("click", () => {
      setStatus(`Finding a ${mode} match...`);
      actions.quick(mode);
    });
    browseRoomsBtn.addEventListener("click", () => {
      show("rooms");
      actions.requestRooms();
    });
    privateRoomBtn.addEventListener("click", () => show("private"));
    hostPublicBtn.addEventListener("click", () => actions.create(mode, "public"));
    createPrivateBtn.addEventListener("click", () => actions.create(mode, "private"));
    joinPlayer.addEventListener("click", () => joinCode("player"));
    joinSpectator.addEventListener("click", () => joinCode("spectator"));
    publicJoinPlayer.addEventListener("click", () => joinPublicCode("player"));
    publicJoinSpectator.addEventListener("click", () => joinPublicCode("spectator"));
    copyRoomBtn.addEventListener("click", actions.copyRoomLink);
    roomWaitingTab.addEventListener("click", () => setRoomTab("waiting"));
    roomLiveTab.addEventListener("click", () => setRoomTab("live"));
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") show("online");
    });
    window.setInterval(() => {
      if (view === "rooms") actions.requestRooms();
    }, 2500);
  }

  function show(next) {
    view = next;
    playHome.classList.toggle("hidden", next !== "home");
    playFlow.classList.toggle("hidden", next === "home");
    modeStep.classList.toggle("hidden", next !== "mode");
    onlineStep.classList.toggle("hidden", next !== "online");
    roomsStep.classList.toggle("hidden", next !== "rooms");
    privateStep.classList.toggle("hidden", next !== "private");
    flowTitle.textContent = titles[next] || titles.mode;
    flowBackBtn.setAttribute("aria-label", next === "mode" ? "Back to home" : "Back");
    if (next === "mode") window.setTimeout(() => nameInput.focus(), 0);
  }

  function goBack() {
    if (view === "mode") show("home");
    else if (view === "rooms" || view === "private") show("online");
    else show("mode");
  }

  function setMode(nextMode, notify = true) {
    mode = nextMode === "2v2" ? "2v2" : "1v1";
    quick1.classList.toggle("active", mode === "1v1");
    quick2.classList.toggle("active", mode === "2v2");
    quick1.setAttribute("aria-pressed", String(mode === "1v1"));
    quick2.setAttribute("aria-pressed", String(mode === "2v2"));
    hostPublicBtn.textContent = `Host public ${mode}`;
    createPrivateBtn.textContent = `Create private ${mode}`;
    if (notify) actions.modeChanged(mode);
  }

  function setRoomTab(tab) {
    roomTab = tab === "live" ? "live" : "waiting";
    roomWaitingTab.classList.toggle("active", roomTab === "waiting");
    roomLiveTab.classList.toggle("active", roomTab === "live");
    roomWaitingTab.setAttribute("aria-selected", String(roomTab === "waiting"));
    roomLiveTab.setAttribute("aria-selected", String(roomTab === "live"));
    renderRooms();
  }

  function updateRooms(nextRooms) {
    rooms = Array.isArray(nextRooms) ? nextRooms : [];
    renderRooms();
  }

  function renderRooms() {
    const visible = rooms.filter((room) => (roomTab === "waiting" ? room.status === "waiting" : room.status !== "waiting"));
    roomsRoot.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "emptyRooms";
      empty.textContent = roomTab === "waiting" ? "No public rooms are waiting." : "No matches are in progress.";
      roomsRoot.appendChild(empty);
      return;
    }

    for (const room of visible) roomsRoot.appendChild(roomNode(room));
  }

  function roomNode(room) {
    const item = document.createElement("article");
    item.className = "roomItem";
    const summary = document.createElement("div");
    summary.className = "roomSummary";
    const title = document.createElement("strong");
    title.textContent = `${room.mode} · ${room.code}`;
    const count = document.createElement("span");
    count.textContent = `${room.players}/${room.maxPlayers} players · ${room.spectators} watching`;
    summary.append(title, count);

    const controls = document.createElement("div");
    controls.className = "roomActions";
    if (room.joinable) controls.appendChild(roomAction("Join", () => joinRoom(room.code, "player")));
    controls.appendChild(roomAction("Spectate", () => joinRoom(room.code, "spectator")));
    item.append(summary, controls);
    return item;
  }

  function roomAction(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function joinRoom(code, role) {
    roomCode.value = code;
    actions.join(code, role);
  }

  function joinCode(role) {
    const code = roomCode.value.trim().toUpperCase();
    if (!code) {
      setStatus("Enter a room code first.");
      roomCode.focus();
      return;
    }
    actions.join(code, role);
  }

  function joinPublicCode(role) {
    const code = publicRoomCode.value.trim().toUpperCase();
    if (!code) {
      setStatus("Enter a room code first.");
      publicRoomCode.focus();
      return;
    }
    roomCode.value = code;
    actions.join(code, role);
  }

  function setStatus(message) {
    flowStatus.textContent = message;
  }

  function openPrivateCode(code = "") {
    show("private");
    roomCode.value = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    window.setTimeout(() => roomCode.focus(), 0);
  }

  function reset() {
    setStatus("Ready.");
    show("home");
  }

  setMode("1v1", false);
  bind();
  return { mode: () => mode, openPrivateCode, reset, setMode, setStatus, show, updateRooms };
}
