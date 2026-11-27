import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir } from "node:fs/promises";
export interface DB {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<any>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDb(url?: string): Promise<DB> {
  if (url?.startsWith("postgres")) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const adapt = (client: pg.Pool | pg.PoolClient): DB => ({
      query: async <T>(s: string, p?: any[]) => ({
        rows: (await client.query(s, p)).rows as T[],
      }),
      exec: async (s) => client.query(s),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(adapt(c));
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    });
    return adapt(pool);
  }
  const directory = url || process.env.DATA_DIR || ".data/postgres";
  if (directory !== ":memory:") await mkdir(directory, { recursive: true });
  const db = new PGlite(directory === ":memory:" ? undefined : directory);
  await db.waitReady;
  const adapt = (c: any): DB => ({
    query: (s, p) => c.query(s, p),
    exec: (s) => c.exec(s),
    transaction: (fn) => c.transaction((tx: any) => fn(adapt(tx))),
    close: () => db.close(),
  });
  return adapt(db);
}
export async function migrate(db: DB) {
  await db.exec(`
 CREATE TABLE IF NOT EXISTS organizations(id text PRIMARY KEY,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),name text NOT NULL,email text NOT NULL UNIQUE,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('admin','pm','foreman','purchasing','viewer')),project_ids jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true);
 CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS records(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id),kind text NOT NULL,data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS records_project_kind ON records(project_id,kind);
 CREATE TABLE IF NOT EXISTS events(seq bigserial PRIMARY KEY,id text NOT NULL UNIQUE,org_id text NOT NULL REFERENCES organizations(id),project_id text REFERENCES projects(id),entity_id text NOT NULL,entity_kind text NOT NULL,actor_id text NOT NULL,actor_name text NOT NULL,action text NOT NULL,version integer NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS events_history ON events(project_id,created_at,seq);
 CREATE TABLE IF NOT EXISTS publications(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id),token_hash text NOT NULL UNIQUE,snapshot jsonb NOT NULL,expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS files(record_id text PRIMARY KEY REFERENCES records(id),content text NOT NULL);
 CREATE TABLE IF NOT EXISTS views(user_id text PRIMARY KEY REFERENCES users(id),data jsonb NOT NULL);
 CREATE TABLE IF NOT EXISTS exports(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id),snapshot jsonb NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS templates(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),name text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS idempotency(user_id text NOT NULL,key text NOT NULL,response jsonb NOT NULL,PRIMARY KEY(user_id,key));
 `);
}
