import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK_ID = 7148492; // Unique 32-bit int for MonoRally migrations advisory lock

export async function runMigrations(pool) {
  if (!pool) return { applied: [] };
  const client = await pool.connect();
  const applied = [];

  try {
    // Acquire session-level advisory lock so concurrent pods queue safely
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const existingRes = await client.query("SELECT version FROM schema_migrations");
    const existing = new Set(existingRes.rows.map((row) => row.version));

    const migrationsDir = join(__dirname, "migrations");
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (existing.has(file)) continue;

      const sql = readFileSync(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Failed to apply migration ${file}: ${err.message}`);
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } catch {
      // Ignore unlock error if client disconnected
    }
    client.release();
  }

  return { applied };
}
