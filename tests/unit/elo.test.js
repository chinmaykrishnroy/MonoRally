import { describe, expect, test } from "vitest";
import {
  DEFAULT_ELO,
  calculateEloDelta,
  calculateExpectedScore,
  calculateMatchElo,
  getRankTier
} from "../../server/src/elo.js";

describe("elo rating engine", () => {
  test("calculates expected score symmetrically", () => {
    // Equal ratings -> 50% probability
    expect(calculateExpectedScore(1200, 1200)).toBeCloseTo(0.5, 4);

    // Higher rated player has > 50% probability
    const higherExpected = calculateExpectedScore(1400, 1200);
    const lowerExpected = calculateExpectedScore(1200, 1400);
    expect(higherExpected).toBeGreaterThan(0.5);
    expect(lowerExpected).toBeLessThan(0.5);
    expect(higherExpected + lowerExpected).toBeCloseTo(1.0, 4);
  });

  test("calculates symmetrical Elo rating exchange on win and loss", () => {
    const winDelta = calculateEloDelta(1200, 1200, 1, 32);
    const lossDelta = calculateEloDelta(1200, 1200, 0, 32);

    expect(winDelta).toBe(16);
    expect(lossDelta).toBe(-16);
    expect(winDelta + lossDelta).toBe(0);
  });

  test("underdog victory grants larger rating reward than favorite victory", () => {
    const underdogWin = calculateEloDelta(1100, 1500, 1, 32);
    const favoriteWin = calculateEloDelta(1500, 1100, 1, 32);

    expect(underdogWin).toBeGreaterThan(favoriteWin);
    expect(underdogWin).toBeGreaterThan(25);
    expect(favoriteWin).toBeLessThan(10);
  });

  test("maps ratings to accurate rank tiers and progression thresholds", () => {
    expect(getRankTier(1050).tier).toBe("Bronze");
    expect(getRankTier(1200).tier).toBe("Silver");
    expect(getRankTier(1450).tier).toBe("Gold");
    expect(getRankTier(1680).tier).toBe("Platinum");
    expect(getRankTier(1900).tier).toBe("Diamond");
    expect(getRankTier(2150).tier).toBe("Master");

    const goldTier = getRankTier(1450);
    expect(goldTier.tier).toBe("Gold");
    expect(goldTier.nextTier).toBe("Platinum");
    expect(goldTier.nextThreshold).toBe(1600);
    expect(goldTier.progress).toBeGreaterThan(0);
    expect(goldTier.progress).toBeLessThan(100);
  });

  test("calculates match Elo deltas for 1v1 and 2v2 teams correctly", () => {
    const teamA = [{ id: "p1", elo: 1300 }];
    const teamB = [{ id: "p2", elo: 1300 }];

    const results = calculateMatchElo({ teamA, teamB, winnerTeam: "bottom" });
    expect(results.get("p1").delta).toBe(16);
    expect(results.get("p1").ratingAfter).toBe(1316);
    expect(results.get("p2").delta).toBe(-16);
    expect(results.get("p2").ratingAfter).toBe(1284);
  });
});
