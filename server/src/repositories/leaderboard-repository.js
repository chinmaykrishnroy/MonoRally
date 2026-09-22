import crypto from "node:crypto";

const CACHE_TTL_SECONDS = 10;

export function createLeaderboardRepository({ pool = null, redis = null } = {}) {
  if (pool) {
    return new PostgresLeaderboardRepository(pool, redis);
  }
  return new MemoryLeaderboardRepository();
}

export class PostgresLeaderboardRepository {
  constructor(pool, redis = null) {
    this.pool = pool;
    this.redis = redis;
  }

  async recordRoom(room) {
    if (!room || room.status !== "ended" || !room.winner || room.leaderboardRecorded) return;
    const duration = Math.max(1, Math.round(((room.endedAt || performance.now()) - room.startedAt) / 1000));
    const winners = room.players.filter((player) => player.team === room.winner && !player.bot);
    if (!winners.length) return;

    const totalReturns = winners.reduce((sum, player) => sum + (player.returns || 0), 0);
    if (totalReturns <= 0) return;

    const name = winners
      .map((player) => player.name)
      .sort()
      .join(" + ");
    const misses = room.misses[room.winner] ?? 0;
    const mode = room.mode;

    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO leaderboard_entries (id, mode, player_name, score, misses, duration_seconds, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, mode, name, totalReturns, misses, duration]
    );

    room.leaderboardRecorded = true;

    // Invalidate Redis cache if configured
    if (this.redis) {
      await this.redis.del(`leaderboard:${mode}`);
    }
  }

  async top(mode, limit = 10) {
    const cacheKey = `leaderboard:${mode}`;
    if (this.redis) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          // Ignore cache parse error
        }
      }
    }

    const res = await this.pool.query(
      `SELECT player_name AS name, score, misses, duration_seconds AS duration, mode
       FROM leaderboard_entries
       WHERE mode = $1
       ORDER BY score DESC, misses ASC, duration_seconds ASC
       LIMIT $2`,
      [mode, limit]
    );

    const rows = res.rows.map((row) => ({
      name: row.name,
      score: Number(row.score),
      misses: Number(row.misses),
      duration: Number(row.duration),
      mode: row.mode
    }));

    if (this.redis) {
      await this.redis.set(cacheKey, JSON.stringify(rows), "EX", CACHE_TTL_SECONDS);
    }

    return rows;
  }

  async flush() {
    // Database writes are synchronous via query, no op needed
  }
}

export class MemoryLeaderboardRepository {
  constructor() {
    this.boards = { "1v1": [], "2v2": [] };
  }

  async recordRoom(room) {
    if (!room || room.status !== "ended" || !room.winner || room.leaderboardRecorded) return;
    const duration = Math.max(1, Math.round(((room.endedAt || performance.now()) - room.startedAt) / 1000));
    const winners = room.players.filter((player) => player.team === room.winner && !player.bot);
    if (!winners.length) return;

    const totalReturns = winners.reduce((sum, player) => sum + (player.returns || 0), 0);
    if (totalReturns <= 0) return;

    const name = winners
      .map((player) => player.name)
      .sort()
      .join(" + ");
    const misses = room.misses[room.winner] ?? 0;
    const mode = room.mode;

    const current = this.boards[mode] || [];
    const existingIndex = current.findIndex((entry) => entry.name === name);

    const record = { name, score: totalReturns, misses, duration, mode };
    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      if (
        record.score > existing.score ||
        (record.score === existing.score && record.misses < existing.misses) ||
        (record.score === existing.score && record.misses === existing.misses && record.duration < existing.duration)
      ) {
        current[existingIndex] = record;
      }
    } else {
      current.push(record);
    }

    current.sort((a, b) => b.score - a.score || a.misses - b.misses || a.duration - b.duration);
    this.boards[mode] = current.slice(0, 100);
    room.leaderboardRecorded = true;
  }

  async top(mode, limit = 10) {
    return (this.boards[mode] || []).slice(0, limit);
  }

  async flush() {
    // In-memory flush no-op
  }
}
