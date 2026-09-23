/**
 * RoomDirectory
 * Stores cluster-visible coarse room metadata in Redis (or in-memory for testing/local dev).
 * Provides cluster-wide pagination for public rooms without coupling to a single process Map.
 */

export class RedisRoomDirectory {
  constructor(redis, { ttlSeconds = 60 } = {}) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
  }

  _roomKey(code) {
    return `room:dir:${code}`;
  }

  async upsertRoom(roomMeta, ttl = this.ttlSeconds) {
    const key = this._roomKey(roomMeta.code);
    const now = Date.now();
    const data = {
      code: roomMeta.code,
      mode: roomMeta.mode || "1v1",
      status: roomMeta.status || "waiting",
      playerCount: Number(roomMeta.playerCount) || 0,
      maxPlayers: Number(roomMeta.maxPlayers) || (roomMeta.mode === "2v2" ? 4 : 2),
      spectatorCount: Number(roomMeta.spectatorCount) || 0,
      visibility: roomMeta.visibility || "public",
      workerId: roomMeta.workerId || null,
      createdAt: roomMeta.createdAt || now,
      updatedAt: now
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(data), "EX", ttl);

    if (data.visibility === "public" && data.status !== "ended") {
      pipeline.zadd("rooms:public", data.createdAt, data.code);
    } else {
      pipeline.zrem("rooms:public", data.code);
    }

    await pipeline.exec();
    return data;
  }

  async removeRoom(code) {
    const key = this._roomKey(code);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.zrem("rooms:public", code);
    await pipeline.exec();
  }

  async getRoom(code) {
    const key = this._roomKey(code);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async listPublicRooms({ page = 1, pageSize = 10 } = {}) {
    const p = Math.max(1, Number(page) || 1);
    const limit = Math.max(1, Math.min(50, Number(pageSize) || 10));
    const start = (p - 1) * limit;
    const stop = start + limit - 1;

    const total = await this.redis.zcard("rooms:public");
    if (total === 0) {
      return { rooms: [], total: 0, page: p, pageSize: limit, totalPages: 0 };
    }

    const codes = await this.redis.zrevrange("rooms:public", start, stop);
    if (!codes || codes.length === 0) {
      return { rooms: [], total, page: p, pageSize: limit, totalPages: Math.ceil(total / limit) };
    }

    const keys = codes.map((c) => this._roomKey(c));
    const raws = await this.redis.mget(...keys);

    const rooms = [];
    const deadCodes = [];

    for (let i = 0; i < codes.length; i++) {
      const raw = raws[i];
      if (raw) {
        try {
          rooms.push(JSON.parse(raw));
        } catch {
          deadCodes.push(codes[i]);
        }
      } else {
        deadCodes.push(codes[i]);
      }
    }

    if (deadCodes.length > 0) {
      await this.redis.zrem("rooms:public", ...deadCodes);
    }

    return {
      rooms,
      total: Math.max(0, total - deadCodes.length),
      page: p,
      pageSize: limit,
      totalPages: Math.ceil(Math.max(0, total - deadCodes.length) / limit)
    };
  }
}

export class MemoryRoomDirectory {
  constructor() {
    this.rooms = new Map(); // code -> meta
  }

  async upsertRoom(roomMeta, ttl = 60) {
    const now = Date.now();
    const data = {
      code: roomMeta.code,
      mode: roomMeta.mode || "1v1",
      status: roomMeta.status || "waiting",
      playerCount: Number(roomMeta.playerCount) || 0,
      maxPlayers: Number(roomMeta.maxPlayers) || (roomMeta.mode === "2v2" ? 4 : 2),
      spectatorCount: Number(roomMeta.spectatorCount) || 0,
      visibility: roomMeta.visibility || "public",
      workerId: roomMeta.workerId || null,
      createdAt: roomMeta.createdAt || now,
      updatedAt: now,
      expiresAt: now + ttl * 1000
    };
    this.rooms.set(roomMeta.code, data);
    return data;
  }

  async removeRoom(code) {
    this.rooms.delete(code);
  }

  async getRoom(code) {
    const entry = this.rooms.get(code);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.rooms.delete(code);
      return null;
    }
    return entry;
  }

  async listPublicRooms({ page = 1, pageSize = 10 } = {}) {
    const now = Date.now();
    const active = [];
    for (const [code, entry] of this.rooms.entries()) {
      if (now > entry.expiresAt) {
        this.rooms.delete(code);
      } else if (entry.visibility === "public" && entry.status !== "ended") {
        active.push(entry);
      }
    }

    active.sort((a, b) => b.createdAt - a.createdAt);

    const p = Math.max(1, Number(page) || 1);
    const limit = Math.max(1, Math.min(50, Number(pageSize) || 10));
    const start = (p - 1) * limit;
    const paginated = active.slice(start, start + limit);

    return {
      rooms: paginated,
      total: active.length,
      page: p,
      pageSize: limit,
      totalPages: Math.ceil(active.length / limit)
    };
  }
}

export function createRoomDirectory(redis = null, options = {}) {
  if (redis) {
    return new RedisRoomDirectory(redis, options);
  }
  return new MemoryRoomDirectory();
}
