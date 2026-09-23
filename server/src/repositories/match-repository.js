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

  async recordMatch(room, eloResults = null) {
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
        const candidateId = player.profileId || player.id;
        const playerId = crypto.isUuid?.(candidateId) ? candidateId : null;
        const eloData = eloResults instanceof Map
          ? eloResults.get(candidateId) || eloResults.get(player.clientId) || null
          : eloResults?.[candidateId] || eloResults?.[player.clientId] || null;

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
            eloData?.ratingBefore ?? null,
            eloData?.ratingAfter ?? null
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

  async getPlayerMatches(playerId, limit = 10) {
    const res = await this.pool.query(
      `SELECT m.id, m.code, m.mode, m.winner_team, m.duration_seconds, m.started_at, m.ended_at,
              mp.team as player_team, mp.returns as player_returns, mp.misses as player_misses,
              mp.rating_before, mp.rating_after,
              (mp.team = m.winner_team) as won
       FROM matches m
       JOIN match_players mp ON m.id = mp.match_id
       WHERE mp.player_id = $1
       ORDER BY m.ended_at DESC
       LIMIT $2`,
      [playerId, Math.max(1, Math.min(50, Number(limit) || 10))]
    );
    return res.rows.map((row) => ({
      id: row.id,
      code: row.code,
      mode: row.mode,
      winnerTeam: row.winner_team,
      playerTeam: row.player_team,
      won: Boolean(row.won),
      returns: row.player_returns,
      misses: row.player_misses,
      duration: row.duration_seconds,
      ratingBefore: row.rating_before,
      ratingAfter: row.rating_after,
      ratingDelta: row.rating_after && row.rating_before ? row.rating_after - row.rating_before : 0,
      endedAt: row.ended_at
    }));
  }
}

export class MemoryMatchRepository {
  constructor() {
    this.matches = new Map();
  }

  async recordMatch(room, eloResults = null) {
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
      endedAt: new Date(performance.timeOrigin + (room.endedAt || performance.now())).toISOString(),
      players: room.players.map((p) => {
        const candidateId = p.profileId || p.id;
        const eloData = eloResults instanceof Map
          ? eloResults.get(candidateId) || eloResults.get(p.clientId) || null
          : eloResults?.[candidateId] || eloResults?.[p.clientId] || null;
        return {
          id: candidateId,
          name: p.name,
          team: p.team,
          slot: p.slot,
          bot: Boolean(p.bot),
          returns: p.returns || 0,
          misses: room.misses[p.team] || 0,
          ratingBefore: eloData?.ratingBefore ?? null,
          ratingAfter: eloData?.ratingAfter ?? null
        };
      })
    };

    this.matches.set(matchId, record);
    room.matchPersisted = true;
    return { matchId };
  }

  async getMatch(matchId) {
    return this.matches.get(matchId) || null;
  }

  async getPlayerMatches(playerId, limit = 10) {
    const results = [];
    for (const match of this.matches.values()) {
      const p = match.players.find((pl) => pl.id === playerId);
      if (p) {
        results.push({
          id: match.id,
          code: match.code,
          mode: match.mode,
          winnerTeam: match.winner,
          playerTeam: p.team,
          won: p.team === match.winner,
          returns: p.returns,
          misses: p.misses,
          duration: match.duration,
          ratingBefore: p.ratingBefore,
          ratingAfter: p.ratingAfter,
          ratingDelta: p.ratingAfter && p.ratingBefore ? p.ratingAfter - p.ratingBefore : 0,
          endedAt: match.endedAt
        });
      }
    }
    results.sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
    return results.slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
  }
}
