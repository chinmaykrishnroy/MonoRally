import crypto from "node:crypto";

export function createPlayerRepository({ pool = null } = {}) {
  if (pool) {
    return new PostgresPlayerRepository(pool);
  }
  return new MemoryPlayerRepository();
}

export class PostgresPlayerRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getOrCreatePlayer(handle, displayName = null) {
    const cleanHandle = String(handle || "").toLowerCase().trim().slice(0, 64);
    const cleanDisplayName = String(displayName || cleanHandle || "player").trim().slice(0, 64);

    const existing = await this.pool.query(
      "SELECT id, handle, display_name, created_at, updated_at FROM players WHERE handle = $1",
      [cleanHandle]
    );

    if (existing.rows.length) {
      return existing.rows[0];
    }

    const id = crypto.randomUUID();
    const inserted = await this.pool.query(
      `INSERT INTO players (id, handle, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (handle) DO UPDATE SET updated_at = NOW()
       RETURNING id, handle, display_name, created_at, updated_at`,
      [id, cleanHandle, cleanDisplayName]
    );

    return inserted.rows[0];
  }

  async getPlayer(id) {
    const res = await this.pool.query(
      "SELECT id, handle, display_name, created_at, updated_at FROM players WHERE id = $1",
      [id]
    );
    return res.rows[0] || null;
  }

  async updateDisplayName(id, displayName) {
    const res = await this.pool.query(
      `UPDATE players
       SET display_name = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, handle, display_name, created_at, updated_at`,
      [id, String(displayName).trim().slice(0, 64)]
    );
    return res.rows[0] || null;
  }
}

export class MemoryPlayerRepository {
  constructor() {
    this.players = new Map();
  }

  async getOrCreatePlayer(handle, displayName = null) {
    const cleanHandle = String(handle || "").toLowerCase().trim().slice(0, 64);
    const cleanDisplayName = String(displayName || cleanHandle || "player").trim().slice(0, 64);

    for (const player of this.players.values()) {
      if (player.handle === cleanHandle) return player;
    }

    const player = {
      id: crypto.randomUUID(),
      handle: cleanHandle,
      display_name: cleanDisplayName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.players.set(player.id, player);
    return player;
  }

  async getPlayer(id) {
    return this.players.get(id) || null;
  }

  async updateDisplayName(id, displayName) {
    const player = this.players.get(id);
    if (!player) return null;
    player.display_name = String(displayName).trim().slice(0, 64);
    player.updated_at = new Date().toISOString();
    return player;
  }
}
