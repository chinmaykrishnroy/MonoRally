#!/usr/bin/env node
import { createDatabasePool, closeDatabasePool } from "../server/src/db/pool.js";
import { runMigrations } from "../server/src/db/migrator.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[migrate] Fatal: DATABASE_URL environment variable is required.");
  process.exit(1);
}

console.log("[migrate] Starting database migrations...");
const pool = createDatabasePool(databaseUrl);

try {
  const { applied } = await runMigrations(pool);
  if (applied.length > 0) {
    console.log(`[migrate] Successfully applied ${applied.length} migration(s): ${applied.join(", ")}`);
  } else {
    console.log("[migrate] Database is already up to date. No new migrations.");
  }
  await closeDatabasePool(pool);
  process.exit(0);
} catch (err) {
  console.error(`[migrate] Migration failed: ${err.message}`);
  try {
    await closeDatabasePool(pool);
  } catch {
    // ignore
  }
  process.exit(1);
}
