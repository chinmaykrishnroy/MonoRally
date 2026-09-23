import { describe, it, expect } from "vitest";
import { MemoryBus } from "../../server/src/bus/memory-bus.js";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { MemoryRoomDirectory } from "../../server/src/redis/room-directory.js";
import { WorkerService } from "../../server/src/services/worker-service.js";
import { INPUT_PACKET } from "../../server/src/config.js";

describe("P0 - Worker Partitioning & O(1) Input Routing", () => {
  it("proves 20 workers with 1 active room receives inputs ONLY on the assigned worker", async () => {
    const bus = new MemoryBus();
    const workerRegistry = new MemoryWorkerRegistry();
    const roomDirectory = new MemoryRoomDirectory();

    const WORKER_COUNT = 20;
    const workers = [];

    // Spin up 20 authoritative workers
    for (let i = 1; i <= WORKER_COUNT; i++) {
      const worker = new WorkerService({
        bus,
        workerRegistry,
        roomDirectory,
        workerId: `worker-${i}`,
        maxRooms: 50
      });
      await worker.start();
      workers.push(worker);
    }

    const assignedWorkerIndex = 6; // worker-7 (0-indexed 6)
    const assignedWorker = workers[assignedWorkerIndex];
    expect(assignedWorker.workerId).toBe("worker-7");

    // Assign room 'PART01' to worker-7
    const room = assignedWorker.makeRoom("1v1", false, "public");
    room.code = "PART01";
    assignedWorker.rooms.set(room.code, room);

    // Add a player to the room
    room.players.push({
      id: "p1",
      clientId: "c1",
      name: "Player 1",
      sessionId: "s1",
      team: "bottom",
      slot: 0,
      x: 500,
      targetX: 500,
      vx: 0,
      inputHistory: []
    });

    // Create binary input packet
    const inputPacket = Buffer.alloc(14);
    inputPacket[0] = INPUT_PACKET;
    inputPacket.writeUInt16BE(32768, 1);
    inputPacket.writeUInt16BE(1, 3);
    inputPacket.writeUInt32BE(1000, 5);
    inputPacket.writeUInt16BE(500, 9);
    inputPacket.writeInt16BE(0, 11);
    inputPacket[13] = 1;

    // Publish input specifically to the assigned worker's partition
    bus.publish(`worker.${assignedWorker.workerId}.room.${room.code}.input`, {
      clientId: "c1",
      data: inputPacket
    });

    // Allow bus dispatch
    await new Promise((r) => setTimeout(r, 50));

    // Verify assigned worker processed the input
    expect(assignedWorker.messagesDelivered).toBe(1);
    expect(assignedWorker.messagesConsumed).toBe(1);

    // Verify ALL other 19 workers received ZERO messages
    for (let i = 0; i < WORKER_COUNT; i++) {
      if (i !== assignedWorkerIndex) {
        expect(workers[i].messagesDelivered).toBe(0);
        expect(workers[i].messagesConsumed).toBe(0);
      }
    }

    // Send a command to worker-7
    bus.publish(`worker.${assignedWorker.workerId}.room.${room.code}.command`, {
      action: "cheer",
      clientId: "c1",
      emoji: "🔥"
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(assignedWorker.messagesDelivered).toBe(2);
    expect(assignedWorker.messagesConsumed).toBe(2);

    // Still 0 for all other 19 workers
    for (let i = 0; i < WORKER_COUNT; i++) {
      if (i !== assignedWorkerIndex) {
        expect(workers[i].messagesDelivered).toBe(0);
        expect(workers[i].messagesConsumed).toBe(0);
      }
    }

    // Clean up
    for (const w of workers) {
      await w.stop();
    }
  });
});
