import { H, W, clamp, config, rand, reflectX } from "../core/shared.js";

export class LocalGame {
  constructor({ getInputX, hitEffect, playMiss, playPower, playStrike, playWall }) {
    this.deps = { getInputX, hitEffect, playMiss, playPower, playStrike, playWall };
    this.mode = "1v1";
    this.missLimit = Number(config.missLimit1v1) || 5;
    this.elapsed = 0;
    this.status = "running";
    this.winner = null;
    this.misses = { top: 0, bottom: 0 };
    this.players = [
      { id: "human", name: "you", team: "bottom", x: W / 2, targetX: W / 2, w: 140, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 },
      { id: "ai", name: "ai", team: "top", x: W / 2, targetX: W / 2, w: 140, laserActiveUntil: 0, laserFadeUntil: 0, empActiveUntil: 0, empFadeUntil: 0 }
    ];
    this.balls = [];
    this.power = null;
    this.nextPowerAt = 8;
    this.lastPower = null;
    this.lastHit = null;
    this.countdownUntil = 0;
    this.serveTeam = "top";
    this.pendingCountdown = false;
    this.lastMissTeam = null;
    this.beginCountdown("top");
  }

  makeBall(direction = Math.random() > 0.5 ? 1 : -1, x = W / 2, y = H / 2) {
    return { x, y, r: 8, vx: rand(-160, 160), vy: direction * 430, speed: 430, lastTouch: null, bump: false };
  }

  makeServeBall(team) {
    const speed = 430 * this.speedMultiplier();
    const target = this.players.find((p) => p.team === team) || this.players[0];
    const x = W / 2;
    const y = H / 2;
    const targetY = team === "top" ? 28 : H - 28;
    const dx = target.x - x;
    const dy = targetY - y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x, y, r: 8, vx: (dx / mag) * speed, vy: (dy / mag) * speed, speed, lastTouch: null, bump: true };
  }

  update(dt) {
    if (this.status !== "running") return;
    this.elapsed += dt;
    this.players[0].targetX = this.deps.getInputX() * W;

    for (const p of this.players) {
      p.w = 140 + 140 * this.laserStrength(p);
      p.x += (p.targetX - p.x) * Math.min(1, dt * 18);
      p.x = clamp(p.x, p.w / 2 + 4, W - p.w / 2 - 4);
    }

    if (this.countdownUntil > this.elapsed) return;
    if (this.countdownUntil) {
      this.launchServe();
      this.countdownUntil = 0;
      return;
    }

    const leadBall = this.chooseAiBall();
    if (leadBall) {
      const aiTuning = aiProfile();
      const ai = this.players[1];
      const predictedX = this.predictBallXAtY(leadBall, 28);
      const missPressure = this.misses.top >= this.missLimit - 1 ? aiTuning.clutch : 1;
      const error = aiTuning.error * missPressure * Math.sin(this.elapsed * aiTuning.errorRate + leadBall.x * 0.01);
      ai.targetX += (predictedX + error - ai.targetX) * Math.min(1, dt * aiTuning.reaction);
      if (Math.random() < aiTuning.wobbleChance) ai.targetX += rand(-aiTuning.wobble, aiTuning.wobble);
    }

    if (!this.power && this.elapsed >= this.nextPowerAt) {
      this.power = { type: ["multi", "laser", "emp"][Math.floor(Math.random() * 3)], x: W / 2 + rand(-150, 150), y: H / 2 + rand(-70, 70), r: 18 };
    }

    const baseSpeed = 430 * this.speedMultiplier();
    for (const ball of [...this.balls]) {
      ball.prevX = ball.x;
      ball.prevY = ball.y;
      let desired = baseSpeed;
      desired *= 1 - 0.55 * this.empSlowStrength(ball);
      ball.speed += (desired - ball.speed) * Math.min(1, dt * 4.5);
      const mag = Math.hypot(ball.vx, ball.vy) || 1;
      ball.vx = (ball.vx / mag) * ball.speed;
      ball.vy = (ball.vy / mag) * ball.speed;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.bump = false;

      if (ball.x < ball.r || ball.x > W - ball.r) {
        ball.x = clamp(ball.x, ball.r, W - ball.r);
        ball.vx *= -1;
        ball.bump = true;
        this.deps.hitEffect(ball.x, ball.y);
        this.deps.playWall?.();
      }

      for (const player of this.players) this.collide(player, ball);
      this.powerHit(ball);
      if (ball.y < -ball.r) this.miss("top", ball);
      if (ball.y > H + ball.r) this.miss("bottom", ball);
    }
    this.balls = this.balls.filter((ball) => !ball.dead).slice(0, Number(config.maxBalls) || 10);
    if ((this.misses.top >= this.missLimit || this.misses.bottom >= this.missLimit) && this.misses.top !== this.misses.bottom) {
      this.status = "ended";
      this.winner = this.misses.top > this.misses.bottom ? "bottom" : "top";
    }
    if (this.status === "running" && this.pendingCountdown && this.balls.length === 0) {
      this.beginCountdown(this.lastMissTeam || "top");
      this.pendingCountdown = false;
      this.lastMissTeam = null;
    }
  }

  collide(player, ball) {
    const y = player.team === "top" ? 28 : H - 28;
    const toward = player.team === "top" ? ball.vy < 0 : ball.vy > 0;
    if (!toward) return;
    const oldX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
    const oldY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
    const nearNow = Math.abs(ball.y - y) <= ball.r + 12;
    const denom = ball.y - oldY;
    const t = Math.abs(denom) > 0.001 ? (y - oldY) / denom : 1;
    const crossed = t >= -0.08 && t <= 1.08;
    const hitX = crossed ? oldX + (ball.x - oldX) * clamp(t, 0, 1) : ball.x;
    const center = this.paddleCollisionCenter(player, hitX);
    if (!nearNow && !crossed) return;
    if (hitX < center - player.w / 2 - ball.r - 16 || hitX > center + player.w / 2 + ball.r + 16) return;

    if (player.id === "human") player.x = center;
    ball.x = hitX;
    const offset = clamp((hitX - center) / (player.w / 2), -1, 1);
    ball.vx += offset * 260;
    ball.vy = Math.abs(ball.vy) * (player.team === "top" ? 1 : -1);
    ball.y = y + (player.team === "top" ? ball.r + 11 : -ball.r - 11);
    ball.lastTouch = player.id;
    ball.bump = true;
    this.lastHit = { x: ball.x, y, at: this.elapsed };
    this.deps.hitEffect(ball.x, ball.y);
    this.deps.playStrike(Math.abs(offset));
  }

  paddleCollisionCenter(player, hitX) {
    const current = clamp(player.x, player.w / 2 + 4, W - player.w / 2 - 4);
    if (player.id !== "human" || !Number.isFinite(player.targetX)) return current;
    const target = clamp(player.targetX, player.w / 2 + 4, W - player.w / 2 - 4);
    const assisted = current + clamp(target - current, -120, 120);
    return clamp(hitX, Math.min(current, assisted), Math.max(current, assisted));
  }

  chooseAiBall() {
    let best = null;
    let bestTime = Infinity;
    for (const ball of this.balls) {
      if (ball.dead || ball.vy >= 0) continue;
      const timeToPaddle = Math.max(0, (ball.y - 28) / Math.abs(ball.vy || 1));
      if (timeToPaddle < bestTime) {
        best = ball;
        bestTime = timeToPaddle;
      }
    }
    return best || this.balls.find((ball) => !ball.dead) || null;
  }

  predictBallXAtY(ball, targetY) {
    if (!ball || Math.abs(ball.vy) < 0.001) return ball?.x ?? W / 2;
    const time = (targetY - ball.y) / ball.vy;
    if (time <= 0) return ball.x;
    return reflectX(ball.x + ball.vx * time, ball.r);
  }

  powerHit(ball) {
    if (!this.power || Math.hypot(ball.x - this.power.x, ball.y - this.power.y) > ball.r + this.power.r) return;
    const player = this.players.find((p) => p.id === ball.lastTouch);
    if (player) {
      if (this.power.type === "multi") {
        const targetBallCount = Number(config.multiballTotal1v1) || 2;
        const extraBalls = Math.max(0, targetBallCount - this.balls.filter((activeBall) => !activeBall.dead).length);
        for (let i = 0; i < extraBalls; i += 1) this.balls.push(this.makeBall(player.team === "top" ? 1 : -1, ball.x, ball.y));
      }
      if (this.power.type === "laser") {
        player.laserActiveUntil = this.elapsed + powerupEffectSeconds();
        player.laserFadeUntil = player.laserActiveUntil + powerupEffectSeconds();
      }
      if (this.power.type === "emp") {
        player.empActiveUntil = this.elapsed + powerupEffectSeconds();
        player.empFadeUntil = player.empActiveUntil + powerupEffectSeconds();
      }
      this.lastPower = { type: this.power.type, player: player.name, at: this.elapsed };
      this.deps.playPower();
    }
    this.power = null;
    this.nextPowerAt = this.elapsed + rand(10, 18);
  }

  miss(team, ball) {
    this.misses[team] += 1;
    ball.dead = true;
    this.lastMissTeam = team;
    this.pendingCountdown = true;
    this.deps.playMiss();
  }

  beginCountdown(team) {
    this.serveTeam = team;
    this.balls = [];
    this.countdownUntil = this.elapsed + 3 / this.speedMultiplier();
  }

  launchServe() {
    this.balls = [this.makeServeBall(this.serveTeam || "top")];
  }

  countdownValue() {
    if (!this.countdownUntil || this.countdownUntil <= this.elapsed) return 0;
    return clamp(Math.ceil((this.countdownUntil - this.elapsed) * this.speedMultiplier()), 1, 3);
  }

  speedMultiplier() {
    return Math.min(2.5, 1 + this.elapsed / 70);
  }

  laserStrength(player) {
    if (player.laserActiveUntil > this.elapsed) return 1;
    if (player.laserFadeUntil > this.elapsed) return (player.laserFadeUntil - this.elapsed) / powerupEffectSeconds();
    return 0;
  }

  empStrength(player) {
    if (player.empActiveUntil > this.elapsed) return 1;
    if (player.empFadeUntil > this.elapsed) return (player.empFadeUntil - this.elapsed) / powerupEffectSeconds();
    return 0;
  }

  empSlowStrength(ball) {
    let strongest = 0;
    for (const player of this.players) {
      const strength = this.empStrength(player);
      if (strength <= 0) continue;
      const y = player.team === "top" ? 95 : H - 95;
      if (Math.hypot(ball.x - player.x, ball.y - y) < 260) strongest = Math.max(strongest, strength);
    }
    return strongest;
  }

  snapshot() {
    return {
      mode: this.mode,
      status: this.status,
      elapsed: this.elapsed,
      missLimit: this.missLimit,
      misses: this.misses,
      winner: this.winner,
      players: this.players.map((p, slot) => ({ id: p.id, name: p.name, team: p.team, slot, x: p.x, w: p.w, laser: this.laserStrength(p) > 0, emp: this.empStrength(p) > 0 })),
      balls: this.balls.map((b) => ({ x: b.x, y: b.y, r: b.r, bump: b.bump })),
      power: this.power,
      lastHit: this.lastHit && this.elapsed - this.lastHit.at < 0.16 ? this.lastHit : null,
      lastPower: this.lastPower && this.elapsed - this.lastPower.at < 1.8 ? this.lastPower : null,
      countdown: this.countdownValue(),
      spectators: 0
    };
  }
}

function aiProfile() {
  if (config.aiDifficulty === "easy") return { reaction: 3.2, wobbleChance: 0.035, wobble: 190, error: 135, errorRate: 1.4, clutch: 0.8 };
  if (config.aiDifficulty === "medium") return { reaction: 5.2, wobbleChance: 0.014, wobble: 90, error: 62, errorRate: 1.9, clutch: 0.55 };
  if (config.aiDifficulty === "insane") return { reaction: 22, wobbleChance: 0, wobble: 0, error: 2, errorRate: 0.4, clutch: 0 };
  return { reaction: 10.5, wobbleChance: 0.003, wobble: 22, error: 24, errorRate: 2.2, clutch: 0.25 };
}

function powerupEffectSeconds() {
  return (Number(config.powerupEffectMs) || 5000) / 1000;
}
