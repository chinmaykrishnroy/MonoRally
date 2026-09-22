import crypto from "node:crypto";

export function createMatchRepository({ pool = null } = {}) {
  if (pool) {
    return new PostgresMatchRepository(pool);
  }
  return new MemoryMatchRepository();
}

export class PostgresMatchRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async recordMatch(room) {
    if (!room || room.status !== "ended" || !room.winner || room.matchPersisted) return null;
    const matchId = room.matchId || crypto.randomUUID();
    room.matchId = matchId;

    const duration = Math.max(1, Math.round(((room.endedAt || performance.now()) - room.startedAt) / 1000));
    const totalReturns = room.players.reduce((sum, p) => sum + (p.returns || 0), 0);
    const startedAt = new Date(performance.timeOrigin + room.startedAt);
    const endedAt = new Date(performance.timeOrigin + (room.endedAt || performance.now()));

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO matches (id, code, mode, winner_team, total_returns, duration_seconds, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [matchId, room.code, room.mode, room.winner, totalReturns, duration, startedAt, endedAt]
      );

      for (const player of room.players) {
        const playerId = crypto.isUuid?.(player.id) ? player.id : null;
        await client.query(
          `INSERT INTO match_players (id, match_id, player_id, name, team, slot, is_bot, returns, misses, rating_before, rating_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            crypto.randomUUID(),
            matchId,
            playerId,
            player.name || "player",
            player.team,
            player.slot,
            Boolean(player.bot),
            player.returns || 0,
            room.misses[player.team] || 0,
            null,
            null
          ]
        );
      }

      await client.query("COMMIT");
      room.matchPersisted = true;
      return { matchId };
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[match.repository] Error recording match:", err.message);
      return null;
    } finally {
      client.release();
    }
  }

  async getMatch(matchId) {
    const res = await this.pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
    if (!res.rows.length) return null;
    const match = res.rows[0];
    const playersRes = await this.pool.query("SELECT * FROM match_players WHERE match_id = $1", [matchId]);
    match.players = playersRes.rows;
    return match;
  }
}

export class MemoryMatchRepository {
  constructor() {
    this.matches = new Map();
  }

  async recordMatch(room) {
    if (!room || room.status !== "ended" || !room.winner || room.matchPersisted) return null;
    const matchId = room.matchId || crypto.randomUUID();
    room.matchId = matchId;

    const duration = Math.max(1, Math.round(((room.endedAt || performance.now()) - room.startedAt) / 1000));
    const totalReturns = room.players.reduce((sum, p) => sum + (p.returns || 0), 0);

    const record = {
      id: matchId,
      code: room.code,
      mode: room.mode,
      winner: room.winner,
      duration,
      totalReturns,
      players: room.players.map((p) => ({
        name: p.name,
        team: p.team,
        slot: p.slot,
        bot: Boolean(p.bot),
        returns: p.returns || 0
      }))
    };

    this.matches.set(matchId, record);
    room.matchPersisted = true;
    return { matchId };
  }

  async getMatch(matchId) {
    return this.matches.get(matchId) || null;
  }
}
