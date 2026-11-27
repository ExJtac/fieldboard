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
    const connections = new Set<pg.PoolClient>();
    pool.on("connect", (client) => connections.add(client));
    pool.on("remove", (client) => connections.delete(client));
    pool.on("error", (error) =>
      console.error(
        JSON.stringify({
          event: "database_idle_connection_error",
          code: (error as any).code,
          message: error.message,
        }),
      ),
    );
    const close = async () => {
      // pg-pool can resolve end() before all sockets emit end. Await both.
      const ended = [...connections].map(
        (client) =>
          new Promise<void>((resolve) => client.once("end", () => resolve())),
      );
      await pool.end();
      await Promise.all(ended);
    };
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
      close,
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
 CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),name text NOT NULL,email text NOT NULL UNIQUE,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('admin','pm','foreman','purchasing','accountant','viewer')),project_ids jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true);
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
 ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
 ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','pm','foreman','purchasing','accountant','viewer'));
 ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
 CREATE TABLE IF NOT EXISTS memberships(user_id text NOT NULL REFERENCES users(id),org_id text NOT NULL REFERENCES organizations(id),role text NOT NULL,project_ids jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true,PRIMARY KEY(user_id,org_id));
 INSERT INTO memberships(user_id,org_id,role,project_ids,active) SELECT id,org_id,role,project_ids,active FROM users ON CONFLICT DO NOTHING;
 ALTER TABLE sessions ADD COLUMN IF NOT EXISTS org_id text REFERENCES organizations(id);
 CREATE TABLE IF NOT EXISTS oidc_identities(issuer text NOT NULL,subject text NOT NULL,user_id text NOT NULL REFERENCES users(id),PRIMARY KEY(issuer,subject));
 CREATE TABLE IF NOT EXISTS oidc_flows(state_hash text PRIMARY KEY,browser_hash text NOT NULL,verifier text NOT NULL,nonce text NOT NULL,expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS resources(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS notifications(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),user_id text NOT NULL REFERENCES users(id),project_id text REFERENCES projects(id),source_key text NOT NULL,data jsonb NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,source_key));
 CREATE TABLE IF NOT EXISTS preferences(user_id text PRIMARY KEY REFERENCES users(id),data jsonb NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS shared_views(id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),name text NOT NULL,team text NOT NULL DEFAULT '',data jsonb NOT NULL,created_by text NOT NULL);
 CREATE TABLE IF NOT EXISTS report_schedules(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id),created_by text NOT NULL REFERENCES users(id),data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,next_run_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS mail_jobs(id text PRIMARY KEY,schedule_id text REFERENCES report_schedules(id),org_id text NOT NULL REFERENCES organizations(id),project_id text REFERENCES projects(id),run_key text NOT NULL,recipient_key text NOT NULL,data jsonb NOT NULL,state text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,last_error text NOT NULL DEFAULT '',delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,run_key,recipient_key));
 CREATE INDEX IF NOT EXISTS mail_jobs_pending ON mail_jobs(state,available_at);
 CREATE TABLE IF NOT EXISTS signup_verifications(token_hash text PRIMARY KEY,data jsonb NOT NULL,expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS subscriptions(org_id text PRIMARY KEY REFERENCES organizations(id),customer_id text NOT NULL,subscription_id text NOT NULL UNIQUE,status text NOT NULL,valid_until timestamptz NOT NULL,price_id text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS billing_events(id text PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
 `);
}
