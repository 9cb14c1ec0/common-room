import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
export type Database = pg.Pool;

export function createDatabase(): Database | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: 10
  });
}

export async function migrate(database: Database) {
  await database.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const name = "001_initial";
  const applied = await database.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
  if (applied.rowCount) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../../../db/schema.sql"), path.resolve(process.cwd(), "db/schema.sql")];
  let sql: string | undefined;
  for (const candidate of candidates) {
    try { sql = await readFile(candidate, "utf8"); break; } catch { /* try next path */ }
  }
  if (!sql) throw new Error("Unable to locate db/schema.sql");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
