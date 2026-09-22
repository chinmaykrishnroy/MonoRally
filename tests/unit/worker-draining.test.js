import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { WorkerService } from "../../server/src/services/worker-service.js";

describe("Worker Draining & Graceful Lifecycle", () => {
  let bus;
  let workerRegistry;
  let worker1;
  let worker2;

  beforeEach(async () => {
    bus = new MemoryBus();
    workerRegistry = new MemoryWorkerRegistry();

    worker1 = new WorkerService({ bus, workerRegistry, workerId: "worker-1", maxRooms: 10 });
    worker2 = new WorkerService({ bus, workerRegistry, workerId: "worker-2", maxRooms: 10 });

    await worker1.start();
    await worker2.start();
  });

  afterEach(async () => {
    await worker1.stop();
    await worker2.stop();
    await bus.close();
  });

  it("marks worker as draining and excludes it from least-loaded selection", async () => {
    // Both workers are ready initially
    let workers = await workerRegistry.getActiveWorkers();
    expect(workers.every((w) => w.status === "ready")).toBe(true);

    // Drain worker 1
    const drainPromise = worker1.drain(5000);

    // Verify worker 1 status is draining
    workers = await workerRegistry.getActiveWorkers();
    const w1 = workers.find((w) => w.workerId === "worker-1");
    expect(w1.status).toBe("draining");

    // Matchmaker selection must pick worker 2
    const best = await workerRegistry.getLeastLoadedWorker();
    expect(best).not.toBeNull();
    expect(best.workerId).toBe("worker-2");

    await drainPromise;
  });

  it("rejects new room allocations while draining", async () => {
    worker1.drain(5000);

    const allocResult = await worker1.allocateRoom({ mode: "1v1" });
    expect(allocResult.ok).toBe(false);
    expect(allocResult.error).toBe("Worker is draining");
  });

  it("completes active rooms before resolving drain()", async () => {
    // Allocate room before draining
    const alloc = await worker1.allocateRoom({
      mode: "1v1",
      initialPlayers: [
        { clientId: "c1", gatewayId: "g1", name: "P1", sessionId: "s1" },
        { clientId: "c2", gatewayId: "g2", name: "P2", sessionId: "s2" }
      ]
    });
    expect(alloc.ok).toBe(true);
    expect(worker1.rooms.size).toBe(1);

    let drained = false;
    const drainPromise = worker1.drain(3000).then(() => {
      drained = true;
    });

    // While room is active, drain has not resolved yet
    await new Promise((r) => setTimeout(r, 50));
    expect(drained).toBe(false);
    expect(worker1.rooms.size).toBe(1);

    // Finish match
    const room = worker1.rooms.get(alloc.roomCode);
    worker1.endRoomByPresence(room, "bottom");

    // Once tickRoom detects ended room while draining, it prunes and resolves drain()
    await new Promise((r) => setTimeout(r, 600));
    expect(drained).toBe(true);
    expect(worker1.rooms.size).toBe(0);

    await drainPromise;
  });

  it("immediately resolves drain() when 0 rooms are active", async () => {
    expect(worker1.rooms.size).toBe(0);
    let resolved = false;

    await worker1.drain(1000).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(true);
  });
});
