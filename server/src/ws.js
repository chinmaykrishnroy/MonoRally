import { WEBSOCKET_MAX_MESSAGE_BYTES } from "./config.js";

export function handleFrames(client, chunk, { onBinary, onMessage, onError }) {
  client.lastSeen = performance.now();
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const fin = (first & 0x80) === 0x80;
    const reserved = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const high = client.buffer.readUInt32BE(2);
      const low = client.buffer.readUInt32BE(6);
      length = high * 2 ** 32 + low;
      offset = 10;
    }
    if (length > WEBSOCKET_MAX_MESSAGE_BYTES) {
      onError(client, "Message too large");
      closeClient(client, 1009, "message too large");
      return;
    }
    if (!masked) {
      closeClient(client, 1002, "unmasked client frame");
      return;
    }
    if (client.buffer.length < offset + 4 + length) return;
    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = client.buffer.subarray(offset, offset + length);
    client.buffer = client.buffer.subarray(offset + length);

    const data = Buffer.alloc(length);
    for (let i = 0; i < length; i += 1) data[i] = payload[i] ^ mask[i % 4];

    if (reserved) {
      closeClient(client, 1002, "unsupported extension bits");
      return;
    }

    if (opcode === 8) {
      client.closeCode = data.length >= 2 ? data.readUInt16BE(0) : 1000;
      client.closeReason = data.length > 2 ? data.subarray(2).toString("utf8").slice(0, 80) : "";
      writeFrame(client.socket, data, 8);
      client.socket.end();
      return;
    }
    if (opcode === 9) {
      if (!fin || length > 125) return closeClient(client, 1002, "invalid control frame");
      writeFrame(client.socket, data, 10);
      continue;
    }
    if (opcode === 10) {
      if (!fin || length > 125) return closeClient(client, 1002, "invalid control frame");
      client.lastPong = performance.now();
      continue;
    }

    if (opcode === 0) {
      if (!client.fragmentOpcode) return closeClient(client, 1002, "unexpected continuation");
      client.fragments.push(data);
      client.fragmentBytes += data.length;
      if (client.fragmentBytes > WEBSOCKET_MAX_MESSAGE_BYTES) return closeClient(client, 1009, "message too large");
      if (!fin) continue;
      const complete = Buffer.concat(client.fragments, client.fragmentBytes);
      const completeOpcode = client.fragmentOpcode;
      clearFragments(client);
      dispatchMessage(client, completeOpcode, complete, { onBinary, onError, onMessage });
      continue;
    }
    if (opcode !== 1 && opcode !== 2) {
      closeClient(client, 1003, "unsupported frame");
      return;
    }
    if (client.fragmentOpcode) return closeClient(client, 1002, "interleaved data frame");
    if (!fin) {
      client.fragmentOpcode = opcode;
      client.fragments = [data];
      client.fragmentBytes = data.length;
      continue;
    }
    dispatchMessage(client, opcode, data, { onBinary, onError, onMessage });
  }
}

function dispatchMessage(client, opcode, data, { onBinary, onMessage, onError }) {
  if (opcode === 2) {
    onBinary(client, data);
    return;
  }
  let message;
  try {
    message = JSON.parse(data.toString("utf8"));
  } catch {
    onError(client, "Bad message");
    return;
  }
  try {
    onMessage(client, message);
  } catch (error) {
    const errorId = `SERVER-${Date.now().toString(36).toUpperCase()}`;
    console.error(`[${errorId}]`, error);
    onError(client, "The server encountered an unexpected error", { errorId, fatal: true });
  }
}

function clearFragments(client) {
  client.fragmentOpcode = 0;
  client.fragments = [];
  client.fragmentBytes = 0;
}

export function closeClient(client, code = 1000, reason = "") {
  if (!client?.socket || client.socket.destroyed) return;
  const text = Buffer.from(String(reason).slice(0, 80));
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  writeFrame(client.socket, payload, 8);
  client.socket.end();
}

export function writeFrame(socket, payload, opcode = 1) {
  if (socket.destroyed) return;
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  socket.write(Buffer.concat([header, payload]));
}

export function send(client, message) {
  writeFrame(client.socket, Buffer.from(JSON.stringify(message)));
}

export function sendBinary(client, payload) {
  writeFrame(client.socket, payload, 2);
}

export function sendPing(client) {
  writeFrame(client.socket, Buffer.alloc(0), 9);
}

export function broadcast(clientsToSend, message) {
  const payload = Buffer.from(JSON.stringify(message));
  for (const client of clientsToSend) writeFrame(client.socket, payload);
}

export function broadcastBinary(clientsToSend, payload) {
  for (const client of clientsToSend) sendBinary(client, payload);
}
