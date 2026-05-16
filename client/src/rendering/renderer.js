import { H, W, clamp, config } from "../core/shared.js";
export function createRenderer({ ctx, state, dom, playRumble, nameForSlot }) {
  let thunderTimer = 0;
  const ballTrails = [];
  const viewport = { dpr: 1, height: H, scale: 1, width: W, x: 0, y: 0 };
  let canvasPixelWidth = 0;
  let canvasPixelHeight = 0;
  let layoutSignature = "";

  function draw(s) {
    if (!ctx) {
      dom.statusEl.textContent = "canvas is not available in this browser";
      return;
    }
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
      ctx.restore();
      return;
    }

    const view = viewState(s);
    updateBallTrails(view.balls || []);
    dom.replayBtn.hidden = !(view.status === "ended" && (state.local || (state.online && state.role === "player")));
    dom.fillAiBtn.hidden = !(state.online && state.role === "player" && view.mode === "2v2" && view.status === "waiting");
    maybeThunder(view.elapsed);
    dom.timerEl.textContent = String(Math.floor(view.elapsed)).padStart(3, "0");
    dom.missesEl.textContent = `${view.misses.top}:${view.misses.bottom} / ${view.missLimit}`;
    if (view.status === "ended") dom.statusEl.textContent = winText(s);
    else if (view.status === "waiting" && view.mode === "2v2") dom.statusEl.textContent = "choose a top or bottom team slot";
    else if (view.lastPower) dom.statusEl.textContent = `${view.lastPower.player || view.lastPower.team} took ${view.lastPower.type}`;
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
      const y = p.team === "top" ? 28 : H - 28;
      const paddleH = visualPaddleHeight();
      const shade = view.mode === "2v2" && p.slot % 2 === 1 ? mid : fg;
      const jiggle = p.laser ? Math.sin(performance.now() / 55 + p.slot) * 4 : 0;
      const hitPulse = impactPulse(view.lastHit, p, y);
      const squash = hitPulse ? 6 : 0;
      roundRect(
        ctx,
        p.x - p.w / 2 - jiggle / 2 - squash,
        y - paddleH / 2 - jiggle / 2 + squash / 3,
        p.w + jiggle + squash * 2,
        paddleH + jiggle - squash / 1.5,
        Math.min(paddleH / 2, 9 + jiggle / 2),
        shade
      );
      if (hitPulse) {
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

    drawBallTrails(fg, inverted);
    for (const b of view.balls) {
      const r = visualBallRadius(b.r);
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * (b.bump ? 1.35 : 1), 0, Math.PI * 2);
      ctx.fill();
      if (b.bump) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = fg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 2.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    if (view.countdown) {
      ctx.fillStyle = fg;
      ctx.font = "96px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(view.countdown), W / 2, H / 2);
    }

    for (let i = state.effects.length - 1; i >= 0; i -= 1) {
      const effect = state.effects[i];
      effect.life -= 1;
      ctx.globalAlpha = Math.max(0, effect.life / effect.max);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.r + (effect.max - effect.life) * 3, 0, Math.PI * 2);
      ctx.stroke();
      drawSpark(effect);
      ctx.globalAlpha = 1;
      if (effect.life <= 0) state.effects.splice(i, 1);
    }

    ctx.restore();
  }

  function prepareCanvas(inverted) {
    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));

    if (pixelWidth !== canvasPixelWidth || pixelHeight !== canvasPixelHeight) {
      canvasPixelWidth = pixelWidth;
      canvasPixelHeight = pixelHeight;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.imageSmoothingEnabled = false;
    }

    computeViewport(pixelWidth, pixelHeight, dpr);
    syncCourtLayout(pixelWidth, pixelHeight, dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.fillStyle = inverted ? "#fff" : "#000";
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    drawOuterField(pixelWidth, pixelHeight, inverted);

    if (window.__MONORALLY_DEBUG__) {
      window.__MONORALLY_VIEWPORT__ = {
        dpr,
        height: viewport.height / dpr,
        scale: viewport.scale / dpr,
        width: viewport.width / dpr,
        x: viewport.x / dpr,
        y: viewport.y / dpr
      };
    }
  }

  function computeViewport(pixelWidth, pixelHeight, dpr) {
    const courtRatio = W / H;
    const screenRatio = pixelWidth / pixelHeight;
    const portrait = screenRatio < 0.85;
    let width;
    let height;

    if (portrait) {
      width = pixelWidth;
      height = width / courtRatio;
    } else if (screenRatio > courtRatio) {
      height = pixelHeight;
      width = height * courtRatio;
    } else {
      width = pixelWidth;
      height = width / courtRatio;
    }

    viewport.dpr = dpr;
    viewport.width = width;
    viewport.height = height;
    viewport.scale = width / W;
    viewport.x = (pixelWidth - width) / 2;
    viewport.y = (pixelHeight - height) / 2;
  }

  function drawOuterField(pixelWidth, pixelHeight, inverted) {
    const gutter = inverted ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.12)";
    ctx.save();
    ctx.strokeStyle = gutter;
    ctx.lineWidth = Math.max(1, viewport.dpr);
    ctx.strokeRect(viewport.x + ctx.lineWidth / 2, viewport.y + ctx.lineWidth / 2, viewport.width - ctx.lineWidth, viewport.height - ctx.lineWidth);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(viewport.x, viewport.y + viewport.height / 2);
    ctx.lineTo(viewport.x + viewport.width, viewport.y + viewport.height / 2);
    ctx.stroke();
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

  function syncCourtLayout(pixelWidth, pixelHeight, dpr) {
    const css = {
      bottom: (viewport.y + viewport.height) / dpr,
      height: viewport.height / dpr,
      left: viewport.x / dpr,
      right: (viewport.x + viewport.width) / dpr,
      top: viewport.y / dpr,
      width: viewport.width / dpr
    };
    const heightFit = Math.abs(viewport.height - pixelHeight) <= dpr;
    const widthFit = Math.abs(viewport.width - pixelWidth) <= dpr;
    const sideRail = heightFit && css.left >= 104;
    const signature = [
      Math.round(css.left),
      Math.round(css.top),
      Math.round(css.width),
      Math.round(css.height),
      heightFit ? "h" : "",
      widthFit ? "w" : "",
      sideRail ? "s" : ""
    ].join(":");
    if (signature === layoutSignature) return;
    layoutSignature = signature;
    const style = document.documentElement.style;
    style.setProperty("--court-left", `${css.left}px`);
    style.setProperty("--court-right", `${css.right}px`);
    style.setProperty("--court-top", `${css.top}px`);
    style.setProperty("--court-bottom", `${css.bottom}px`);
    style.setProperty("--court-width", `${css.width}px`);
    style.setProperty("--court-height", `${css.height}px`);
    document.body.classList.toggle("court-height-fit", heightFit);
    document.body.classList.toggle("court-width-fit", widthFit);
    document.body.classList.toggle("court-side-rail", sideRail);
  }

  function updateBallTrails(balls) {
    ballTrails.length = balls.length;
    balls.forEach((ball, index) => {
      const trail = ballTrails[index] || [];
      trail.push({ x: ball.x, y: ball.y, r: ball.r });
      if (trail.length > 9) trail.splice(0, trail.length - 9);
      ballTrails[index] = trail;
    });
  }

  function drawBallTrails(fg, inverted) {
    ctx.save();
    ctx.fillStyle = fg;
    for (const trail of ballTrails) {
      if (!trail) continue;
      trail.forEach((point, index) => {
        const alpha = (index + 1) / trail.length;
        const r = visualBallRadius(point.r);
        ctx.globalAlpha = (inverted ? 0.1 : 0.16) * alpha;
        ctx.beginPath();
        ctx.arc(point.x, point.y, r * (0.45 + alpha * 0.35), 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawSpark(effect) {
    const alpha = Math.max(0, effect.life / effect.max);
    const radius = effect.r + (effect.max - effect.life) * 2.2;
    const spin = effect.spin || 0;
    ctx.save();
    ctx.translate(effect.x, effect.y);
    ctx.rotate(spin + (1 - alpha) * 0.9);
    for (let i = 0; i < 4; i += 1) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(radius * 0.35, 0);
      ctx.lineTo(radius * 0.9, 0);
      ctx.stroke();
    }
    ctx.restore();
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

  function impactPulse(lastHit, player, y) {
    if (!lastHit) return false;
    return Math.abs(lastHit.y - y) < 34 && Math.abs(lastHit.x - player.x) < player.w / 2 + 34;
  }

  function shouldReplaceStaleStatus(text) {
    return /waiting for players|choose a top|filling empty seats|rejoined match/i.test(String(text || ""));
  }

  function runningStatusText(view) {
    if (state.role === "spectator") return "spectating";
    return `${view.mode} rally / ${view.missLimit} misses loses`;
  }

  function cssPxToCourt(px) {
    return (px * viewport.dpr) / Math.max(viewport.scale, 1);
  }

  function usesMobileVisuals() {
    return window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  }

  function visualBallRadius(radius) {
    return usesMobileVisuals() ? Math.max(radius, cssPxToCourt(5.5)) : radius;
  }

  function visualPaddleHeight() {
    return usesMobileVisuals() ? Math.max(18, cssPxToCourt(13)) : 18;
  }

  function visualPowerRadius(radius) {
    return usesMobileVisuals() ? Math.max(radius, cssPxToCourt(12)) : radius;
  }

  function interpolatedNetState() {
    if (!state.netBuffer.length) return state.lastNetState;
    const target = performance.now() - state.renderDelay;
    let older = state.netBuffer[0];
    let newer = state.netBuffer[state.netBuffer.length - 1];

    for (let i = 0; i < state.netBuffer.length - 1; i += 1) {
      if (state.netBuffer[i].receivedAt <= target && state.netBuffer[i + 1].receivedAt >= target) {
        older = state.netBuffer[i];
        newer = state.netBuffer[i + 1];
        break;
      }
    }

    if (target <= state.netBuffer[0].receivedAt) return predictOwnPaddle(state.netBuffer[0].snapshot);
    if (target >= state.netBuffer[state.netBuffer.length - 1].receivedAt) {
      return predictOwnPaddle(state.netBuffer[state.netBuffer.length - 1].snapshot);
    }

    const span = Math.max(1, newer.receivedAt - older.receivedAt);
    return predictOwnPaddle(interpolateSnapshot(older.snapshot, newer.snapshot, (target - older.receivedAt) / span));
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
        return ap ? { ...bp, x: mix(ap.x, bp.x), w: mix(ap.w, bp.w) } : { ...bp };
      }),
      balls: b.balls.map((bb, index) => {
        const ab = a.balls[index];
        return ab ? { ...bb, x: mix(ab.x, bb.x), y: mix(ab.y, bb.y), r: mix(ab.r, bb.r) } : { ...bb };
      }),
      power:
        a.power && b.power && a.power.type === b.power.type
          ? { ...b.power, x: mix(a.power.x, b.power.x), y: mix(a.power.y, b.power.y) }
          : b.power
    };
  }

  function predictOwnPaddle(snapshot) {
    if (!snapshot || state.role !== "player") return snapshot;
    return {
      ...snapshot,
      players: snapshot.players.map((player) => {
        if (player.slot !== state.slot) return player;
        const targetX = clamp(state.inputX * W, player.w / 2 + 4, W - player.w / 2 - 4);
        return { ...player, x: player.x + (targetX - player.x) * 0.9 };
      })
    };
  }

  function viewState(snapshot) {
    if (!snapshot || !shouldFlipView()) return snapshot;
    return {
      ...snapshot,
      misses: {
        top: snapshot.misses.bottom,
        bottom: snapshot.misses.top
      },
      winner: flipTeam(snapshot.winner),
      players: snapshot.players.map((player) => ({ ...player, team: flipTeam(player.team) })),
      balls: snapshot.balls.map((ball) => ({ ...ball, y: H - ball.y })),
      power: snapshot.power ? { ...snapshot.power, y: H - snapshot.power.y } : null,
      lastHit: snapshot.lastHit ? { ...snapshot.lastHit, y: H - snapshot.lastHit.y } : null,
      lastPower: snapshot.lastPower ? { ...snapshot.lastPower, team: flipTeam(snapshot.lastPower.team) } : snapshot.lastPower
    };
  }

  function winText(snapshot) {
    if (!snapshot.winner) return "nobody wins / leave to menu";
    if (state.role === "spectator") return `${viewState(snapshot).winner} wins / leave to menu`;
    const ownTeam = state.local ? "bottom" : state.team;
    const won = snapshot.winner === ownTeam;
    if (snapshot.mode === "2v2") return `your team ${won ? "won" : "lost"} / leave to menu`;
    return `you ${won ? "won" : "lost"} / leave to menu`;
  }

  function shouldFlipView() {
    return state.online && state.role === "player" && state.team === "top";
  }

  function toViewY(y) {
    return shouldFlipView() ? H - y : y;
  }

  function clientToCourt(clientX, clientY) {
    const rect = ctx.canvas.getBoundingClientRect();
    const dpr = viewport.dpr || window.devicePixelRatio || 1;
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;
    return {
      x: clamp((x - viewport.x) / viewport.scale, 0, W),
      y: clamp((y - viewport.y) / viewport.scale, 0, H)
    };
  }

  function flipTeam(team) {
    if (team === "top") return "bottom";
    if (team === "bottom") return "top";
    return team;
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
    const name = String(player.name || nameForSlot(player.slot) || "").slice(0, 16);
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
    if (thunderTimer) {
      window.clearTimeout(thunderTimer);
      thunderTimer = 0;
    }
    document.body.classList.remove("invert", "shake");
  }

  return { clearThunder, clientToCourt, draw, interpolatedNetState, toViewY };
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
