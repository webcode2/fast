import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './auth.ts';

const directory = join(import.meta.dirname, '../migrations');
const migrationLock = '649012204';

/** Applies each migration file once, in name order. Safe to run from several hosts. */
export async function migrate() {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLock]);
    // Schema changes can legitimately take longer than the request timeout.
    await client.query('SET statement_timeout = 0');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map(({ name }) => name));
    for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      await client.query(readFileSync(join(directory, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      applied.push(name);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLock]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    const applied = await migrate();
    console.log(applied.length ? `Applied ${applied.join(', ')}` : 'Database is up to date');
  } catch (error) {
    console.error(error instanceof Error ? `Migration failed: ${error.message}` : 'Migration failed');
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
