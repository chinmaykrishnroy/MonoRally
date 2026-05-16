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
});
