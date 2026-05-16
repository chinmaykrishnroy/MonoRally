export function createNetwork({ handleServer, helloMessage, nameForSlot, onClose, onConnecting, onOpen, onProtocolError, parseBinaryStatePacket, state }) {
  function connect() {
    if (state.connecting || state.ws?.readyState === WebSocket.OPEN || state.ws?.readyState === WebSocket.CONNECTING) return;
    state.connecting = true;
    onConnecting?.();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    state.ws = new WebSocket(`${proto}://${location.host}`);
    state.ws.binaryType = "arraybuffer";
    state.ws.addEventListener("open", () => {
      state.connecting = false;
      send(helloMessage());
      send({ t: "rooms" });
      onOpen?.();
      flushPending();
    });
    state.ws.addEventListener("message", (event) => {
      handleSocketMessage(event).catch(onProtocolError);
    });
    state.ws.addEventListener("close", () => {
      state.connecting = false;
      onClose?.();
      setTimeout(connect, 900);
    });
    state.ws.addEventListener("error", () => {
      state.connecting = false;
    });
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
    if (!state.ws || state.ws.readyState > 1) connect();
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
