import { describe, expect, test } from "vitest";
import { H, W } from "../../server/src/config.js";
import { advanceBalls, beginCountdown, launchServe, makeBall } from "../../server/src/physics.js";

function roomFixture(overrides = {}) {
  return {
    mode: "1v1",
    missLimit: 5,
    misses: { top: 0, bottom: 0 },
    players: [
      { id: "bottom", clientId: "bottom", name: "bottom", team: "bottom", slot: 0, x: W / 2, targetX: W / 2, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 },
      { id: "top", clientId: "top", name: "top", team: "top", slot: 1, x: W / 2, targetX: W / 2, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 }
    ],
    balls: [],
    power: null,
    pendingCountdown: false,
    lastMissTeam: null,
    nextPowerAt: 0,
    startedAt: 0,
    ...overrides
  };
}

describe("server physics", () => {
  test("reflects a ball off the bottom paddle", () => {
    const room = roomFixture({
      startedAt: 0,
      balls: [{ ...makeBall(1), x: W / 2, y: H - 42, prevX: W / 2, prevY: H - 62, vx: 0, vy: 450, speed: 450 }]
    });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.lastHit).toMatchObject({ x: W / 2 });
  });

  test("honors a recent player target when the visible paddle reaches the ball", () => {
    const room = roomFixture({
      players: [
        { id: "bottom", clientId: "bottom", name: "bottom", team: "bottom", slot: 0, x: 520, targetX: 640, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 },
        { id: "top", clientId: "top", name: "top", team: "top", slot: 1, x: W / 2, targetX: W / 2, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 }
      ],
      balls: [{ ...makeBall(1), x: 640, y: H - 36, vx: 0, vy: 450, speed: 450 }]
    });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
    expect(room.lastHit.x).toBeCloseTo(640, 0);
  });

  test("does not allow a target position to catch across the full court instantly", () => {
    const room = roomFixture({
      players: [
        { id: "bottom", clientId: "bottom", name: "bottom", team: "bottom", slot: 0, x: 120, targetX: 900, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 },
        { id: "top", clientId: "top", name: "top", team: "top", slot: 1, x: W / 2, targetX: W / 2, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 }
      ],
      balls: [{ ...makeBall(1), x: 900, y: H - 36, vx: 0, vy: 450, speed: 450 }]
    });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeGreaterThan(0);
    expect(room.lastHit).toBeUndefined();
  });

  test("marks a miss and waits for all active balls before countdown", () => {
    const room = roomFixture({
      balls: [{ ...makeBall(1), y: H + 20, vy: 450 }]
    });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.misses.bottom).toBe(1);
    expect(room.balls).toHaveLength(0);
    expect(room.pendingCountdown).toBe(true);
    expect(room.lastMissTeam).toBe("bottom");
  });

  test("serves two balls in 2v2 countdown launch", () => {
    const room = roomFixture({ mode: "2v2" });

    beginCountdown(room, 1000, "both");
    launchServe(room, 1000);

    expect(room.balls).toHaveLength(2);
    expect(room.balls.some((ball) => ball.vy > 0)).toBe(true);
    expect(room.balls.some((ball) => ball.vy < 0)).toBe(true);
  });
});
