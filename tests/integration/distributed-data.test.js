import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHttpServer } from "../../server/src/http.js";
import { MemoryLeaderboardRepository } from "../../server/src/repositories/leaderboard-repository.js";

const PORT_A = 19281;
const PORT_B = 19282;

let serverA;
let serverB;
let sharedLeaderboardRepo;

beforeAll(async () => {
  // Shared backend state (simulating shared PostgreSQL/Redis cluster across replicas)
  sharedLeaderboardRepo = new MemoryLeaderboardRepository();

  const checkHealth = async () => ({
    ready: true,
    database: { healthy: true, latencyMs: 1.2 },
    redis: { healthy: true, latencyMs: 0.8 }
  });

  serverA = createHttpServer({
    checkHealth,
    leaderboard: sharedLeaderboardRepo,
    publicRoomPage: () => ({ rooms: [], total: 0, hasMore: false, nextOffset: 0 })
  });

  serverB = createHttpServer({
    checkHealth,
    leaderboard: sharedLeaderboardRepo,
    publicRoomPage: () => ({ rooms: [], total: 0, hasMore: false, nextOffset: 0 })
  });

  await Promise.all([
    new Promise((resolve) => serverA.listen(PORT_A, resolve)),
    new Promise((resolve) => serverB.listen(PORT_B, resolve))
  ]);
});

afterAll(async () => {
  await Promise.all([
    new Promise((resolve) => (serverA ? serverA.close(resolve) : resolve())),
    new Promise((resolve) => (serverB ? serverB.close(resolve) : resolve()))
  ]);
});

describe("Distributed Multi-Replica Data Integration", () => {
  test("both API instances report healthy liveness and readiness", async () => {
    const [liveA, liveB, readyA, readyB] = await Promise.all([
      fetch(`http://127.0.0.1:${PORT_A}/health/live`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${PORT_B}/health/live`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${PORT_A}/health/ready`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${PORT_B}/health/ready`).then((r) => r.json())
    ]);

    expect(liveA).toEqual({ status: "alive" });
    expect(liveB).toEqual({ status: "alive" });
    expect(readyA.ready).toBe(true);
    expect(readyB.ready).toBe(true);
  });

  test("two independent API replicas return identical leaderboard data without local files", async () => {
    // Record match win on shared backend
    await sharedLeaderboardRepo.recordRoom({
      code: "DIST01",
      mode: "1v1",
      status: "ended",
      winner: "bottom",
      startedAt: 1000,
      endedAt: 61000,
      misses: { top: 5, bottom: 1 },
      returns: { top: 0, bottom: 42 },
      leaderboardRecorded: false,
      players: [
        { name: "hyper-spin", team: "bottom", slot: 0, returns: 42, bot: false },
        { name: "rival-paddle", team: "top", slot: 1, returns: 30, bot: false }
      ]
    });

    // Query Instance A and Instance B independently
    const [resA, resB] = await Promise.all([
      fetch(`http://127.0.0.1:${PORT_A}/leaderboard.json`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${PORT_B}/leaderboard.json`).then((r) => r.json())
    ]);

    expect(resA.boards["1v1"]).toHaveLength(1);
    expect(resB.boards["1v1"]).toHaveLength(1);

    // Assert exact data equivalence across distinct HTTP replicas
    expect(resA.boards["1v1"]).toEqual(resB.boards["1v1"]);
    expect(resB.boards["1v1"][0]).toMatchObject({
      name: "hyper-spin",
      score: 42,
      misses: 1,
      duration: 60,
      mode: "1v1"
    });
  });

  test("serves Prometheus text exposition and JSON telemetry metrics", async () => {
    const [promRes, jsonRes] = await Promise.all([
      fetch(`http://127.0.0.1:${PORT_A}/metrics`),
      fetch(`http://127.0.0.1:${PORT_A}/metrics.json`)
    ]);

    expect(promRes.status).toBe(200);
    expect(promRes.headers.get("content-type")).toContain("text/plain");
    const promText = await promRes.text();
    expect(promText).toContain("monorally_connected_clients");
    expect(promText).toContain("monorally_process_resident_memory_bytes");

    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get("content-type")).toContain("application/json");
    const jsonData = await jsonRes.json();
    expect(jsonData).toHaveProperty("timestamp");
    expect(jsonData).toHaveProperty("connections");
    expect(jsonData).toHaveProperty("rooms");
    expect(jsonData).toHaveProperty("resources");
  });
});
