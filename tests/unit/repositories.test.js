import { describe, expect, test, vi } from "vitest";
import { createLeaderboardRepository, MemoryLeaderboardRepository } from "../../server/src/repositories/leaderboard-repository.js";
import { createPlayerRepository, MemoryPlayerRepository } from "../../server/src/repositories/player-repository.js";
import { createMatchRepository, MemoryMatchRepository } from "../../server/src/repositories/match-repository.js";
import { createSessionStore } from "../../server/src/redis/session-store.js";
import { createPresenceStore } from "../../server/src/redis/presence-store.js";
import { createDistributedRateLimiter } from "../../server/src/redis/rate-limiter.js";
import { checkDatabaseHealth } from "../../server/src/db/pool.js";
import { checkRedisHealth } from "../../server/src/redis/client.js";

function endedRoomFixture(overrides = {}) {
  return {
    code: "ROOM01",
    mode: "1v1",
    status: "ended",
    winner: "bottom",
    startedAt: 1000,
    endedAt: 75000,
    misses: { top: 5, bottom: 2 },
    returns: { top: 0, bottom: 18 },
    leaderboardRecorded: false,
    players: [
      { name: "ace-rally", team: "bottom", slot: 0, returns: 18, bot: false },
      { name: "rival-paddle", team: "top", slot: 1, returns: 15, bot: false }
    ],
    ...overrides
  };
}

describe("Repository and Distributed Coordination Layer", () => {
  describe("LeaderboardRepository", () => {
    test("MemoryLeaderboardRepository records and orders top entries", async () => {
      const repo = new MemoryLeaderboardRepository();
      const room = endedRoomFixture();

      await repo.recordRoom(room);
      expect(room.leaderboardRecorded).toBe(true);

      const top1v1 = await repo.top("1v1", 10);
      expect(top1v1).toHaveLength(1);
      expect(top1v1[0]).toMatchObject({
        name: "ace-rally",
        score: 18,
        misses: 2,
        duration: 74,
        mode: "1v1"
      });
    });

    test("does not record zero score or bot-only wins", async () => {
      const repo = new MemoryLeaderboardRepository();
      const botRoom = endedRoomFixture({
        players: [{ name: "AI-1", team: "bottom", slot: 0, returns: 12, bot: true }]
      });

      await repo.recordRoom(botRoom);
      expect(await repo.top("1v1")).toEqual([]);
    });

    test("PostgresLeaderboardRepository queries pool and caches with Redis", async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ name: "pg-player", score: 25, misses: 1, duration: 60, mode: "1v1" }]
        })
      };
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1)
      };

      const repo = createLeaderboardRepository({ pool: mockPool, redis: mockRedis });
      const top = await repo.top("1v1", 5);

      expect(top).toEqual([
        { name: "pg-player", score: 25, misses: 1, duration: 60, mode: "1v1" }
      ]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT player_name AS name"),
        ["1v1", 5]
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        "leaderboard:1v1",
        expect.any(String),
        "EX",
        10
      );
    });
  });

  describe("PlayerRepository", () => {
    test("MemoryPlayerRepository creates and retrieves players by handle", async () => {
      const repo = new MemoryPlayerRepository();
      const created = await repo.getOrCreatePlayer("swift-orbit", "Swift Orbit");

      expect(created).toMatchObject({
        handle: "swift-orbit",
        display_name: "Swift Orbit"
      });

      const retrieved = await repo.getPlayer(created.id);
      expect(retrieved).toEqual(created);
    });

    test("updates player display name", async () => {
      const repo = new MemoryPlayerRepository();
      const player = await repo.getOrCreatePlayer("orbit-01");
      const updated = await repo.updateDisplayName(player.id, "New Orbit");

      expect(updated.display_name).toBe("New Orbit");
    });
  });

  describe("MatchRepository", () => {
    test("MemoryMatchRepository records match and prevents duplicate persistence", async () => {
      const repo = new MemoryMatchRepository();
      const room = endedRoomFixture();

      const result1 = await repo.recordMatch(room);
      expect(result1).toHaveProperty("matchId");
      expect(room.matchPersisted).toBe(true);

      // Second call is idempotent no-op
      const result2 = await repo.recordMatch(room);
      expect(result2).toBeNull();

      const match = await repo.getMatch(result1.matchId);
      expect(match).toMatchObject({
        code: "ROOM01",
        mode: "1v1",
        winner: "bottom"
      });
      expect(match.players).toHaveLength(2);
    });
  });

  describe("SessionStore", () => {
    test("stores, retrieves, touches, and deletes session data", async () => {
      const store = createSessionStore(null);
      await store.set("session-123", { userId: "user-1", name: "PlayerOne" });

      const data = await store.get("session-123");
      expect(data).toEqual({ userId: "user-1", name: "PlayerOne" });

      await store.touch("session-123", 3600);
      expect(await store.get("session-123")).toBeTruthy();

      await store.delete("session-123");
      expect(await store.get("session-123")).toBeNull();
    });
  });

  describe("PresenceStore", () => {
    test("sets, queries, and clears player presence", async () => {
      const presence = createPresenceStore(null);
      await presence.setPresence("player-abc", "in_game");

      expect(await presence.getPresence("player-abc")).toBe("in_game");

      await presence.removePresence("player-abc");
      expect(await presence.getPresence("player-abc")).toBeNull();
    });
  });

  describe("RateLimiter", () => {
    test("enforces sliding window rate limits", async () => {
      const limiter = createDistributedRateLimiter(null);
      const identity = "127.0.0.1";

      for (let i = 0; i < 5; i++) {
        expect(await limiter.allow(identity, "test-action", 5, 10)).toBe(true);
      }
      expect(await limiter.allow(identity, "test-action", 5, 10)).toBe(false);
    });
  });

  describe("Health Checks", () => {
    test("checkDatabaseHealth reports status and latency", async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] })
      };
      const result = await checkDatabaseHealth(mockPool);
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      const failingPool = {
        query: vi.fn().mockRejectedValue(new Error("Connection refused"))
      };
      const failResult = await checkDatabaseHealth(failingPool);
      expect(failResult.healthy).toBe(false);
      expect(failResult.reason).toContain("Connection refused");
    });

    test("checkRedisHealth reports status and latency", async () => {
      const mockRedis = {
        ping: vi.fn().mockResolvedValue("PONG")
      };
      const result = await checkRedisHealth(mockRedis);
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      const failingRedis = {
        ping: vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
      };
      const failResult = await checkRedisHealth(failingRedis);
      expect(failResult.healthy).toBe(false);
      expect(failResult.reason).toContain("ECONNREFUSED");
    });
  });
});
