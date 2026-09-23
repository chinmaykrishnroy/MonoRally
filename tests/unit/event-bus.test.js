import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBus, matchSubject } from "../../server/src/bus/memory-bus.js";

describe("EventBus & Pattern Matching", () => {
  describe("matchSubject", () => {
    it("matches exact subjects", () => {
      expect(matchSubject("room.ABCD.input", "room.ABCD.input")).toBe(true);
      expect(matchSubject("room.ABCD.input", "room.WXYZ.input")).toBe(false);
    });

    it("matches single token wildcard (*)", () => {
      expect(matchSubject("room.*.input", "room.ABCD.input")).toBe(true);
      expect(matchSubject("room.*.input", "room.1234.input")).toBe(true);
      expect(matchSubject("room.*.input", "room.ABCD.extra.input")).toBe(false);
      expect(matchSubject("*.ABCD.input", "room.ABCD.input")).toBe(true);
      expect(matchSubject("room.*.*", "room.ABCD.input")).toBe(true);
    });

    it("matches multi token wildcard (>)", () => {
      expect(matchSubject("room.>", "room.ABCD")).toBe(true);
      expect(matchSubject("room.>", "room.ABCD.input")).toBe(true);
      expect(matchSubject("room.>", "room.ABCD.physics.snapshot")).toBe(true);
      expect(matchSubject("room.>", "other.ABCD")).toBe(false);
      expect(matchSubject(">", "any.arbitrary.subject")).toBe(true);
    });
  });

  describe("MemoryBus", () => {
    let bus;

    beforeEach(() => {
      bus = new MemoryBus();
    });

    afterEach(async () => {
      await bus.close();
    });

    it("publishes and receives messages on subscribed subjects", async () => {
      const received = [];
      await bus.subscribe("chat.general", (data) => {
        received.push(data);
      });

      await bus.publish("chat.general", { text: "hello" });
      await bus.publish("chat.general", { text: "world" });

      await new Promise((r) => setTimeout(r, 15));
      expect(received).toEqual([{ text: "hello" }, { text: "world" }]);
    });

    it("supports wildcard subscriptions", async () => {
      const received = [];
      await bus.subscribe("room.*.broadcast", (data, replyTo, subject) => {
        received.push({ data, subject });
      });

      await bus.publish("room.ROOM1.broadcast", { score: [1, 0] });
      await bus.publish("room.ROOM2.broadcast", { score: [2, 1] });
      await bus.publish("room.ROOM1.other", { ignored: true });

      await new Promise((r) => setTimeout(r, 15));
      expect(received.length).toBe(2);
      expect(received[0].subject).toBe("room.ROOM1.broadcast");
      expect(received[1].subject).toBe("room.ROOM2.broadcast");
    });

    it("transmits binary Uint8Array / Buffer payloads intact", async () => {
      const received = [];
      await bus.subscribe("room.1.binary", (data) => {
        received.push(data);
      });

      const binaryData = new Uint8Array([0x05, 0x10, 0x20, 0x30, 0xFF]);
      await bus.publish("room.1.binary", binaryData);

      await new Promise((r) => setTimeout(r, 15));
      expect(received.length).toBe(1);
      expect(received[0]).toEqual(binaryData);
    });

    it("allows unsubscribing from subjects", async () => {
      const received = [];
      const sub = await bus.subscribe("events", (data) => {
        received.push(data);
      });

      await bus.publish("events", "first");
      await new Promise((r) => setTimeout(r, 15));
      expect(received).toEqual(["first"]);

      sub.unsubscribe();
      await bus.publish("events", "second");
      await new Promise((r) => setTimeout(r, 15));
      expect(received).toEqual(["first"]);
    });

    it("handles request-reply RPC pattern", async () => {
      await bus.subscribe("worker.allocate", (data, replyTo) => {
        if (replyTo) {
          bus.publish(replyTo, { allocated: true, roomId: data.roomId, workerId: "worker-1" });
        }
      });

      const reply = await bus.request("worker.allocate", { roomId: "R123" }, 500);
      expect(reply).toEqual({ allocated: true, roomId: "R123", workerId: "worker-1" });
    });

    it("times out request when no replier responds", async () => {
      await expect(bus.request("unhandled.subject", {}, 50)).rejects.toThrow("MemoryBus request timeout");
    });

    it("distributes messages among subscribers in a queue group", async () => {
      const g1Received = [];
      const g2Received = [];
      const standardReceived = [];

      await bus.subscribe("tasks", (d) => standardReceived.push(d));
      await bus.subscribe("tasks", (d) => g1Received.push(d), { queue: "workers" });
      await bus.subscribe("tasks", (d) => g2Received.push(d), { queue: "workers" });

      await bus.publish("tasks", 1);
      await bus.publish("tasks", 2);
      await bus.publish("tasks", 3);
      await bus.publish("tasks", 4);

      await new Promise((r) => setTimeout(r, 20));

      expect(standardReceived).toEqual([1, 2, 3, 4]);
      // Each message reached exactly one worker in the group
      expect(g1Received.length + g2Received.length).toBe(4);
      expect(g1Received.length).toBe(2);
      expect(g2Received.length).toBe(2);
    });
  });
});
