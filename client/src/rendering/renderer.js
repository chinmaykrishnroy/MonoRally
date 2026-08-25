import { H, W, clamp, config } from "../core/shared.js";
import { createTrajectoryPredictor } from "./trajectory.js";
import { createCourtViewport } from "./viewport.js";
import { orientSnapshotForPlayer, orientYForPlayer } from "./view-orientation.js";

export function createRenderer({ ctx, state, dom, cancelRumble = () => {}, playRumble, nameForSlot, localPerformanceForServerTimestamp = () => performance.now() }) {
  let thunderTimer = 0;
  const ballTrails = [];
  const impactEvents = new Map();
  const ballImpactEvents = new Map();
  const ballBumpStates = new Map();
  const mobileVisualQuery = window.matchMedia("(max-width: 820px), (pointer: coarse)");
  let lastImpactToken = "";
  const { clientToCourt, cssPxToCourt, prepareCanvas, viewport } = createCourtViewport(ctx, usesMobileVisuals);
  const trajectory = createTrajectoryPredictor(state);

  function draw(s) {
    if (!ctx) {
      dom.statusEl.textContent = "canvas is not available in this browser";
      return;
    }
    if (s?.status !== "running" && (thunderTimer || document.body.classList.contains("invert") || document.body.classList.contains("shake"))) clearThunder();
    const inverted = document.body.classList.contains("invert");
    prepareCanvas(inverted);
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.scale, viewport.scale);
    ctx.fillStyle = inverted ? "#fff" : "#000";
    ctx.fillRect(0, 0, W, H);
    if (!s) {
      dom.replayBtn.hidden = true;
      dom.fillAiBtn.hidden = true;
      dom.matchResult?.classList.add("hidden");
      ballTrails.length = 0;
      ballImpactEvents.clear();
      ballBumpStates.clear();
      ctx.restore();
      return;
    }

    const view = orientSnapshotForPlayer(s, state);
    if (window.__MONORALLY_DEBUG__) {
      window.__MONORALLY_FRAME__ = {
        mode: view.mode,
        status: view.status,
        ownSlot: state.slot,
        players: view.players.map((player) => ({ slot: player.slot, team: player.team, x: player.x })),
        balls: view.balls.map((ball) => ({ id: ball.id, x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, bump: ball.bump }))
      };
    }
    if (view.status === "running") updateBallTrails(view.balls || []);
    else ballTrails.length = 0;
    registerImpact(view.lastHit, view.players || []);
    registerBallImpacts(view.balls || []);
    const replayReady = state.local || (
      state.online &&
      state.role === "player" &&
      view.players.length === (view.mode === "2v2" ? 4 : 2)
    );
    dom.replayBtn.hidden = !(view.status === "ended" && replayReady);
    dom.fillAiBtn.hidden = !(state.online && state.role === "player" && view.mode === "2v2" && view.status === "waiting");
    if (view.status === "running") maybeThunder(view.elapsed);
    dom.timerEl.textContent = String(Math.floor(view.elapsed)).padStart(3, "0");
    dom.missesEl.textContent = scoreText(view);
    updateMatchResult(s, view);
    if (view.status === "ended") {
      dom.statusEl.textContent = state.role === "spectator"
        ? "Match over."
        : replayReady
          ? "Replay or leave the match."
          : "Match over. A player left.";
    }
    else if (view.status === "waiting" && view.mode === "2v2") dom.statusEl.textContent = "Choose a top-team or bottom-team slot.";
    else if (view.lastPower) dom.statusEl.textContent = `${view.lastPower.player || view.lastPower.team} collected ${powerName(view.lastPower.type)}.`;
    else if (view.status === "running" && shouldReplaceStaleStatus(dom.statusEl.textContent)) dom.statusEl.textContent = runningStatusText(view);

    const fg = inverted ? "#000" : "#fff";
    const mid = inverted ? "#666" : "#aaa";
    const dim = inverted ? "#bbb" : "#343434";
    ctx.strokeStyle = dim;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 18]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.28;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.globalAlpha = 1;
    drawCourtBoundaries(fg, inverted);
    drawMobileMissGuides(fg, inverted);

    if (view.status === "waiting" && view.mode === "2v2") {
      drawStagingLobby(view, fg, mid);
      ctx.restore();
      return;
    }

    if (view.power) {
      ctx.save();
      ctx.translate(view.power.x, view.power.y);
      const powerR = visualPowerRadius(view.power.r);
      const pulse = 1 + Math.sin(performance.now() / 130) * 0.1;
      ctx.strokeStyle = fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, powerR * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(0, 0, powerR * 2.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.scale(powerR / view.power.r, powerR / view.power.r);
      drawPowerIcon(view.power.type, fg);
      ctx.restore();
    }

    const players = [...view.players].sort((a, b) => Number(a.slot === state.slot) - Number(b.slot === state.slot));
    for (const p of players) {
      const impact = paddleImpact(p);
      const edgeDirection = p.team === "top" ? -1 : 1;
      const y = (p.team === "top" ? 28 : H - 28) + edgeDirection * impact.recoil;
      const paddleH = visualPaddleHeight();
      const shade = view.mode === "2v2" && p.slot % 2 === 1 ? mid : fg;
      const jiggle = p.laser ? Math.sin(performance.now() / 55 + p.slot) * 4 : 0;
      const squash = impact.squash;
      const paddleX = p.x - p.w / 2 - jiggle / 2 - squash;
      const paddleY = y - paddleH / 2 - jiggle / 2 + squash / 3;
      const paddleW = p.w + jiggle + squash * 2;
      const renderedH = paddleH + jiggle - squash / 1.5;
      const depth = Math.max(3, cssPxToCourt(3));
      roundRect(
        ctx,
        paddleX,
        paddleY + (p.team === "top" ? depth : -depth),
        paddleW,
        renderedH,
        Math.min(renderedH / 2, 9 + jiggle / 2),
        inverted ? "#aaa" : "#383838"
      );
      roundRect(
        ctx,
        paddleX,
        paddleY,
        paddleW,
        renderedH,
        Math.min(renderedH / 2, 9 + jiggle / 2),
        shade
      );
      if (impact.active) {
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = shade;
        ctx.strokeRect(p.x - p.w / 2 - 18, y - paddleH / 2 - 13, p.w + 36, paddleH + 26);
        ctx.globalAlpha = 1;
      }
      if (p.laser) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = shade;
        ctx.strokeRect(p.x - p.w / 2 - 8, y - paddleH / 2 - 8, p.w + 16, paddleH + 16);
        ctx.globalAlpha = 1;
      }
      if (p.slot === state.slot && networkWarningActive() && Math.sin(performance.now() / 115) > -0.15) {
        ctx.save();
        ctx.strokeStyle = "#ff3b30";
        ctx.lineWidth = Math.max(2, cssPxToCourt(2));
        ctx.globalAlpha = 0.88;
        ctx.strokeRect(paddleX - 5, paddleY - 5, paddleW + 10, renderedH + 10);
        ctx.restore();
      }
      drawPaddleName(p, p.x, y, p.w, inverted);
      if (p.emp) {
        ctx.strokeStyle = shade;
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(p.x, p.team === "top" ? 95 : H - 95, 260, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    for (const b of view.balls) {
      const r = visualBallRadius(b.r);
      const impact = ballImpact(b);
      drawBall(b, r, fg, impact.deformation);
    }

    if (view.countdown) {
      ctx.fillStyle = fg;
      ctx.font = "96px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(view.countdown), W / 2, H / 2);
    }

    const effectNow = performance.now();
    for (let i = state.effects.length - 1; i >= 0; i -= 1) {
      const effect = state.effects[i];
      const progress = clamp((effectNow - effect.createdAt) / effect.duration, 0, 1);
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.r + progress * 54, 0, Math.PI * 2);
      ctx.stroke();
      drawSpark(effect, progress);
      ctx.globalAlpha = 1;
      if (progress >= 1) state.effects.splice(i, 1);
    }

    ctx.restore();
  }

  function drawCourtBoundaries(fg, inverted) {
    const wallWidth = Math.max(2, cssPxToCourt(1.7));
    ctx.save();
    ctx.strokeStyle = fg;
    ctx.lineWidth = wallWidth;
    ctx.globalAlpha = inverted ? 0.42 : 0.5;
    ctx.beginPath();
    ctx.moveTo(wallWidth / 2, wallWidth / 2);
    ctx.lineTo(wallWidth / 2, H - wallWidth / 2);
    ctx.moveTo(W - wallWidth / 2, wallWidth / 2);
    ctx.lineTo(W - wallWidth / 2, H - wallWidth / 2);
    ctx.stroke();

    ctx.globalAlpha = inverted ? 0.18 : 0.24;
    ctx.setLineDash([28, 18]);
    ctx.beginPath();
    ctx.moveTo(0, wallWidth / 2);
    ctx.lineTo(W, wallWidth / 2);
    ctx.moveTo(0, H - wallWidth / 2);
    ctx.lineTo(W, H - wallWidth / 2);
    ctx.stroke();
    ctx.restore();
  }

  function updateBallTrails(balls) {
    const activeIds = new Set(balls.map((ball, index) => ball.id ?? index));
    for (let i = ballTrails.length - 1; i >= 0; i -= 1) {
      if (!activeIds.has(ballTrails[i].id)) ballTrails.splice(i, 1);
    }
    balls.forEach((ball, index) => {
      const id = ball.id ?? index;
      const entry = ballTrails.find((trail) => trail.id === id) || { id, points: [] };
      const trail = entry.points;
      trail.push({ x: ball.x, y: ball.y, r: ball.r });
      const limit = usesMobileVisuals() ? 6 : 9;
      if (trail.length > limit) trail.splice(0, trail.length - limit);
      if (!ballTrails.includes(entry)) ballTrails.push(entry);
    });
  }

  function drawBallTrails(fg, inverted) {
    ctx.save();
    ctx.fillStyle = fg;
    for (const entry of ballTrails) {
      const trail = entry.points;
      trail.forEach((point, index) => {
        const alpha = (index + 1) / Math.max(1, trail.length);
        const r = visualBallRadius(point.r);
        ctx.globalAlpha = (inverted ? 0.1 : 0.16) * alpha;
        ctx.beginPath();
        ctx.arc(point.x, point.y, r * (0.45 + alpha * 0.35), 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawSpark(effect, progress) {
    const radius = effect.r + progress * 40;
    const spin = effect.spin || 0;
    ctx.save();
    ctx.translate(effect.x, effect.y);
    ctx.rotate(spin + progress * 0.9);
    for (let i = 0; i < 4; i += 1) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(radius * 0.35, 0);
      ctx.lineTo(radius * 0.9, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBall(ball, radius, fg, impactDeformation = 0) {
    const speed = Math.hypot(ball.vx || 0, ball.vy || 0);
    const angle = Math.atan2(ball.vy || 1, ball.vx || 0);
    const speedStretch = clamp((speed - 380) / 5000, 0, 0.1);
    const stretch = clamp(speedStretch + impactDeformation, -0.24, 0.2);
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(angle);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * (1 + stretch), radius * (1 - stretch * 0.55), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function registerImpact(lastHit, players) {
    if (!lastHit) return;
    const token = `${lastHit.at}:${lastHit.slot ?? ""}:${Math.round(lastHit.x || 0)}`;
    if (token === lastImpactToken) return;
    lastImpactToken = token;
    let slot = Number.isInteger(lastHit.slot) ? lastHit.slot : null;
    if (slot == null) {
      const nearest = players.reduce((best, player) => {
        const distance = Math.abs(player.x - lastHit.x);
        return !best || distance < best.distance ? { distance, slot: player.slot } : best;
      }, null);
      slot = nearest?.slot;
    }
    if (slot == null) return;
    const now = performance.now();
    const presentationAt = state.online && state.clockSynced
      ? localPerformanceForServerTimestamp(lastHit.at)
      : now;
    impactEvents.set(slot, {
      at: Number.isFinite(presentationAt) ? presentationAt : now,
      intensity: clamp(Number(lastHit.intensity) || 0.7, 0.35, 1)
    });
  }

  function registerBallImpacts(balls) {
    const activeIds = new Set();
    for (const ball of balls) {
      const id = ball.id ?? 0;
      activeIds.add(id);
      const wasBumped = ballBumpStates.get(id) === true;
      if (ball.bump && !wasBumped) ballImpactEvents.set(id, { at: performance.now() });
      ballBumpStates.set(id, Boolean(ball.bump));
    }
    for (const id of ballBumpStates.keys()) {
      if (!activeIds.has(id)) {
        ballBumpStates.delete(id);
        ballImpactEvents.delete(id);
      }
    }
  }

  function ballImpact(ball) {
    const event = ballImpactEvents.get(ball.id ?? 0);
    if (!event) return { active: false, deformation: 0, envelope: 0 };
    const age = performance.now() - event.at;
    if (age < 0) return { active: false, deformation: 0, envelope: 0 };
    if (age >= 420) {
      ballImpactEvents.delete(ball.id ?? 0);
      return { active: false, deformation: 0, envelope: 0 };
    }
    const envelope = Math.exp(-age / 145);
    const deformation = -Math.cos(age / 30) * 0.22 * envelope;
    return { active: true, deformation, envelope };
  }

  function paddleImpact(player) {
    const event = impactEvents.get(player.slot);
    if (!event) return { active: false, recoil: 0, squash: 0 };
    const age = performance.now() - event.at;
    if (age < 0) return { active: false, recoil: 0, squash: 0 };
    if (age >= 420) {
      impactEvents.delete(player.slot);
      return { active: false, recoil: 0, squash: 0 };
    }
    const intensity = event.intensity;
    const envelope = Math.exp(-age / 150) * intensity;
    const recoil = Math.max(0, Math.sin(Math.min(1, age / 76) * Math.PI)) * 15 * envelope + Math.sin(age / 32) * 2.4 * envelope;
    const squash = Math.max(0, Math.sin(Math.min(1, age / 95) * Math.PI)) * 6 * envelope;
    return { active: true, recoil, squash };
  }

  function drawPowerIcon(type, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (type === "multi") {
      const points = [
        [-6, -6],
        [6, -6],
        [-6, 6],
        [6, 6]
      ];
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === "laser") {
      ctx.beginPath();
      ctx.moveTo(-14, -5);
      ctx.lineTo(14, -5);
      ctx.moveTo(-14, 5);
      ctx.lineTo(14, 5);
      ctx.stroke();
      ctx.fillRect(-3, -10, 6, 20);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.65;
      for (let i = 0; i < 4; i += 1) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(20, 0);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMobileMissGuides(fg, inverted) {
    if (!usesMobileVisuals()) return;
    const lineWidth = Math.max(2, cssPxToCourt(1.8));
    ctx.save();
    ctx.strokeStyle = fg;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = inverted ? 0.28 : 0.34;
    ctx.setLineDash([28, 18]);
    ctx.beginPath();
    ctx.moveTo(26, 8);
    ctx.lineTo(W - 26, 8);
    ctx.moveTo(26, H - 8);
    ctx.lineTo(W - 26, H - 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = inverted ? 0.16 : 0.22;
    ctx.lineWidth = Math.max(1, lineWidth * 0.55);
    ctx.beginPath();
    ctx.moveTo(26, 48);
    ctx.lineTo(W - 26, 48);
    ctx.moveTo(26, H - 48);
    ctx.lineTo(W - 26, H - 48);
    ctx.stroke();
    ctx.restore();
  }

  function shouldReplaceStaleStatus(text) {
    return /waiting for players|choose a top|preparing ai|rejoined the match/i.test(String(text || ""));
  }

  function runningStatusText(view) {
    if (state.role === "spectator") return "Spectating.";
    return `${view.mode} rally. ${view.missLimit} misses loses.`;
  }

  function networkWarningActive() {
    if (!state.online || state.role !== "player") return false;
    const packetAge = performance.now() - (state.lastSnapshotReceivedAt || performance.now());
    const staleAfter = Math.max(420, (Number(state.latencyMs) || 0) * 3 + 100);
    return state.connectionState !== "online" || state.networkDegraded || packetAge > staleAfter;
  }

  function usesMobileVisuals() {
    return mobileVisualQuery.matches;
  }

  function visualBallRadius(radius) {
    return radius;
  }

  function visualPaddleHeight() {
    return 18;
  }

  function visualPowerRadius(radius) {
    return usesMobileVisuals() ? Math.max(radius, cssPxToCourt(12)) : radius;
  }

  function scoreText(view) {
    if (state.role === "spectator") return `Top ${view.misses.top} · Bottom ${view.misses.bottom} / ${view.missLimit}`;
    if (view.mode === "2v2") return `Your team ${view.misses.bottom} · Opponents ${view.misses.top} / ${view.missLimit}`;
    return `You ${view.misses.bottom} · Them ${view.misses.top} / ${view.missLimit}`;
  }

  function resultScoreText(view) {
    if (state.role === "spectator") return `Top ${view.misses.top} · Bottom ${view.misses.bottom}`;
    if (view.mode === "2v2") return `Your team ${view.misses.bottom} · Opponents ${view.misses.top}`;
    return `You ${view.misses.bottom} · Them ${view.misses.top}`;
  }

  function updateMatchResult(snapshot, view) {
    if (!dom.matchResult) return;
    const ended = view.status === "ended";
    dom.matchResult.classList.toggle("hidden", !ended);
    if (!ended) return;
    dom.resultTitle.textContent = winText(snapshot);
    dom.resultScore.textContent = resultScoreText(view);
  }

  function powerName(type) {
    if (type === "multi") return "Multi-ball";
    if (type === "laser") return "Laser Paddle";
    return "EMP";
  }

  function winText(snapshot) {
    if (!snapshot.winner) return "Draw";
    if (state.role === "spectator") return `${capitalize(orientSnapshotForPlayer(snapshot, state).winner)} team won`;
    const ownTeam = state.local ? "bottom" : state.team;
    const won = snapshot.winner === ownTeam;
    if (snapshot.mode === "2v2") return `Your team ${won ? "won" : "lost"}`;
    return `You ${won ? "won" : "lost"}`;
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  function toViewY(y, snapshot = state.lastNetState) {
    return orientYForPlayer(y, snapshot, state);
  }

  function drawStagingLobby(view, fg, mid) {
    const roster = state.roster.length ? state.roster : view.players;
    ctx.fillStyle = mid;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "14px Consolas, monospace";
    ctx.fillText("top team", W / 2, 64);
    ctx.fillText("bottom team", W / 2, H - 64);

    for (const rect of stagingSlots()) {
      const occupant = roster.find((player) => player.slot === rect.slot);
      const isOwn = occupant?.id === state.clientId || state.slot === rect.slot;
      const color = occupant ? (rect.team === "top" ? mid : fg) : "#444";
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2, color);
      ctx.fillStyle = occupant ? (document.body.classList.contains("invert") ? "#fff" : "#000") : mid;
      ctx.font = "16px Consolas, monospace";
      const label = occupant ? occupant.name : rect.label;
      ctx.fillText(label.slice(0, 16), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
      if (isOwn) {
        ctx.strokeStyle = fg;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x - 5, rect.y - 5, rect.w + 10, rect.h + 10);
      }
    }

    const filled = roster.filter((player) => player.slot >= 0).length;
    ctx.fillStyle = mid;
    ctx.font = "20px Consolas, monospace";
    ctx.fillText(`${filled}/4 ready`, W / 2, H / 2 + 54);
    if (state.draggingSlot) {
      ctx.fillStyle = fg;
      ctx.fillText((dom.nameInput.value.trim() || "you").slice(0, 16), W / 2, H / 2 + 86);
    }
  }

  function drawPaddleName(player, x, y, width, inverted) {
    const handle = String(player.name || nameForSlot(player.slot) || "").slice(0, 16);
    const visibleHandle = usesMobileVisuals() && handle.length > 8 ? `${handle.slice(0, 7)}..` : handle;
    const name = `${visibleHandle} [${Math.max(0, Number(player.score) || 0)}]`;
    if (!name) return;
    const minFont = usesMobileVisuals() ? cssPxToCourt(9) : 10;
    const maxFont = usesMobileVisuals() ? cssPxToCourt(12) : 16;
    ctx.save();
    ctx.fillStyle = inverted ? "#fff" : "#000";
    ctx.font = `${Math.max(minFont, Math.min(maxFont, width / Math.max(4, name.length * 0.8)))}px Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x, y + 1, Math.max(32, width - 14));
    ctx.restore();
  }

  function maybeThunder(elapsed) {
    const triggerSeconds = Number(config.colorInvertAtSeconds) || 100;
    if (elapsed < triggerSeconds || state.thunderDone) return;
    state.thunderDone = true;
    clearThunder();
    document.body.classList.add("invert", "shake");
    playRumble();
    if ("vibrate" in navigator) navigator.vibrate([90, 40, 140, 40, 220]);
    thunderTimer = window.setTimeout(clearThunder, Number(config.colorInvertDurationMs) || 3000);
  }

  function clearThunder() {
    if (thunderTimer) window.clearTimeout(thunderTimer);
    thunderTimer = 0;
    lastImpactToken = "";
    impactEvents.clear();
    ballImpactEvents.clear();
    ballBumpStates.clear();
    cancelRumble();
    if ("vibrate" in navigator) navigator.vibrate(0);
    document.body.classList.remove("invert", "shake");
  }

  return { clearThunder, clientToCourt, draw, interpolatedNetState: trajectory.interpolatedNetState, toViewY };
}

export function stagingSlots() {
  const w = 156;
  const h = 20;
  const left = W * 0.28 - w / 2;
  const right = W * 0.72 - w / 2;
  const top = 28 - h / 2;
  const bottom = H - 28 - h / 2;
  return [
    { slot: 0, x: left, y: bottom, w, h, team: "bottom", label: "bottom 1" },
    { slot: 1, x: right, y: bottom, w, h, team: "bottom", label: "bottom 2" },
    { slot: 2, x: left, y: top, w, h, team: "top", label: "top 1" },
    { slot: 3, x: right, y: top, w, h, team: "top", label: "top 2" }
  ];
}

export function roundRect(context, x, y, w, h, r, color) {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.fill();
}
