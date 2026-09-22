export function createNetwork({ handleServer, helloMessage, nameForSlot, onClose, onConnecting, onOpen, onProtocolError, parseBinaryStatePacket, state }) {
  let reconnectTimer = 0;
  let generation = 0;

  function connect() {
    if (state.connecting || state.ws?.readyState === WebSocket.OPEN || state.ws?.readyState === WebSocket.CONNECTING) return;
    clearReconnectTimer();
    state.connecting = true;
    onConnecting?.();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socketGeneration = ++generation;
    let socket;
    try {
      socket = new WebSocket(`${proto}://${location.host}`);
    } catch (error) {
      state.connecting = false;
      onProtocolError?.(error);
      scheduleReconnect(socketGeneration);
      return;
    }
    state.ws = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      if (!isCurrent(socket, socketGeneration)) return;
      clearReconnectTimer();
      state.connecting = false;
      send(helloMessage());
      send({ t: "rooms" });
      onOpen?.();
      flushPending();
    });
    socket.addEventListener("message", (event) => {
      if (!isCurrent(socket, socketGeneration)) return;
      handleSocketMessage(event).catch(onProtocolError);
    });
    socket.addEventListener("close", () => {
      if (!isCurrent(socket, socketGeneration)) return;
      state.connecting = false;
      onClose?.();
      if (state.sessionMoved) return;
      scheduleReconnect(socketGeneration);
    });
    socket.addEventListener("error", () => {
      if (!isCurrent(socket, socketGeneration)) return;
      state.connecting = socket.readyState === WebSocket.CONNECTING;
    });
  }

  function isCurrent(socket, socketGeneration) {
    return state.ws === socket && generation === socketGeneration;
  }

  function scheduleReconnect(socketGeneration) {
    if (state.sessionMoved || reconnectTimer || socketGeneration !== generation) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      connect();
    }, 900);
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }

  async function handleSocketMessage(event) {
    if (typeof event.data === "string") {
      handleServer(JSON.parse(event.data));
      return;
    }
    const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
    handleServer(parseBinaryStatePacket(buffer, nameForSlot));
  }

  function ensureSocket() {
    if (!state.ws || state.ws.readyState > 1) {
      state.sessionMoved = false;
      connect();
    }
  }

  function send(msg) {
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(msg));
      return;
    }
    state.pending.push(msg);
    if (state.pending.length > 20) state.pending.splice(0, state.pending.length - 20);
    ensureSocket();
  }

  function flushPending() {
    const pending = state.pending.splice(0);
    for (const msg of pending) send(msg);
  }

  return { connect, send };
}
