import { EventBus } from "./event-bus.js";

/**
 * Encodes arbitrary data to Uint8Array for NATS transmission.
 */
export function encodePayload(data) {
  if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
    return data;
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  return new TextEncoder().encode(JSON.stringify(data));
}

/**
 * Decodes received NATS Uint8Array payload.
 * Parses JSON if payload begins with JSON structure, otherwise returns raw Uint8Array.
 */
export function decodePayload(uint8) {
  if (!uint8 || uint8.length === 0) return null;
  const firstByte = uint8[0];
  // JSON object '{' is 123, JSON array '[' is 91
  if (firstByte === 123 || firstByte === 91) {
    try {
      const text = new TextDecoder().decode(uint8);
      return JSON.parse(text);
    } catch {
      return uint8;
    }
  }
  return uint8;
}

/**
 * Production NATS Core EventBus implementation for distributed MonoRally clusters.
 */
export class NatsBus extends EventBus {
  constructor(nc) {
    super();
    this.nc = nc;
    this.subscriptions = new Set();
  }

  static async connect(options = {}) {
    const { connect } = await import("nats");
    const url = options.url || process.env.NATS_URL || "nats://127.0.0.1:4222";
    const nc = await connect({
      servers: url,
      name: options.name || `monorally-${process.pid}`,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 1000
    });
    return new NatsBus(nc);
  }

  async publish(subject, data, replyTo = undefined) {
    const payload = encodePayload(data);
    this.nc.publish(subject, payload, { reply: replyTo });
  }

  async subscribe(subject, handler) {
    const natsSub = this.nc.subscribe(subject);
    this.subscriptions.add(natsSub);

    // Consume messages asynchronously from NATS subscription iterator
    (async () => {
      try {
        for await (const m of natsSub) {
          const decoded = decodePayload(m.data);
          try {
            handler(decoded, m.reply, m.subject);
          } catch (err) {
            console.error(`[NatsBus] Error in handler for subject "${m.subject}":`, err);
          }
        }
      } catch (err) {
        // Iterator terminates on unsubscribe
      }
    })();

    return {
      unsubscribe: () => {
        natsSub.unsubscribe();
        this.subscriptions.delete(natsSub);
      }
    };
  }

  async request(subject, data, timeoutMs = 2000) {
    const payload = encodePayload(data);
    const msg = await this.nc.request(subject, payload, { timeout: timeoutMs });
    return decodePayload(msg.data);
  }

  async close() {
    for (const sub of this.subscriptions) {
      try {
        sub.unsubscribe();
      } catch {
        // ignore
      }
    }
    this.subscriptions.clear();
    await this.nc.drain();
  }
}
