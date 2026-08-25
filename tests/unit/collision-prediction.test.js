import { describe, expect, test } from "vitest";
import { H } from "../../client/src/core/shared.js";
import { projectBallWithCollisions } from "../../client/src/rendering/collision-prediction.js";

const bottom = (overrides = {}) => ({ team: "bottom", slot: 0, x: 500, w: 140, vx: 0, ...overrides });

describe("client collision prediction", () => {
  test("keeps an extrapolated strike in front of the bottom paddle", () => {
    const ball = { id: 1, x: 500, y: 610, r: 6, vx: 0, vy: 900, curve: 0 };

    const projected = projectBallWithCollisions(ball, 0.08, [bottom()]);

    expect(projected.vy).toBeLessThan(0);
    expect(projected.y).toBeLessThan(H - 28);
    expect(projected.predictedImpact).toBe(true);
  });

  test("predicts a fast strike at the forgiving paddle edge", () => {
    const ball = { id: 1, x: 610, y: 610, r: 6, vx: -2200, vy: 1800, curve: 0 };

    const projected = projectBallWithCollisions(ball, 0.06, [bottom()]);

    expect(projected.vy).toBeLessThan(0);
    expect(projected.predictedImpact).toBe(true);
  });

  test("does not invent a collision outside the paddle reach", () => {
    const ball = { id: 1, x: 850, y: 610, r: 6, vx: 0, vy: 900, curve: 0 };

    const projected = projectBallWithCollisions(ball, 0.08, [bottom()]);

    expect(projected.vy).toBeGreaterThan(0);
    expect(projected.y).toBeGreaterThan(H - 28);
  });
});
