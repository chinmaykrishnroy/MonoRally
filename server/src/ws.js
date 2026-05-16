import { WEBSOCKET_MAX_MESSAGE_BYTES } from "./config.js";

export function handleFrames(client, chunk, { onBinary, onMessage, onError }) {
  client.lastSeen = performance.now();
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
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

    if (opcode === 8) {
      client.socket.end();
      return;
    }
    if (opcode === 9) {
      writeFrame(client.socket, data, 10);
      continue;
    }
    if (opcode === 10) {
      client.lastPong = performance.now();
      continue;
    }
    if (opcode === 2) {
      onBinary(client, data);
      continue;
    }
    if (opcode !== 1) {
      closeClient(client, 1003, "unsupported frame");
      return;
    }

    try {
      onMessage(client, JSON.parse(data.toString("utf8")));
    } catch {
      onError(client, "Bad message");
    }
  }
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
