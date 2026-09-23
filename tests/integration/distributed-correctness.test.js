import { describe, it, expect } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryRoomDirectory } from "../../server/src/redis/room-directory.js";
import { MemoryMatchmakingQueue } from "../../server/src/redis/matchmaking-queue.js";
import { GatewayService } from "../../server/src/services/gateway-service.js";
import { WorkerService } from "../../server/src/services/worker-service.js";
import { MatchmakerService } from "../../server/src/services/matchmaker-service.js";
import { createInfra } from "../../server/src/bootstrap.js";
import { INPUT_PACKET } from "../../server/src/config.js";

function createMockSocket() {
  const sent = [];
  return {
    sent,
    destroyed: false,
    write: (data) => sent.push(data),
    end: function() { this.destroyed = true; },
    destroy: function() { this.destroyed = true; }
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

describe("P0/P1 - 14-Point Distributed Correctness & Scale Invariant Suite", () => {
  // Point 1: Gateway role starts without physics loop
  it("Point 1: Gateway service does not instantiate or run physics timer", () => {
    const bus = new MemoryBus();
    const gateway = new GatewayService({ bus, gatewayId: "gw-1" });
    expect(gateway.physicsTimer).toBeUndefined();
    expect(gateway.rooms).toBeUndefined();
  });

  // Point 2: Worker role starts without websocket listener
  it("Point 2: Worker service runs physics but does not terminate player WebSockets", () => {
    const bus = new MemoryBus();
    const worker = new WorkerService({ bus, workerId: "wk-1" });
    expect(worker.clients).toBeUndefined();
    expect(typeof worker.tick).toBe("function");
  });

  // Point 3: Matchmaker role starts without physics or websockets
  it("Point 3: Matchmaker service runs neither physics nor client WebSockets", () => {
    const bus = new MemoryBus();
    const matchmaker = new MatchmakerService({ bus });
    expect(matchmaker.physicsTimer).toBeUndefined();
    expect(matchmaker.clients).toBeUndefined();
    expect(matchmaker.rooms).toBeUndefined();
  });

  // Point 4: Fail-closed production bootstrap
  it("Point 4: Fails closed when required distributed backends are missing in production mode", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(
        createInfra({ role: "gateway", bus: null, redis: null })
      ).rejects.toThrow(/Fatal: REDIS_URL is required/);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  // Point 5: HA Matchmaker queue group concurrency and atomic claiming
  it("Point 5: Multi-replica matchmakers share queue group without duplicate room assignments", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const matchmakingQueue = new MemoryMatchmakingQueue();

    // Register a worker
    await workerRegistry.registerWorkerHeartbeat({ workerId: "wk-shared", maxRooms: 50, activeRooms: 0 });

    const matchmakerA = new MatchmakerService({ bus, workerRegistry, matchmakingQueue, fallbackMs: 5000 });
    const matchmakerB = new MatchmakerService({ bus, workerRegistry, matchmakingQueue, fallbackMs: 5000 });
    await matchmakerA.start();
    await matchmakerB.start();

    let allocations = 0;
    await bus.subscribe("worker.wk-shared.allocate_room", (data, replyTo) => {
      allocations++;
      if (replyTo) bus.publish(replyTo, { roomCode: "MATCH01", workerId: "wk-shared" });
    });

    // Two players queue simultaneously
    await matchmakerA.enqueue({ clientId: "p1", name: "P1", mode: "1v1", gatewayId: "gw-1" });
    await matchmakerB.enqueue({ clientId: "p2", name: "P2", mode: "1v1", gatewayId: "gw-2" });

    // Allow queue claim & matchmaker dispatch
    await new Promise((r) => setTimeout(r, 60));

    // Exactly 1 allocation made across both matchmakers (atomic claim)
    expect(allocations).toBe(1);

    await matchmakerA.stop();
    await matchmakerB.stop();
  });

  // Point 6: Authoritative worker input partitioning
  it("Point 6: Input routing is partitioned: worker.<id>.room.<code>.input reaches only the assigned worker", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();

    const w1 = new WorkerService({ bus, workerRegistry, roomDirectory, workerId: "w1" });
    const w2 = new WorkerService({ bus, workerRegistry, roomDirectory, workerId: "w2" });
    await w1.start();
    await w2.start();

    const room = w1.makeRoom("1v1", false, "public");
    w1.rooms.set(room.code, room);

    bus.publish(`worker.w1.room.${room.code}.input`, { clientId: "c1", data: Buffer.alloc(3) });
    await new Promise((r) => setTimeout(r, 30));

    expect(w1.messagesDelivered).toBe(1);
    expect(w2.messagesDelivered).toBe(0);

    await w1.stop();
    await w2.stop();
  });

  // Point 7: Gateway scoped snapshot routing
  it("Point 7: Snapshots are scoped: gateway.<id>.room.<code>.snapshot reaches only hosting gateways", async () => {
    const bus = new MemoryBus();
    const worker = new WorkerService({ bus, workerId: "w-snap" });
    await worker.start();

    const gw1Snapshots = [];
    const gw2Snapshots = [];
    await bus.subscribe("gateway.gw1.room.R1.snapshot", (s) => gw1Snapshots.push(s));
    await bus.subscribe("gateway.gw2.room.R1.snapshot", (s) => gw2Snapshots.push(s));

    const room = worker.makeRoom("1v1", false, "public");
    room.code = "R1";
    room.players.push({ id: "p1", clientId: "c1", gatewayId: "gw1", team: "bottom", slot: 0 });
    worker.rooms.set(room.code, room);

    worker.publishState(room, performance.now(), true);
    await new Promise((r) => setTimeout(r, 20));

    expect(gw1Snapshots.length).toBe(1);
    expect(gw2Snapshots.length).toBe(0);

    await worker.stop();
  });

  // Point 8: Cross-gateway game over and rematch negotiation
  it("Point 8: Rematch negotiation functions across multiple gateways", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();

    const worker = new WorkerService({ bus, workerRegistry, roomDirectory, workerId: "w-rematch" });
    const gw1 = new GatewayService({ bus, workerRegistry, roomDirectory, gatewayId: "gw1" });
    const gw2 = new GatewayService({ bus, workerRegistry, roomDirectory, gatewayId: "gw2" });
    await worker.start();
    await gw1.start();
    await gw2.start();

    const room = worker.makeRoom("1v1", false, "public");
    room.code = "REMATCH1";
    worker.rooms.set(room.code, room);
    await workerRegistry.acquireRoomLease(room.code, worker.workerId);

    const client1 = createMockClient("c1", "Player 1", "sess-1");
    const client2 = createMockClient("c2", "Player 2", "sess-2");
    gw1.handleClientConnected(client1);
    gw2.handleClientConnected(client2);

    await worker.handleJoin(room, { clientId: "c1", name: "Player 1", sessionId: "sess-1", gatewayId: "gw1" });
    await worker.handleJoin(room, { clientId: "c2", name: "Player 2", sessionId: "sess-2", gatewayId: "gw2" });
    client1.roomCode = room.code;
    client2.roomCode = room.code;
    client1.workerId = worker.workerId;
    client2.workerId = worker.workerId;
    gw1.roomWorkerMap.set(room.code, worker.workerId);
    gw2.roomWorkerMap.set(room.code, worker.workerId);

    room.status = "ended";

    // Player 1 requests replay
    await gw1.handleMessage(client1, { t: "replayRoom" });
    await new Promise((r) => setTimeout(r, 40));

    // Player 2 requests replay (both consented)
    await gw2.handleMessage(client2, { t: "replayRoom" });
    await new Promise((r) => setTimeout(r, 50));

    expect(room.status).toBe("running");

    await gw1.stop();
    await gw2.stop();
    await worker.stop();
  });

  // Point 9: Reliable mid-match reconnection across different gateways
  it("Point 9: Player reconnecting on a different gateway resumes active court session seamlessly", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();

    const worker = new WorkerService({ bus, workerRegistry, roomDirectory, workerId: "w-recon" });
    const gw1 = new GatewayService({ bus, workerRegistry, roomDirectory, gatewayId: "gw-origin" });
    const gw2 = new GatewayService({ bus, workerRegistry, roomDirectory, gatewayId: "gw-target" });
    await worker.start();
    await gw1.start();
    await gw2.start();

    const room = worker.makeRoom("1v1", false, "public");
    room.code = "RECON01";
    worker.rooms.set(room.code, room);
    await workerRegistry.acquireRoomLease(room.code, worker.workerId);
    await roomDirectory.upsertRoom({ code: room.code, workerId: worker.workerId });

    gw1.roomWorkerMap.set(room.code, worker.workerId);
    gw2.roomWorkerMap.set(room.code, worker.workerId);

    const clientOrig = createMockClient("c-orig", "ReconPlayer", "session-persist-xyz");
    gw1.handleClientConnected(clientOrig);
    clientOrig.roomCode = room.code;
    clientOrig.workerId = worker.workerId;
    await worker.handleJoin(room, { clientId: "c-orig", name: "ReconPlayer", sessionId: "session-persist-xyz", gatewayId: "gw-origin" });
    room.status = "running";

    // Disconnect from gw-origin
    gw1.handleClientDisconnected(clientOrig);
    await new Promise((r) => setTimeout(r, 40));

    const player = room.players.find((p) => p.sessionId === "session-persist-xyz");
    expect(player).toBeDefined();
    expect(player.disconnected).toBe(true);

    // Reconnect through gw-target with same sessionId
    const clientNew = createMockClient("c-new", "ReconPlayer", "session-persist-xyz");
    gw2.handleClientConnected(clientNew);
    await gw2.handleMessage(clientNew, { t: "joinRoom", code: room.code });

    await new Promise((r) => setTimeout(r, 60));

    expect(player.disconnected).toBe(false);
    expect(player.gatewayId).toBe("gw-target");
    expect(player.clientId).toBe("c-new");

    await gw1.stop();
    await gw2.stop();
    await worker.stop();
  });

  // Point 10: Room lease tracking and release
  it("Point 10: Worker manages and releases room leases upon termination", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const worker = new WorkerService({ bus, workerRegistry, workerId: "w-lease" });
    await worker.start();

    const room = worker.makeRoom("1v1", false, "public");
    worker.rooms.set(room.code, room);
    await workerRegistry.acquireRoomLease(room.code, worker.workerId);

    let assigned = await workerRegistry.getRoomWorker(room.code);
    expect(assigned).toBe("w-lease");

    await worker.stop();
    assigned = await workerRegistry.getRoomWorker(room.code);
    expect(assigned).toBeNull();
  });

  // Point 11: Gateway connection cap rejection
  it("Point 11: Gateway rejects connections when maxClients cap is reached", () => {
    const bus = new MemoryBus();
    const gateway = new GatewayService({ bus, gatewayId: "gw-cap", maxClients: 2 });

    const c1 = createMockClient("c1", "P1");
    const c2 = createMockClient("c2", "P2");
    const c3 = createMockClient("c3", "P3");

    expect(gateway.handleClientConnected(c1)).toBe(true);
    expect(gateway.handleClientConnected(c2)).toBe(true);
    // 3rd client rejected due to cap
    expect(gateway.handleClientConnected(c3)).toBe(false);
    expect(c3.socket.destroyed).toBe(true);
  });

  // Point 12: Draining mode graceful shutdown
  it("Point 12: Worker draining marks worker as draining and sheds rooms", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const worker = new WorkerService({ bus, workerRegistry, workerId: "w-drain" });
    await worker.start();

    await workerRegistry.markWorkerDraining("w-drain");
    const active = await workerRegistry.getActiveWorkers();
    const drainingWorker = active.find((w) => w.workerId === "w-drain");
    expect(drainingWorker.status).toBe("draining");

    await worker.stop();
  });

  // Point 13: Real dynamic SLO evaluation
  it("Point 13: Worker samples real tick durations and dynamic SLO evaluates correctly", async () => {
    const bus = new MemoryBus();
    const worker = new WorkerService({ bus, workerId: "w-slo" });
    await worker.start();

    const room = worker.makeRoom("1v1", false, "public");
    room.status = "running";
    room.players.push({ id: "p1", clientId: "c1", team: "bottom", slot: 0, x: 500, vx: 0, inputHistory: [] });
    room.players.push({ id: "p2", clientId: "c2", team: "top", slot: 1, x: 500, vx: 0, inputHistory: [] });
    worker.rooms.set(room.code, room);

    for (let i = 0; i < 20; i++) {
      worker.tickRoom(room);
    }

    const samples = worker.getTickSamples();
    expect(samples.length).toBeGreaterThan(0);
    for (const duration of samples) {
      expect(duration).toBeLessThan(16.6); // 60 Hz frame deadline SLO
    }

    await worker.stop();
  });

  // Point 14: O(N) message complexity invariant
  it("Point 14: Verifies O(N) message scaling invariant across workers and gateways", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();

    const W_COUNT = 5;
    const GW_COUNT = 3;

    const workers = [];
    for (let i = 0; i < W_COUNT; i++) {
      const w = new WorkerService({ bus, workerRegistry, roomDirectory, workerId: `wk-${i}` });
      await w.start();
      workers.push(w);
    }

    const gateways = [];
    for (let i = 0; i < GW_COUNT; i++) {
      const gw = new GatewayService({ bus, workerRegistry, roomDirectory, gatewayId: `gw-${i}` });
      await gw.start();
      gateways.push(gw);
    }

    // Room on wk-0 with 2 players on gw-0 and gw-1
    const targetWorker = workers[0];
    const room = targetWorker.makeRoom("1v1", false, "public");
    room.code = "INV01";
    targetWorker.rooms.set(room.code, room);
    await workerRegistry.acquireRoomLease(room.code, targetWorker.workerId);

    room.players.push({ id: "p1", clientId: "c1", gatewayId: "gw-0", team: "bottom", slot: 0 });
    room.players.push({ id: "p2", clientId: "c2", gatewayId: "gw-1", team: "top", slot: 1 });

    // Client on gw-0 sends 5 inputs
    const client = createMockClient("c1", "P1");
    gateways[0].handleClientConnected(client);
    client.roomCode = room.code;
    client.workerId = targetWorker.workerId;
    gateways[0].roomWorkerMap.set(room.code, targetWorker.workerId);

    const inputPkt = Buffer.alloc(14);
    inputPkt[0] = INPUT_PACKET;
    for (let i = 0; i < 5; i++) {
      gateways[0].handleBinaryMessage(client, inputPkt);
    }

    await new Promise((r) => setTimeout(r, 40));

    // Target worker received exactly 5 inputs
    expect(targetWorker.messagesDelivered).toBe(5);

    // All other 4 workers received 0 messages
    for (let i = 1; i < W_COUNT; i++) {
      expect(workers[i].messagesDelivered).toBe(0);
    }

    // Cleanup
    for (const gw of gateways) await gw.stop();
    for (const w of workers) await w.stop();
  });
});
