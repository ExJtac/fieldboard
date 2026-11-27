import "dotenv/config";
import { resolve } from "node:path";
import { openDb, migrate } from "../server/db.ts";
import { writeBackup, restoreBackup } from "../server/backup.ts";
const [action, path] = process.argv.slice(2);
if (!["create", "restore"].includes(action) || !path || !process.env.BACKUP_KEY)
  throw new Error(
    "Usage: BACKUP_KEY=<64 hex characters> npm run backup -- create|restore /private/file.fbbackup. Stop embedded-database app first. Restore requires an empty destination.",
  );
const db = await openDb(process.env.DATABASE_URL);
try {
  await migrate(db);
  console.log(
    JSON.stringify(
      action === "create"
        ? await writeBackup(db, resolve(path), process.env.BACKUP_KEY)
        : await restoreBackup(db, resolve(path), process.env.BACKUP_KEY),
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
