const DEFAULT_TTL_SECONDS = 7 * 24 * 3600; // 7 days

export function createSessionStore(redis = null) {
  if (redis) {
    return {
      async get(sessionId) {
        if (!sessionId) return null;
        const raw = await redis.get(`session:${sessionId}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      async set(sessionId, data, ttlSeconds = DEFAULT_TTL_SECONDS) {
        if (!sessionId) return;
        await redis.set(`session:${sessionId}`, JSON.stringify(data), "EX", ttlSeconds);
      },
      async touch(sessionId, ttlSeconds = DEFAULT_TTL_SECONDS) {
        if (!sessionId) return;
        await redis.expire(`session:${sessionId}`, ttlSeconds);
      },
      async delete(sessionId) {
        if (!sessionId) return;
        await redis.del(`session:${sessionId}`);
      }
    };
  }

  // In-memory fallback
  const store = new Map();
  return {
    async get(sessionId) {
      if (!sessionId) return null;
      const record = store.get(sessionId);
      if (!record) return null;
      if (Date.now() > record.expiresAt) {
        store.delete(sessionId);
        return null;
      }
      return record.data;
    },
    async set(sessionId, data, ttlSeconds = DEFAULT_TTL_SECONDS) {
      if (!sessionId) return;
      store.set(sessionId, {
        data,
        expiresAt: Date.now() + ttlSeconds * 1000
      });
    },
    async touch(sessionId, ttlSeconds = DEFAULT_TTL_SECONDS) {
      if (!sessionId) return;
      const record = store.get(sessionId);
      if (record) record.expiresAt = Date.now() + ttlSeconds * 1000;
    },
    async delete(sessionId) {
      if (!sessionId) return;
      store.delete(sessionId);
    }
  };
}
