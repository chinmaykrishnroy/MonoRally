import { describe, it, expect } from "vitest";
import { MatchmakerService } from "../../server/src/services/matchmaker-service.js";
import { WorkerService } from "../../server/src/services/worker-service.js";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryMatchmakingQueue } from "../../server/src/redis/matchmaking-queue.js";

describe("Quick Match Population and Bot Identification", () => {
  it("Quick Match Population: player enters warmup on timeout, remains in queue, and matches second human into PvP", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const queue = new MemoryMatchmakingQueue();

    const worker = new WorkerService({
      bus,
      workerRegistry,
      workerId: "worker-test-1",
      maxRooms: 10
    });
    await worker.start();

    const matchmaker = new MatchmakerService({
      bus,
      workerRegistry,
      matchmakingQueue: queue,
      fallbackMs: 50 // Short fallback for test
    });
    await matchmaker.start();

    try {
      const client1Messages = [];
      const client2Messages = [];

      bus.subscribe("gateway.gw-1.client.c1.send", (msg) => {
        client1Messages.push(msg);
      });
      bus.subscribe("gateway.gw-1.client.c2.send", (msg) => {
        client2Messages.push(msg);
      });

      // 1. Player 1 queues
      await matchmaker.enqueue({
        clientId: "c1",
        gatewayId: "gw-1",
        name: "PlayerOne",
        mode: "1v1",
        enqueuedAt: Date.now() - 100 // Already past fallbackMs
      });

      // 2. Trigger fallback check
      await matchmaker.checkFallbackTimeouts();

      // Verify Player 1 received quickWarmup message
      const warmupMsg = client1Messages.find((m) => m.t === "quickWarmup");
      expect(warmupMsg).toBeDefined();
      expect(warmupMsg.mode).toBe("1v1");

      // Verify Player 1 was NOT removed from matchmaking queue!
      const queueDepthAfterWarmup = await queue.getQueueDepth("1v1");
      expect(queueDepthAfterWarmup).toBe(1);

      // 3. Player 2 joins queue
      await matchmaker.enqueue({
        clientId: "c2",
        gatewayId: "gw-1",
        name: "PlayerTwo",
        mode: "1v1",
        enqueuedAt: Date.now()
      });

      // Wait brief tick for dispatch
      await new Promise((r) => setTimeout(r, 50));

      // Both players should receive matchmaker.assigned to the same room
      const assigned1 = client1Messages.find((m) => m.t === "matchmaker.assigned");
      const assigned2 = client2Messages.find((m) => m.t === "matchmaker.assigned");
      expect(assigned1).toBeDefined();
      expect(assigned2).toBeDefined();
      expect(assigned1.roomCode).toBe(assigned2.roomCode);

      // Queue should now be empty
      const finalQueueDepth = await queue.getQueueDepth("1v1");
      expect(finalQueueDepth).toBe(0);
    } finally {
      await matchmaker.stop();
      await worker.stop();
    }
  });

  it("Authoritative Worker identifies bots with [BOT] prefix and bot flag in roster", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();

    const worker = new WorkerService({
      bus,
      workerRegistry,
      workerId: "worker-test-bot",
      maxRooms: 10
    });
    await worker.start();

    try {
      const room = worker.makeRoom("2v2", false, "public");
      worker.rooms.set(room.code, room);

      // Add human player
      worker.addPlayer(room, { clientId: "c1", name: "Alice", gatewayId: "gw-1" }, { slot: 0, team: "bottom" });

      // Add bot player
      worker.addBot(room, 1, "Ace");

      expect(room.players.length).toBe(2);
      const botPlayer = room.players.find((p) => p.bot);
      expect(botPlayer).toBeDefined();
      expect(botPlayer.name).toBe("[BOT] Ace");

      // Verify broadcastRoster formatting
      let rosterEvent = null;
      await bus.subscribe(`gateway.gw-1.room.${room.code}.events`, (event) => {
        if (event.t === "roster") rosterEvent = event;
      });

      worker.broadcastRoster(room);
      await new Promise((r) => setTimeout(r, 20));
      expect(rosterEvent).toBeDefined();
      const botRosterEntry = rosterEvent.players.find((p) => p.bot);
      expect(botRosterEntry).toBeDefined();
      expect(botRosterEntry.name).toBe("[BOT] Ace");
    } finally {
      await worker.stop();
    }
  });
});
