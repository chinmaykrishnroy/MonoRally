const DEFAULT_PRESENCE_TTL_SECONDS = 90;

export function createPresenceStore(redis = null) {
  if (redis) {
    return {
      async setPresence(playerId, status, ttlSeconds = DEFAULT_PRESENCE_TTL_SECONDS) {
        if (!playerId) return;
        const payload = typeof status === "object" ? JSON.stringify(status) : String(status);
        await redis.set(`presence:${playerId}`, payload, "EX", ttlSeconds);
      },
      async getPresence(playerId) {
        if (!playerId) return null;
        const raw = await redis.get(`presence:${playerId}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
      async removePresence(playerId) {
        if (!playerId) return;
        await redis.del(`presence:${playerId}`);
      },
      async heartbeat(playerId, ttlSeconds = DEFAULT_PRESENCE_TTL_SECONDS) {
        if (!playerId) return;
        await redis.expire(`presence:${playerId}`, ttlSeconds);
      }
    };
  }

  // In-memory fallback
  const store = new Map();
  return {
    async setPresence(playerId, status, ttlSeconds = DEFAULT_PRESENCE_TTL_SECONDS) {
      if (!playerId) return;
      store.set(playerId, {
        status,
        expiresAt: Date.now() + ttlSeconds * 1000
      });
    },
    async getPresence(playerId) {
      if (!playerId) return null;
      const record = store.get(playerId);
      if (!record) return null;
      if (Date.now() > record.expiresAt) {
        store.delete(playerId);
        return null;
      }
      return record.status;
    },
    async removePresence(playerId) {
      if (!playerId) return;
      store.delete(playerId);
    },
    async heartbeat(playerId, ttlSeconds = DEFAULT_PRESENCE_TTL_SECONDS) {
      if (!playerId) return;
      const record = store.get(playerId);
      if (record) record.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  };
}
