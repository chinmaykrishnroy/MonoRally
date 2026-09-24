import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryRoomDirectory } from "../../server/src/redis/room-directory.js";
import { WorkerService } from "../../server/src/services/worker-service.js";
import { GatewayService } from "../../server/src/services/gateway-service.js";

describe("P0 - RoomDirectory Lifecycle Integration Across Workers & Gateways", () => {
  let bus;
  let workerRegistry;
  let roomDirectory;
  let workerA;
  let gatewayB;

  beforeEach(async () => {
    bus = new MemoryBus();
    workerRegistry = new MemoryWorkerRegistry();
    roomDirectory = new MemoryRoomDirectory();

    workerA = new WorkerService({
      bus,
      workerRegistry,
      roomDirectory,
      workerId: "worker-A",
      maxRooms: 10
    });

    gatewayB = new GatewayService({
      bus,
      workerRegistry,
      roomDirectory,
      gatewayId: "gateway-B"
    });

    await workerA.start();
    await gatewayB.start();
  });

  afterEach(async () => {
    await workerA.stop();
    await gatewayB.stop();
    await bus.close();
  });

  it("proves complete 8-point lifecycle synchronization between Worker and RoomDirectory", async () => {
    // 1. Worker A creates public room
    const alloc = await workerA.allocateRoom({
      mode: "1v1",
      visibility: "public"
    });
    expect(alloc.ok).toBe(true);
    const roomCode = alloc.roomCode;
    const room = workerA.rooms.get(roomCode);
    expect(room).toBeDefined();

    // 2. Gateway/API B sees it through shared RoomDirectory
    let roomMeta = await roomDirectory.getRoom(roomCode);
    expect(roomMeta).toBeDefined();
    expect(roomMeta.code).toBe(roomCode);
    expect(roomMeta.workerId).toBe("worker-A");
    expect(roomMeta.status).toBe("waiting");
    expect(roomMeta.playerCount).toBe(0);
    expect(roomMeta.spectatorCount).toBe(0);

    let publicList = await roomDirectory.listPublicRooms({ page: 1, pageSize: 10 });
    expect(publicList.rooms.some((r) => r.code === roomCode)).toBe(true);

    // Also verify Gateway B can resolve the worker for this room via directory
    const resolvedWorker = await gatewayB.getWorkerForRoom(roomCode);
    expect(resolvedWorker).toBe("worker-A");

    // 3. Player count updates (player 1 joins)
    await workerA.handleJoin(room, {
      clientId: "client-p1",
      gatewayId: "gateway-B",
      name: "Player 1",
      sessionId: "session-1"
    });
    roomMeta = await roomDirectory.getRoom(roomCode);
    expect(roomMeta.playerCount).toBe(1);
    expect(roomMeta.status).toBe("waiting");

    // 4. Status changes to running (player 2 joins, filling 1v1 capacity)
    await workerA.handleJoin(room, {
      clientId: "client-p2",
      gatewayId: "gateway-B",
      name: "Player 2",
      sessionId: "session-2"
    });
    roomMeta = await roomDirectory.getRoom(roomCode);
    expect(roomMeta.playerCount).toBe(2);
    expect(roomMeta.status).toBe("running");

    // 5. Spectator count updates
    await workerA.handleJoin(room, {
      clientId: "client-spec1",
      gatewayId: "gateway-B",
      name: "Spectator 1",
      spectator: true
    });
    roomMeta = await roomDirectory.getRoom(roomCode);
    expect(roomMeta.spectatorCount).toBe(1);

    // Spectator leaves
    await workerA.handleLeave(room, "client-spec1");
    roomMeta = await roomDirectory.getRoom(roomCode);
    expect(roomMeta.spectatorCount).toBe(0);

    // 6. Ended/deleted room disappears from public list
    workerA.endRoomByPresence(room, "bottom");
    expect(room.status).toBe("ended");
    roomMeta = await roomDirectory.getRoom(roomCode);
    expect(roomMeta.status).toBe("ended");

    // Ended room is excluded from public directory
    publicList = await roomDirectory.listPublicRooms({ page: 1, pageSize: 10 });
    expect(publicList.rooms.some((r) => r.code === roomCode)).toBe(false);

    // Permanent room removal
    await roomDirectory.removeRoom(roomCode);
    const deletedMeta = await roomDirectory.getRoom(roomCode);
    expect(deletedMeta).toBeNull();
  });

  it("keeps TTL alive throughout a long-running match and prunes stale state on worker failure", async () => {
    // Custom room directory with small TTL (1 second) to test heartbeat TTL refresh & expiry
    const shortTtlDirectory = new MemoryRoomDirectory();
    const shortTtlWorker = new WorkerService({
      bus,
      workerRegistry,
      roomDirectory: shortTtlDirectory,
      workerId: "worker-short-ttl"
    });

    const alloc = await shortTtlWorker.allocateRoom({
      mode: "1v1",
      visibility: "public"
    });
    const roomCode = alloc.roomCode;
    const room = shortTtlWorker.rooms.get(roomCode);

    // Manually set initial short expiration (300ms)
    await shortTtlDirectory.upsertRoom({
      code: roomCode,
      workerId: "worker-short-ttl",
      mode: "1v1",
      status: "running",
      playerCount: 2,
      maxPlayers: 2,
      spectatorCount: 0
    }, 0.3); // 300ms TTL

    // 7. TTL remains alive through renewLeases / syncRoomDirectory
    const initialEntry = await shortTtlDirectory.getRoom(roomCode);
    expect(initialEntry).toBeDefined();

    // Before it expires, renewLeases refreshes the TTL
    await shortTtlWorker.renewLeases();
    const renewedEntry = await shortTtlDirectory.getRoom(roomCode);
    expect(renewedEntry).toBeDefined();
    expect(renewedEntry.expiresAt).toBeGreaterThan(initialEntry.expiresAt);

    // 8. Worker failure eventually causes stale directory state to disappear
    // Simulate worker crashing without calling stop() - no renewLeases calls
    await shortTtlDirectory.upsertRoom({
      code: roomCode,
      workerId: "worker-short-ttl",
      status: "running"
    }, 0.05); // 50ms TTL

    await new Promise((r) => setTimeout(r, 80));

    // Stale entry has expired and is now null
    const expiredEntry = await shortTtlDirectory.getRoom(roomCode);
    expect(expiredEntry).toBeNull();
  });
});
