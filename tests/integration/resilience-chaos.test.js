import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MatchmakerService } from "../../server/src/services/matchmaker-service.js";
import { WorkerService } from "../../server/src/services/worker-service.js";
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

function createMockClient(id, name, sessionId = "session-test") {
  const socket = createMockSocket();
  return {
    id,
    name,
    sessionId,
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

describe("Resilience & Chaos Testing", () => {
  let bus;
  let workerRegistry;
  let matchmaker;
  let worker1;
  let worker2;
  let gateway1;
  let gateway2;

  beforeEach(async () => {
    bus = new MemoryBus();
    workerRegistry = new MemoryWorkerRegistry();

    matchmaker = new MatchmakerService({ bus, workerRegistry, fallbackMs: 500 });
    worker1 = new WorkerService({ bus, workerRegistry, workerId: "worker-1", maxRooms: 10 });
    worker2 = new WorkerService({ bus, workerRegistry, workerId: "worker-2", maxRooms: 10 });

    gateway1 = new GatewayService({ bus, workerRegistry, gatewayId: "gateway-1" });
    gateway2 = new GatewayService({ bus, workerRegistry, gatewayId: "gateway-2" });

    await matchmaker.start();
    await worker1.start();
    await worker2.start();
    await gateway1.start();
    await gateway2.start();
  });

  afterEach(async () => {
    await gateway1.stop();
    await gateway2.stop();
    await worker1.stop();
    await worker2.stop();
    await matchmaker.stop();
    await bus.close();
  });

  it("handles rolling update: drains active worker without dropping ongoing matches while routing new traffic to healthy worker", async () => {
    // 1. Client A and B pair on Gateway 1 & 2
    const clientA = createMockClient("client-a", "Alice");
    const clientB = createMockClient("client-b", "Bob");
    gateway1.handleClientConnected(clientA);
    gateway2.handleClientConnected(clientB);

    gateway1.handleMessage(clientA, { t: "quick", mode: "1v1" });
    gateway2.handleMessage(clientB, { t: "quick", mode: "1v1" });

    await new Promise((r) => setTimeout(r, 60));

    // Identify which worker got the first match
    const firstWorker = worker1.rooms.size === 1 ? worker1 : worker2;
    const secondWorker = firstWorker === worker1 ? worker2 : worker1;
    const firstRoomCode = [...firstWorker.rooms.keys()][0];

    expect(firstWorker.rooms.size).toBe(1);
    expect(secondWorker.rooms.size).toBe(0);

    // 2. Trigger rolling upgrade / drain on first worker
    const drainPromise = firstWorker.drain(5000);

    // 3. New clients C and D arrive while first worker is draining
    const clientC = createMockClient("client-c", "Charlie");
    const clientD = createMockClient("client-d", "Diana");
    gateway1.handleClientConnected(clientC);
    gateway2.handleClientConnected(clientD);

    gateway1.handleMessage(clientC, { t: "quick", mode: "1v1" });
    gateway2.handleMessage(clientD, { t: "quick", mode: "1v1" });

    await new Promise((r) => setTimeout(r, 60));

    // Matchmaker must have routed clients C & D to secondWorker
    expect(secondWorker.rooms.size).toBe(1);
    const secondRoomCode = [...secondWorker.rooms.keys()][0];
    expect(secondRoomCode).not.toBe(firstRoomCode);

    // 4. Clients A & B continue active match on firstWorker without interruption
    const activeFirstRoom = firstWorker.rooms.get(firstRoomCode);
    expect(activeFirstRoom.status).toBe("running");

    // Finish match on firstWorker
    firstWorker.endRoomByPresence(activeFirstRoom, "top");

    // Allow tickRoom to prune ended room and complete drain
    await new Promise((r) => setTimeout(r, 600));
    expect(firstWorker.rooms.size).toBe(0);
    await drainPromise;

    // Second worker continues running healthy
    expect(secondWorker.rooms.size).toBe(1);
  });

  it("recovers from worker crash by cleaning stale room leases", async () => {
    // Worker 1 acquires room lease
    await workerRegistry.acquireRoomLease("ORPHAN_ROOM", "worker-1", 10);
    expect(await workerRegistry.getRoomWorker("ORPHAN_ROOM")).toBe("worker-1");

    // Worker 1 abruptly terminates (crashes without release)
    await workerRegistry.unregisterWorker("worker-1");

    // Run stale lease cleaner
    await workerRegistry.cleanStaleLeases();

    // Stale lease must be purged
    const workerForRoom = await workerRegistry.getRoomWorker("ORPHAN_ROOM");
    expect(workerForRoom).toBeNull();

    // New worker 2 can now claim the room
    const acquired = await workerRegistry.acquireRoomLease("ORPHAN_ROOM", "worker-2", 10);
    expect(acquired).toBe(true);
  });
});
