/**
 * MonoRally Replay Player
 * Smooth 60+ FPS interpolated playback engine with scrubbing and variable speeds.
 */

export class ReplayPlayer {
  constructor() {
    this.replay = null;
    this.frames = [];
    this.duration = 0;
    this.currentTime = 0;
    this.speed = 1.0;
    this.status = "idle"; // "idle" | "playing" | "paused" | "ended"
    this.listeners = new Set();
  }

  /**
   * Loads a replay into the player.
   */
  load(replay) {
    if (!replay || !Array.isArray(replay.frames) || replay.frames.length === 0) {
      throw new Error("Invalid replay format or empty frames");
    }

    this.replay = replay;
    this.frames = [...replay.frames].sort((a, b) => a.t - b.t);
    this.duration = Number(replay.duration) || this.frames[this.frames.length - 1].t || 1;
    this.currentTime = 0;
    this.status = "playing";
    this.notify();
  }

  /**
   * Subscribe to playback timeline changes.
   */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    const data = {
      status: this.status,
      currentTime: this.currentTime,
      duration: this.duration,
      progress: this.duration > 0 ? Math.min(1, Math.max(0, this.currentTime / this.duration)) : 0,
      speed: this.speed,
      replay: this.replay
    };
    for (const fn of this.listeners) {
      try {
        fn(data);
      } catch {}
    }
  }

  play() {
    if (this.status === "ended") {
      this.currentTime = 0;
    }
    this.status = "playing";
    this.notify();
  }

  pause() {
    this.status = "paused";
    this.notify();
  }

  toggle() {
    if (this.status === "playing") {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(seconds) {
    this.currentTime = Math.max(0, Math.min(seconds, this.duration));
    if (this.status === "ended" && this.currentTime < this.duration) {
      this.status = "paused";
    }
    this.notify();
  }

  seekProgress(fraction) {
    this.seek(fraction * this.duration);
  }

  setSpeed(speed) {
    const valid = [0.5, 1.0, 2.0];
    if (valid.includes(speed)) {
      this.speed = speed;
      this.notify();
    }
  }

  /**
   * Advances the replay clock by dt seconds.
   */
  update(dt) {
    if (this.status !== "playing") return;

    this.currentTime += dt * this.speed;
    if (this.currentTime >= this.duration) {
      this.currentTime = this.duration;
      this.status = "ended";
    }
    this.notify();
  }

  /**
   * Generates a smoothly interpolated snapshot for renderer.draw(snapshot).
   */
  getSnapshot() {
    if (!this.replay || this.frames.length === 0) return null;

    const t = this.currentTime;
    let idxB = this.frames.findIndex((f) => f.t >= t);

    if (idxB === -1) {
      idxB = this.frames.length - 1;
    }

    const idxA = Math.max(0, idxB - 1);
    const frameA = this.frames[idxA];
    const frameB = this.frames[idxB];

    const span = Math.max(0.001, frameB.t - frameA.t);
    const frac = idxA === idxB ? 0 : Math.max(0, Math.min(1, (t - frameA.t) / span));

    // Interpolate players
    const players = (frameB.players || []).map((pB, i) => {
      const pA = frameA.players?.[i] || pB;
      const interpX = pA.x + frac * (pB.x - pA.x);
      const interpW = pA.w + frac * (pB.w - pA.w);
      const interpVx = pA.vx + frac * (pB.vx - pA.vx);
      return {
        id: this.replay.players?.[i]?.id || `p_${i}`,
        name: this.replay.players?.[i]?.name || (i === 0 ? "You" : "Opponent"),
        team: this.replay.players?.[i]?.team || (i === 0 ? "bottom" : "top"),
        slot: pB.slot ?? i,
        x: interpX,
        vx: interpVx,
        w: interpW,
        score: pB.score,
        laser: pB.laser,
        emp: pB.emp
      };
    });

    // Interpolate balls
    const balls = (frameB.balls || []).map((bB, i) => {
      const bA = frameA.balls?.[i] || bB;
      const interpX = bA.x + frac * (bB.x - bA.x);
      const interpY = bA.y + frac * (bB.y - bA.y);
      const interpVx = bA.vx + frac * (bB.vx - bA.vx);
      const interpVy = bA.vy + frac * (bB.vy - bA.vy);
      const interpCurve = (bA.curve || 0) + frac * ((bB.curve || 0) - (bA.curve || 0));

      return {
        id: bB.id || i + 1,
        x: interpX,
        y: interpY,
        vx: interpVx,
        vy: interpVy,
        r: 8,
        curve: interpCurve,
        bump: bB.bump,
        pending: false
      };
    });

    // Pick active hit or powerup closest to current frame
    const activeFrame = frac > 0.5 ? frameB : frameA;
    const lastHit = activeFrame.lastHit && Math.abs(t - activeFrame.lastHit.at) < 0.25 ? activeFrame.lastHit : null;

    return {
      mode: this.replay.mode,
      status: this.status === "ended" ? "ended" : activeFrame.status || "running",
      elapsed: t,
      missLimit: this.replay.missLimit || 5,
      misses: {
        top: activeFrame.misses?.top || 0,
        bottom: activeFrame.misses?.bottom || 0
      },
      winner: this.status === "ended" ? this.replay.winner : null,
      players,
      balls,
      power: activeFrame.power,
      lastHit,
      countdown: activeFrame.countdown || 0,
      spectators: 0,
      isReplay: true
    };
  }

  unload() {
    this.replay = null;
    this.frames = [];
    this.status = "idle";
    this.currentTime = 0;
    this.notify();
  }
}
