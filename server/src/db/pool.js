import pg from "pg";

const { Pool } = pg;

export function createDatabasePool(connectionString, options = {}) {
  if (!connectionString) return null;
  const pool = new Pool({
    connectionString,
    max: options.max || 20,
    idleTimeoutMillis: options.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: options.connectionTimeoutMillis || 5000,
    ...options
  });

  pool.on("error", (err) => {
    console.error("[db.pool] Unexpected error on idle client", err);
  });

  return pool;
}

export async function checkDatabaseHealth(pool) {
  if (!pool) return { healthy: false, reason: "Database pool not configured" };
  const start = performance.now();
  try {
    const res = await pool.query("SELECT 1 AS ok");
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    return { healthy: res.rows?.[0]?.ok === 1, latencyMs };
  } catch (error) {
    return {
      healthy: false,
      reason: error.message,
      latencyMs: Math.round((performance.now() - start) * 100) / 100
    };
  }
}

export async function closeDatabasePool(pool) {
  if (!pool) return;
  try {
    await pool.end();
  } catch (error) {
    console.error("[db.pool] Error closing database pool", error);
  }
}
