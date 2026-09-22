import { EventBus } from "./event-bus.js";

/**
 * Matches dot-separated subject patterns against a subject string.
 * Supports NATS-style wildcard semantics:
 *  - '*' matches exactly one token
 *  - '>' matches one or more remaining tokens at the end of the pattern
 */
export function matchSubject(pattern, subject) {
  if (pattern === subject) return true;
  if (pattern === ">") return true;
  const pTokens = pattern.split(".");
  const sTokens = subject.split(".");
  for (let i = 0; i < pTokens.length; i++) {
    const p = pTokens[i];
    if (p === ">") return true;
    if (i >= sTokens.length) return false;
    if (p !== "*" && p !== sTokens[i]) return false;
  }
  return pTokens.length === sTokens.length;
}

/**
 * High-performance In-Memory EventBus with NATS semantics.
 * Ideal for standalone unified deployments, local development, and isolated tests.
 */
export class MemoryBus extends EventBus {
  constructor() {
    super();
    this.subscriptions = new Set();
    this.closed = false;
  }

  async publish(subject, data, replyTo = undefined) {
    if (this.closed) return;
    const matches = [];
    for (const sub of this.subscriptions) {
      if (matchSubject(sub.pattern, subject)) {
        matches.push(sub.handler);
      }
    }
    if (matches.length === 0) return;

    // Asynchronous dispatch preserves event loop interleaving like a real network bus
    queueMicrotask(() => {
      for (const handler of matches) {
        try {
          handler(data, replyTo, subject);
        } catch (err) {
          console.error(`[MemoryBus] Error handling message on subject "${subject}":`, err);
        }
      }
    });
  }

  async subscribe(subject, handler) {
    if (this.closed) {
      throw new Error("Cannot subscribe to closed MemoryBus");
    }
    const sub = { pattern: subject, handler };
    this.subscriptions.add(sub);
    return {
      unsubscribe: () => {
        this.subscriptions.delete(sub);
      }
    };
  }

  async request(subject, data, timeoutMs = 2000) {
    if (this.closed) {
      throw new Error("Cannot request on closed MemoryBus");
    }
    const inbox = `_INBOX.${Math.random().toString(36).slice(2)}.${Date.now()}`;
    return new Promise((resolve, reject) => {
      let timer = null;
      let sub = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (sub) sub.unsubscribe();
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`MemoryBus request timeout on subject "${subject}" after ${timeoutMs}ms`));
      }, timeoutMs);

      this.subscribe(inbox, (replyData) => {
        cleanup();
        resolve(replyData);
      }).then((subscription) => {
        sub = subscription;
        this.publish(subject, data, inbox);
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  async close() {
    this.closed = true;
    this.subscriptions.clear();
  }
}
