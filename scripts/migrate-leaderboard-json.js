import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createDatabasePool, closeDatabasePool } from "../server/src/db/pool.js";
import { runMigrations } from "../server/src/db/migrator.js";

const databaseUrl = process.env.DATABASE_URL;
const jsonFile = process.argv[2] || process.env.LEADERBOARD_FILE || "./data/leaderboard.json";

async function main() {
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required to migrate leaderboard to PostgreSQL.");
    process.exit(1);
  }

  if (!existsSync(jsonFile)) {
    console.log(`No legacy leaderboard file found at ${jsonFile}. Nothing to migrate.`);
    process.exit(0);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(jsonFile, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${jsonFile}:`, err.message);
    process.exit(1);
  }

  const pool = createDatabasePool(databaseUrl);
  console.log("Applying database migrations...");
  await runMigrations(pool);

  let imported = 0;
  for (const mode of ["1v1", "2v2"]) {
    const records = Array.isArray(data?.boards?.[mode]) ? data.boards[mode] : [];
    for (const record of records) {
      const name = String(record.name || "player").trim();
      const score = Number(record.score) || 0;
      const misses = Number(record.misses) || 0;
      const duration = Number(record.duration) || 0;

      // Check if duplicate entry exists
      const existing = await pool.query(
        "SELECT id FROM leaderboard_entries WHERE mode = $1 AND player_name = $2 AND score = $3 AND misses = $4 AND duration_seconds = $5",
        [mode, name, score, misses, duration]
      );

      if (!existing.rows.length) {
        await pool.query(
          `INSERT INTO leaderboard_entries (id, mode, player_name, score, misses, duration_seconds, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [crypto.randomUUID(), mode, name, score, misses, duration]
        );
        imported += 1;
      }
    }
  }

  console.log(`Successfully migrated ${imported} leaderboard records into PostgreSQL.`);
  await closeDatabasePool(pool);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
