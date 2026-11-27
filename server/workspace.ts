import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { DB } from "./db.ts";
import { assert, schemas, type User, type RecordRow } from "./domain.ts";
import { event, authorizedProject, loadProject, addRecord } from "./store.ts";
import { scheduleAnalysis, visibleRecords } from "./analysis.ts";
import { reminders } from "./notifications.ts";
const settingsSchema = z.object({
  timezone: z
    .string()
    .default("America/Denver")
    .refine((s) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }),
  reportTitle: z.string().max(150).default("Project report"),
  reportFooter: z.string().max(500).default(""),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#047857"),
  logoDocumentId: z.string().max(100).default(""),
  notificationRetentionDays: z.number().int().min(7).max(3650).default(90),
  exportRetentionDays: z.number().int().min(30).max(3650).default(365),
  automaticRetention: z.boolean().default(false),
});
export async function retention(db: DB, orgId?: string) {
  const orgs = (await db.query("SELECT * FROM organizations")).rows.filter(
    (o) => !orgId || o.id === orgId,
  );
  let removed = 0;
  for (const org of orgs) {
    const s = settingsSchema.parse(org.settings || {});
    if (!s.automaticRetention) continue;
    const count = await db.transaction(async (tx) => {
      const notifications = await tx.query(
        "DELETE FROM notifications WHERE org_id=$1 AND read_at IS NOT NULL AND created_at<$2 RETURNING id",
        [
          org.id,
          new Date(
            Date.now() - s.notificationRetentionDays * 86400000,
          ).toISOString(),
        ],
      );
      const exports = await tx.query(
        "DELETE FROM exports WHERE project_id IN(SELECT id FROM projects WHERE org_id=$1) AND created_at<$2 RETURNING id",
        [
          org.id,
          new Date(Date.now() - s.exportRetentionDays * 86400000).toISOString(),
        ],
      );
      const sessions = await tx.query(
        "DELETE FROM sessions WHERE expires_at<now() RETURNING token_hash",
      );
      const n = notifications.rows.length + exports.rows.length;
      if (n)
        await event(
          tx,
          {
            id: "system",
            org_id: org.id,
            name: "Retention service",
            email: "",
            role: "admin",
            project_ids: [],
          },
          null,
          "retention",
          randomUUID(),
          "expired_artifacts_removed",
          1,
          {
            notifications: notifications.rows.length,
            exports: exports.rows.length,
          },
        );
      return n;
    });
    removed += count;
  }
  return { removed };
}
export function installWorkspace(app: Express, db: DB) {
  const user = (res: any) => res.locals.user as User;
  const manager = (u: User) =>
    assert(["admin", "pm"].includes(u.role), 403, "Manager access required");
  app.get("/api/resources", async (req, res) => {
    const u = user(res);
    assert(u.role !== "viewer", 403, "Internal access required");
    let rows = (
      await db.query(
        "SELECT *, 'resource' AS kind FROM resources WHERE org_id=$1 ORDER BY data->>'name'",
        [u.org_id],
      )
    ).rows;
    if (!["admin", "pm"].includes(u.role)) {
      const assignments = (
        await db.query(
          "SELECT r.* FROM records r JOIN projects p ON p.id=r.project_id WHERE p.org_id=$1 AND r.kind='crew'",
          [u.org_id],
        )
      ).rows.filter((r) => u.project_ids.includes(r.project_id));
      rows = visibleRecords([...rows, ...assignments], u.role).filter(
        (r) => r.kind === "resource",
      );
    }
    res.json(rows);
  });
  app.post("/api/resources", async (req, res) => {
    const u = user(res);
    manager(u);
    const data = schemas.resource.parse(req.body.data);
    const id = randomUUID();
    const row = await db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "INSERT INTO resources(id,org_id,data) VALUES($1,$2,$3) RETURNING *, 'resource' AS kind, '' AS project_id",
          [id, u.org_id, JSON.stringify(data)],
        )
      ).rows[0];
      await event(tx, u, null, "resource", id, "created", 1, row);
      return row;
    });
    res.status(201).json(row);
  });
  app.patch("/api/resources/:resourceId", async (req, res) => {
    const u = user(res);
    manager(u);
    const data = schemas.resource.parse(req.body.data),
      version = z.number().int().positive().parse(req.body.version);
    res.json(
      await db.transaction(async (tx) => {
        const row = (
          await tx.query(
            "UPDATE resources SET data=$1,version=version+1,updated_at=now() WHERE id=$2 AND org_id=$3 AND version=$4 RETURNING *, 'resource' AS kind, '' AS project_id",
            [JSON.stringify(data), req.params.resourceId, u.org_id, version],
          )
        ).rows[0];
        assert(row, 409, "Resource changed or unavailable");
        await event(
          tx,
          u,
          null,
          "resource",
          row.id,
          "updated",
          row.version,
          row,
        );
        return row;
      }),
    );
  });
  app.get("/api/projects/:id/team", async (req, res) => {
    const u = user(res);
    await authorizedProject(db, u, req.params.id);
    const rows = (
      await db.query(
        "SELECT u.id,u.name,m.role,m.project_ids FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1 AND u.active=true AND m.active=true AND m.role<>'viewer'",
        [u.org_id],
      )
    ).rows;
    res.json(
      rows
        .filter(
          (r) =>
            ["admin", "pm"].includes(r.role) ||
            r.project_ids.includes(req.params.id),
        )
        .map(({ project_ids, ...r }) => r),
    );
  });
  app.post("/api/projects/:id/forecast-proposal", async (req, res) => {
    const u = user(res);
    manager(u);
    const reason = z.string().trim().min(3).max(2000).parse(req.body.reason);
    res.status(201).json(
      await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ]);
        const { project, records } = await loadProject(tx, u, req.params.id);
        const proposal = scheduleAnalysis(
          project,
          records.filter((r) => r.kind === "task"),
        );
        assert(proposal.tasks.length, 400, proposal.reason);
        const rows = [];
        for (const t of proposal.tasks) {
          const source = records.find((r) => r.id === t.id)!;
          if (
            records.some(
              (r) =>
                r.kind === "revision" &&
                r.data.status === "submitted" &&
                r.data.taskId === t.id &&
                r.data.forecastStart === t.start &&
                r.data.forecastFinish === t.finish,
            )
          )
            continue;
          if (
            t.start === source.data.forecastStart &&
            t.finish === source.data.forecastFinish
          )
            continue;
          rows.push(
            await addRecord(
              tx,
              u,
              project.id,
              "revision",
              schemas.revision.parse({
                name: `Dependency forecast: ${t.name}`,
                taskId: t.id,
                forecastStart: t.start,
                forecastFinish: t.finish,
                reason,
              }),
            ),
          );
        }
        return rows;
      }),
    );
  });
  app.get("/api/preferences", async (req, res) =>
    res.json(
      (
        await db.query("SELECT data FROM preferences WHERE user_id=$1", [
          user(res).id,
        ])
      ).rows[0]?.data || {
        mentions: true,
        approvals: true,
        reminders: true,
        changes: false,
      },
    ),
  );
  app.put("/api/preferences", async (req, res) => {
    const data = z
      .object({
        mentions: z.boolean(),
        approvals: z.boolean(),
        reminders: z.boolean(),
        changes: z.boolean(),
      })
      .parse(req.body);
    await db.query(
      "INSERT INTO preferences(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      [user(res).id, JSON.stringify(data)],
    );
    res.json(data);
  });
  app.get("/api/notifications", async (req, res) => {
    const u = user(res);
    assert(u.role !== "viewer", 403, "Internal access required");
    await reminders(db);
    const rows = (
      await db.query(
        "SELECT * FROM notifications WHERE user_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 100",
        [u.id, u.org_id],
      )
    ).rows;
    const projects = (
      await db.query("SELECT id FROM projects WHERE org_id=$1", [u.org_id])
    ).rows;
    res.json(
      rows.filter(
        (r) =>
          !r.project_id ||
          (projects.some((p) => p.id === r.project_id) &&
            (["admin", "pm"].includes(u.role) ||
              u.project_ids.includes(r.project_id))),
      ),
    );
  });
  app.post("/api/notifications/:notificationId/read", async (req, res) => {
    const row = (
      await db.query(
        "UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
        [req.params.notificationId, user(res).id],
      )
    ).rows[0];
    assert(row, 404, "Notification not found");
    res.json({ ok: true });
  });
  app.get("/api/workspace", async (req, res) => {
    const u = user(res);
    manager(u);
    const org = (
      await db.query("SELECT name,settings FROM organizations WHERE id=$1", [
        u.org_id,
      ])
    ).rows[0];
    res.json({ ...org, settings: settingsSchema.parse(org.settings) });
  });
  app.put("/api/workspace", async (req, res) => {
    const u = user(res);
    assert(u.role === "admin", 403, "Administrator access required");
    const data = z
      .object({
        name: z.string().trim().min(1).max(150),
        settings: settingsSchema,
      })
      .parse(req.body);
    if (data.settings.logoDocumentId) {
      const row = (
        await db.query(
          "SELECT r.data FROM records r JOIN projects p ON p.id=r.project_id WHERE r.id=$1 AND p.org_id=$2 AND r.kind='document'",
          [data.settings.logoDocumentId, u.org_id],
        )
      ).rows[0];
      assert(
        row &&
          row.data.scanStatus === "clean" &&
          ["image/png", "image/jpeg"].includes(row.data.mime),
        400,
        "Logo must be a scanned PNG or JPEG from this organization",
      );
    }
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE organizations SET name=$1,settings=$2 WHERE id=$3",
        [data.name, JSON.stringify(data.settings), u.org_id],
      );
      await event(
        tx,
        u,
        null,
        "organization",
        u.org_id,
        "settings_updated",
        1,
        { name: data.name, settings: data.settings },
      );
    });
    res.json(data);
  });
  app.get("/api/shared-views", async (req, res) => {
    assert(user(res).role !== "viewer", 403, "Internal access required");
    res.json(
      (
        await db.query(
          "SELECT * FROM shared_views WHERE org_id=$1 ORDER BY name",
          [user(res).org_id],
        )
      ).rows,
    );
  });
  app.post("/api/shared-views", async (req, res) => {
    const u = user(res);
    manager(u);
    const data = z
      .object({
        name: z.string().trim().min(1).max(150),
        team: z.string().max(100).default(""),
        data: z.object({
          hidden: z.array(z.string()).max(30),
          order: z.array(z.string()).max(30),
          filters: z.record(z.string(), z.string()).default({}),
        }),
      })
      .parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO shared_views(id,org_id,name,team,data,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [id, u.org_id, data.name, data.team, JSON.stringify(data.data), u.id],
      );
      await event(tx, u, null, "view", id, "created", 1, data);
    });
    res.status(201).json({ id });
  });
  app.delete("/api/shared-views/:viewId", async (req, res) => {
    const u = user(res);
    manager(u);
    await db.transaction(async (tx) => {
      const rows = (
        await tx.query(
          "DELETE FROM shared_views WHERE id=$1 AND org_id=$2 RETURNING id",
          [req.params.viewId, u.org_id],
        )
      ).rows;
      assert(rows.length, 404, "View not found");
      await event(tx, u, null, "view", req.params.viewId, "deleted", 1, {});
    });
    res.json({ ok: true });
  });
  app.get("/api/operations", async (req, res) => {
    const u = user(res);
    assert(u.role === "admin", 403, "Administrator access required");
    res.json({
      telemetry: {
        ...app.locals.telemetry,
        durations: undefined,
        p95Milliseconds:
          [...app.locals.telemetry.durations].sort(
            (a: number, b: number) => a - b,
          )[Math.floor(app.locals.telemetry.durations.length * 0.95)] || 0,
      },
      backupConfigured: !!process.env.BACKUP_DIR && !!process.env.BACKUP_KEY,
      database: process.env.DATABASE_URL?.startsWith("postgres")
        ? "PostgreSQL"
        : "Embedded PostgreSQL",
      scannerConfigured: !!process.env.CLAMSCAN_PATH,
      counts: (
        await db.query(
          "SELECT (SELECT count(*) FROM projects WHERE org_id=$1) AS projects,(SELECT count(*) FROM events WHERE org_id=$1) AS audit_events,(SELECT count(*) FROM notifications WHERE org_id=$1 AND read_at IS NULL) AS unread_notifications",
          [u.org_id],
        )
      ).rows[0],
      retention: (
        await db.query("SELECT settings FROM organizations WHERE id=$1", [
          u.org_id,
        ])
      ).rows[0].settings,
    });
  });
  app.post("/api/operations/retention", async (req, res) => {
    assert(user(res).role === "admin", 403, "Administrator access required");
    res.json(await retention(db, user(res).org_id));
  });
}
