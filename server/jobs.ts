import { enqueueDueSchedules, processMailJobs } from "./schedules.ts";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { reminders } from "./notifications.ts";
import { retention } from "./workspace.ts";
import { writeBackup } from "./backup.ts";
export function startJobs(db: DB) {
  let busy = false,
    lastBackup = 0,
    lastCleanup = 0;
  const interval = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await reminders(db);
      await enqueueDueSchedules(db);
      await processMailJobs(db);
      if (Date.now() - lastCleanup > 3600000) {
        await retention(db);
        lastCleanup = Date.now();
      }
      if (
        process.env.BACKUP_DIR &&
        process.env.BACKUP_KEY &&
        Date.now() - lastBackup >
          Number(process.env.BACKUP_INTERVAL_HOURS || 24) * 3600000
      ) {
        const result = await writeBackup(
          db,
          join(
            process.env.BACKUP_DIR,
            `fieldboard-${new Date().toISOString().replaceAll(":", "-")}.fbbackup`,
          ),
          process.env.BACKUP_KEY,
        );
        console.log(
          JSON.stringify({
            event: "backup_completed",
            bytes: result.bytes,
            sha256: result.sha256,
          }),
        );
        lastBackup = Date.now();
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "background_job_failed",
          message: (e as Error).message,
        }),
      );
    } finally {
      busy = false;
    }
  }, 60000);
  interval.unref();
  return () => clearInterval(interval);
}
