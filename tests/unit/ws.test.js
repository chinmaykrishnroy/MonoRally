import { describe, expect, test, vi } from "vitest";
import { handleFrames } from "../../server/src/ws.js";

function maskedTextFrame(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function maskedFrame(payload, { fin, opcode }) {
  const data = Buffer.from(payload);
  const mask = Buffer.from([5, 6, 7, 8]);
  const header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | data.length]);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

describe("websocket frame parser", () => {
  test("parses a masked json text frame", () => {
    const client = { buffer: Buffer.alloc(0), socket: { destroyed: false, write: vi.fn(), end: vi.fn() } };
    const onMessage = vi.fn();

    handleFrames(client, maskedTextFrame(JSON.stringify({ t: "hello" })), {
      onBinary: vi.fn(),
      onError: vi.fn(),
      onMessage
    });

    expect(onMessage).toHaveBeenCalledWith(client, { t: "hello" });
  });

  test("closes unmasked client frames", () => {
    const client = { buffer: Buffer.alloc(0), socket: { destroyed: false, write: vi.fn(), end: vi.fn() } };

    handleFrames(client, Buffer.from([0x81, 0x02, 0x7b, 0x7d]), {
      onBinary: vi.fn(),
      onError: vi.fn(),
      onMessage: vi.fn()
    });

    expect(client.socket.write).toHaveBeenCalled();
    expect(client.socket.end).toHaveBeenCalled();
  });

  test("reassembles fragmented Safari-style text messages", () => {
    const client = { buffer: Buffer.alloc(0), socket: { destroyed: false, write: vi.fn(), end: vi.fn() } };
    const onMessage = vi.fn();
    const handlers = { onBinary: vi.fn(), onError: vi.fn(), onMessage };

    handleFrames(client, maskedFrame('{"t":"create', { fin: false, opcode: 1 }), handlers);
    handleFrames(client, maskedFrame('Room","mode":"1v1"}', { fin: true, opcode: 0 }), handlers);

    expect(onMessage).toHaveBeenCalledWith(client, { t: "createRoom", mode: "1v1" });
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});
