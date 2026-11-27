import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { writeFile, readFile, mkdir, rename, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import type { DB } from "./db.ts";
import { assert } from "./domain.ts";
// Trusted identifiers only, dependency order. Sessions deliberately never survive recovery.
export const backupTables = [
  "organizations",
  "users",
  "memberships",
  "projects",
  "records",
  "resources",
  "events",
  "publications",
  "files",
  "views",
  "exports",
  "templates",
  "idempotency",
  "preferences",
  "notifications",
  "shared_views",
  "oidc_identities",
  "report_schedules",
  "mail_jobs",
  "subscriptions",
  "billing_events",
] as const;
export async function backupData(db: DB) {
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const tables: Record<string, any[]> = {};
    for (const table of backupTables) {
      const exists = (await tx.query("SELECT to_regclass($1) AS name", [table]))
        .rows[0]?.name;
      if (exists)
        tables[table] = (await tx.query(`SELECT * FROM ${table}`)).rows;
    }
    return {
      format: "fieldboard-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      tables,
    };
  });
}
export function encodeBackup(data: any, key: string) {
  assert(
    /^[0-9a-fA-F]{64}$/.test(key),
    400,
    "BACKUP_KEY must contain 64 hexadecimal characters",
  );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const content = gzipSync(Buffer.from(JSON.stringify(data)));
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([
    Buffer.from("FIELDBOARD1"),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
}
export function decodeBackup(buffer: Buffer, key: string) {
  assert(
    buffer.subarray(0, 11).toString() === "FIELDBOARD1",
    400,
    "Invalid backup format",
  );
  assert(/^[0-9a-fA-F]{64}$/.test(key), 400, "Invalid backup key");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    buffer.subarray(11, 23),
  );
  decipher.setAuthTag(buffer.subarray(23, 39));
  return JSON.parse(
    gunzipSync(
      Buffer.concat([decipher.update(buffer.subarray(39)), decipher.final()]),
    ).toString(),
  );
}
export async function writeBackup(db: DB, path: string, key: string) {
  const encoded = encodeBackup(await backupData(db), key);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temp, encoded, { mode: 0o600, flag: "wx" });
  await rename(temp, path);
  await chmod(path, 0o600);
  return {
    path,
    sha256: createHash("sha256").update(encoded).digest("hex"),
    bytes: encoded.length,
  };
}
export async function restoreData(db: DB, data: any) {
  assert(
    data?.format === "fieldboard-backup" && data.version === 1 && data.tables,
    400,
    "Unsupported backup",
  );
  return db.transaction(async (tx) => {
    for (const table of backupTables) {
      const exists = (await tx.query("SELECT to_regclass($1) AS name", [table]))
        .rows[0]?.name;
      if (exists)
        assert(
          !(await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length,
          409,
          "Restore destination must be an empty database",
        );
    }
    for (const table of backupTables) {
      const rows = data.tables[table] || [];
      assert(Array.isArray(rows), 400, "Invalid backup table");
      if (!rows.length) continue;
      const allowed = new Set(
        (
          await tx.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",
            [table],
          )
        ).rows.map((r) => r.column_name),
      );
      for (const row of rows) {
        const keys = Object.keys(row);
        assert(
          keys.every((k) => allowed.has(k)),
          400,
          "Backup contains unsupported columns",
        );
        await tx.query(
          `INSERT INTO ${table}(${keys.map((k) => `"${k}"`).join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          keys.map((k) =>
            row[k] !== null && typeof row[k] === "object"
              ? JSON.stringify(row[k])
              : row[k],
          ),
        );
      }
    }
    await tx.exec(
      "SELECT setval(pg_get_serial_sequence('events','seq'), GREATEST(COALESCE((SELECT max(seq) FROM events),0),1), EXISTS(SELECT 1 FROM events))",
    );
    return {
      tables: Object.fromEntries(
        backupTables.map((t) => [t, (data.tables[t] || []).length]),
      ),
    };
  });
}
export async function restoreBackup(db: DB, path: string, key: string) {
  return restoreData(db, decodeBackup(await readFile(path), key));
}
