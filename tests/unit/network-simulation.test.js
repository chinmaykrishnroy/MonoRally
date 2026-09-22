import { describe, expect, test } from "vitest";
import { H, W, PADDLE_MAX_SPEED, PADDLE_ACCELERATION, BALL_BASE_SPEED, BALL_MAX_SPEED_MULTIPLIER } from "../../server/src/config.js";
import { advanceBalls, makeBall } from "../../server/src/physics.js";
import { recordInputSample } from "../../server/src/input-timeline.js";
import { configureNetworkTelemetryForTests } from "../../server/src/network-telemetry.js";

function playerFixture(team, slot, overrides = {}) {
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
    code: "NETSIM",
    mode: "1v1",
    status: "running",
    missLimit: 5,
    misses: { top: 0, bottom: 0 },
    returns: { top: 0, bottom: 0 },
    players: [playerFixture("bottom", 0), playerFixture("top", 1)],
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

describe("network impairment & collision fairness simulation", () => {
  test("20 ms RTT / ~0 jitter: clean immediate strike without pending miss delay", () => {
    // 20 ms RTT => ~10 ms one-way delay
    const bottom = playerFixture("bottom", 0, {
      x: 500,
      targetX: 500,
      inputDelayMs: 10,
      inputJitterMs: 0.5,
      clockTrusted: true,
      inputHistory: [{ x: 500, rawX: 500, eventAt: 990, receivedAt: 1000, sequence: 10, vx: 0 }]
    });
    const ball = { ...makeBall(1), x: 500, y: H - 50, vx: 0, vy: 450, speed: 450, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.misses.bottom).toBe(0);
  });

  test("80 ms RTT / 10-20 ms jitter: late input rescues ball during pending miss", () => {
    // 80 ms RTT => ~40 ms baseline delay + 15 ms jitter = 55 ms delivery delay
    const bottom = playerFixture("bottom", 0, {
      x: 200,
      targetX: 200,
      inputDelayMs: 40,
      inputJitterMs: 15,
      clockTrusted: true
    });
    // y starts at 655; with vy=1200, in 1 frame (1/60s) moves to 675, crossing exitY=667
    const ball = { ...makeBall(1), x: 500, y: 655, vx: 0, vy: 1200, speed: 1200, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    // Frame 1 at t=1000: ball exits paddle plane. Player is at x=200 on server. Ball queues pending miss.
    advanceBalls(room, 1000, 1 / 60);
    expect(room.balls[0].pendingMiss).toBeTruthy();
    expect(room.misses.bottom).toBe(0);

    // Frame 2: delayed input arrives that was generated at eventAt=995 with targetX=500
    bottom.inputHistory.push({ x: 500, rawX: 500, eventAt: 995, receivedAt: 1045, sequence: 15, vx: 0 });
    // Advance to after resolveAt window (at least ~80ms)
    advanceBalls(room, 1120, 1 / 60);

    // Pending miss is adjudicated as a successful hit!
    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
  });

  test("150 ms RTT / 30-50 ms jitter: high latency late-input rescue with telemetry", () => {
    const telemetryEvents = [];
    configureNetworkTelemetryForTests(true, (line) => telemetryEvents.push(JSON.parse(line)));

    const bottom = playerFixture("bottom", 0, {
      x: 150,
      targetX: 150,
      inputDelayMs: 75,
      inputJitterMs: 40,
      clockTrusted: true
    });
    const ball = { ...makeBall(1), x: 450, y: 655, vx: 0, vy: 1200, speed: 1200, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    // Crossing tick
    advanceBalls(room, 1000, 1 / 60);
    expect(room.balls[0].pendingMiss).toBeTruthy();

    // Input arrives 80ms later (eventAt=992, receivedAt=1072)
    bottom.inputHistory.push({ x: 450, rawX: 450, eventAt: 992, receivedAt: 1072, sequence: 22, vx: 0 });

    // Advance to after resolveAt (inputDelay 75 + jitter 40*2 + 16 = ~171 ms -> t=1200)
    advanceBalls(room, 1200, 1 / 60);

    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);

    // Verify structured telemetry was emitted
    const adjudicated = telemetryEvents.find((e) => e.event === "collision.adjudicated");
    expect(adjudicated).toBeDefined();
    expect(adjudicated.outcome).toBe("hit");
    expect(adjudicated.lateInput).toBe(true);
    expect(adjudicated.resolvedSlot).toBe(0);

    configureNetworkTelemetryForTests(false);
  });

  test("250 ms RTT / 50-80 ms jitter: validates late-input grace window boundary", () => {
    // 250 ms RTT => ~125 ms delay + 60 ms jitter
    const bottom = playerFixture("bottom", 0, {
      x: 100,
      targetX: 100,
      inputDelayMs: 125,
      inputJitterMs: 60,
      clockTrusted: true
    });
    const ball = { ...makeBall(1), x: 500, y: 655, vx: 0, vy: 1200, speed: 1200, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);
    expect(room.balls[0].pendingMiss).toBeTruthy();

    // Input arrived at t=1160, event happened at t=990 (before crossing)
    bottom.inputHistory.push({ x: 500, rawX: 500, eventAt: 990, receivedAt: 1160, sequence: 30, vx: 0 });
    // Advance to after clamped grace window (LATE_INPUT_GRACE_MS = 220ms -> t=1240)
    advanceBalls(room, 1240, 1 / 60);

    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
  });

  test("packet loss simulation: lost intermediate packet doesn't prevent hit on subsequent packet", () => {
    const bottom = playerFixture("bottom", 0, {
      x: 200,
      targetX: 200,
      inputDelayMs: 30,
      inputJitterMs: 5,
      clockTrusted: true
    });
    const ball = { ...makeBall(1), x: 520, y: 655, vx: 0, vy: 1200, speed: 1200, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);
    expect(room.balls[0].pendingMiss).toBeTruthy();

    // Packet sequence 10 was lost in transit.
    // Packet sequence 11 arrives containing event position that was valid at eventAt=995:
    bottom.inputHistory.push({ x: 520, rawX: 520, eventAt: 995, receivedAt: 1030, sequence: 11, vx: 0 });
    advanceBalls(room, 1120, 1 / 60);

    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
  });

  test("bursty delay & packet reordering: historical out-of-order packet rescues collision", () => {
    const bottom = playerFixture("bottom", 0, {
      x: 200,
      targetX: 200,
      inputDelayMs: 40,
      inputJitterMs: 25,
      clockTrusted: true,
      lastInputSequence: 20
    });
    const ball = { ...makeBall(1), x: 480, y: 655, vx: 0, vy: 1200, speed: 1200, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);
    expect(room.balls[0].pendingMiss).toBeTruthy();

    // Sequence 19 was reordered and arrived AFTER sequence 20:
    // Event time t=995 was valid at collision crossing (t=998)
    recordInputSample(
      bottom,
      { x: 480, rawX: 480, eventAt: 995, receivedAt: 1040, sequence: 19, vx: 0 },
      { acceleration: PADDLE_ACCELERATION, historyMs: 500, maxSpeed: PADDLE_MAX_SPEED, now: 1040 }
    );
    advanceBalls(room, 1150, 1 / 60);

    expect(room.balls[0].pendingMiss).toBeNull();
    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
  });

  test("maximum ball speed collision: swept collision prevents tunneling at 1125 px/s", () => {
    const maxSpeed = BALL_BASE_SPEED * BALL_MAX_SPEED_MULTIPLIER; // 1125 px/s
    const bottom = playerFixture("bottom", 0, {
      bot: true,
      clientId: null,
      x: 500,
      prevX: 500
    });
    // Ball starts before paddle plane and travels more than the paddle thickness in one 60Hz tick (~18.75 px/tick)
    const ball = { ...makeBall(1), x: 500, y: H - 55, vx: 0, vy: maxSpeed, speed: maxSpeed, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.balls[0].y).toBeLessThanOrEqual(H - 28);
    expect(room.misses.bottom).toBe(0);
  });

  test("corner collision: rounded cap hit calculation detects corner strike accurately", () => {
    // Paddle width is 140 -> half width is 70. Center is at 500. Corner cap starts around |relativeX| = 70 - 9 + 6 = 67.
    const bottom = playerFixture("bottom", 0, { bot: true, clientId: null, x: 500, prevX: 500 });
    // Ball aimed at edge (x=565)
    const ball = { ...makeBall(1), x: 565, y: H - 45, vx: 0, vy: 500, speed: 500, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
    // Offset causes deflection velocity
    expect(room.balls[0].vx).toBeGreaterThan(0);
  });

  test("paddle entering trajectory immediately before impact: swept collision detects moving contact", () => {
    // Paddle starts at x=350 and sweeps rapidly to x=500 during the frame
    const bottom = playerFixture("bottom", 0, {
      bot: true,
      clientId: null,
      prevX: 350,
      x: 500,
      vx: 3000
    });
    const ball = { ...makeBall(1), x: 480, y: H - 50, vx: 0, vy: 600, speed: 600, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
    expect(room.balls[0].vx).toBeGreaterThan(0); // Paddle velocity transfer
  });

  test("multiball simultaneous approaches: both balls checked and bounced independently", () => {
    const bottom = playerFixture("bottom", 0, { bot: true, clientId: null, x: 500, prevX: 500 });
    // Two balls approaching near the same paddle simultaneously
    const ball1 = { ...makeBall(1), id: 1, x: 480, y: H - 45, vx: 0, vy: 500, speed: 500, curve: 0 };
    const ball2 = { ...makeBall(1), id: 2, x: 520, y: H - 45, vx: 0, vy: 500, speed: 500, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball1, ball2] });

    advanceBalls(room, 1000, 1 / 60);

    expect(room.balls[0].vy).toBeLessThan(0);
    expect(room.balls[1].vy).toBeLessThan(0);
    expect(room.misses.bottom).toBe(0);
  });

  test("anti-cheat bounds: physically impossible teleport is rejected as miss", () => {
    const bottom = playerFixture("bottom", 0, {
      x: 100,
      targetX: 100,
      inputDelayMs: 40,
      inputJitterMs: 10,
      clockTrusted: true
    });
    // Ball crosses at x=900, y starts at 655 with vy=1200 to cross exitY=667 on frame 1
    const ball = { ...makeBall(1), x: 900, y: 655, vx: 0, vy: 1200, speed: 1200, curve: 0 };
    const room = roomFixture({ players: [bottom, playerFixture("top", 1)], balls: [ball] });

    advanceBalls(room, 1000, 1 / 60);
    expect(room.balls[0].pendingMiss).toBeTruthy();

    // Client claims paddle was at x=900 just 10ms after being at x=100 (requires 80,000 px/s, exceeding maxSpeed 4200)
    recordInputSample(
      bottom,
      { x: 900, rawX: 900, eventAt: 995, receivedAt: 1030, sequence: 5, vx: 0 },
      { acceleration: PADDLE_ACCELERATION, historyMs: 500, maxSpeed: PADDLE_MAX_SPEED, now: 1030 }
    );

    // Resolve after grace window
    advanceBalls(room, 1250, 1 / 60);

    // Since the player physically could not reach x=900 in 10ms, miss is enforced!
    expect(room.misses.bottom).toBe(1);
    expect(room.balls).toHaveLength(0);
  });
});
