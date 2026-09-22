import { MemoryBus } from "./memory-bus.js";
import { NatsBus } from "./nats-bus.js";

/**
 * Creates and initializes the event bus.
 * Automatically falls back to MemoryBus if NATS is unavailable or not configured.
 */
export async function createEventBus(options = {}) {
  const type = options.type || process.env.BUS_TYPE || (process.env.NATS_URL ? "nats" : "memory");
  if (type === "nats") {
    try {
      return await NatsBus.connect(options);
    } catch (err) {
      console.warn(
        `[EventBus] Could not connect to NATS (${err.message}). Falling back to high-performance MemoryBus.`
      );
      return new MemoryBus();
    }
  }
  return new MemoryBus();
}

export { EventBus } from "./event-bus.js";
export { MemoryBus } from "./memory-bus.js";
export { NatsBus } from "./nats-bus.js";
