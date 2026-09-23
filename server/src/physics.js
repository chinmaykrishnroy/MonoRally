import {
  BALL_BASE_SPEED,
  BALL_MAX_SPEED_MULTIPLIER,
  BALL_SPIN_DECAY,
  BALL_SPIN_MAX,
  BALL_SPIN_OFFSET,
  BALL_SPIN_TRANSFER,
  GAME_ACCEL_SECONDS,
  H,
  HIT_PRESENTATION_DELAY_MS,
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
import { emitNetworkTelemetry } from "./network-telemetry.js";
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

    let paddleHit = false;
    for (const player of room.players) {
      if (player.disconnected) continue;
      if (collidePaddle(room, player, ball, now, dt)) {
        paddleHit = true;
        break;
      }
    }

    const crossing = paddleHit ? null : paddleMissTraversal(ball, now, dt);
    if (crossing) {
      queuePendingMiss(room, ball, crossing, now);
      resolvePendingMiss(room, ball, now);
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
  if (!movingToward) return false;
  const crossing = sweptPaddleContact(ball, player.team, width, (t) => paddleCenterDuringStep(player, t));
  if (!crossing) return false;
  const hitX = crossing.hitX;
  const center = paddleCenterDuringStep(player, crossing.t);

  applyPaddleBounce(
    room,
    player,
    ball,
    now,
    hitX,
    center,
    Number(player.vx) || 0,
    frontContactY(player.team, ball.r, crossing.hitY)
  );
  return true;
}

export function classifyShot(player, ball, paddleVelocity, hitX, center, width, now) {
  const offset = clamp((hitX - center) / Math.max(1, width / 2), -1, 1);
  const absOffset = Math.abs(offset);
  const absPaddleSpeed = Math.abs(paddleVelocity);
  const isOverdrive = Boolean(player.overdriveActiveUntil && player.overdriveActiveUntil > now);
  const baseSpeed = Math.max(ball.speed || 0, Math.hypot(ball.vx, ball.vy), 1);

  if (isOverdrive) {
    return "smash";
  }

  // 1. Counter / Parry: Fast oncoming ball, paddle moving opposite to incoming x velocity, well centered
  if (baseSpeed >= 540 && absOffset <= 0.45 && Math.sign(paddleVelocity) !== 0 && Math.sign(paddleVelocity) !== Math.sign(ball.vx)) {
    return "counter";
  }

  // 2. Smash: Rapid paddle acceleration and hit within paddle central zone
  if (absPaddleSpeed >= 1100 && absOffset <= 0.38) {
    return "smash";
  }

  // 3. Curve: Outer edge slicing contact with paddle motion
  if (absOffset >= 0.52 && absPaddleSpeed >= 380) {
    return "curve";
  }

  // 4. Drive: Dead center hit with low paddle velocity
  if (absOffset <= 0.16 && absPaddleSpeed <= 350) {
    return "drive";
  }

  return "standard";
}

function applyPaddleBounce(room, player, ball, now, hitX, center, paddleVelocity, contactY) {
  const width = paddleWidth(player, now);
  const baseSpeed = Math.max(ball.speed || 0, Math.hypot(ball.vx, ball.vy), 1);
  const offset = clamp((hitX - center) / Math.max(1, width / 2), -1, 1);
  const absPaddleSpeed = Math.abs(paddleVelocity);
  const isOverdrive = Boolean(player.overdriveActiveUntil && player.overdriveActiveUntil > now);

  const shotType = classifyShot(player, ball, paddleVelocity, hitX, center, width, now);

  let desiredVx;
  let speed = baseSpeed;

  if (shotType === "counter") {
    speed = Math.min(baseSpeed * 1.25 + 60, BALL_BASE_SPEED * BALL_MAX_SPEED_MULTIPLIER);
    desiredVx = -ball.vx * 0.85 + offset * speed * 0.4 + paddleVelocity * 0.25;
    ball.curve = clamp(paddleVelocity * BALL_SPIN_TRANSFER + offset * BALL_SPIN_OFFSET, -BALL_SPIN_MAX, BALL_SPIN_MAX);
  } else if (shotType === "smash") {
    speed = Math.min(baseSpeed * 1.35, BALL_BASE_SPEED * BALL_MAX_SPEED_MULTIPLIER);
    if (isOverdrive) {
      desiredVx = clamp(ball.vx * 0.15 + offset * 70, -60, 60);
      ball.curve = 0;
    } else {
      desiredVx = ball.vx * 0.35 + offset * speed * 0.75 + paddleVelocity * (PADDLE_VELOCITY_TRANSFER * 1.2);
      ball.curve = clamp(paddleVelocity * BALL_SPIN_TRANSFER + offset * BALL_SPIN_OFFSET, -BALL_SPIN_MAX, BALL_SPIN_MAX);
    }
  } else if (shotType === "curve") {
    desiredVx = ball.vx * 0.4 + offset * speed * 0.8 + paddleVelocity * PADDLE_VELOCITY_TRANSFER;
    const maxSpin = 1400;
    ball.curve = clamp(Math.sign(offset) * (700 + absPaddleSpeed * 0.65), -maxSpin, maxSpin);
  } else if (shotType === "drive") {
    speed = baseSpeed * 1.08;
    desiredVx = clamp(ball.vx * 0.15 + offset * 60, -45, 45);
    ball.curve = 0;
  } else {
    desiredVx = ball.vx * 0.42 + offset * speed * 0.72 + paddleVelocity * PADDLE_VELOCITY_TRANSFER;
    ball.curve = clamp(paddleVelocity * BALL_SPIN_TRANSFER + offset * BALL_SPIN_OFFSET, -BALL_SPIN_MAX, BALL_SPIN_MAX);
  }

  const effectiveHorizontalLimit = speed * Math.sin(MAX_BOUNCE_ANGLE);
  ball.vx = clamp(desiredVx, -effectiveHorizontalLimit, effectiveHorizontalLimit);
  const verticalSpeed = Math.max(speed * 0.36, Math.sqrt(Math.max(0, speed * speed - ball.vx * ball.vx)));
  ball.vy = verticalSpeed * (player.team === "top" ? 1 : -1);
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
  ball.paddleApproach = null;
  ball.bump = now;
  room.lastHit = {
    x: ball.x,
    y: player.team === "top" ? 28 : H - 28,
    at: now,
    presentAt: now + HIT_PRESENTATION_DELAY_MS,
    slot: player.slot,
    score: player.returns,
    intensity: clamp(Math.abs(offset) * 0.45 + Math.abs(paddleVelocity) / PADDLE_MAX_SPEED + (shotType !== "standard" ? 0.28 : 0), 0.2, 1),
    shotType
  };
}

function paddleCenterDuringStep(player, t) {
  const oldX = Number.isFinite(player.prevX) ? player.prevX : player.x;
  return oldX + (player.x - oldX) * clamp(t, 0, 1);
}

function paddleMissTraversal(ball, now, dt) {
  const team = ball.vy < 0 ? "top" : ball.vy > 0 ? "bottom" : null;
  if (!team) {
    ball.paddleApproach = null;
    return null;
  }
  if (ball.paddleApproach?.team !== team) ball.paddleApproach = null;

  const oldX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
  const oldY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
  const startedAt = now - Math.max(0, dt * 1000);
  const paddleY = team === "top" ? 28 : H - 28;
  const collisionRadius = PADDLE_HEIGHT / 2 + ball.r;
  const entryY = paddleY + (team === "top" ? collisionRadius : -collisionRadius);
  const exitY = paddleY + (team === "top" ? -collisionRadius : collisionRadius);

  if (!ball.paddleApproach) {
    const entry = segmentCrossingPoint(oldX, oldY, ball.x, ball.y, startedAt, now, entryY, team);
    if (entry) {
      ball.paddleApproach = { team, points: [entry] };
    } else if (insidePaddleTraversal(oldY, entryY, exitY)) {
      ball.paddleApproach = { team, points: [{ x: oldX, y: oldY, at: startedAt }] };
    } else {
      return null;
    }
  }

  const exit = segmentCrossingPoint(oldX, oldY, ball.x, ball.y, startedAt, now, exitY, team);
  if (exit) {
    appendApproachPoint(ball.paddleApproach, exit);
    const points = ball.paddleApproach.points;
    const first = points[0];
    ball.paddleApproach = null;
    return {
      team,
      t: 1,
      hitX: first.x,
      contactY: entryY,
      crossedAt: first.at,
      oldX: first.x,
      oldY: first.y,
      newX: exit.x,
      newY: exit.y,
      points
    };
  }

  appendApproachPoint(ball.paddleApproach, { x: ball.x, y: ball.y, at: now });
  return null;
}

function segmentCrossingPoint(oldX, oldY, newX, newY, startedAt, endedAt, y, team) {
  const denominator = newY - oldY;
  if (Math.abs(denominator) < 0.0001) return null;
  const t = (y - oldY) / denominator;
  const movingToward = team === "top" ? denominator < 0 : denominator > 0;
  if (!movingToward || t < 0 || t > 1) return null;
  return {
    x: clamp(oldX + (newX - oldX) * t, 0, W),
    y,
    at: startedAt + (endedAt - startedAt) * t
  };
}

function insidePaddleTraversal(y, entryY, exitY) {
  return y >= Math.min(entryY, exitY) && y <= Math.max(entryY, exitY);
}

function appendApproachPoint(approach, point) {
  const last = approach.points[approach.points.length - 1];
  if (last && Math.abs(last.at - point.at) < 0.001) {
    approach.points[approach.points.length - 1] = point;
  } else {
    approach.points.push(point);
  }
  if (approach.points.length > 64) approach.points.splice(1, approach.points.length - 64);
}

function sweptPaddleContact(ball, team, width, centerAt) {
  const oldX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
  const oldY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
  const paddleY = team === "top" ? 28 : H - 28;
  const capRadius = PADDLE_HEIGHT / 2 + ball.r;
  const straightHalf = Math.max(0, width / 2 - PADDLE_HEIGHT / 2 + PADDLE_EDGE_GRACE);
  const relativeStartX = oldX - centerAt(0);
  const relativeEndX = ball.x - centerAt(1);
  const relativeStartY = oldY - paddleY;
  const relativeEndY = ball.y - paddleY;
  const t = segmentCapsuleHitT(
    relativeStartX,
    relativeStartY,
    relativeEndX,
    relativeEndY,
    straightHalf,
    capRadius
  );
  if (t == null) return null;
  return {
    t,
    hitX: clamp(oldX + (ball.x - oldX) * t, ball.r, W - ball.r),
    hitY: oldY + (ball.y - oldY) * t
  };
}

function segmentCapsuleHitT(x0, y0, x1, y1, halfLength, radius) {
  const edgeX = Math.max(0, Math.abs(x0) - halfLength);
  if (edgeX * edgeX + y0 * y0 <= radius * radius) return 0;

  const candidates = [];
  const rectangleHit = segmentAabbHitT(x0, y0, x1, y1, -halfLength, halfLength, -radius, radius);
  if (rectangleHit != null) candidates.push(rectangleHit);
  const leftHit = segmentCircleHitT(x0, y0, x1, y1, -halfLength, 0, radius);
  if (leftHit != null) candidates.push(leftHit);
  const rightHit = segmentCircleHitT(x0, y0, x1, y1, halfLength, 0, radius);
  if (rightHit != null) candidates.push(rightHit);
  return candidates.length ? Math.min(...candidates) : null;
}

function segmentAabbHitT(x0, y0, x1, y1, minX, maxX, minY, maxY) {
  let enter = 0;
  let exit = 1;
  for (const [start, delta, min, max] of [[x0, x1 - x0, minX, maxX], [y0, y1 - y0, minY, maxY]]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return null;
      continue;
    }
    const first = (min - start) / delta;
    const second = (max - start) / delta;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return null;
  }
  return enter >= 0 && enter <= 1 ? enter : null;
}

function segmentCircleHitT(x0, y0, x1, y1, centerX, centerY, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ox = x0 - centerX;
  const oy = y0 - centerY;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return null;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return null;
}

function paddleContactY(team, radius) {
  const y = team === "top" ? 28 : H - 28;
  return y + (team === "top" ? PADDLE_HEIGHT / 2 + radius : -PADDLE_HEIGHT / 2 - radius);
}

function frontContactY(team, radius, hitY) {
  const plane = paddleContactY(team, radius);
  return team === "top" ? Math.max(plane, hitY) : Math.min(plane, hitY);
}

function fallbackCrossing(ball, team, now) {
  return {
    team,
    t: 1,
    hitX: clamp(ball.x, ball.r, W - ball.r),
    contactY: paddleContactY(team, ball.r),
    crossedAt: now,
    points: [{ x: ball.x, y: ball.y, at: now }]
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
    newY: crossing.newY,
    points: crossing.points
  };
  ball.paddleApproach = null;
  emitNetworkTelemetry("collision.pending", () => collisionTelemetry(room, ball, ball.pendingMiss, now));
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
  const points = pendingSweepPoints(pending);
  const catches = [];

  for (const player of players) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const width = Math.max(paddleWidth(player, start.at), paddleWidth(player, end.at));
      const sweepBall = {
        ...ball,
        prevX: start.x,
        prevY: start.y,
        x: end.x,
        y: end.y
      };
      const centerAt = (t) => {
        const at = start.at + (end.at - start.at) * t;
        return reconstructedPaddleState(player, at, width)?.x ?? Number.NaN;
      };
      const contact = sweptPaddleContact(sweepBall, pending.team, width, centerAt);
      if (!contact) continue;

      const contactAt = start.at + (end.at - start.at) * contact.t;
      const state = reconstructedPaddleState(player, contactAt, width);
      if (!state) continue;
      catches.push({
        center: state.x,
        contact,
        contactAt,
        distance: Math.abs(contact.hitX - state.x),
        player,
        vx: state.vx
      });
      break;
    }
  }

  if (catches.length) {
    const caught = catches.sort((a, b) => a.distance - b.distance || a.contactAt - b.contactAt)[0];
    emitNetworkTelemetry("collision.adjudicated", () => ({
      ...collisionTelemetry(room, ball, pending, now),
      outcome: "hit",
      lateInput: true,
      resolvedSlot: caught.player.slot,
      reconstructed: { x: caught.center, vx: caught.vx, contactAt: caught.contactAt, distance: caught.distance }
    }));
    applyPaddleBounce(
      room,
      caught.player,
      ball,
      now,
      caught.contact.hitX,
      caught.center,
      caught.vx,
      frontContactY(pending.team, ball.r, caught.contact.hitY)
    );
    catchUpResolvedBall(ball, now - caught.contactAt);
    return;
  }

  emitNetworkTelemetry("collision.adjudicated", () => ({
    ...collisionTelemetry(room, ball, pending, now),
    outcome: "miss",
    lateInput: false
  }));
  finalizeMiss(room, pending.team, ball, now);
}

function collisionTelemetry(room, ball, pending, now) {
  return {
    room: room.code,
    ball: ball.id,
    team: pending.team,
    collisionTimestamp: pending.crossedAt,
    decisionTimestamp: now,
    pendingMiss: {
      hitX: pending.hitX,
      contactY: pending.contactY,
      resolveAt: pending.resolveAt
    },
    ballApproach: (pending.points || []).slice(-16).map((point) => ({ x: point.x, y: point.y, at: point.at })),
    paddles: room.players
      .filter((player) => player.team === pending.team && !player.bot)
      .map((player) => ({
        slot: player.slot,
        clockTrusted: Boolean(player.clockTrusted),
        estimatedRttMs: Number.isFinite(player.inputDelayMs) ? player.inputDelayMs * 2 : null,
        jitterMs: Number.isFinite(player.inputJitterMs) ? player.inputJitterMs : null,
        history: (player.inputHistory || []).slice(-16).map((sample) => ({
          sequence: sample.sequence,
          eventAt: sample.eventAt,
          receivedAt: sample.receivedAt,
          x: sample.x,
          vx: sample.vx
        }))
      }))
  };
}

function pendingSweepPoints(pending) {
  if (Array.isArray(pending.points) && pending.points.length >= 2) return pending.points;
  if ([pending.oldX, pending.oldY, pending.newX, pending.newY].every(Number.isFinite)) {
    return [
      { x: pending.oldX, y: pending.oldY, at: pending.crossedAt },
      { x: pending.newX, y: pending.newY, at: pending.resolveAt }
    ];
  }
  return [];
}

function reconstructedPaddleState(player, at, width) {
  const claim = inputSampleAt(player, at);
  if (!claim || at - claim.eventAt > Math.max(300, LATE_INPUT_GRACE_MS * 1.5)) return null;
  const projected = projectInputSample(claim, at, PADDLE_MAX_SPEED, PADDLE_ACCELERATION);
  return {
    x: clamp(projected.x, width / 2 + 4, W - width / 2 - 4),
    vx: clamp(Number(projected.vx) || 0, -PADDLE_MAX_SPEED, PADDLE_MAX_SPEED)
  };
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
  if (type === "overdrive") {
    player.overdriveActiveUntil = now + POWERUP_EFFECT_MS;
    player.overdriveFadeUntil = player.overdriveActiveUntil + POWERUP_EFFECT_MS;
  }
  room.lastPower = { type, player: player.name, team: player.team, at: now };
  room.power = null;
  room.nextPowerAt = now + rand(POWERUP_MIN_MS, POWERUP_MAX_MS);
}

function finalizeMiss(room, team, ball, now) {
  room.misses[team] += 1;
  ball.dead = true;
  ball.pendingMiss = null;
  ball.paddleApproach = null;
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

export function overdriveStrength(player, now) {
  if (player.overdriveActiveUntil > now) return 1;
  if (player.overdriveFadeUntil > now) return (player.overdriveFadeUntil - now) / POWERUP_EFFECT_MS;
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
