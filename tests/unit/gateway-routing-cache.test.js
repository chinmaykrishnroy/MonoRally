import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryRoomDirectory } from "../../server/src/redis/room-directory.js";
import { GatewayService } from "../../server/src/services/gateway-service.js";

function createMockSocket() {
  const sent = [];
  return {
    sent,
    destroyed: false,
    write: (data) => sent.push(data),
    end: () => {}
  };
}

function createMockClient(id, name) {
  const socket = createMockSocket();
  return {
    id,
    name,
    sessionId: `session-${id}`,
    socket,
    alive: true,
    protocol: 4,
    lastPong: performance.now(),
    teamPreference: null,
    buffer: Buffer.alloc(0),
    fragments: [],
    fragmentBytes: 0,
    fragmentOpcode: 0,
    roomCode: null,
    inputWindowStartedAt: performance.now(),
    inputCount: 0,
    inputLimitedAt: 0
  };
}

describe("P1 - Gateway Room Routing Cache Lifecycle & Pruning", () => {
  let bus;
  let workerRegistry;
  let roomDirectory;
  let gateway;

  beforeEach(async () => {
    bus = new MemoryBus();
    workerRegistry = new MemoryWorkerRegistry();
    roomDirectory = new MemoryRoomDirectory();

    gateway = new GatewayService({
      bus,
      workerRegistry,
      roomDirectory,
      gatewayId: "test-gateway-routing"
    });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
    await bus.close();
  });

  it("prunes roomWorkerMap when local clients leave or disconnect", async () => {
    const clientA = createMockClient("c-a", "Alice");
    const clientB = createMockClient("c-b", "Bob");
    gateway.handleClientConnected(clientA);
    gateway.handleClientConnected(clientB);

    // Register active worker and room
    await workerRegistry.registerWorkerHeartbeat({ workerId: "worker-1", maxRooms: 50, activeRooms: 1 });
    await roomDirectory.upsertRoom({
      code: "ROOM01",
      workerId: "worker-1",
      mode: "1v1",
      status: "waiting",
      visibility: "public"
    });

    // Client A joins ROOM01
    await gateway.joinRoom(clientA, "ROOM01");
    expect(gateway.roomWorkerMap.has("ROOM01")).toBe(true);
    expect(gateway.roomWorkerMap.get("ROOM01")).toBe("worker-1");
    expect(gateway.roomClients.get("ROOM01")?.size).toBe(1);

    // Client B joins ROOM01
    await gateway.joinRoom(clientB, "ROOM01");
    expect(gateway.roomClients.get("ROOM01")?.size).toBe(2);

    // Client A leaves
    gateway.leaveRoom(clientA);
    expect(gateway.roomClients.get("ROOM01")?.size).toBe(1);
    expect(gateway.roomWorkerMap.has("ROOM01")).toBe(true); // Still retained because Client B is connected

    // Client B disconnects
    gateway.handleClientDisconnected(clientB);
    // When last local client leaves, cache entry MUST be pruned
    expect(gateway.roomClients.has("ROOM01")).toBe(false);
    expect(gateway.roomWorkerMap.has("ROOM01")).toBe(false);
  });

  it("clears stale ownership cache when room is not found or lease expires", async () => {
    const client = createMockClient("c-1", "Charlie");
    gateway.handleClientConnected(client);

    // Cache a previous room
    gateway.roomWorkerMap.set("STALE_ROOM", "worker-old");

    // Attempting to look up a stale/non-existent room deletes it from cache
    const worker = await gateway.getWorkerForRoom("STALE_ROOM");
    expect(worker).toBeNull();
    expect(gateway.roomWorkerMap.has("STALE_ROOM")).toBe(false);
  });

  it("clears stale ownership cache when worker becomes unavailable", async () => {
    const client = createMockClient("c-2", "David");
    gateway.handleClientConnected(client);

    // Setup room pointing to worker-dead
    await roomDirectory.upsertRoom({
      code: "ROOM_DEAD",
      workerId: "worker-dead",
      mode: "1v1",
      status: "waiting"
    });

    // Worker is NOT registered in workerRegistry (simulates crashed/dead worker)
    const worker = await gateway.getWorkerForRoom("ROOM_DEAD");
    expect(worker).toBeNull();
    expect(gateway.roomWorkerMap.has("ROOM_DEAD")).toBe(false);
  });
});
