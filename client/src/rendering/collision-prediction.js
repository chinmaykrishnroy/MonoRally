import { H, W, clamp, config } from "../core/shared.js";

const PADDLE_Y_OFFSET = 28;
const PADDLE_HEIGHT = 18;
const PADDLE_EDGE_GRACE = 6;
const MAX_BOUNCE_ANGLE = (68 * Math.PI) / 180;
const MAX_STEP_SECONDS = 1 / 120;

export function projectBallWithCollisions(ball, seconds, players = []) {
  const projected = { ...ball };
  let remaining = Math.max(0, seconds);
  let elapsed = 0;

  while (remaining > 0.000001) {
    const step = Math.min(MAX_STEP_SECONDS, remaining);
    advanceStep(projected, step, elapsed, players);
    elapsed += step;
    remaining -= step;
  }

  return projected;
}

function advanceStep(ball, step, elapsed, players) {
  const oldX = ball.x;
  const oldY = ball.y;
  const oldVx = Number(ball.vx) || 0;
  const oldVy = Number(ball.vy) || 0;
  const curve = Number(ball.curve) || 0;
  ball.x += oldVx * step + 0.5 * curve * step * step;
  ball.y += oldVy * step;
  ball.vx = oldVx + curve * step;
  ball.curve = curve * Math.exp(-(Number(config.ballSpinDecay) || 1.8) * step);
  reflectSideWalls(ball);

  const team = oldVy < 0 ? "top" : oldVy > 0 ? "bottom" : null;
  if (!team) return;
  const contacts = players
    .filter((player) => player.team === team)
    .map((player) => {
      const vx = Number(player.vx) || 0;
      const contact = sweptPaddleContact(
        oldX,
        oldY,
        ball.x,
        ball.y,
        team,
        player.w,
        ball.r,
        (t) => player.x + vx * (elapsed + step * t)
      );
      if (!contact) return null;
      const center = player.x + vx * (elapsed + step * contact.t);
      return { center, contact, player };
    })
    .filter(Boolean)
    .sort((a, b) => a.contact.t - b.contact.t || Math.abs(a.contact.hitX - a.center) - Math.abs(b.contact.hitX - b.center));
  if (!contacts.length) return;

  const { center, contact, player } = contacts[0];
  applyPredictedBounce(ball, player, contact.hitX, center);
  const tail = step * (1 - contact.t);
  ball.x = contact.hitX + ball.vx * tail + 0.5 * (ball.curve || 0) * tail * tail;
  ball.y = frontContactY(team, ball.r, contact.hitY) + ball.vy * tail;
  ball.vx += (ball.curve || 0) * tail;
  reflectSideWalls(ball);
  ball.bump = true;
  ball.predictedImpact = true;
}

function sweptPaddleContact(oldX, oldY, newX, newY, team, width, radius, centerAt) {
  const paddleY = team === "top" ? PADDLE_Y_OFFSET : H - PADDLE_Y_OFFSET;
  const capRadius = PADDLE_HEIGHT / 2 + radius;
  const straightHalf = Math.max(0, width / 2 - PADDLE_HEIGHT / 2 + PADDLE_EDGE_GRACE);
  const intersects = (t) => {
    const relativeX = oldX + (newX - oldX) * t - centerAt(t);
    const relativeY = oldY + (newY - oldY) * t - paddleY;
    const edgeX = Math.max(0, Math.abs(relativeX) - straightHalf);
    return edgeX * edgeX + relativeY * relativeY <= capRadius * capRadius;
  };

  let previousT = 0;
  if (intersects(0)) return { t: 0, hitX: oldX, hitY: oldY };
  for (let sample = 1; sample <= 16; sample += 1) {
    const t = sample / 16;
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
    return {
      t: high,
      hitX: clamp(oldX + (newX - oldX) * high, 0, W),
      hitY: oldY + (newY - oldY) * high
    };
  }
  return null;
}

function applyPredictedBounce(ball, player, hitX, center) {
  const speed = Math.max(1, Math.hypot(Number(ball.vx) || 0, Number(ball.vy) || 0));
  const offset = clamp((hitX - center) / Math.max(1, player.w / 2), -1, 1);
  const horizontalLimit = speed * Math.sin(MAX_BOUNCE_ANGLE);
  const desiredVx =
    (Number(ball.vx) || 0) * 0.42 +
    offset * speed * 0.72 +
    (Number(player.vx) || 0) * (Number(config.paddleVelocityTransfer) || 0.34);
  ball.vx = clamp(desiredVx, -horizontalLimit, horizontalLimit);
  ball.vy = Math.max(speed * 0.36, Math.sqrt(Math.max(0, speed * speed - ball.vx * ball.vx))) * (player.team === "top" ? 1 : -1);
  ball.curve = clamp(
    (Number(player.vx) || 0) * (Number(config.ballSpinTransfer) || 0.26) + offset * (Number(config.ballSpinOffset) || 280),
    -(Number(config.ballSpinMax) || 1400),
    Number(config.ballSpinMax) || 1400
  );
}

function reflectSideWalls(ball) {
  while (ball.x < ball.r || ball.x > W - ball.r) {
    if (ball.x < ball.r) {
      ball.x = ball.r + (ball.r - ball.x);
      ball.vx = Math.abs(ball.vx);
      ball.curve = Math.abs(ball.curve || 0);
    } else {
      ball.x = W - ball.r - (ball.x - (W - ball.r));
      ball.vx = -Math.abs(ball.vx);
      ball.curve = -Math.abs(ball.curve || 0);
    }
  }
}

function paddleContactY(team, radius) {
  const y = team === "top" ? PADDLE_Y_OFFSET : H - PADDLE_Y_OFFSET;
  return y + (team === "top" ? PADDLE_HEIGHT / 2 + radius : -PADDLE_HEIGHT / 2 - radius);
}

function frontContactY(team, radius, hitY) {
  const plane = paddleContactY(team, radius);
  return team === "top" ? Math.max(plane, hitY) : Math.min(plane, hitY);
}
