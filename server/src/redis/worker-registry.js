/**
 * WorkerRegistry and Room Lease Manager.
 * Manages active worker registrations, capacity-aware load balancing,
 * worker draining for zero-match-drop rollouts, and distributed room ownership leases
 * with Redis or memory fallback.
 */

const RENEW_LEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_LEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export class RedisWorkerRegistry {
  constructor(redis) {
    this.redis = redis;
  }

  async registerWorkerHeartbeat(workerInfo, ttlSeconds = 10) {
    const key = `worker:${workerInfo.workerId}`;
    const payload = JSON.stringify({
      status: "ready",
      ...workerInfo,
      lastHeartbeat: Date.now()
    });
    const pipeline = this.redis.pipeline();
    pipeline.set(key, payload, "EX", ttlSeconds);
    pipeline.sadd("workers:active", workerInfo.workerId);
    await pipeline.exec();
  }

  async markWorkerDraining(workerId, ttlSeconds = 120) {
    const key = `worker:${workerId}`;
    const raw = await this.redis.get(key);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      data.status = "draining";
      await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
      return true;
    } catch {
      return false;
    }
  }

  async unregisterWorker(workerId) {
    const key = `worker:${workerId}`;
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem("workers:active", workerId);
    await pipeline.exec();
  }

  async isWorkerAvailable(workerId) {
    if (!workerId) return false;
    const key = `worker:${workerId}`;
    const raw = await this.redis.get(key);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      return data.status === "ready" || data.status === "draining";
    } catch {
      return false;
    }
  }

  async getActiveWorkers() {
    const workerIds = await this.redis.smembers("workers:active");
    if (!workerIds || workerIds.length === 0) return [];

    const keys = workerIds.map((id) => `worker:${id}`);
    const values = await this.redis.mget(...keys);

    const active = [];
    const deadWorkerIds = [];

    for (let i = 0; i < workerIds.length; i++) {
      const val = values[i];
      if (val) {
        try {
          active.push(JSON.parse(val));
        } catch {
          // ignore corrupted
        }
      } else {
        deadWorkerIds.push(workerIds[i]);
      }
    }

    if (deadWorkerIds.length > 0) {
      await this.redis.srem("workers:active", ...deadWorkerIds);
    }

    return active;
  }

  async getLeastLoadedWorker(maxRoomsPerWorker = 50) {
    const workers = await this.getActiveWorkers();
    let best = null;

    for (const w of workers) {
      if (w.status === "draining") continue; // Exclude draining workers from matchmaking
      const activeRooms = w.activeRooms || 0;
      const capacity = w.maxRooms || maxRoomsPerWorker;
      const safeCapacity = Math.max(1, Math.floor(capacity * 0.85));
      if (activeRooms < safeCapacity) {
        if (!best || activeRooms < (best.activeRooms || 0)) {
          best = w;
        }
      }
    }

    return best;
  }

  async acquireRoomLease(roomCode, workerId, ttlSeconds = 15) {
    const key = `room:lease:${roomCode}`;
    const res = await this.redis.set(key, workerId, "EX", ttlSeconds, "NX");
    return res === "OK";
  }

  async renewRoomLease(roomCode, workerId, ttlSeconds = 15) {
    const key = `room:lease:${roomCode}`;
    const res = await this.redis.eval(RENEW_LEASE_LUA, 1, key, workerId, ttlSeconds);
    return res === 1;
  }

  async releaseRoomLease(roomCode, workerId) {
    const key = `room:lease:${roomCode}`;
    const res = await this.redis.eval(RELEASE_LEASE_LUA, 1, key, workerId);
    return res === 1;
  }

  async getRoomWorker(roomCode) {
    const key = `room:lease:${roomCode}`;
    return await this.redis.get(key);
  }

  async cleanStaleLeases() {
    const workers = await this.getActiveWorkers();
    const activeSet = new Set(workers.map((w) => w.workerId));
    // Redis keys are automatically expired by TTL; this handles active verification
    return activeSet;
  }
}

export class MemoryWorkerRegistry {
  constructor() {
    this.workers = new Map(); // workerId -> { info, expiresAt }
    this.leases = new Map(); // roomCode -> { workerId, expiresAt }
  }

  async registerWorkerHeartbeat(workerInfo, ttlSeconds = 10) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.workers.set(workerInfo.workerId, {
      info: {
        status: "ready",
        ...workerInfo,
        lastHeartbeat: Date.now()
      },
      expiresAt
    });
  }

  async markWorkerDraining(workerId) {
    const entry = this.workers.get(workerId);
    if (!entry) return false;
    entry.info.status = "draining";
    return true;
  }

  async unregisterWorker(workerId) {
    this.workers.delete(workerId);
  }

  async isWorkerAvailable(workerId) {
    if (!workerId) return false;
    const entry = this.workers.get(workerId);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.workers.delete(workerId);
      return false;
    }
    return entry.info.status === "ready" || entry.info.status === "draining";
  }

  async getActiveWorkers() {
    const now = Date.now();
    const active = [];
    for (const [id, entry] of this.workers.entries()) {
      if (entry.expiresAt > now) {
        active.push(entry.info);
      } else {
        this.workers.delete(id);
      }
    }
    return active;
  }

  async getLeastLoadedWorker(maxRoomsPerWorker = 50) {
    const workers = await this.getActiveWorkers();
    let best = null;

    for (const w of workers) {
      if (w.status === "draining") continue; // Exclude draining workers
      const activeRooms = w.activeRooms || 0;
      const capacity = w.maxRooms || maxRoomsPerWorker;
      const safeCapacity = Math.max(1, Math.floor(capacity * 0.85));
      if (activeRooms < safeCapacity) {
        if (!best || activeRooms < (best.activeRooms || 0)) {
          best = w;
        }
      }
    }

    return best;
  }

  async acquireRoomLease(roomCode, workerId, ttlSeconds = 15) {
    const now = Date.now();
    const existing = this.leases.get(roomCode);
    if (!existing || existing.expiresAt <= now) {
      this.leases.set(roomCode, {
        workerId,
        expiresAt: now + ttlSeconds * 1000
      });
      return true;
    }
    if (existing.workerId === workerId) {
      existing.expiresAt = now + ttlSeconds * 1000;
      return true;
    }
    return false;
  }

  async renewRoomLease(roomCode, workerId, ttlSeconds = 15) {
    const now = Date.now();
    const existing = this.leases.get(roomCode);
    if (existing && existing.workerId === workerId && existing.expiresAt > now) {
      existing.expiresAt = now + ttlSeconds * 1000;
      return true;
    }
    return false;
  }

  async releaseRoomLease(roomCode, workerId) {
    const existing = this.leases.get(roomCode);
    if (existing && existing.workerId === workerId) {
      this.leases.delete(roomCode);
      return true;
    }
    return false;
  }

  async getRoomWorker(roomCode) {
    const now = Date.now();
    const existing = this.leases.get(roomCode);
    if (existing && existing.expiresAt > now) {
      return existing.workerId;
    }
    if (existing) {
      this.leases.delete(roomCode);
    }
    return null;
  }

  async cleanStaleLeases() {
    const now = Date.now();
    for (const [code, lease] of this.leases.entries()) {
      if (lease.expiresAt <= now || !this.workers.has(lease.workerId)) {
        this.leases.delete(code);
      }
    }
  }
}

export function createWorkerRegistry(redisClient = null) {
  if (redisClient) {
    return new RedisWorkerRegistry(redisClient);
  }
  return new MemoryWorkerRegistry();
}
