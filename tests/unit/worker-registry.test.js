import { describe, it, expect, beforeEach } from "vitest";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";

describe("WorkerRegistry (Memory Implementation)", () => {
  let registry;

  beforeEach(() => {
    registry = new MemoryWorkerRegistry();
  });

  it("registers heartbeats and lists active workers", async () => {
    await registry.registerWorkerHeartbeat({ workerId: "w1", activeRooms: 2, maxRooms: 10 });
    await registry.registerWorkerHeartbeat({ workerId: "w2", activeRooms: 5, maxRooms: 10 });

    const workers = await registry.getActiveWorkers();
    expect(workers.length).toBe(2);
    expect(workers.map((w) => w.workerId).sort()).toEqual(["w1", "w2"]);
  });

  it("selects the least loaded worker", async () => {
    await registry.registerWorkerHeartbeat({ workerId: "w1", activeRooms: 10, maxRooms: 50 });
    await registry.registerWorkerHeartbeat({ workerId: "w2", activeRooms: 2, maxRooms: 50 });
    await registry.registerWorkerHeartbeat({ workerId: "w3", activeRooms: 15, maxRooms: 50 });

    const best = await registry.getLeastLoadedWorker();
    expect(best).not.toBeNull();
    expect(best.workerId).toBe("w2");
  });

  it("skips workers that have reached maximum capacity", async () => {
    await registry.registerWorkerHeartbeat({ workerId: "w1", activeRooms: 10, maxRooms: 10 });
    await registry.registerWorkerHeartbeat({ workerId: "w2", activeRooms: 7, maxRooms: 10 });

    const best = await registry.getLeastLoadedWorker();
    expect(best).not.toBeNull();
    expect(best.workerId).toBe("w2");
  });

  it("returns null when all workers are at capacity", async () => {
    await registry.registerWorkerHeartbeat({ workerId: "w1", activeRooms: 10, maxRooms: 10 });
    const best = await registry.getLeastLoadedWorker();
    expect(best).toBeNull();
  });

  it("unregisters workers upon shutdown", async () => {
    await registry.registerWorkerHeartbeat({ workerId: "w1", activeRooms: 1 });
    await registry.unregisterWorker("w1");
    const workers = await registry.getActiveWorkers();
    expect(workers.length).toBe(0);
  });

  describe("Room Leases", () => {
    it("acquires room lease exclusively", async () => {
      const acquired1 = await registry.acquireRoomLease("ROOM1", "w1", 10);
      expect(acquired1).toBe(true);

      // w2 cannot acquire room leased to w1
      const acquired2 = await registry.acquireRoomLease("ROOM1", "w2", 10);
      expect(acquired2).toBe(false);

      expect(await registry.getRoomWorker("ROOM1")).toBe("w1");
    });

    it("renews lease for current owner only", async () => {
      await registry.acquireRoomLease("ROOM1", "w1", 10);
      const renewed1 = await registry.renewRoomLease("ROOM1", "w1", 15);
      expect(renewed1).toBe(true);

      const renewed2 = await registry.renewRoomLease("ROOM1", "w2", 15);
      expect(renewed2).toBe(false);
    });

    it("releases lease allowing another worker to acquire", async () => {
      await registry.acquireRoomLease("ROOM1", "w1", 10);
      const released = await registry.releaseRoomLease("ROOM1", "w1");
      expect(released).toBe(true);

      expect(await registry.getRoomWorker("ROOM1")).toBeNull();

      const acquiredByW2 = await registry.acquireRoomLease("ROOM1", "w2", 10);
      expect(acquiredByW2).toBe(true);
      expect(await registry.getRoomWorker("ROOM1")).toBe("w2");
    });
  });
});
