export function createDistributedRateLimiter(redis = null) {
  if (redis) {
    return {
      async allow(identity, action, limit = 100, windowSeconds = 1) {
        const key = `rate:${identity}:${action}`;
        const current = await redis.incr(key);
        if (current === 1) {
          await redis.expire(key, windowSeconds);
        }
        return current <= limit;
      }
    };
  }

  // In-memory fallback
  const windows = new Map();
  return {
    async allow(identity, action, limit = 100, windowSeconds = 1) {
      const key = `${identity}:${action}`;
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const record = windows.get(key);

      if (!record || now - record.startedAt >= windowMs) {
        windows.set(key, { count: 1, startedAt: now });
        return true;
      }

      record.count += 1;
      return record.count <= limit;
    }
  };
}
