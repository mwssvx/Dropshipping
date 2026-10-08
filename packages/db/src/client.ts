import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/** In-memory database for tests: real Postgres (PGlite), migrated, nothing on disk. */
export async function createTestDb(): Promise<Db> {
  const db = drizzlePglite(new PGlite(), { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}

/**
 * The app database. With DATABASE_URL set (Supabase in staging and production) it uses
 * postgres-js; otherwise a PGlite database stored under DATA_DIR (default ./.data).
 */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.url) {
    const db = drizzlePostgres(postgres(opts.url, { prepare: false }), { schema });
    await migratePostgres(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const dir = opts.dataDir ?? path.resolve(".data/pglite");
  mkdirSync(dir, { recursive: true });
  const db = drizzlePglite(new PGlite(dir), { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}
