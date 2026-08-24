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
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = [{ name: "001_initial", file: "schema.sql" }, { name: "002_invitations", file: "002_invitations.sql" }, { name: "003_request_meetings", file: "003_request_meetings.sql" }, { name: "004_recordings", file: "004_recordings.sql" }, { name: "005_meeting_titles", file: "005_meeting_titles.sql" }, { name: "006_meeting_visibility", file: "006_meeting_visibility.sql" }, { name: "007_user_deletion", file: "007_user_deletion.sql" }];
  for (const migration of migrations) {
    const applied = await database.query("SELECT 1 FROM schema_migrations WHERE name = $1", [migration.name]);
    if (applied.rowCount) continue;
    const candidates = [path.resolve(here, `../../../db/${migration.file}`), path.resolve(process.cwd(), `db/${migration.file}`)];
    let sql: string | undefined;
    for (const candidate of candidates) {
      try { sql = await readFile(candidate, "utf8"); break; } catch { /* try next path */ }
    }
    if (!sql) throw new Error(`Unable to locate db/${migration.file}`);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migration.name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
