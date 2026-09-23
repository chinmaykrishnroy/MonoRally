import { describe, it, expect } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryRoomDirectory } from "../../server/src/redis/room-directory.js";
import { MemoryMatchmakingQueue } from "../../server/src/redis/matchmaking-queue.js";
import {
  startGatewayNode,
  startWorkerNode,
  startMatchmakerNode,
  startUnifiedNode
} from "../../server/src/bootstrap.js";

describe("P0 - SERVICE_ROLE Runtime Component Isolation", () => {
  function createTestInfra(role) {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();
    const matchmakingQueue = new MemoryMatchmakingQueue();
    const checkHealth = async () => ({ ready: true, role });

    return {
      role,
      bus,
      workerRegistry,
      roomDirectory,
      matchmakingQueue,
      checkHealth,
      leaderboard: { getTop: () => [], getRankings: () => [] },
      playerRepository: null,
      matchRepository: null,
      sessionStore: null,
      presenceStore: null,
      rateLimiter: null
    };
  }

  it("gateway role terminates WebSockets but does NOT run physics", async () => {
    const infra = createTestInfra("gateway");
    const node = await startGatewayNode(infra, { port: 0, gatewayId: "test-gateway-1" });

    try {
      expect(node.role).toBe("gateway");
      expect(node.gateway).toBeDefined();
      expect(node.server).toBeDefined();
      // Verify gateway does NOT have a physics timer or worker simulation
      expect(node.worker).toBeUndefined();
      expect(node.physicsTimer).toBeUndefined();
      expect(node.rooms).toBeUndefined(); // Gateway does not own room simulation maps

      // Verify gateway accepts player WebSocket connections
      const port = node.server.address().port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const connected = await new Promise((resolve, reject) => {
        ws.addEventListener("open", () => resolve(true));
        ws.addEventListener("error", reject);
      });
      expect(connected).toBe(true);

      const helloReply = await new Promise((resolve) => {
        ws.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data.toString());
          if (msg.t === "hello" && msg.name) resolve(msg);
        });
        ws.send(JSON.stringify({ t: "hello", name: "Tester" }));
      });
      expect(helloReply.t).toBe("hello");
      expect(helloReply.name).toBe("Tester");

      ws.close();
    } finally {
      await node.stop();
    }
  });

  it("worker role runs physics simulation but does NOT terminate public player WebSockets", async () => {
    const infra = createTestInfra("worker");
    const node = await startWorkerNode(infra, { port: 0, workerId: "test-worker-1" });

    try {
      expect(node.role).toBe("worker");
      expect(node.worker).toBeDefined();
      expect(node.server).toBeDefined();

      // Verify worker runs physics loop
      expect(node.worker.physicsTimer).toBeDefined();

      // Verify worker HTTP server does NOT attach WebSocket player server
      const port = node.server.address().port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const failedConnection = await new Promise((resolve) => {
        ws.addEventListener("open", () => resolve(false));
        ws.addEventListener("error", () => resolve(true));
      });
      expect(failedConnection).toBe(true); // Must refuse or fail WS upgrade because worker doesn't terminate player websockets
    } finally {
      await node.stop();
    }
  });

  it("matchmaker role does NOT run physics and does NOT terminate WebSockets", async () => {
    const infra = createTestInfra("matchmaker");
    const node = await startMatchmakerNode(infra, { port: 0 });

    try {
      expect(node.role).toBe("matchmaker");
      expect(node.matchmaker).toBeDefined();
      expect(node.server).toBeDefined();

      // No physics simulation
      expect(node.worker).toBeUndefined();
      expect(node.physicsTimer).toBeUndefined();

      // No WebSockets
      const port = node.server.address().port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const failedConnection = await new Promise((resolve) => {
        ws.addEventListener("open", () => resolve(false));
        ws.addEventListener("error", () => resolve(true));
      });
      expect(failedConnection).toBe(true);
    } finally {
      await node.stop();
    }
  });

  it("unified role runs BOTH physics and WebSockets for local development", async () => {
    const infra = createTestInfra("unified");
    const node = await startUnifiedNode(infra, { port: 0 });

    try {
      expect(node.role).toBe("unified");
      expect(node.server).toBeDefined();
      expect(node.physicsTimer).toBeDefined();
      expect(node.rooms).toBeDefined();
      expect(node.clients).toBeDefined();

      // Verify WebSockets connect and answer in unified mode
      const port = node.server.address().port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const connected = await new Promise((resolve, reject) => {
        ws.addEventListener("open", () => resolve(true));
        ws.addEventListener("error", reject);
      });
      expect(connected).toBe(true);

      const helloReply = await new Promise((resolve) => {
        ws.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data.toString());
          if (msg.t === "hello" && msg.name) resolve(msg);
        });
        ws.send(JSON.stringify({ t: "hello", name: "UnifiedPlayer" }));
      });
      expect(helloReply.t).toBe("hello");
      expect(helloReply.name).toBe("UnifiedPlayer");

      ws.close();
    } finally {
      await node.stop();
    }
  });
});
