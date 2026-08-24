import { H, W, clamp, config } from "../core/shared.js";

export function createTrajectoryPredictor(state) {
  const pendingVisuals = new Map();

  function interpolatedNetState() {
    if (!state.netBuffer.length) return state.lastNetState;
    const latestEntry = state.netBuffer[state.netBuffer.length - 1];
    if (latestEntry.snapshot.status !== "running") return predictOwnPaddle(latestEntry.snapshot);
    const trajectoryMode = latestEntry.snapshot.protocol >= 3 && state.clockSynced;
    const visualDelay = trajectoryMode ? clamp((state.clockJitterMs || 0) * 1.5 + 4, 4, 24) : state.renderDelay;
    const target = performance.now() - visualDelay;
    let older = state.netBuffer[0];
    let newer = latestEntry;

    for (let i = 0; i < state.netBuffer.length - 1; i += 1) {
      if (entryTime(state.netBuffer[i]) <= target && entryTime(state.netBuffer[i + 1]) >= target) {
        older = state.netBuffer[i];
        newer = state.netBuffer[i + 1];
        break;
      }
    }

    if (target <= entryTime(state.netBuffer[0])) return predictOwnPaddle(state.netBuffer[0].snapshot);
    if (target >= entryTime(latestEntry)) {
      const previous = state.netBuffer[state.netBuffer.length - 2];
      return predictOwnPaddle(extrapolateSnapshot(previous, latestEntry, target));
    }

    const span = Math.max(1, entryTime(newer) - entryTime(older));
    return predictOwnPaddle(interpolateSnapshot(older.snapshot, newer.snapshot, (target - entryTime(older)) / span));
  }

  function interpolateSnapshot(a, b, t) {
    const mix = (av, bv) => av + (bv - av) * t;
    return {
      ...b,
      elapsed: mix(a.elapsed || 0, b.elapsed || 0),
      misses: { ...b.misses },
      countdown: b.countdown,
      players: b.players.map((bp) => {
        const ap = a.players.find((player) => player.slot === bp.slot);
        return ap ? { ...bp, x: mix(ap.x, bp.x), w: mix(ap.w, bp.w), vx: mix(ap.vx || 0, bp.vx || 0) } : { ...bp };
      }),
      balls: b.balls.map((bb, index) => {
        const ab = a.balls.find((ball) => ball.id === bb.id) || a.balls[index];
        return ab
          ? { ...bb, x: mix(ab.x, bb.x), y: mix(ab.y, bb.y), r: mix(ab.r, bb.r), vx: mix(ab.vx || 0, bb.vx || 0), vy: mix(ab.vy || 0, bb.vy || 0), curve: mix(ab.curve || 0, bb.curve || 0) }
          : { ...bb };
      }),
      power:
        a.power && b.power && a.power.type === b.power.type
          ? { ...b.power, x: mix(a.power.x, b.power.x), y: mix(a.power.y, b.power.y) }
          : b.power
    };
  }

  function extrapolateSnapshot(previous, latest, target) {
    if (!previous || !latest) return latest?.snapshot || state.lastNetState;
    const frameMs = Math.max(1, entryTime(latest) - entryTime(previous));
    const aheadMs = clamp(target - entryTime(latest), 0, latest.snapshot.protocol >= 3 ? 120 : 50);
    const ratio = aheadMs / frameMs;
    const current = latest.snapshot;
    const prior = previous.snapshot;
    if (current.protocol >= 3) return projectTrajectorySnapshot(current, aheadMs / 1000);
    return {
      ...current,
      elapsed: (current.elapsed || 0) + aheadMs / 1000,
      players: current.players.map((player) => {
        const old = prior.players.find((entry) => entry.slot === player.slot);
        if (!old) return { ...player };
        return { ...player, x: clamp(player.x + (player.x - old.x) * ratio, player.w / 2 + 4, W - player.w / 2 - 4) };
      }),
      balls: current.balls.map((ball, index) => {
        const old = prior.balls[index];
        if (!old || ball.bump) return { ...ball };
        return {
          ...ball,
          x: clamp(ball.x + (ball.x - old.x) * ratio, -ball.r, W + ball.r),
          y: clamp(ball.y + (ball.y - old.y) * ratio, -ball.r, H + ball.r)
        };
      })
    };
  }

  function predictOwnPaddle(snapshot) {
    if (!snapshot || state.role !== "player") return snapshot;
    return {
      ...snapshot,
      players: snapshot.players.map((player) => {
        if (player.slot !== state.slot) return player;
        const predictedX = clamp(state.predictedPaddleX, player.w / 2 + 4, W - player.w / 2 - 4);
        return { ...player, x: predictedX, vx: state.predictedPaddleVx };
      })
    };
  }

  function projectTrajectorySnapshot(snapshot, seconds) {
    if (snapshot.status !== "running" || seconds <= 0) return snapshot;
    return {
      ...snapshot,
      elapsed: (snapshot.elapsed || 0) + seconds,
      players: snapshot.players.map((player) => ({
        ...player,
        x: clamp(player.x + (player.vx || 0) * seconds, player.w / 2 + 4, W - player.w / 2 - 4)
      })),
      balls: snapshot.balls.map((ball) => projectBall(ball, seconds, snapshot.players))
    };
  }

  function projectBall(ball, seconds, players = []) {
    if (ball.pending) return projectPendingBall(ball, seconds, players);
    pendingVisuals.delete(ball.id ?? 0);
    let curve = ball.curve || 0;
    let x = ball.x + (ball.vx || 0) * seconds + 0.5 * curve * seconds * seconds;
    let vx = (ball.vx || 0) + curve * seconds;
    const minX = ball.r;
    const maxX = W - ball.r;
    for (let bounce = 0; bounce < 3 && (x < minX || x > maxX); bounce += 1) {
      if (x < minX) {
        x = minX + (minX - x);
        vx = Math.abs(vx);
        curve = Math.abs(curve);
      } else if (x > maxX) {
        x = maxX - (x - maxX);
        vx = -Math.abs(vx);
        curve = -Math.abs(curve);
      }
    }
    return {
      ...ball,
      x: clamp(x, minX, maxX),
      y: ball.y + (ball.vy || 0) * seconds,
      vx,
      curve: curve * Math.exp(-(Number(config.ballSpinDecay) || 1.8) * seconds)
    };
  }

  function projectPendingBall(ball, seconds, players) {
    const id = ball.id ?? 0;
    let visual = pendingVisuals.get(id);
    if (!visual) {
      const team = ball.vy < 0 ? "top" : "bottom";
      const candidates = players
        .filter((player) => player.team === team)
        .map((player) => ({
          ...player,
          x: player.slot === state.slot ? state.predictedPaddleX : player.x,
          vx: player.slot === state.slot ? state.predictedPaddleVx : player.vx || 0
        }))
        .filter((player) => Math.abs(ball.x - player.x) <= player.w / 2 + ball.r + 6)
        .sort((a, b) => Math.abs(ball.x - a.x) - Math.abs(ball.x - b.x));
      const player = candidates[0];
      if (!player) return { ...ball };
      const speed = Math.max(1, Math.hypot(ball.vx || 0, ball.vy || 0));
      const offset = clamp((ball.x - player.x) / Math.max(1, player.w / 2), -1, 1);
      const horizontalLimit = speed * Math.sin((68 * Math.PI) / 180);
      const vx = clamp((ball.vx || 0) * 0.42 + offset * speed * 0.72 + player.vx * (Number(config.paddleVelocityTransfer) || 0.34), -horizontalLimit, horizontalLimit);
      const vy = Math.sqrt(Math.max(speed * speed * 0.13, speed * speed - vx * vx)) * (team === "top" ? 1 : -1);
      visual = {
        at: performance.now(),
        ball: {
          ...ball,
          pending: false,
          bump: true,
          vx,
          vy,
          curve: clamp(
            player.vx * (Number(config.ballSpinTransfer) || 0.26) + offset * (Number(config.ballSpinOffset) || 280),
            -(Number(config.ballSpinMax) || 1400),
            Number(config.ballSpinMax) || 1400
          )
        }
      };
      pendingVisuals.set(id, visual);
    }
    const age = clamp((performance.now() - visual.at) / 1000 + seconds, 0, 0.26);
    return projectBall(visual.ball, age, players);
  }

  function entryTime(entry) {
    return Number.isFinite(entry?.timelineAt) ? entry.timelineAt : entry?.receivedAt || 0;
  }

  return { interpolatedNetState };
}
