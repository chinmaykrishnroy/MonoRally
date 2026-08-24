import { describe, expect, test } from "vitest";
import { parseStatePacket } from "../../client/src/network/protocol.js";
import { scoredStatePacket, statePacket } from "../../server/src/serialization.js";

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
      balls: [{ id: 9, x: 500, y: 340, r: 8, vx: 320, vy: -510, curve: 740, bump: 900 }],
      power: { type: "laser", x: 520, y: 320, r: 18 },
      lastHit: { x: 505, y: 120, at: 990, slot: 0, intensity: 0.8 },
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
    expect(parsed.balls[0]).toMatchObject({ id: 9, r: 8, vx: 320, vy: -510, curve: 740, bump: false });
    expect(parsed.balls[0].x).toBeCloseTo(500, 1);
    expect(parsed.balls[0].y).toBeCloseTo(340, 1);
    expect(parsed.power).toMatchObject({ type: "laser", r: 18 });
    expect(parsed.power.x).toBeCloseTo(520, 1);
    expect(parsed.power.y).toBeCloseTo(320, 1);
    expect(parsed.lastHit).toMatchObject({ slot: 0 });
    expect(parsed.lastHit.x).toBeCloseTo(505, 1);
    expect(parsed.lastHit.y).toBeCloseTo(120, 1);
    expect(parsed.lastHit.intensity).toBeCloseTo(0.8, 1);
    expect(parsed.lastPower).toMatchObject({ type: "laser", team: "bottom", player: "bottom" });
    expect(parsed.countdown).toBe(2);
    expect(parsed.spectators).toBe(2);
  });

  test("protocol four carries the scorer total only with a hit event", () => {
    const room = {
      mode: "1v1",
      status: "running",
      startedAt: 500,
      missLimit: 5,
      misses: { top: 0, bottom: 1 },
      winner: null,
      players: [
        { clientId: "a", name: "alpha", team: "bottom", slot: 0, x: 500, w: 140, returns: 17 }
      ],
      balls: [],
      power: null,
      lastHit: { x: 500, y: 650, at: 990, slot: 0, intensity: 0.7, score: 17 },
      spectators: []
    };
    const packet = scoredStatePacket(room, 1000, mechanics);
    const parsed = parseStatePacket(packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength), () => "alpha");

    expect(parsed.protocol).toBe(4);
    expect(parsed.players[0]).toMatchObject({ name: "alpha", score: 0 });
    expect(parsed.lastHit).toMatchObject({ slot: 0, score: 17 });
  });
});
