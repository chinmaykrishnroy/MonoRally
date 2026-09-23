/**
 * MonoRally Replay Recorder
 * Compact deterministic recording of match keyframes at ~15-20 Hz.
 */

import { config } from "../core/shared.js";

export class ReplayRecorder {
  constructor() {
    this.active = false;
    this.replay = null;
    this.lastFrameAt = -1;
    this.recordIntervalSec = 0.066; // ~15 Hz sampling for compact storage
    this.peakSpeed = 0;
    this.totalReturns = 0;
    this.skillShots = { smash: 0, curve: 0, counter: 0, drive: 0 };
  }

  /**
   * Starts a new recording session with match configuration.
   */
  start({ mode = "1v1", missLimit = 5, players = [] } = {}) {
    this.active = true;
    this.lastFrameAt = -1;
    this.peakSpeed = 0;
    this.totalReturns = 0;
    this.skillShots = { smash: 0, curve: 0, counter: 0, drive: 0 };

    this.replay = {
      version: config.appVersion || "1.12.1",
      id: `rly_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      mode,
      missLimit,
      startedAt: new Date().toISOString(),
      endedAt: null,
      duration: 0,
      winner: null,
      players: players.map((p, idx) => ({
        id: p.id || `p_${idx}`,
        name: p.name || `Player ${idx + 1}`,
        team: p.team || (idx % 2 === 0 ? "bottom" : "top"),
        rankTier: p.rankTier || "SILVER",
        elo: p.elo || 1200
      })),
      stats: {
        peakSpeed: 0,
        totalReturns: 0,
        skillShots: { smash: 0, curve: 0, counter: 0, drive: 0 }
      },
      frames: []
    };
  }

  /**
   * Records a snapshot if active and enough time has elapsed.
   */
  recordFrame(snapshot) {
    if (!this.active || !this.replay || !snapshot) return;

    const t = Number(snapshot.elapsed || 0);

    // Track statistics across frames
    if (Array.isArray(snapshot.balls)) {
      for (const b of snapshot.balls) {
        const speed = Math.hypot(b.vx || 0, b.vy || 0);
        if (speed > this.peakSpeed) this.peakSpeed = Math.round(speed);
      }
    }

    if (snapshot.lastHit && snapshot.lastHit.skillShot) {
      const type = snapshot.lastHit.skillShot;
      if (this.skillShots[type] !== undefined) {
        // Only increment if this is a newly arrived hit
        if (!this._lastRecordedHitAt || Math.abs(snapshot.lastHit.at - this._lastRecordedHitAt) > 0.1) {
          this.skillShots[type] += 1;
          this.totalReturns += 1;
          this._lastRecordedHitAt = snapshot.lastHit.at;
        }
      }
    }

    // Rate-limit frame storage unless it's a significant event (hit or game ended)
    const isSpecialEvent = snapshot.status === "ended" || Boolean(snapshot.lastHit && snapshot.lastHit.at === t);
    if (!isSpecialEvent && this.lastFrameAt >= 0 && t - this.lastFrameAt < this.recordIntervalSec) {
      return;
    }

    this.lastFrameAt = t;

    // Compact frame structure
    const frame = {
      t: Math.round(t * 1000) / 1000,
      balls: Array.isArray(snapshot.balls)
        ? snapshot.balls.map((b) => ({
            id: b.id,
            x: Math.round(b.x * 10) / 10,
            y: Math.round(b.y * 10) / 10,
            vx: Math.round(b.vx),
            vy: Math.round(b.vy),
            curve: Math.round((b.curve || 0) * 10) / 10,
            bump: Boolean(b.bump)
          }))
        : [],
      players: Array.isArray(snapshot.players)
        ? snapshot.players.map((p) => ({
            slot: p.slot,
            x: Math.round(p.x * 10) / 10,
            w: Math.round(p.w),
            vx: Math.round(p.vx || 0),
            score: p.score || 0,
            laser: Boolean(p.laser),
            emp: Boolean(p.emp)
          }))
        : [],
      misses: {
        top: snapshot.misses?.top || 0,
        bottom: snapshot.misses?.bottom || 0
      },
      lastHit: snapshot.lastHit
        ? {
            x: Math.round(snapshot.lastHit.x),
            y: Math.round(snapshot.lastHit.y),
            team: snapshot.lastHit.team,
            at: snapshot.lastHit.at,
            skillShot: snapshot.lastHit.skillShot,
            boost: Boolean(snapshot.lastHit.boost)
          }
        : null,
      power: snapshot.power
        ? {
            type: snapshot.power.type,
            x: Math.round(snapshot.power.x),
            y: Math.round(snapshot.power.y),
            r: snapshot.power.r
          }
        : null,
      countdown: snapshot.countdown || 0,
      status: snapshot.status
    };

    this.replay.frames.push(frame);
  }

  /**
   * Finalizes the match recording with winner and duration.
   */
  finalize({ winner = null, elapsed = 0 } = {}) {
    if (!this.active || !this.replay) return null;

    this.replay.endedAt = new Date().toISOString();
    this.replay.duration = Math.round((elapsed || this.lastFrameAt || 0) * 10) / 10;
    this.replay.winner = winner;
    this.replay.stats = {
      peakSpeed: this.peakSpeed,
      totalReturns: this.totalReturns,
      skillShots: { ...this.skillShots }
    };

    const completed = this.replay;
    this.active = false;
    this.replay = null;
    return completed;
  }

  /**
   * Discards the active recording without saving.
   */
  cancel() {
    this.active = false;
    this.replay = null;
  }
}
