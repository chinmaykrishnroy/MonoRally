import {
  BALL_BASE_SPEED,
  BALL_MAX_SPEED_MULTIPLIER,
  GAME_ACCEL_SECONDS,
  H,
  MAX_BALLS,
  MULTIBALL_TOTAL_1V1,
  MULTIBALL_TOTAL_2V2,
  POWERUP_EFFECT_MS,
  POWERUP_MAX_MS,
  POWERUP_MIN_MS,
  QUICK_AI_DIFFICULTY,
  W
} from "./config.js";
import { clamp, playerKey, rand, reflectX } from "./utils.js";

const PADDLE_HEIGHT = 18;
const PADDLE_EDGE_GRACE = 16;
const PADDLE_LATENCY_ASSIST = 120;

export function advanceBalls(room, now, dt) {
  const baseSpeed = BALL_BASE_SPEED * speedMultiplier(room, now);
  for (const ball of [...room.balls]) {
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    let desired = baseSpeed;
    desired *= 1 - 0.55 * empSlowStrength(room, ball, now);
    ball.speed += (desired - ball.speed) * Math.min(1, dt * 4.5);

    const mag = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / mag) * ball.speed;
    ball.vy = (ball.vy / mag) * ball.speed;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < ball.r) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx);
      ball.bump = now;
    }
    if (ball.x > W - ball.r) {
      ball.x = W - ball.r;
      ball.vx = -Math.abs(ball.vx);
      ball.bump = now;
    }

    for (const player of room.players) {
      if (!player.disconnected) collidePaddle(room, player, ball, now);
    }
    collidePower(room, ball, now);

    if (ball.y < -ball.r) miss(room, "top", ball, now);
    if (ball.y > H + ball.r) miss(room, "bottom", ball, now);
  }

  room.balls = room.balls.filter((ball) => !ball.dead).slice(0, MAX_BALLS);
}

export function updateBotTargets(room, now, dt) {
  const profile = botProfile(room.quickAiDifficulty || QUICK_AI_DIFFICULTY);
  for (const bot of room.players) {
    if (!bot.bot || bot.disconnected) continue;
    const ball = chooseBotBall(room, bot);
    const paddleY = bot.team === "top" ? 28 : H - 28;
    const predictedX = ball ? predictBallXAtY(ball, paddleY) : W / 2;
    const pressure = room.misses[bot.team] >= room.missLimit - 1 ? profile.clutch : 1;
    const error = profile.error * pressure * Math.sin(now * 0.001 * profile.errorRate + bot.aiPhase);
    bot.targetX += (predictedX + error - bot.targetX) * Math.min(1, dt * profile.reaction);
    if (Math.random() < profile.wobbleChance) bot.targetX += rand(-profile.wobble, profile.wobble);
    bot.targetX = clamp(bot.targetX, paddleWidth(bot, now) / 2 + 4, W - paddleWidth(bot, now) / 2 - 4);
  }
}

function botProfile(difficulty) {
  if (difficulty === "easy") return { reaction: 3.2, wobbleChance: 0.035, wobble: 190, error: 135, errorRate: 1.4, clutch: 0.8 };
  if (difficulty === "hard") return { reaction: 10.5, wobbleChance: 0.003, wobble: 22, error: 24, errorRate: 2.2, clutch: 0.25 };
  if (difficulty === "insane") return { reaction: 22, wobbleChance: 0, wobble: 0, error: 2, errorRate: 0.4, clutch: 0 };
  return { reaction: 5.2, wobbleChance: 0.014, wobble: 90, error: 62, errorRate: 1.9, clutch: 0.55 };
}

function chooseBotBall(room, player) {
  const towardSign = player.team === "top" ? -1 : 1;
  const paddleY = player.team === "top" ? 28 : H - 28;
  let best = null;
  let bestTime = Infinity;
  for (const ball of room.balls) {
    if (ball.dead || Math.sign(ball.vy || towardSign) !== towardSign) continue;
    const time = Math.abs((paddleY - ball.y) / (ball.vy || 1));
    if (time < bestTime) {
      best = ball;
      bestTime = time;
    }
  }
  return best || room.balls.find((ball) => !ball.dead) || null;
}

function predictBallXAtY(ball, targetY) {
  if (!ball || Math.abs(ball.vy) < 0.001) return ball?.x ?? W / 2;
  const time = (targetY - ball.y) / ball.vy;
  if (time <= 0) return ball.x;
  return reflectX(ball.x + ball.vx * time, ball.r);
}

function collidePaddle(room, player, ball, now) {
  const width = paddleWidth(player, now);
  const y = player.team === "top" ? 28 : H - 28;
  const movingToward = player.team === "top" ? ball.vy < 0 : ball.vy > 0;
  if (!movingToward) return;
  const oldX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
  const oldY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
  const nearNow = Math.abs(ball.y - y) <= ball.r + PADDLE_HEIGHT / 2 + 3;
  const denom = ball.y - oldY;
  const t = Math.abs(denom) > 0.001 ? (y - oldY) / denom : 1;
  const crossed = t >= -0.08 && t <= 1.08;
  const hitX = crossed ? oldX + (ball.x - oldX) * clamp(t, 0, 1) : ball.x;
  const center = paddleCollisionCenter(player, width, hitX);
  if (!nearNow && !crossed) return;
  if (hitX < center - width / 2 - ball.r - PADDLE_EDGE_GRACE || hitX > center + width / 2 + ball.r + PADDLE_EDGE_GRACE) return;

  ball.x = hitX;
  if (player.clientId) player.x = center;
  const offset = clamp((hitX - center) / (width / 2), -1, 1);
  ball.vx += offset * 260;
  ball.vy = Math.abs(ball.vy) * (player.team === "top" ? 1 : -1);
  ball.y = y + (player.team === "top" ? ball.r + PADDLE_HEIGHT / 2 + 1 : -ball.r - PADDLE_HEIGHT / 2 - 1);
  ball.lastTouch = playerKey(player);
  ball.bump = now;
  room.lastHit = { x: ball.x, y: ball.y, at: now };
}

function paddleCollisionCenter(player, width, hitX) {
  const current = clamp(player.x, width / 2 + 4, W - width / 2 - 4);
  if (!player.clientId || !Number.isFinite(player.targetX)) return current;
  const target = clamp(player.targetX, width / 2 + 4, W - width / 2 - 4);
  const assisted = current + clamp(target - current, -PADDLE_LATENCY_ASSIST, PADDLE_LATENCY_ASSIST);
  return clamp(hitX, Math.min(current, assisted), Math.max(current, assisted));
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
      room.balls.push(makeBall(Math.sin(angle), ball.x, ball.y, Math.cos(angle)));
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

function miss(room, team, ball, now) {
  room.misses[team] += 1;
  ball.dead = true;
  ball.bump = now;
  room.lastMissTeam = team;
  room.pendingCountdown = true;
}

export function checkWin(room) {
  const top = room.misses.top;
  const bottom = room.misses.bottom;
  if (top >= room.missLimit || bottom >= room.missLimit) {
    if (top === bottom) return;
    room.status = "ended";
    room.winner = top > bottom ? "bottom" : "top";
  }
}

export function makeBall(direction = Math.random() > 0.5 ? 1 : -1, x = W / 2, y = H / 2, xDir = rand(-0.45, 0.45)) {
  const speed = BALL_BASE_SPEED;
  return {
    x,
    y,
    r: 8,
    vx: xDir * speed,
    vy: direction * speed,
    speed,
    lastTouch: null,
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
    x,
    y,
    r: 8,
    vx: (dx / mag) * speed,
    vy: (dy / mag) * speed,
    speed,
    lastTouch: null,
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
    room.balls = [makeServeBall(room, "top", now), makeServeBall(room, "bottom", now)];
    return;
  }
  room.balls = [makeServeBall(room, room.serveTeam || "top", now)];
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
