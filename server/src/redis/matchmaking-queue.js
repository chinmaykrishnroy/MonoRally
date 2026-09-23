/**
 * MatchmakingQueue
 * Provides atomic, distributed matchmaking queue operations backed by Redis
 * (with an in-memory equivalent for local development and testing).
 * Supports regional queues, duplicate protection, atomic group claims,
 * and stale entry eviction.
 */

const ENQUEUE_LUA = `
local queueKey = KEYS[1]
local entryKey = KEYS[2]
local clientId = ARGV[1]
local enqueuedAt = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])
local payload = ARGV[4]

redis.call("zadd", queueKey, enqueuedAt, clientId)
redis.call("set", entryKey, payload, "EX", ttlSeconds)
return redis.call("zcard", queueKey)
`;

const DEQUEUE_LUA = `
local queueKey = KEYS[1]
local entryKey = KEYS[2]
local clientId = ARGV[1]

local removed = redis.call("zrem", queueKey, clientId)
redis.call("del", entryKey)
return removed
`;

const CLAIM_GROUP_LUA = `
local queueKey = KEYS[1]
local needed = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local maxWaitMs = tonumber(ARGV[3])
local prefix = ARGV[4]

-- Prune expired entries older than maxWaitMs * 3
local cutoff = now - (maxWaitMs * 3)
local expired = redis.call("zrangebyscore", queueKey, "-inf", cutoff)
for _, id in ipairs(expired) do
  redis.call("zrem", queueKey, id)
  redis.call("del", prefix .. id)
end

local count = redis.call("zcard", queueKey)
if count < needed then
  return {}
end

local candidateIds = redis.call("zrange", queueKey, 0, needed - 1)
local claimed = {}

for _, id in ipairs(candidateIds) do
  local raw = redis.call("get", prefix .. id)
  if raw then
    table.insert(claimed, raw)
    redis.call("zrem", queueKey, id)
    redis.call("del", prefix .. id)
  else
    -- Entry expired from hash; remove phantom from ZSET
    redis.call("zrem", queueKey, id)
  end
end

if #claimed == needed then
  return claimed
else
  -- Rollback partial claim if any entry was missing
  for _, raw in ipairs(claimed) do
    local decoded = cjson.decode(raw)
    redis.call("zadd", queueKey, decoded.enqueuedAt or now, decoded.clientId)
    redis.call("set", prefix .. decoded.clientId, raw, "EX", math.floor(maxWaitMs / 1000) * 2)
  end
  return {}
end
`;

const CLAIM_TIMED_OUT_LUA = `
local queueKey = KEYS[1]
local now = tonumber(ARGV[1])
local fallbackMs = tonumber(ARGV[2])
local prefix = ARGV[3]

local cutoff = now - fallbackMs
local candidates = redis.call("zrangebyscore", queueKey, "-inf", cutoff, "LIMIT", 0, 1)
if #candidates == 0 then
  return nil
end

local id = candidates[1]
local raw = redis.call("get", prefix .. id)
redis.call("zrem", queueKey, id)
redis.call("del", prefix .. id)

if raw then
  return raw
else
  return nil
end
`;

export class RedisMatchmakingQueue {
  constructor(redis, { region = "default", ttlSeconds = 60 } = {}) {
    this.redis = redis;
    this.region = region;
    this.ttlSeconds = ttlSeconds;
  }

  _queueKey(mode) {
    return `mm:queue:${this.region}:${mode}`;
  }

  _entryKey(clientId) {
    return `mm:entry:${clientId}`;
  }

  async enqueue(player) {
    const mode = player.mode === "2v2" ? "2v2" : "1v1";
    const queueKey = this._queueKey(mode);
    const entryKey = this._entryKey(player.clientId);
    const enqueuedAt = player.enqueuedAt || Date.now();
    const payload = JSON.stringify({
      ...player,
      mode,
      region: this.region,
      enqueuedAt
    });

    const depth = await this.redis.eval(
      ENQUEUE_LUA,
      2,
      queueKey,
      entryKey,
      player.clientId,
      enqueuedAt,
      this.ttlSeconds,
      payload
    );
    return Number(depth);
  }

  async dequeue(clientId, mode = "1v1") {
    const entryKey = this._entryKey(clientId);
    for (const m of ["1v1", "2v2"]) {
      const queueKey = this._queueKey(m);
      await this.redis.eval(DEQUEUE_LUA, 2, queueKey, entryKey, clientId);
    }
  }

  async claimGroup(mode, count, maxWaitMs = 120000) {
    const queueKey = this._queueKey(mode);
    const prefix = "mm:entry:";
    const now = Date.now();

    const claimedStrings = await this.redis.eval(
      CLAIM_GROUP_LUA,
      1,
      queueKey,
      count,
      now,
      maxWaitMs,
      prefix
    );

    if (!claimedStrings || claimedStrings.length === 0) return [];
    return claimedStrings.map((s) => JSON.parse(s));
  }

  async claimTimedOut(mode, fallbackMs) {
    const queueKey = this._queueKey(mode);
    const prefix = "mm:entry:";
    const now = Date.now();

    const raw = await this.redis.eval(
      CLAIM_TIMED_OUT_LUA,
      1,
      queueKey,
      now,
      fallbackMs,
      prefix
    );

    if (!raw) return null;
    return JSON.parse(raw);
  }

  async getQueueDepth(mode) {
    const queueKey = this._queueKey(mode);
    return await this.redis.zcard(queueKey);
  }

  async getTotalDepth() {
    const d1 = await this.getQueueDepth("1v1");
    const d2 = await this.getQueueDepth("2v2");
    return d1 + d2;
  }
}

export class MemoryMatchmakingQueue {
  constructor({ region = "default" } = {}) {
    this.region = region;
    this.queues = {
      "1v1": new Map(), // clientId -> entry
      "2v2": new Map()
    };
  }

  async enqueue(player) {
    const mode = player.mode === "2v2" ? "2v2" : "1v1";
    const q = this.queues[mode];
    // Remove if previously queued in either mode
    this.queues["1v1"].delete(player.clientId);
    this.queues["2v2"].delete(player.clientId);

    const enqueuedAt = player.enqueuedAt || Date.now();
    q.set(player.clientId, {
      ...player,
      mode,
      region: this.region,
      enqueuedAt
    });
    return q.size;
  }

  async dequeue(clientId) {
    const r1 = this.queues["1v1"].delete(clientId);
    const r2 = this.queues["2v2"].delete(clientId);
    return r1 || r2 ? 1 : 0;
  }

  async claimGroup(mode, count) {
    const q = this.queues[mode];
    if (q.size < count) return [];

    const entries = Array.from(q.values())
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
      .slice(0, count);

    for (const e of entries) {
      q.delete(e.clientId);
    }
    return entries;
  }

  async claimTimedOut(mode, fallbackMs) {
    const q = this.queues[mode];
    const now = Date.now();
    const sorted = Array.from(q.values()).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (const entry of sorted) {
      if (now - entry.enqueuedAt >= fallbackMs) {
        q.delete(entry.clientId);
        return entry;
      }
    }
    return null;
  }

  async getQueueDepth(mode) {
    return this.queues[mode]?.size || 0;
  }

  async getTotalDepth() {
    return (this.queues["1v1"]?.size || 0) + (this.queues["2v2"]?.size || 0);
  }
}

export function createMatchmakingQueue(redis = null, options = {}) {
  if (redis) {
    return new RedisMatchmakingQueue(redis, options);
  }
  return new MemoryMatchmakingQueue(options);
}
