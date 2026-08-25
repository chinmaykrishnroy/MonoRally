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
  const contactY = paddleContactY(team, ball.r);
  const denominator = ball.y - oldY;
  if (Math.abs(denominator) < 0.0001) return;
  const crossing = (contactY - oldY) / denominator;
  if (crossing < 0 || crossing > 1) return;

  const hitX = oldX + (ball.x - oldX) * crossing;
  const hitAt = elapsed + step * crossing;
  const candidates = players
    .filter((player) => player.team === team)
    .map((player) => ({
      player,
      center: player.x + (Number(player.vx) || 0) * hitAt
    }))
    .filter(({ player, center }) => Math.abs(hitX - center) <= player.w / 2 + ball.r + PADDLE_EDGE_GRACE)
    .sort((a, b) => Math.abs(hitX - a.center) - Math.abs(hitX - b.center));
  if (!candidates.length) return;

  const { player, center } = candidates[0];
  applyPredictedBounce(ball, player, hitX, center);
  const tail = step * (1 - crossing);
  ball.x = hitX + ball.vx * tail + 0.5 * (ball.curve || 0) * tail * tail;
  ball.y = contactY + ball.vy * tail;
  ball.vx += (ball.curve || 0) * tail;
  reflectSideWalls(ball);
  ball.bump = true;
  ball.predictedImpact = true;
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
  return y + (team === "top" ? PADDLE_HEIGHT / 2 + radius + 1 : -PADDLE_HEIGHT / 2 - radius - 1);
}
