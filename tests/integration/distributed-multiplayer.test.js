import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MatchmakerService } from "../../server/src/services/matchmaker-service.js";
import { WorkerService } from "../../server/src/services/worker-service.js";
import { GatewayService } from "../../server/src/services/gateway-service.js";
import { INPUT_PACKET } from "../../server/src/config.js";

function createMockSocket() {
  const sent = [];
  return {
    sent,
    destroyed: false,
    write: (data) => sent.push(data),
    end: () => {}
  };
}

function createMockClient(id, name, sessionId = "session-1") {
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

describe("Distributed Realtime Multiplayer (Multi-Gateway / Multi-Worker)", () => {
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

    gateway1 = new GatewayService({ bus, gatewayId: "gateway-1" });
    gateway2 = new GatewayService({ bus, gatewayId: "gateway-2" });

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

  it("coordinates quick-match pairing across separate gateways and routes to least-loaded worker", async () => {
    const clientA = createMockClient("client-a", "Alice");
    const clientB = createMockClient("client-b", "Bob");

    gateway1.handleClientConnected(clientA);
    gateway2.handleClientConnected(clientB);

    // Client A on Gateway 1 queues for quick match
    gateway1.handleMessage(clientA, { t: "quick", mode: "1v1" });

    // Client B on Gateway 2 queues for quick match
    gateway2.handleMessage(clientB, { t: "quick", mode: "1v1" });

    // Allow bus messages to dispatch
    await new Promise((r) => setTimeout(r, 60));

    // Either worker1 or worker2 was chosen to host the room
    const totalRooms = worker1.rooms.size + worker2.rooms.size;
    expect(totalRooms).toBe(1);

    const hostingWorker = worker1.rooms.size === 1 ? worker1 : worker2;
    const [room] = hostingWorker.rooms.values();

    expect(room).toBeDefined();
    expect(room.mode).toBe("1v1");
    expect(room.players.length).toBe(2);

    // Verify room lease was registered
    const leasedWorker = await workerRegistry.getRoomWorker(room.code);
    expect(leasedWorker).toBe(hostingWorker.workerId);

    // Verify both clients received joined notification and roster
    await new Promise((r) => setTimeout(r, 40));
    expect(clientA.socket.sent.length).toBeGreaterThan(0);
    expect(clientB.socket.sent.length).toBeGreaterThan(0);

    expect(clientA.roomCode).toBe(room.code);
    expect(clientB.roomCode).toBe(room.code);

    // Client A sends binary input frame to Gateway 1
    const inputBuf = Buffer.alloc(14);
    inputBuf[0] = INPUT_PACKET;
    inputBuf.writeUInt16BE(32768, 1); // 0.5 normalized x
    inputBuf.writeUInt16BE(1, 3); // sequence 1
    inputBuf.writeUInt32BE(1000, 5); // timestamp
    gateway1.handleBinaryMessage(clientA, inputBuf);

    await new Promise((r) => setTimeout(r, 40));

    // Verify Worker 1 updated player target position
    const playerA = room.players.find((p) => p.clientId === "client-a");
    expect(playerA).toBeDefined();
    expect(playerA.targetX).toBeCloseTo(500, 0);

    // Let physics tick and verify snapshots reach both client sockets across both gateways
    await new Promise((r) => setTimeout(r, 80));
    expect(clientA.socket.sent.length).toBeGreaterThan(2);
    expect(clientB.socket.sent.length).toBeGreaterThan(2);
  });

  it("routes private room creation and join across two distinct gateways", async () => {
    const host = createMockClient("host-1", "HostUser");
    const guest = createMockClient("guest-1", "GuestUser");

    gateway1.handleClientConnected(host);
    gateway2.handleClientConnected(guest);

    // Host creates room on Gateway 1
    await gateway1.createRoom(host, "1v1", "private");
    await new Promise((r) => setTimeout(r, 50));

    expect(host.roomCode).toBeTruthy();
    const roomCode = host.roomCode;

    // Guest joins room on Gateway 2
    await gateway2.joinRoom(guest, roomCode, false);
    await new Promise((r) => setTimeout(r, 50));

    expect(guest.roomCode).toBe(roomCode);

    const hostingWorker = worker1.rooms.has(roomCode) ? worker1 : worker2;
    const room = hostingWorker.rooms.get(roomCode);
    expect(room).toBeDefined();
    expect(room.players.length).toBe(2);
  });
});
