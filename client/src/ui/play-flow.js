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
  let joining = false;
  let loadingRooms = false;
  let hasMoreRooms = false;
  let nextRoomOffset = 0;
  let joinTimer = 0;
  let lastRenderKey = "";
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
    browseRoomsBtn.addEventListener("click", () => show("rooms"));
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
    roomsRoot.addEventListener("scroll", () => {
      if (roomsRoot.scrollTop + roomsRoot.clientHeight >= roomsRoot.scrollHeight - 24) requestRoomPage(false);
    });
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") show("online");
    });
    window.setInterval(() => {
      if (view === "rooms" && !joining && roomsRoot.scrollTop < 8) requestRoomPage(true);
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
    if (next === "rooms") window.setTimeout(() => requestRoomPage(true), 0);
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
    loadingRooms = false;
    hasMoreRooms = false;
    nextRoomOffset = 0;
    rooms = [];
    lastRenderKey = "";
    roomWaitingTab.classList.toggle("active", roomTab === "waiting");
    roomLiveTab.classList.toggle("active", roomTab === "live");
    roomWaitingTab.setAttribute("aria-selected", String(roomTab === "waiting"));
    roomLiveTab.setAttribute("aria-selected", String(roomTab === "live"));
    renderRooms();
    requestRoomPage(true);
  }

  function requestRoomPage(reset) {
    if (joining || loadingRooms || (!reset && !hasMoreRooms)) return;
    loadingRooms = true;
    roomsRoot.setAttribute("aria-busy", "true");
    if (reset) nextRoomOffset = 0;
    actions.requestRooms({ append: !reset, offset: nextRoomOffset, status: roomTab });
  }

  function updateRooms(nextRooms, page = {}) {
    if (joining) return;
    loadingRooms = false;
    roomsRoot.setAttribute("aria-busy", "false");
    if (page.status && page.status !== roomTab) return;
    const incoming = Array.isArray(nextRooms) ? nextRooms : [];
    rooms = page.append ? mergeRooms(rooms, incoming) : incoming;
    hasMoreRooms = Boolean(page.hasMore);
    nextRoomOffset = Number(page.nextOffset) || rooms.length;
    renderRooms();
  }

  function roomsLoadFailed() {
    loadingRooms = false;
    roomsRoot.setAttribute("aria-busy", "false");
    if (!rooms.length) setStatus("Could not load public rooms. You can still join with a room code.");
  }

  function renderRooms() {
    const visible = rooms.filter((room) => (roomTab === "waiting" ? room.status === "waiting" : room.status !== "waiting"));
    const renderKey = `${roomTab}:${JSON.stringify(visible)}`;
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;
    const scrollTop = roomsRoot.scrollTop;
    roomsRoot.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "emptyRooms";
      empty.textContent = roomTab === "waiting" ? "No public rooms are waiting." : "No matches are in progress.";
      roomsRoot.appendChild(empty);
      roomsRoot.scrollTop = 0;
      return;
    }

    for (const room of visible) roomsRoot.appendChild(roomNode(room));
    roomsRoot.scrollTop = scrollTop;
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
    beginJoin(code, role);
  }

  function joinCode(role) {
    const code = roomCode.value.trim().toUpperCase();
    if (!code) {
      setStatus("Enter a room code first.");
      roomCode.focus();
      return;
    }
    beginJoin(code, role);
  }

  function joinPublicCode(role) {
    const code = publicRoomCode.value.trim().toUpperCase();
    if (!code) {
      setStatus("Enter a room code first.");
      publicRoomCode.focus();
      return;
    }
    roomCode.value = code;
    beginJoin(code, role);
  }

  function beginJoin(code, role) {
    if (joining) return;
    joining = true;
    setJoinBusy(true);
    actions.join(code, role);
    window.clearTimeout(joinTimer);
    joinTimer = window.setTimeout(() => {
      if (!joining) return;
      joining = false;
      setJoinBusy(false);
      setStatus("The room did not respond. Check your connection and try again.");
    }, 7000);
  }

  function finishJoin(message = "") {
    joining = false;
    loadingRooms = false;
    window.clearTimeout(joinTimer);
    setJoinBusy(false);
    if (message) setStatus(message);
    else view = "game";
  }

  function setJoinBusy(busy) {
    roomsStep.setAttribute("aria-busy", String(busy));
    for (const button of [joinPlayer, joinSpectator, publicJoinPlayer, publicJoinSpectator, ...roomsRoot.querySelectorAll("button")]) {
      button.disabled = busy;
    }
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
    finishJoin();
    setStatus("Ready.");
    show("home");
  }

  setMode("1v1", false);
  bind();
  return { finishJoin, mode: () => mode, openPrivateCode, reset, roomsLoadFailed, setMode, setStatus, show, updateRooms };
}

function mergeRooms(current, incoming) {
  const merged = new Map(current.map((room) => [room.code, room]));
  for (const room of incoming) merged.set(room.code, room);
  return [...merged.values()];
}
