import crypto from "node:crypto";
import { getRankTier } from "../elo.js";

export function createPlayerRepository({ pool = null } = {}) {
  if (pool) {
    return new PostgresPlayerRepository(pool);
  }
  return new MemoryPlayerRepository();
}

export function formatPlayerProfile(row) {
  if (!row) return null;
  const elo = Number(row.elo_rating ?? 1200);
  const played = Number(row.matches_played ?? 0);
  const wins = Number(row.wins ?? 0);
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    display_name: row.display_name,
    eloRating: elo,
    peakRating: Number(row.peak_rating ?? elo),
    matchesPlayed: played,
    wins,
    losses: Number(row.losses ?? 0),
    currentStreak: Number(row.current_streak ?? 0),
    bestStreak: Number(row.best_streak ?? 0),
    peakSpeed: Number(row.peak_speed ?? 0),
    smashCount: Number(row.smash_count ?? 0),
    curveCount: Number(row.curve_count ?? 0),
    counterCount: Number(row.counter_count ?? 0),
    driveCount: Number(row.drive_count ?? 0),
    winRate: played > 0 ? Math.round((wins / played) * 100) : 0,
    rankTier: getRankTier(elo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class PostgresPlayerRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getOrCreatePlayer(handleOrObj, displayName = null) {
    let id = null;
    let handle = "";
    let cleanDisplayName = "";

    if (typeof handleOrObj === "object" && handleOrObj !== null) {
      id = handleOrObj.id || null;
      handle = handleOrObj.handle || "";
      cleanDisplayName = handleOrObj.displayName || handle || "player";
    } else {
      handle = String(handleOrObj || "");
      cleanDisplayName = String(displayName || handle || "player");
    }

    const cleanHandle = String(handle).toLowerCase().trim().slice(0, 64) || `p_${crypto.randomBytes(3).toString("hex")}`;
    cleanDisplayName = String(cleanDisplayName).trim().slice(0, 64);

    if (id && crypto.isUuid?.(id)) {
      const byId = await this.pool.query("SELECT * FROM players WHERE id = $1", [id]);
      if (byId.rows.length) {
        return formatPlayerProfile(byId.rows[0]);
      }
    }

    const existing = await this.pool.query("SELECT * FROM players WHERE handle = $1", [cleanHandle]);
    if (existing.rows.length) {
      return formatPlayerProfile(existing.rows[0]);
    }

    const newId = id && crypto.isUuid?.(id) ? id : crypto.randomUUID();
    const inserted = await this.pool.query(
      `INSERT INTO players (id, handle, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (handle) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [newId, cleanHandle, cleanDisplayName]
    );

    return formatPlayerProfile(inserted.rows[0]);
  }

  async getPlayer(id) {
    const res = await this.pool.query("SELECT * FROM players WHERE id = $1", [id]);
    return res.rows[0] ? formatPlayerProfile(res.rows[0]) : null;
  }

  async getPlayerByHandle(handle) {
    const cleanHandle = String(handle || "").toLowerCase().trim();
    const res = await this.pool.query("SELECT * FROM players WHERE handle = $1", [cleanHandle]);
    return res.rows[0] ? formatPlayerProfile(res.rows[0]) : null;
  }

  async updateDisplayName(id, displayName) {
    const res = await this.pool.query(
      `UPDATE players
       SET display_name = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, String(displayName).trim().slice(0, 64)]
    );
    return res.rows[0] ? formatPlayerProfile(res.rows[0]) : null;
  }

  async updatePlayerStats(id, { won = false, ratingDelta = 0, peakSpeed = 0, skillShots = {} } = {}) {
    const res = await this.pool.query(
      `UPDATE players
       SET
         matches_played = matches_played + 1,
         wins = wins + (CASE WHEN $2::boolean THEN 1 ELSE 0 END),
         losses = losses + (CASE WHEN $2::boolean THEN 0 ELSE 1 END),
         current_streak = (CASE WHEN $2::boolean THEN current_streak + 1 ELSE 0 END),
         best_streak = GREATEST(best_streak, CASE WHEN $2::boolean THEN current_streak + 1 ELSE 0 END),
         elo_rating = GREATEST(100, elo_rating + $3::int),
         peak_rating = GREATEST(peak_rating, elo_rating + $3::int),
         peak_speed = GREATEST(peak_speed, $4::int),
         smash_count = smash_count + $5::int,
         curve_count = curve_count + $6::int,
         counter_count = counter_count + $7::int,
         drive_count = drive_count + $8::int,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        Boolean(won),
        Number(ratingDelta) || 0,
        Math.round(Number(peakSpeed) || 0),
        Number(skillShots.smash) || 0,
        Number(skillShots.curve) || 0,
        Number(skillShots.counter) || 0,
        Number(skillShots.drive) || 0
      ]
    );
    return res.rows[0] ? formatPlayerProfile(res.rows[0]) : null;
  }

  async getRankedLeaderboard(limit = 20) {
    const res = await this.pool.query(
      `SELECT * FROM players
       ORDER BY elo_rating DESC, wins DESC, matches_played DESC
       LIMIT $1`,
      [Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    return res.rows.map(formatPlayerProfile);
  }
}

export class MemoryPlayerRepository {
  constructor() {
    this.players = new Map();
  }

  async getOrCreatePlayer(handleOrObj, displayName = null) {
    let id = null;
    let handle = "";
    let cleanDisplayName = "";

    if (typeof handleOrObj === "object" && handleOrObj !== null) {
      id = handleOrObj.id || null;
      handle = handleOrObj.handle || "";
      cleanDisplayName = handleOrObj.displayName || handle || "player";
    } else {
      handle = String(handleOrObj || "");
      cleanDisplayName = String(displayName || handle || "player");
    }

    const cleanHandle = String(handle).toLowerCase().trim().slice(0, 64) || `p_${crypto.randomBytes(3).toString("hex")}`;
    cleanDisplayName = String(cleanDisplayName).trim().slice(0, 64);

    if (id && this.players.has(id)) {
      return formatPlayerProfile(this.players.get(id));
    }

    for (const player of this.players.values()) {
      if (player.handle === cleanHandle) return formatPlayerProfile(player);
    }

    const newId = id || crypto.randomUUID();
    const player = {
      id: newId,
      handle: cleanHandle,
      display_name: cleanDisplayName,
      elo_rating: 1200,
      peak_rating: 1200,
      matches_played: 0,
      wins: 0,
      losses: 0,
      current_streak: 0,
      best_streak: 0,
      peak_speed: 0,
      smash_count: 0,
      curve_count: 0,
      counter_count: 0,
      drive_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.players.set(newId, player);
    return formatPlayerProfile(player);
  }

  async getPlayer(id) {
    const player = this.players.get(id);
    return player ? formatPlayerProfile(player) : null;
  }

  async getPlayerByHandle(handle) {
    const cleanHandle = String(handle || "").toLowerCase().trim();
    for (const player of this.players.values()) {
      if (player.handle === cleanHandle) return formatPlayerProfile(player);
    }
    return null;
  }

  async updateDisplayName(id, displayName) {
    const player = this.players.get(id);
    if (!player) return null;
    player.display_name = String(displayName).trim().slice(0, 64);
    player.updated_at = new Date().toISOString();
    return formatPlayerProfile(player);
  }

  async updatePlayerStats(id, { won = false, ratingDelta = 0, peakSpeed = 0, skillShots = {} } = {}) {
    const player = this.players.get(id);
    if (!player) return null;

    player.matches_played += 1;
    if (won) {
      player.wins += 1;
      player.current_streak += 1;
      player.best_streak = Math.max(player.best_streak, player.current_streak);
    } else {
      player.losses += 1;
      player.current_streak = 0;
    }

    player.elo_rating = Math.max(100, player.elo_rating + (Number(ratingDelta) || 0));
    player.peak_rating = Math.max(player.peak_rating, player.elo_rating);
    player.peak_speed = Math.max(player.peak_speed, Math.round(Number(peakSpeed) || 0));

    player.smash_count += Number(skillShots.smash) || 0;
    player.curve_count += Number(skillShots.curve) || 0;
    player.counter_count += Number(skillShots.counter) || 0;
    player.drive_count += Number(skillShots.drive) || 0;
    player.updated_at = new Date().toISOString();

    return formatPlayerProfile(player);
  }

  async getRankedLeaderboard(limit = 20) {
    const all = Array.from(this.players.values());
    all.sort((a, b) => b.elo_rating - a.elo_rating || b.wins - a.wins || b.matches_played - a.matches_played);
    return all.slice(0, Math.max(1, Math.min(100, Number(limit) || 20))).map(formatPlayerProfile);
  }
}
