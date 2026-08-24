import { describe, expect, test } from "vitest";
import { H, W } from "../../server/src/config.js";
import { advanceBalls, beginCountdown, checkWin, launchServe, makeBall, updateBotTargets } from "../../server/src/physics.js";

function player(team, slot, overrides = {}) {
  const x = overrides.x ?? W / 2;
  return {
    id: `${team}-${slot}`,
    clientId: `${team}-${slot}`,
    name: `${team}-${slot}`,
    team,
    slot,
    x,
    prevX: x,
    vx: 0,
    targetX: x,
    inputHistory: [{ x, rawX: x, eventAt: 900, receivedAt: 900, sequence: 0, vx: 0 }],
    laserActiveUntil: 0,
    laserFadeUntil: 0,
    empActiveUntil: 0,
    empFadeUntil: 0,
    ...overrides
  };
}

function roomFixture(overrides = {}) {
  return {
    mode: "1v1",
    status: "running",
    missLimit: 5,
    misses: { top: 0, bottom: 0 },
    returns: { top: 0, bottom: 0 },
    players: [player("bottom", 0), player("top", 1)],
    balls: [],
    power: null,
    pendingCountdown: false,
    countdownUntil: 0,
    lastMissTeam: null,
    nextPowerAt: Infinity,
    startedAt: 0,
    nextBallId: 1,
    ...overrides
  };
}

function crossingBall(x = W / 2) {
  return { ...makeBall(1), x, y: H - 50, vx: 0, vy: 450, speed: 450, curve: 0 };
}

describe("server physics", () => {
  test("reflects a ball at the physical paddle crossing plane", () => {
    const bottom = player("bottom", 0, { bot: true, clientId: null });
    const room = roomFixture({ players: [bottom, player("top", 1)], balls: [crossingBall()] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.lastHit).toMatchObject({ x: W / 2, slot: 0 });
  });

  test("does not let an unprocessed target act as an invisible paddle", () => {
    const bottom = player("bottom", 0, { x: 120, targetX: 900 });
    const room = roomFixture({ players: [bottom, player("top", 1)], balls: [crossingBall(900)] });

    advanceBalls(room, 1000, 1 / 60);
    advanceBalls(room, 1250, 1 / 60);

    expect(room.misses.bottom).toBe(1);
    expect(room.lastHit).toBeUndefined();
  });

  test("finalizes a miss after its adaptive late-input window", () => {
    const room = roomFixture({ balls: [{ ...makeBall(1), x: 900, y: H + 20, vy: 450 }] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.misses.bottom).toBe(0);
    expect(room.balls[0].pendingMiss).toMatchObject({ team: "bottom" });

    advanceBalls(room, 1250, 1 / 60);

    expect(room.misses.bottom).toBe(1);
    expect(room.balls).toHaveLength(0);
    expect(room.pendingCountdown).toBe(true);
  });

  test("accepts a delayed input only when it happened before the crossing", () => {
    const bottom = player("bottom", 0, { x: 180, targetX: 180, inputDelayMs: 90, inputJitterMs: 10 });
    const room = roomFixture({ players: [bottom, player("top", 1)], balls: [crossingBall(760)] });

    advanceBalls(room, 1000, 1 / 60);
    bottom.inputHistory.push({ x: 760, rawX: 760, eventAt: 990, receivedAt: 1040, sequence: 7, vx: 0 });
    advanceBalls(room, 1140, 1 / 60);

    expect(room.misses.bottom).toBe(0);
    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.balls[0].vy).toBeLessThan(0);
  });

  test("rejects a move that happened after the ball crossed", () => {
    const bottom = player("bottom", 0, { x: 180, targetX: 180, inputDelayMs: 90, inputJitterMs: 10 });
    const room = roomFixture({ players: [bottom, player("top", 1)], balls: [crossingBall(760)] });

    advanceBalls(room, 1000, 1 / 60);
    bottom.inputHistory.push({ x: 760, rawX: 760, eventAt: 1005, receivedAt: 1040, sequence: 7, vx: 0 });
    advanceBalls(room, 1140, 1 / 60);

    expect(room.misses.bottom).toBe(1);
    expect(room.balls).toHaveLength(0);
  });

  test("moving paddle transfers momentum and spin to the ball", () => {
    const bottom = player("bottom", 0, { bot: true, clientId: null, prevX: 470, x: 500, vx: 1800 });
    const room = roomFixture({ players: [bottom, player("top", 1)], balls: [crossingBall(500)] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vx).toBeGreaterThan(0);
    expect(room.balls[0].curve).toBeGreaterThan(0);
  });

  test("catches a steep trajectory that enters through the rounded paddle edge", () => {
    const bottom = player("bottom", 0, { bot: true, clientId: null, x: 500, prevX: 500 });
    const ball = { ...makeBall(1), x: 610, y: 620, vx: -3000, vy: 2400, speed: Math.hypot(3000, 2400), curve: 0 };
    const room = roomFixture({ players: [bottom, player("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
    expect(room.lastHit).toMatchObject({ slot: 0 });
  });

  test("starts scoring only after both sides establish the rally", () => {
    const bottom = player("bottom", 0, { bot: true, clientId: null });
    const top = player("top", 1, { bot: true, clientId: null });
    const room = roomFixture({ players: [bottom, top], balls: [crossingBall()] });

    advanceBalls(room, 1000, 1 / 60);
    expect(bottom.returns).toBe(0);

    room.balls = [{ ...makeBall(-1), touchMask: 2, x: W / 2, y: 50, vx: 0, vy: -450, speed: 450 }];
    advanceBalls(room, 1020, 1 / 60);
    expect(top.returns).toBe(0);

    room.balls = [{ ...crossingBall(), touchMask: 3 }];
    advanceBalls(room, 1040, 1 / 60);
    expect(bottom.returns).toBe(1);
    expect(room.lastHit).toMatchObject({ slot: 0, score: 1 });
  });

  test("restores the two-ball baseline while a 2v2 rally continues", () => {
    const room = roomFixture({ mode: "2v2", nextBallId: 2, balls: [{ ...makeBall(-1), id: 1, y: H / 2 }] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls).toHaveLength(2);
    expect(new Set(room.balls.map((ball) => ball.id)).size).toBe(2);
  });

  test("assigns two same-team AI paddles to different balls", () => {
    const left = player("top", 2, { bot: true, clientId: null, aiPhase: 0, x: 250, targetX: 250 });
    const right = player("top", 3, { bot: true, clientId: null, aiPhase: 0, x: 750, targetX: 750 });
    const room = roomFixture({
      mode: "2v2",
      quickAiDifficulty: "insane",
      players: [left, right],
      balls: [
        { ...makeBall(-1), id: 1, x: 180, y: 300, vx: 0, vy: -450 },
        { ...makeBall(-1), id: 2, x: 820, y: 320, vx: 0, vy: -450 }
      ]
    });

    updateBotTargets(room, 1000, 1);

    expect(left.targetX).toBeLessThan(400);
    expect(right.targetX).toBeGreaterThan(600);
  });

  test("a lone AI switches to whichever ball is most urgent", () => {
    const bot = player("top", 2, { bot: true, clientId: null, aiPhase: 0, x: 500, targetX: 500 });
    const room = roomFixture({
      mode: "2v2",
      quickAiDifficulty: "insane",
      players: [bot],
      balls: [
        { ...makeBall(-1), id: 1, x: 180, y: 90, vx: 0, vy: -450 },
        { ...makeBall(-1), id: 2, x: 820, y: 560, vx: 0, vy: -450 }
      ]
    });

    updateBotTargets(room, 1000, 1);
    expect(bot.targetX).toBeLessThan(300);

    bot.targetX = 500;
    room.balls[0].vy = 450;
    room.balls[1].y = 90;
    updateBotTargets(room, 1100, 1);
    expect(bot.targetX).toBeGreaterThan(700);
  });

  test("serves two balls in a 2v2 countdown launch", () => {
    const room = roomFixture({ mode: "2v2" });

    beginCountdown(room, 1000, "both");
    launchServe(room, 1000);

    expect(room.balls).toHaveLength(2);
    expect(room.balls.some((ball) => ball.vy > 0)).toBe(true);
    expect(room.balls.some((ball) => ball.vy < 0)).toBe(true);
  });

  test("freezes gameplay state when the match ends", () => {
    const room = roomFixture({ misses: { top: 5, bottom: 2 }, balls: [makeBall(1)], power: { type: "emp" }, pendingCountdown: true });

    checkWin(room, 1200);

    expect(room.status).toBe("ended");
    expect(room.winner).toBe("bottom");
    expect(room.balls).toEqual([]);
    expect(room.power).toBeNull();
    expect(room.pendingCountdown).toBe(false);
  });
});
