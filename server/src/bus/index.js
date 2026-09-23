import { MemoryBus } from "./memory-bus.js";
import { NatsBus } from "./nats-bus.js";

/**
 * Creates and initializes the event bus.
 * Automatically falls back to MemoryBus if NATS is unavailable or not configured.
 */
export async function createEventBus(options = {}) {
  const type = options.type || process.env.BUS_TYPE || (process.env.NATS_URL ? "nats" : "memory");
  const allowFallback = options.allowFallback ?? (process.env.SERVICE_ROLE === "unified" || process.env.NODE_ENV === "test");
  if (type === "nats") {
    try {
      return await NatsBus.connect(options);
    } catch (err) {
      if (allowFallback) {
        console.warn(
          `[EventBus] Could not connect to NATS (${err.message}). Falling back to MemoryBus for local/test mode.`
        );
        return new MemoryBus();
      }
      throw new Error(
        `[EventBus] Fatal: NATS connection required for role "${process.env.SERVICE_ROLE || "distributed"}" failed: ${err.message}`
      );
    }
  }
  return new MemoryBus();
}

export { EventBus } from "./event-bus.js";
export { MemoryBus } from "./memory-bus.js";
export { NatsBus } from "./nats-bus.js";
