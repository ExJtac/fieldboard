import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { openDb, migrate } from "../server/db.ts";
import { backupData, restoreData } from "../server/backup.ts";
import { createApp, errorHandler } from "../server/app.ts";
import { projectSchema, schemas } from "../server/domain.ts";
import request from "supertest";
import assert from "node:assert/strict";
const adminUrl = process.env.PG_TEST_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    "Set PG_TEST_ADMIN_URL to a dedicated staging PostgreSQL admin connection.",
  );
const control = new pg.Pool({ connectionString: adminUrl });
const name = "fb_accept_" + randomBytes(6).toString("hex"),
  restoreName = name + "_restore",
  deliveryName = name + "_delivery";
const url = new URL(adminUrl);
url.pathname = "/" + name;
let db: any, restored: any;
try {
  await control.query(`CREATE DATABASE ${name}`);
  await control.query(`CREATE DATABASE ${restoreName}`);
  await control.query(`CREATE DATABASE ${deliveryName}`);
  const exit = await new Promise<number>((resolve) => {
    const proc = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "--test", "tests/extended.test.ts"],
      {
        env: { ...process.env, TEST_DATABASE_URL: url.href },
        stdio: "inherit",
      },
    );
    proc.on("exit", (c) => resolve(c ?? 1));
  });
  assert.equal(exit, 0, "Native PostgreSQL workflow tests failed");
  const deliveryUrl = new URL(url);
  deliveryUrl.pathname = "/" + deliveryName;
  const deliveryExit = await new Promise<number>((resolve) => {
    const proc = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "--test", "tests/delivery.test.ts"],
      {
        env: { ...process.env, TEST_DELIVERY_DATABASE_URL: deliveryUrl.href },
        stdio: "inherit",
      },
    );
    proc.on("exit", (c) => resolve(c ?? 1));
  });
  assert.equal(
    deliveryExit,
    0,
    "Native PostgreSQL delivery and subscription tests failed",
  );
  const interrupted = await openDb(url.href);
  try {
    const pid = (await interrupted.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    await control.query("SELECT pg_terminate_backend($1)", [pid]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await interrupted.query("SELECT 1 AS ready")).rows[0].ready,
      1,
    );
    console.log("PASS idle PostgreSQL disconnect recovery");
  } finally {
    await interrupted.close();
  }
  db = await openDb(url.href);
  const backup = await backupData(db);
  const restoreUrl = new URL(url);
  restoreUrl.pathname = "/" + restoreName;
  restored = await openDb(restoreUrl.href);
  await migrate(restored);
  const result = await restoreData(restored, backup);
  assert.equal(
    (await restored.query("SELECT count(*)::int AS n FROM events")).rows[0].n,
    backup.tables.events.length,
  );
  console.log(
    "PASS native PostgreSQL backup/restore",
    JSON.stringify(result.tables),
  );
  const app = createApp(db);
  app.use(errorHandler);
  const a = request.agent(app);
  await a
    .post("/api/auth/login")
    .set("X-Fieldboard-Request", "1")
    .send({ email: "owner@extended.test", password: "extended-test-password" });
  const org = (await a.get("/api/me")).body.user.org_id;
  const id = "load-project";
  await db.query("INSERT INTO projects(id,org_id,data) VALUES($1,$2,$3)", [
    id,
    org,
    JSON.stringify(
      projectSchema.parse({
        name: "Load fixture",
        code: "LOAD",
        customer: "Sample",
      }),
    ),
  ]);
  await db.transaction(async (tx: any) => {
    await tx.query(
      "INSERT INTO records(id,project_id,kind,data) VALUES($1,$2,$3,$4)",
      [
        "load-section",
        id,
        "section",
        JSON.stringify(schemas.section.parse({ name: "Section" })),
      ],
    );
    for (let i = 0; i < 100; i++) {
      await tx.query(
        "INSERT INTO records(id,project_id,kind,data) VALUES($1,$2,$3,$4)",
        [
          "load-task-" + i,
          id,
          "task",
          JSON.stringify(
            schemas.task.parse({
              name: "Activity " + i,
              sectionId: "load-section",
              estimatedHours: 100,
              quantity: 100,
              baselineStart: "2026-11-01",
              baselineFinish: "2026-12-01",
            }),
          ),
        ],
      );
      await tx.query(
        "INSERT INTO records(id,project_id,kind,data) VALUES($1,$2,$3,$4)",
        [
          "load-report-" + i,
          id,
          "report",
          JSON.stringify(
            schemas.report.parse({
              taskId: "load-task-" + i,
              date: "2026-11-20",
              hours: 25,
              quantity: 25,
              accomplishments: "Synthetic load fixture",
              status: "approved",
            }),
          ),
        ],
      );
    }
  });
  const durations: number[] = [];
  for (let batch = 0; batch < 10; batch++)
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const started = performance.now();
        const r = await a.get("/api/projects/" + id + "/dashboard");
        assert.equal(r.status, 200);
        assert.equal(
          r.body.metrics.find((m: any) => m.key === "actual_hours").value,
          2500,
        );
        durations.push(performance.now() - started);
      }),
    );
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  console.log(
    JSON.stringify({
      requests: durations.length,
      concurrency: 8,
      tasks: 100,
      approvedReports: 100,
      p95Milliseconds: Math.round(p95),
      maxMilliseconds: Math.round(durations.at(-1)!),
    }),
  );
  assert(p95 < 2500, "Dashboard p95 exceeded 2.5 seconds on this staging host");
} finally {
  if (db) await db.close();
  if (restored) await restored.close();
  for (const n of [name, restoreName, deliveryName])
    await control.query(`DROP DATABASE IF EXISTS ${n}`);
  await control.end();
}
