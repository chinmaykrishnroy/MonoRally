import Redis from "ioredis";

export function createRedisClient(connectionString, options = {}) {
  if (!connectionString) return null;
  const client = new Redis(connectionString, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > 10) return null; // Stop retrying after 10 attempts
      return Math.min(times * 100, 3000);
    },
    ...options
  });

  client.on("error", (err) => {
    console.error("[redis.client] Redis connection error", err.message);
  });

  return client;
}

export async function checkRedisHealth(client) {
  if (!client) return { healthy: false, reason: "Redis client not configured" };
  const start = performance.now();
  try {
    const reply = await client.ping();
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    return { healthy: reply === "PONG", latencyMs };
  } catch (error) {
    return {
      healthy: false,
      reason: error.message,
      latencyMs: Math.round((performance.now() - start) * 100) / 100
    };
  }
}

export async function closeRedisClient(client) {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
