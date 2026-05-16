import { describe, expect, test } from "vitest";
import { parseStatePacket } from "../../client/src/network/protocol.js";
import { statePacket } from "../../server/src/serialization.js";

const mechanics = {
  countdownValue: () => 2,
  empStrength: (player) => (player.emp ? 1 : 0),
  laserStrength: (player) => (player.laser ? 1 : 0),
  paddleWidth: (player) => player.w
};

describe("state packet protocol", () => {
  test("round-trips compact binary room state", () => {
    const room = {
      mode: "2v2",
      status: "running",
      startedAt: 500,
      missLimit: 8,
      misses: { top: 2, bottom: 3 },
      winner: null,
      players: [
        { clientId: "a", id: "a", name: "alpha", team: "bottom", slot: 0, x: 410, w: 140, laser: true },
        { clientId: "b", id: "b", name: "beta", team: "top", slot: 2, x: 590, w: 120, emp: true }
      ],
      balls: [{ x: 500, y: 340, r: 8, bump: 900 }],
      power: { type: "laser", x: 520, y: 320, r: 18 },
      lastHit: { x: 505, y: 120, at: 990 },
      lastPower: { type: "laser", team: "bottom", at: 980 },
      spectators: [{}, {}]
    };

    const packet = statePacket(room, 1000, mechanics);
    const parsed = parseStatePacket(packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength), (slot) => `slot-${slot}`);

    expect(parsed.mode).toBe("2v2");
    expect(parsed.status).toBe("running");
    expect(parsed.elapsed).toBe(0.5);
    expect(parsed.misses).toEqual({ top: 2, bottom: 3 });
    expect(parsed.players).toHaveLength(2);
    expect(parsed.players[0]).toMatchObject({ name: "slot-0", team: "bottom", slot: 0, laser: true });
    expect(parsed.players[1]).toMatchObject({ name: "slot-2", team: "top", slot: 2, emp: true });
    expect(parsed.balls[0]).toMatchObject({ x: 500, y: 340, r: 8, bump: false });
    expect(parsed.power).toMatchObject({ type: "laser", x: 520, y: 320, r: 18 });
    expect(parsed.lastHit).toMatchObject({ x: 505, y: 120, at: 990 });
    expect(parsed.lastPower).toMatchObject({ type: "laser", team: "bottom", player: "bottom", at: 980 });
    expect(parsed.countdown).toBe(2);
    expect(parsed.spectators).toBe(2);
  });
});
