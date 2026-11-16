import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
export type Row = Record<string, any>;
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: any[]): Promise<T[]>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(url?: string, directory?: string): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
      query: async (sql, params = []) => (await client.query(sql, params)).rows,
    });
    return {
      ...wrap(pool),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(wrap(client));
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (directory) await mkdir(directory, { recursive: true });
  const lite = new PGlite(directory);
  await lite.waitReady;
  return {
    query: async (sql, params = []) => (await lite.query<Row>(sql, params)).rows as any,
    transaction: (fn) =>
      lite.transaction((tx) =>
        fn({ query: async (sql, params = []) => (await tx.query<Row>(sql, params)).rows as any }),
      ),
    close: () => lite.close(),
  };
}
export async function migrate(db: Database) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of (await readdir(path.resolve('migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if ((await db.query('SELECT name FROM schema_migrations WHERE name=$1', [file])).length)
      continue;
    const sql = await readFile(path.resolve('migrations', file), 'utf8');
    await db.transaction(async (tx) => {
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
    });
  }
}
