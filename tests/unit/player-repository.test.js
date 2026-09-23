import { describe, expect, test } from "vitest";
import { MemoryPlayerRepository } from "../../server/src/repositories/player-repository.js";
import { MemoryMatchRepository } from "../../server/src/repositories/match-repository.js";

describe("player repository and profile progression", () => {
  test("creates player with default Elo and combat stats", async () => {
    const repo = new MemoryPlayerRepository();
    const profile = await repo.getOrCreatePlayer({ id: "p1-uuid", handle: "rallymaster", displayName: "Rally Master" });

    expect(profile.id).toBe("p1-uuid");
    expect(profile.handle).toBe("rallymaster");
    expect(profile.displayName).toBe("Rally Master");
    expect(profile.eloRating).toBe(1200);
    expect(profile.peakRating).toBe(1200);
    expect(profile.matchesPlayed).toBe(0);
    expect(profile.wins).toBe(0);
    expect(profile.losses).toBe(0);
    expect(profile.currentStreak).toBe(0);
    expect(profile.bestStreak).toBe(0);
    expect(profile.winRate).toBe(0);
    expect(profile.rankTier.tier).toBe("Silver");
  });

  test("updates player combat stats on win and loss correctly", async () => {
    const repo = new MemoryPlayerRepository();
    const p = await repo.getOrCreatePlayer("challenger");

    // Win 1: +16 rating, peak speed 750, 2 smashes, 1 curve
    const win1 = await repo.updatePlayerStats(p.id, {
      won: true,
      ratingDelta: 16,
      peakSpeed: 750,
      skillShots: { smash: 2, curve: 1 }
    });

    expect(win1.matchesPlayed).toBe(1);
    expect(win1.wins).toBe(1);
    expect(win1.losses).toBe(0);
    expect(win1.currentStreak).toBe(1);
    expect(win1.bestStreak).toBe(1);
    expect(win1.eloRating).toBe(1216);
    expect(win1.peakRating).toBe(1216);
    expect(win1.peakSpeed).toBe(750);
    expect(win1.smashCount).toBe(2);
    expect(win1.curveCount).toBe(1);
    expect(win1.winRate).toBe(100);

    // Win 2: +15 rating, streak becomes 2
    const win2 = await repo.updatePlayerStats(p.id, {
      won: true,
      ratingDelta: 15,
      peakSpeed: 600,
      skillShots: { counter: 1, drive: 2 }
    });
    expect(win2.currentStreak).toBe(2);
    expect(win2.bestStreak).toBe(2);
    expect(win2.eloRating).toBe(1231);
    expect(win2.counterCount).toBe(1);
    expect(win2.driveCount).toBe(2);

    // Loss 1: -16 rating, streak resets to 0, best streak remains 2
    const loss1 = await repo.updatePlayerStats(p.id, {
      won: false,
      ratingDelta: -16,
      peakSpeed: 820
    });
    expect(loss1.matchesPlayed).toBe(3);
    expect(loss1.wins).toBe(2);
    expect(loss1.losses).toBe(1);
    expect(loss1.currentStreak).toBe(0);
    expect(loss1.bestStreak).toBe(2);
    expect(loss1.eloRating).toBe(1215);
    expect(loss1.peakSpeed).toBe(820);
    expect(loss1.winRate).toBe(67);
  });

  test("generates ranked leaderboard sorted by Elo rating", async () => {
    const repo = new MemoryPlayerRepository();
    const p1 = await repo.getOrCreatePlayer("player1");
    const p2 = await repo.getOrCreatePlayer("player2");
    const p3 = await repo.getOrCreatePlayer("player3");

    await repo.updatePlayerStats(p1.id, { won: true, ratingDelta: 40 });
    await repo.updatePlayerStats(p2.id, { won: true, ratingDelta: 120 });
    await repo.updatePlayerStats(p3.id, { won: false, ratingDelta: -20 });

    const board = await repo.getRankedLeaderboard(10);
    expect(board).toHaveLength(3);
    expect(board[0].handle).toBe("player2"); // 1320 Elo
    expect(board[1].handle).toBe("player1"); // 1240 Elo
    expect(board[2].handle).toBe("player3"); // 1180 Elo
  });

  test("records match ratings and fetches player match history", async () => {
    const matchRepo = new MemoryMatchRepository();
    const room = {
      code: "HIST01",
      mode: "1v1",
      status: "ended",
      winner: "bottom",
      startedAt: 1000,
      endedAt: 60000,
      misses: { top: 5, bottom: 2 },
      players: [
        { profileId: "user-alpha", name: "Alpha", team: "bottom", slot: 0, returns: 15, bot: false },
        { profileId: "user-beta", name: "Beta", team: "top", slot: 1, returns: 12, bot: false }
      ]
    };

    const eloResults = new Map([
      ["user-alpha", { ratingBefore: 1200, ratingAfter: 1216, delta: 16 }],
      ["user-beta", { ratingBefore: 1200, ratingAfter: 1184, delta: -16 }]
    ]);

    await matchRepo.recordMatch(room, eloResults);

    const historyAlpha = await matchRepo.getPlayerMatches("user-alpha", 5);
    expect(historyAlpha).toHaveLength(1);
    expect(historyAlpha[0]).toMatchObject({
      code: "HIST01",
      mode: "1v1",
      won: true,
      ratingBefore: 1200,
      ratingAfter: 1216,
      ratingDelta: 16,
      returns: 15
    });

    const historyBeta = await matchRepo.getPlayerMatches("user-beta", 5);
    expect(historyBeta).toHaveLength(1);
    expect(historyBeta[0]).toMatchObject({
      code: "HIST01",
      won: false,
      ratingDelta: -16
    });
  });
});
