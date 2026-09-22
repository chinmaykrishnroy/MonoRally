/**
 * WorkerRegistry and Room Lease Manager.
 * Manages active worker registrations, capacity-aware load balancing,
 * and distributed room ownership leases with Redis or memory fallback.
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
      ...workerInfo,
      lastHeartbeat: Date.now()
    });
    const pipeline = this.redis.pipeline();
    pipeline.set(key, payload, "EX", ttlSeconds);
    pipeline.sadd("workers:active", workerInfo.workerId);
    await pipeline.exec();
  }

  async unregisterWorker(workerId) {
    const key = `worker:${workerId}`;
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem("workers:active", workerId);
    await pipeline.exec();
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
      const activeRooms = w.activeRooms || 0;
      const capacity = w.maxRooms || maxRoomsPerWorker;
      if (activeRooms < capacity) {
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
}

export class MemoryWorkerRegistry {
  constructor() {
    this.workers = new Map(); // workerId -> { info, expiresAt }
    this.leases = new Map(); // roomCode -> { workerId, expiresAt }
  }

  async registerWorkerHeartbeat(workerInfo, ttlSeconds = 10) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.workers.set(workerInfo.workerId, {
      info: { ...workerInfo, lastHeartbeat: Date.now() },
      expiresAt
    });
  }

  async unregisterWorker(workerId) {
    this.workers.delete(workerId);
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
      const activeRooms = w.activeRooms || 0;
      const capacity = w.maxRooms || maxRoomsPerWorker;
      if (activeRooms < capacity) {
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
}

export function createWorkerRegistry(redisClient = null) {
  if (redisClient) {
    return new RedisWorkerRegistry(redisClient);
  }
  return new MemoryWorkerRegistry();
}
