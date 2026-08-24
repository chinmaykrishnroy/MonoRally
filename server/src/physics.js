import {
  BALL_BASE_SPEED,
  BALL_MAX_SPEED_MULTIPLIER,
  BALL_SPIN_DECAY,
  BALL_SPIN_MAX,
  BALL_SPIN_OFFSET,
  BALL_SPIN_TRANSFER,
  GAME_ACCEL_SECONDS,
  H,
  INPUT_SEND_HZ,
  LATE_INPUT_GRACE_MS,
  MAX_BALLS,
  MULTIBALL_TOTAL_1V1,
  MULTIBALL_TOTAL_2V2,
  PADDLE_ACCELERATION,
  PADDLE_MAX_SPEED,
  PADDLE_VELOCITY_TRANSFER,
  POWERUP_EFFECT_MS,
  POWERUP_MAX_MS,
  POWERUP_MIN_MS,
  QUICK_AI_DIFFICULTY,
  W
} from "./config.js";
import { inputSampleAt, projectInputSample } from "./input-timeline.js";
import { clamp, playerKey, rand, reflectX } from "./utils.js";

const PADDLE_HEIGHT = 18;
const PADDLE_EDGE_GRACE = 6;
const MAX_BOUNCE_ANGLE = (68 * Math.PI) / 180;

export function advanceBalls(room, now, dt) {
  const baseSpeed = BALL_BASE_SPEED * speedMultiplier(room, now);
  for (const ball of [...room.balls]) {
    if (ball.pendingMiss) {
      resolvePendingMiss(room, ball, now);
      continue;
    }

    ball.prevX = ball.x;
    ball.prevY = ball.y;
    let desired = baseSpeed;
    desired *= 1 - 0.55 * empSlowStrength(room, ball, now);
    ball.speed += (desired - ball.speed) * Math.min(1, dt * 4.5);

    ball.curve = (Number(ball.curve) || 0) * Math.exp(-BALL_SPIN_DECAY * dt);
    ball.vx += ball.curve * dt;
    const mag = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / mag) * ball.speed;
    ball.vy = (ball.vy / mag) * ball.speed;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < ball.r) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx);
      ball.curve = Math.abs(ball.curve);
      ball.bump = now;
    }
    if (ball.x > W - ball.r) {
      ball.x = W - ball.r;
      ball.vx = -Math.abs(ball.vx);
      ball.curve = -Math.abs(ball.curve);
      ball.bump = now;
    }

    for (const player of room.players) {
      if (!player.disconnected && !player.clientId) collidePaddle(room, player, ball, now, dt);
    }

    const crossing = paddleCrossing(ball, now, dt);
    if (crossing) {
      queuePendingMiss(room, ball, crossing, now);
      continue;
    }
    collidePower(room, ball, now);

    if (ball.y < -ball.r) queuePendingMiss(room, ball, fallbackCrossing(ball, "top", now), now);
    if (ball.y > H + ball.r) queuePendingMiss(room, ball, fallbackCrossing(ball, "bottom", now), now);
  }

  room.balls = room.balls.filter((ball) => !ball.dead).slice(0, MAX_BALLS);
  restoreTwoBallBaseline(room, now);
}

export function updateBotTargets(room, now, dt) {
  const profile = botProfile(room.quickAiDifficulty || QUICK_AI_DIFFICULTY);
  const assignments = assignBotBalls(room);
  const botsByTeam = new Map();
  for (const bot of room.players) {
    if (!bot.bot || bot.disconnected) continue;
    if (!botsByTeam.has(bot.team)) botsByTeam.set(bot.team, []);
    botsByTeam.get(bot.team).push(bot);
  }
  for (const bot of room.players) {
    if (!bot.bot || bot.disconnected) continue;
    const ball = assignments.get(bot.slot);
    const paddleY = bot.team === "top" ? 28 : H - 28;
    const teammates = botsByTeam.get(bot.team).sort((a, b) => a.slot - b.slot);
    const lane = W * ((teammates.indexOf(bot) + 1) / (teammates.length + 1));
    const predictedX = ball ? predictBallXAtY(ball, paddleY) : lane;
    const pressure = room.misses[bot.team] >= room.missLimit - 1 ? profile.clutch : 1;
    const error = profile.error * pressure * Math.sin(now * 0.001 * profile.errorRate + bot.aiPhase);
    bot.targetX += (predictedX + error - bot.targetX) * Math.min(1, dt * profile.reaction);
    if (Math.random() < profile.wobbleChance) bot.targetX += rand(-profile.wobble, profile.wobble);
    bot.targetX = clamp(bot.targetX, paddleWidth(bot, now) / 2 + 4, W - paddleWidth(bot, now) / 2 - 4);
  }
}

function restoreTwoBallBaseline(room, now) {
  if (room.mode !== "2v2" || room.status !== "running" || room.countdownUntil || room.balls.length !== 1) return;
  const team = room.lastMissTeam || (room.balls[0].vy > 0 ? "top" : "bottom");
  room.balls.push(assignBallId(room, makeServeBall(room, team, now)));
}

export function advancePaddles(room, now, dt) {
  for (const player of room.players) {
    if (player.disconnected) continue;
    const width = paddleWidth(player, now);
    const minX = width / 2 + 4;
    const maxX = W - width / 2 - 4;
    const target = clamp(player.targetX, minX, maxX);
    const previousX = clamp(player.x, minX, maxX);
    const desiredVelocity = clamp((target - previousX) * 18, -PADDLE_MAX_SPEED, PADDLE_MAX_SPEED);
    const accelerationStep = PADDLE_ACCELERATION * dt;
    const velocity = moveToward(Number(player.vx) || 0, desiredVelocity, accelerationStep);
    let nextX = clamp(previousX + velocity * dt, minX, maxX);
    if ((target - previousX) * (target - nextX) <= 0) nextX = target;

    player.prevX = previousX;
    player.x = nextX;
    player.vx = dt > 0 ? (nextX - previousX) / dt : 0;
    player.stepStartedAt = now - dt * 1000;
    player.stepEndedAt = now;
  }
}

function botProfile(difficulty) {
  if (difficulty === "easy") return { reaction: 3.2, wobbleChance: 0.035, wobble: 190, error: 135, errorRate: 1.4, clutch: 0.8 };
  if (difficulty === "hard") return { reaction: 10.5, wobbleChance: 0.003, wobble: 22, error: 24, errorRate: 2.2, clutch: 0.25 };
  if (difficulty === "insane") return { reaction: 22, wobbleChance: 0, wobble: 0, error: 2, errorRate: 0.4, clutch: 0 };
  return { reaction: 5.2, wobbleChance: 0.014, wobble: 90, error: 62, errorRate: 1.9, clutch: 0.55 };
}

function assignBotBalls(room) {
  const assignments = new Map();
  const balls = room.balls.filter((ball) => !ball.dead && !ball.pendingMiss);
  for (const team of ["top", "bottom"]) {
    const bots = room.players.filter((player) => player.bot && !player.disconnected && player.team === team).sort((a, b) => a.slot - b.slot);
    if (!bots.length || !balls.length) continue;
    if (bots.length === 1 || balls.length === 1) {
      const bot = bots.reduce((best, candidate) => {
        if (!best) return candidate;
        const ball = balls[0];
        return botBallCost(candidate, ball) < botBallCost(best, ball) ? candidate : best;
      }, null);
      const target = balls.reduce((best, candidate) => (!best || botBallCost(bot, candidate) < botBallCost(bot, best) ? candidate : best), null);
      assignments.set(bot.slot, target);
      continue;
    }

    let best = null;
    for (let first = 0; first < balls.length; first += 1) {
      for (let second = 0; second < balls.length; second += 1) {
        if (first === second) continue;
        const cost = botBallCost(bots[0], balls[first]) + botBallCost(bots[1], balls[second]);
        if (!best || cost < best.cost) best = { cost, first, second };
      }
    }
    assignments.set(bots[0].slot, balls[best.first]);
    assignments.set(bots[1].slot, balls[best.second]);
  }
  return assignments;
}

function botBallCost(bot, ball) {
  const paddleY = bot.team === "top" ? 28 : H - 28;
  const direction = bot.team === "top" ? -1 : 1;
  const toward = Math.sign(ball.vy || direction) === direction;
  const flightTime = toward ? Math.max(0, (paddleY - ball.y) / (ball.vy || direction)) : 2.5 + Math.abs(paddleY - ball.y) / Math.max(1, Math.abs(ball.vy));
  const targetX = predictBallXAtY(ball, paddleY);
  return flightTime + Math.abs(targetX - bot.x) / PADDLE_MAX_SPEED;
}

function predictBallXAtY(ball, targetY) {
  if (!ball || Math.abs(ball.vy) < 0.001) return ball?.x ?? W / 2;
  const time = (targetY - ball.y) / ball.vy;
  if (time <= 0) return ball.x;
  return reflectX(ball.x + ball.vx * time + 0.5 * (ball.curve || 0) * time * time, ball.r);
}

function collidePaddle(room, player, ball, now, dt) {
  const width = paddleWidth(player, now);
  const movingToward = player.team === "top" ? ball.vy < 0 : ball.vy > 0;
  if (!movingToward) return;
  const crossing = sweptPaddleContact(ball, player.team, width, (t) => paddleCenterDuringStep(player, t));
  if (!crossing) return;
  const hitX = crossing.hitX;
  const center = paddleCenterDuringStep(player, crossing.t);

  applyPaddleBounce(room, player, ball, now, hitX, center, Number(player.vx) || 0, paddleContactY(player.team, ball.r));
}

function applyPaddleBounce(room, player, ball, now, hitX, center, paddleVelocity, contactY) {
  const width = paddleWidth(player, now);
  const speed = Math.max(ball.speed || 0, Math.hypot(ball.vx, ball.vy), 1);
  const offset = clamp((hitX - center) / Math.max(1, width / 2), -1, 1);
  const horizontalLimit = speed * Math.sin(MAX_BOUNCE_ANGLE);
  const desiredVx = ball.vx * 0.42 + offset * speed * 0.72 + paddleVelocity * PADDLE_VELOCITY_TRANSFER;
  ball.vx = clamp(desiredVx, -horizontalLimit, horizontalLimit);
  const verticalSpeed = Math.max(speed * 0.36, Math.sqrt(Math.max(0, speed * speed - ball.vx * ball.vx)));
  ball.vy = verticalSpeed * (player.team === "top" ? 1 : -1);
  ball.curve = clamp(paddleVelocity * BALL_SPIN_TRANSFER + offset * BALL_SPIN_OFFSET, -BALL_SPIN_MAX, BALL_SPIN_MAX);
  ball.x = hitX;
  ball.y = contactY;
  ball.speed = Math.hypot(ball.vx, ball.vy);
  const touchBit = player.team === "top" ? 1 : 2;
  const establishedRally = (Number(ball.touchMask) || 0) === 3;
  ball.touchMask = (Number(ball.touchMask) || 0) | touchBit;
  ball.lastTouch = playerKey(player);
  room.returns ??= { top: 0, bottom: 0 };
  player.returns = Math.max(0, Number(player.returns) || 0) + (establishedRally ? 1 : 0);
  room.returns[player.team] += establishedRally ? 1 : 0;
  ball.pendingMiss = null;
  ball.bump = now;
  room.lastHit = {
    x: ball.x,
    y: player.team === "top" ? 28 : H - 28,
    at: now,
    slot: player.slot,
    score: player.returns,
    intensity: clamp(Math.abs(offset) * 0.45 + Math.abs(paddleVelocity) / PADDLE_MAX_SPEED, 0.2, 1)
  };
}

function paddleCenterDuringStep(player, t) {
  const oldX = Number.isFinite(player.prevX) ? player.prevX : player.x;
  return oldX + (player.x - oldX) * clamp(t, 0, 1);
}

function paddleCrossing(ball, now, dt) {
  const team = ball.vy < 0 ? "top" : ball.vy > 0 ? "bottom" : null;
  return team ? crossingForTeam(ball, team, now, dt) : null;
}

function crossingForTeam(ball, team, now, dt) {
  const oldX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
  const oldY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
  const contactY = paddleContactY(team, ball.r);
  const denom = ball.y - oldY;
  if (Math.abs(denom) < 0.001) return null;
  const t = (contactY - oldY) / denom;
  if (t < 0 || t > 1) return null;
  const movingToward = team === "top" ? ball.vy < 0 : ball.vy > 0;
  if (!movingToward) return null;
  return {
    team,
    t,
    hitX: clamp(oldX + (ball.x - oldX) * t, ball.r, W - ball.r),
    contactY,
    crossedAt: now - Math.max(0, dt * 1000 * (1 - t)),
    oldX,
    oldY,
    newX: ball.x,
    newY: ball.y
  };
}

function sweptPaddleContact(ball, team, width, centerAt) {
  const oldX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
  const oldY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
  const paddleY = team === "top" ? 28 : H - 28;
  const capRadius = PADDLE_HEIGHT / 2 + ball.r + PADDLE_EDGE_GRACE;
  const straightHalf = Math.max(0, width / 2 - PADDLE_HEIGHT / 2);
  const intersects = (t) => {
    const relativeX = oldX + (ball.x - oldX) * t - centerAt(t);
    const relativeY = oldY + (ball.y - oldY) * t - paddleY;
    const edgeX = Math.max(0, Math.abs(relativeX) - straightHalf);
    return edgeX * edgeX + relativeY * relativeY <= capRadius * capRadius;
  };
  let previousT = 0;
  if (intersects(previousT)) return { t: 0, hitX: oldX };
  for (let step = 1; step <= 16; step += 1) {
    const t = step / 16;
    if (!intersects(t)) {
      previousT = t;
      continue;
    }
    let low = previousT;
    let high = t;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const mid = (low + high) / 2;
      if (intersects(mid)) high = mid;
      else low = mid;
    }
    return { t: high, hitX: clamp(oldX + (ball.x - oldX) * high, ball.r, W - ball.r) };
  }
  return null;
}

function paddleContactY(team, radius) {
  const y = team === "top" ? 28 : H - 28;
  return y + (team === "top" ? PADDLE_HEIGHT / 2 + radius + 1 : -PADDLE_HEIGHT / 2 - radius - 1);
}

function fallbackCrossing(ball, team, now) {
  return {
    team,
    t: 1,
    hitX: clamp(ball.x, ball.r, W - ball.r),
    contactY: paddleContactY(team, ball.r),
    crossedAt: now
  };
}

function queuePendingMiss(room, ball, crossing, now) {
  if (ball.pendingMiss || ball.dead) return;
  ball.x = crossing.hitX;
  ball.y = crossing.contactY;
  ball.pendingMiss = {
    team: crossing.team,
    hitX: crossing.hitX,
    contactY: crossing.contactY,
    crossedAt: crossing.crossedAt,
    resolveAt: Math.max(now, crossing.crossedAt + inputDecisionDelay(room, crossing.team)),
    oldX: crossing.oldX,
    oldY: crossing.oldY,
    newX: crossing.newX,
    newY: crossing.newY
  };
}

function inputDecisionDelay(room, team) {
  const players = room.players.filter((player) => player.team === team && player.clientId && !player.disconnected);
  if (!players.length) return 0;
  const inputInterval = 1000 / INPUT_SEND_HZ;
  const estimate = players.reduce((longest, player) => {
    const delay = Number.isFinite(player.inputDelayMs) ? player.inputDelayMs : 24;
    const jitter = Number.isFinite(player.inputJitterMs) ? player.inputJitterMs : 8;
    return Math.max(longest, delay + jitter * 2 + inputInterval);
  }, 0);
  return clamp(estimate, 36, LATE_INPUT_GRACE_MS);
}

function resolvePendingMiss(room, ball, now) {
  const pending = ball.pendingMiss;
  if (now < pending.resolveAt) return;
  const players = room.players.filter((player) => player.team === pending.team && player.clientId && !player.disconnected);
  const catches = [];
  for (const player of players) {
    const width = paddleWidth(player, pending.crossedAt);
    const claim = inputSampleAt(player, pending.crossedAt);
    if (!claim) continue;
    if (pending.crossedAt - claim.eventAt > Math.max(100, LATE_INPUT_GRACE_MS)) continue;
    const projected = projectInputSample(claim, pending.crossedAt, PADDLE_MAX_SPEED, PADDLE_ACCELERATION);
    const center = clamp(projected.x, width / 2 + 4, W - width / 2 - 4);
    const sweepBall = {
      ...ball,
      prevX: pending.oldX ?? pending.hitX,
      prevY: pending.oldY ?? pending.contactY,
      x: pending.newX ?? pending.hitX,
      y: pending.newY ?? pending.contactY
    };
    const contact = sweptPaddleContact(sweepBall, pending.team, width, () => center);
    if (!contact) continue;

    catches.push({ center, contact, distance: Math.abs(contact.hitX - center), player, vx: projected.vx || 0 });
  }
  if (catches.length) {
    const caught = catches.sort((a, b) => a.distance - b.distance)[0];
    applyPaddleBounce(room, caught.player, ball, now, caught.contact.hitX, caught.center, caught.vx, pending.contactY);
    catchUpResolvedBall(ball, now - pending.crossedAt);
    return;
  }

  finalizeMiss(room, pending.team, ball, now);
}

function catchUpResolvedBall(ball, delayMs) {
  const seconds = clamp(delayMs / 1000, 0, LATE_INPUT_GRACE_MS / 1000);
  ball.x += ball.vx * seconds + 0.5 * (ball.curve || 0) * seconds * seconds;
  ball.y += ball.vy * seconds;
  ball.vx += (ball.curve || 0) * seconds;
  ball.curve = (ball.curve || 0) * Math.exp(-BALL_SPIN_DECAY * seconds);
  while (ball.x < ball.r || ball.x > W - ball.r) {
    if (ball.x < ball.r) {
      ball.x = ball.r + (ball.r - ball.x);
      ball.vx = Math.abs(ball.vx);
      ball.curve = Math.abs(ball.curve);
    } else {
      ball.x = W - ball.r - (ball.x - (W - ball.r));
      ball.vx = -Math.abs(ball.vx);
      ball.curve = -Math.abs(ball.curve);
    }
  }
}

function collidePower(room, ball, now) {
  if (!room.power) return;
  if (Math.hypot(ball.x - room.power.x, ball.y - room.power.y) > ball.r + room.power.r) return;
  const player = room.players.find((p) => playerKey(p) === ball.lastTouch);
  if (!player) {
    room.power = null;
    room.nextPowerAt = now + rand(POWERUP_MIN_MS, POWERUP_MAX_MS);
    return;
  }

  const type = room.power.type;
  if (type === "multi") {
    const targetBallCount = room.mode === "2v2" ? MULTIBALL_TOTAL_2V2 : MULTIBALL_TOTAL_1V1;
    const extraBalls = Math.max(0, targetBallCount - room.balls.filter((activeBall) => !activeBall.dead).length);
    for (let i = 0; i < extraBalls; i += 1) {
      const angle = rand(-0.85, 0.85) + (player.team === "top" ? Math.PI / 2 : -Math.PI / 2);
      room.balls.push(assignBallId(room, makeBall(Math.sin(angle), ball.x, ball.y, Math.cos(angle))));
    }
  }
  if (type === "laser") {
    player.laserActiveUntil = now + POWERUP_EFFECT_MS;
    player.laserFadeUntil = player.laserActiveUntil + POWERUP_EFFECT_MS;
  }
  if (type === "emp") {
    player.empActiveUntil = now + POWERUP_EFFECT_MS;
    player.empFadeUntil = player.empActiveUntil + POWERUP_EFFECT_MS;
  }
  room.lastPower = { type, player: player.name, team: player.team, at: now };
  room.power = null;
  room.nextPowerAt = now + rand(POWERUP_MIN_MS, POWERUP_MAX_MS);
}

function finalizeMiss(room, team, ball, now) {
  room.misses[team] += 1;
  ball.dead = true;
  ball.pendingMiss = null;
  ball.bump = now;
  room.lastMissTeam = team;
  room.pendingCountdown = true;
}

export function checkWin(room, now = performance.now()) {
  const top = room.misses.top;
  const bottom = room.misses.bottom;
  if (top >= room.missLimit || bottom >= room.missLimit) {
    if (top === bottom) return;
    room.status = "ended";
    room.winner = top > bottom ? "bottom" : "top";
    room.endedAt = now;
    room.balls = [];
    room.power = null;
    room.countdownUntil = 0;
    room.pendingCountdown = false;
    room.nextPublishAt = 0;
  }
}

function moveToward(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  if (value > target) return Math.max(target, value - amount);
  return target;
}

export function makeBall(direction = Math.random() > 0.5 ? 1 : -1, x = W / 2, y = H / 2, xDir = rand(-0.45, 0.45)) {
  const speed = BALL_BASE_SPEED;
  return {
    id: 0,
    x,
    y,
    r: 8,
    vx: xDir * speed,
    vy: direction * speed,
    speed,
    curve: 0,
    lastTouch: null,
    touchMask: 0,
    bump: 0
  };
}

function makeServeBall(room, team, now) {
  const speed = BALL_BASE_SPEED * speedMultiplier(room, now);
  const target = targetPlayer(room, team);
  const x = W / 2;
  const y = H / 2;
  const targetY = team === "top" ? 28 : H - 28;
  const dx = (target?.x ?? W / 2) - x;
  const dy = targetY - y;
  const mag = Math.hypot(dx, dy) || 1;
  return {
    id: 0,
    x,
    y,
    r: 8,
    vx: (dx / mag) * speed,
    vy: (dy / mag) * speed,
    speed,
    curve: 0,
    lastTouch: null,
    touchMask: 0,
    bump: now
  };
}

function targetPlayer(room, team) {
  const candidates = room.players.filter((player) => player.team === team && !player.disconnected);
  if (!candidates.length) return null;
  return candidates.reduce((best, player) => (Math.abs(player.x - W / 2) < Math.abs(best.x - W / 2) ? player : best), candidates[0]);
}

export function beginCountdown(room, now, team) {
  room.serveTeam = team;
  room.balls = [];
  const duration = 3000 / speedMultiplier(room, now);
  room.countdownUntil = now + duration;
  room.nextPublishAt = now;
}

export function launchServe(room, now) {
  if (room.mode === "2v2" || room.serveTeam === "both") {
    room.balls = [assignBallId(room, makeServeBall(room, "top", now)), assignBallId(room, makeServeBall(room, "bottom", now))];
    return;
  }
  room.balls = [assignBallId(room, makeServeBall(room, room.serveTeam || "top", now))];
}

function assignBallId(room, ball) {
  const id = room.nextBallId || 1;
  room.nextBallId = id >= 255 ? 1 : id + 1;
  ball.id = id;
  return ball;
}

export function countdownValue(room, now) {
  if (!room.countdownUntil || room.countdownUntil <= now) return 0;
  const stepMs = 1000 / speedMultiplier(room, now);
  return clamp(Math.ceil((room.countdownUntil - now) / stepMs), 1, 3);
}

export function speedMultiplier(room, now) {
  const elapsed = room.startedAt ? (now - room.startedAt) / 1000 : 0;
  return Math.min(BALL_MAX_SPEED_MULTIPLIER, 1 + elapsed / GAME_ACCEL_SECONDS);
}

export function paddleWidth(player, now) {
  return 140 + 140 * laserStrength(player, now);
}

export function laserStrength(player, now) {
  if (player.laserActiveUntil > now) return 1;
  if (player.laserFadeUntil > now) return (player.laserFadeUntil - now) / POWERUP_EFFECT_MS;
  return 0;
}

export function empStrength(player, now) {
  if (player.empActiveUntil > now) return 1;
  if (player.empFadeUntil > now) return (player.empFadeUntil - now) / POWERUP_EFFECT_MS;
  return 0;
}

function empSlowStrength(room, ball, now) {
  let strongest = 0;
  for (const player of room.players) {
    if (player.disconnected) continue;
    const strength = empStrength(player, now);
    if (strength <= 0) continue;
    const y = player.team === "top" ? 95 : H - 95;
    if (Math.hypot(ball.x - player.x, ball.y - y) < 260) strongest = Math.max(strongest, strength);
  }
  return strongest;
}
