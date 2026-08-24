import { describe, expect, test } from "vitest";
import { inputSampleAt, projectInputSample, recordInputSample } from "../../server/src/input-timeline.js";

describe("timestamped paddle input", () => {
  test("selects the last sample that existed at collision time", () => {
    const player = {
      x: 100,
      targetX: 100,
      inputHistory: [
        { x: 100, rawX: 100, eventAt: 100, receivedAt: 130, sequence: 1, vx: 0 },
        { x: 400, rawX: 400, eventAt: 200, receivedAt: 240, sequence: 2, vx: 900 }
      ]
    };

    expect(inputSampleAt(player, 199).x).toBe(100);
    expect(inputSampleAt(player, 200).x).toBe(400);
  });

  test("limits an impossible position jump with acceleration and speed", () => {
    const player = {
      x: 100,
      targetX: 900,
      inputHistory: [{ x: 100, rawX: 100, eventAt: 0, receivedAt: 0, sequence: 0, vx: 0 }]
    };

    const sample = recordInputSample(
      player,
      { x: 900, eventAt: 16, receivedAt: 60, sequence: 1 },
      { acceleration: 30000, historyMs: 500, maxSpeed: 4200, now: 60 }
    );

    expect(sample.x).toBeLessThan(112);
    expect(sample.vx).toBeLessThanOrEqual(480);
    expect(sample.rawX).toBe(900);
  });

  test("projects a sample toward its raw target without overshooting", () => {
    const projected = projectInputSample({ x: 200, rawX: 260, eventAt: 100, vx: 600 }, 300, 4200, 30000);

    expect(projected.x).toBe(260);
  });
});
