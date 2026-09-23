import { describe, expect, it } from "vitest";
import { ReplayRecorder } from "../../client/src/replay/replay-recorder.js";
import { ReplayPlayer } from "../../client/src/replay/replay-player.js";

describe("ReplayRecorder & ReplayPlayer", () => {
  it("records match frames and tracks peak speed and skill shots", () => {
    const recorder = new ReplayRecorder();
    recorder.start({
      mode: "1v1",
      missLimit: 5,
      players: [
        { name: "Player 1", team: "bottom" },
        { name: "AI", team: "top" }
      ]
    });

    // Record snapshot 1
    recorder.recordFrame({
      elapsed: 0.1,
      balls: [{ id: 1, x: 500, y: 340, vx: 200, vy: -400, curve: 0 }],
      players: [{ slot: 0, x: 500, w: 140, vx: 0, score: 0 }],
      misses: { top: 0, bottom: 0 },
      status: "running"
    });

    // Fast sub-interval snapshot (should be throttled)
    recorder.recordFrame({
      elapsed: 0.12,
      balls: [{ id: 1, x: 502, y: 335, vx: 200, vy: -400, curve: 0 }],
      players: [{ slot: 0, x: 500, w: 140, vx: 0, score: 0 }],
      misses: { top: 0, bottom: 0 },
      status: "running"
    });

    // Snapshot with high ball speed and smash skill shot
    recorder.recordFrame({
      elapsed: 0.2,
      balls: [{ id: 1, x: 520, y: 280, vx: 600, vy: -700, curve: 150 }],
      players: [{ slot: 0, x: 510, w: 140, vx: 50, score: 1 }],
      misses: { top: 0, bottom: 0 },
      lastHit: { x: 510, y: 650, team: "bottom", at: 0.2, skillShot: "smash", boost: true },
      status: "running"
    });

    // Finalize recording
    const replay = recorder.finalize({ winner: "bottom", elapsed: 0.25 });

    expect(replay).toBeDefined();
    expect(replay.mode).toBe("1v1");
    expect(replay.winner).toBe("bottom");
    expect(replay.stats.peakSpeed).toBeGreaterThan(900); // sqrt(600^2 + 700^2) = 921
    expect(replay.stats.skillShots.smash).toBe(1);
    expect(replay.frames.length).toBe(2); // 1st frame + 3rd frame (2nd frame throttled)
  });

  it("plays back frames with smooth interpolation, speed control, and scrubbing", () => {
    const player = new ReplayPlayer();
    const mockReplay = {
      version: "1.10.0",
      id: "rly_test_123",
      mode: "1v1",
      missLimit: 5,
      duration: 1.0,
      winner: "bottom",
      players: [
        { name: "Player 1", team: "bottom" },
        { name: "Player 2", team: "top" }
      ],
      frames: [
        {
          t: 0.0,
          balls: [{ id: 1, x: 400, y: 300, vx: 0, vy: 100, curve: 0 }],
          players: [{ slot: 0, x: 400, w: 140, vx: 0, score: 0 }],
          misses: { top: 0, bottom: 0 }
        },
        {
          t: 1.0,
          balls: [{ id: 1, x: 600, y: 500, vx: 0, vy: 100, curve: 0 }],
          players: [{ slot: 0, x: 500, w: 140, vx: 0, score: 0 }],
          misses: { top: 0, bottom: 0 }
        }
      ]
    };

    player.load(mockReplay);
    expect(player.status).toBe("playing");
    expect(player.currentTime).toBe(0);

    // Initial snapshot at t = 0
    let snap = player.getSnapshot();
    expect(snap.balls[0].x).toBe(400);
    expect(snap.players[0].x).toBe(400);

    // Advance by 0.5s (should interpolate halfway)
    player.update(0.5);
    expect(player.currentTime).toBe(0.5);

    snap = player.getSnapshot();
    expect(snap.balls[0].x).toBeCloseTo(500, 1);
    expect(snap.players[0].x).toBeCloseTo(450, 1);

    // Test speed control
    player.setSpeed(2.0);
    expect(player.speed).toBe(2.0);
    player.update(0.2); // 0.2 * 2.0 = 0.4s advanced => t = 0.9
    expect(player.currentTime).toBeCloseTo(0.9, 1);

    // Advance past duration => ends playback
    player.update(0.2);
    expect(player.status).toBe("ended");
    expect(player.currentTime).toBe(1.0);

    // Seek test
    player.seek(0.25);
    expect(player.currentTime).toBe(0.25);
    snap = player.getSnapshot();
    expect(snap.balls[0].x).toBeCloseTo(450, 1);
  });
});
