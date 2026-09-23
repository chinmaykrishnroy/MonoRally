import { describe, it, expect } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryRoomDirectory } from "../../server/src/redis/room-directory.js";
import { WorkerService } from "../../server/src/services/worker-service.js";

describe("P0 - Gateway Snapshot Scoping", () => {
  it("delivers snapshots and events ONLY to gateways with connected clients for that room", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();

    const worker = new WorkerService({
      bus,
      workerRegistry,
      roomDirectory,
      workerId: "worker-scope",
      maxRooms: 10
    });
    await worker.start();

    // Track snapshots received by 3 gateways
    const gateway1Snapshots = [];
    const gateway2Snapshots = [];
    const gateway3Snapshots = [];

    await bus.subscribe("gateway.gateway-1.room.SCOPED1.snapshot", (data) => gateway1Snapshots.push(data));
    await bus.subscribe("gateway.gateway-2.room.SCOPED1.snapshot", (data) => gateway2Snapshots.push(data));
    await bus.subscribe("gateway.gateway-3.room.SCOPED1.snapshot", (data) => gateway3Snapshots.push(data));

    // Create room with player on gateway-1 only
    const room = worker.makeRoom("1v1", false, "public");
    room.code = "SCOPED1";
    worker.rooms.set(room.code, room);

    room.players.push({
      id: "p1",
      clientId: "c1",
      gatewayId: "gateway-1",
      name: "Player 1",
      team: "bottom",
      slot: 0,
      x: 500,
      disconnected: false
    });

    // Worker publishes state (force = true)
    worker.publishState(room, performance.now(), true);

    await new Promise((r) => setTimeout(r, 20));

    // Gateway 1 must receive the snapshot; Gateways 2 and 3 must receive 0
    expect(gateway1Snapshots.length).toBe(1);
    expect(gateway2Snapshots.length).toBe(0);
    expect(gateway3Snapshots.length).toBe(0);

    // Now spectator on gateway-2 joins
    room.spectators.push({
      id: "s1",
      clientId: "s1",
      gatewayId: "gateway-2",
      name: "Spectator 1"
    });

    worker.publishState(room, performance.now() + 100, true);
    await new Promise((r) => setTimeout(r, 20));

    // Gateway 1 has 2, Gateway 2 has 1, Gateway 3 still has 0
    expect(gateway1Snapshots.length).toBe(2);
    expect(gateway2Snapshots.length).toBe(1);
    expect(gateway3Snapshots.length).toBe(0);

    // Player disconnects and spectator leaves
    room.players[0].disconnected = true;
    room.spectators = [];

    worker.publishState(room, performance.now() + 200, true);
    await new Promise((r) => setTimeout(r, 20));

    // No additional snapshots delivered
    expect(gateway1Snapshots.length).toBe(2);
    expect(gateway2Snapshots.length).toBe(1);
    expect(gateway3Snapshots.length).toBe(0);

    await worker.stop();
  });
});
