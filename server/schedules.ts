import { entitlement } from "./billing.ts";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import type { Express } from "express";
import type { DB } from "./db.ts";
import { assert, type User } from "./domain.ts";
import { authorizedProject, loadProject, event } from "./store.ts";
import { dayAfter, visibleRecords, financialRoles } from "./analysis.ts";
import { dashboard, publicSnapshot } from "./metrics.ts";
import { hash } from "./auth.ts";
import { makePdf, makeExcel } from "./exports.ts";
import { reportSchema } from "./reporting.ts";
import { deliverMail, mailConfigured } from "./mail.ts";
export const scheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    weekday: z.number().int().min(0).max(6).default(1),
    monthDay: z.number().int().min(1).max(28).default(1),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
    lookbackDays: z.number().int().min(1).max(90).default(7),
    sectionId: z.string().max(100).default(""),
    recipientIds: z.array(z.string().max(100)).max(50).default([]),
    externalEmails: z.array(z.email()).max(20).default([]),
    publicationDays: z.number().int().min(1).max(90).default(7),
    format: z.enum(["pdf", "xlsx", "both"]).default("pdf"),
    report: reportSchema.default({
      type: "weekly_owner",
      includeArchived: false,
      portfolioFilters: {},
    }),
    active: z.boolean().default(true),
  })
  .refine(
    (d) => d.recipientIds.length + d.externalEmails.length > 0,
    "Choose at least one recipient",
  )
  .refine(
    (d) => d.report.type !== "portfolio" || !d.externalEmails.length,
    "Portfolio reports can only be sent to internal recipients",
  );
function localParts(date: Date, timezone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    f.formatToParts(date).map((x) => [x.type, x.value]),
  );
}
export function nextRun(data: z.infer<typeof scheduleSchema>, after: Date) {
  const parts = localParts(after, data.timezone),
    start = `${parts.year}-${parts.month}-${parts.day}`;
  const [h, m] = data.time.split(":").map(Number);
  for (let i = 0; i < 65; i++) {
    const day = dayAfter(start, i),
      calendar = new Date(day + "T12:00:00Z");
    if (data.cadence === "weekly" && calendar.getUTCDay() !== data.weekday)
      continue;
    if (data.cadence === "monthly" && calendar.getUTCDate() !== data.monthDay)
      continue;
    const target = Date.parse(day + `T${data.time}:00Z`);
    const offsets = new Set(
      [-86400000, 0, 86400000].map((delta) => {
        const date = new Date(target + delta),
          p = localParts(date, data.timezone);
        return (
          Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) -
          date.getTime()
        );
      }),
    );
    const candidates = [...offsets]
      .map((offset) => new Date(target - offset))
      .filter((date) => {
        const p = localParts(date, data.timezone);
        return (
          `${p.year}-${p.month}-${p.day}` === day &&
          +p.hour === h &&
          +p.minute === m
        );
      })
      .sort((a, b) => +a - +b);
    // One delivery per local date, including the repeated hour at DST fall-back.
    if (candidates.length && +candidates[0] > +after)
      return candidates[0].toISOString();
  }
  throw new Error("No valid schedule time found");
}
async function scheduleActor(db: DB, id: string, org: string) {
  return (
    await db.query(
      "SELECT u.id,u.name,u.email,m.org_id,m.role,m.project_ids FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.org_id=$2 AND u.active=true AND m.active=true",
      [id, org],
    )
  ).rows[0] as User | undefined;
}
export async function enqueueSchedule(
  tx: DB,
  row: any,
  runKey: string,
  at = new Date(),
) {
  const org = (
    await tx.query("SELECT org_id FROM projects WHERE id=$1", [row.project_id])
  ).rows[0].org_id;
  const p = localParts(at, row.data.timezone),
    to = `${p.year}-${p.month}-${p.day}`,
    from = dayAfter(to, 1 - row.data.lookbackDays);
  for (const [key, recipient] of [
    ...row.data.recipientIds.map((id: string) => [
      "user:" + id,
      { userId: id },
    ]),
    ...row.data.externalEmails.map((email: string) => [
      "email:" + email.toLowerCase(),
      { email },
    ]),
  ])
    await tx.query(
      "INSERT INTO mail_jobs(id,schedule_id,org_id,project_id,run_key,recipient_key,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(schedule_id,run_key,recipient_key) DO NOTHING",
      [
        randomUUID(),
        row.id,
        org,
        row.project_id,
        runKey,
        key,
        JSON.stringify({
          recipient,
          actorId: row.created_by,
          schedule: row.data,
          scope: {
            from,
            to,
            ...(row.data.sectionId ? { sectionId: row.data.sectionId } : {}),
          },
          asOf: at.toISOString(),
        }),
      ],
    );
}
export async function enqueueDueSchedules(db: DB, now = new Date()) {
  if (!mailConfigured()) return 0;
  return db.transaction(async (tx) => {
    const rows = (
      await tx.query(
        "SELECT * FROM report_schedules WHERE data->>'active'='true' AND next_run_at<=$1 FOR UPDATE SKIP LOCKED",
        [now.toISOString()],
      )
    ).rows;
    for (const row of rows) {
      await enqueueSchedule(
        tx,
        row,
        new Date(row.next_run_at).toISOString(),
        now,
      );
      await tx.query("UPDATE report_schedules SET next_run_at=$1 WHERE id=$2", [
        nextRun(row.data, now),
        row.id,
      ]);
    }
    return rows.length;
  });
}
export async function processMailJobs(db: DB, max = 10) {
  if (!mailConfigured()) return 0;
  await db.query(
    "UPDATE mail_jobs SET state='failed',lease_until=NULL,last_error='Delivery worker stopped during final attempt; check recipient before requeuing' WHERE state='processing' AND lease_until<now() AND attempts>=5",
  );
  let sent = 0;
  for (let i = 0; i < max; i++) {
    const job = await db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM mail_jobs WHERE ((state='queued' AND available_at<=now()) OR (state='processing' AND lease_until<now())) AND attempts<5 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return null;
      await tx.query(
        "UPDATE mail_jobs SET state='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE id=$1",
        [row.id],
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) break;
    try {
      assert(
        (await entitlement(db, job.org_id)).allowed,
        403,
        "Organization subscription is inactive",
      );
      const actor = await scheduleActor(db, job.data.actorId, job.org_id);
      assert(
        actor && ["admin", "pm"].includes(actor.role),
        403,
        "Schedule creator no longer has manager access",
      );
      const schedule = (
        await db.query("SELECT data FROM report_schedules WHERE id=$1", [
          job.schedule_id,
        ])
      ).rows[0];
      assert(schedule?.data.active, 409, "Schedule is paused");
      const recipient = job.data.recipient.userId
        ? await scheduleActor(db, job.data.recipient.userId, job.org_id)
        : null;
      if (job.data.recipient.userId) {
        assert(
          recipient && recipient.role !== "viewer",
          403,
          "Recipient no longer has internal access",
        );
        await authorizedProject(db, recipient, job.project_id);
      }
      const loaded = await loadProject(db, actor, job.project_id, {
        asOf: job.data.asOf,
      });
      const org = (
        await db.query("SELECT name,settings FROM organizations WHERE id=$1", [
          job.org_id,
        ])
      ).rows[0];
      let payload = job.data.payload;
      if (
        !payload ||
        payload.role !== recipient?.role ||
        payload.access !== JSON.stringify(recipient?.project_ids || [])
      ) {
        const projected = dashboard(
          loaded.project,
          visibleRecords(loaded.records, recipient?.role || "viewer"),
          job.data.scope,
          job.data.asOf,
        );
        if (recipient && !financialRoles.includes(recipient.role)) {
          const keys = new Set(
            projected.analysis.financialMetrics.map((m) => m.key),
          );
          projected.metrics = projected.metrics.filter((m) => !keys.has(m.key));
          projected.analysis.financialMetrics = [];
        }
        const d: any = {
          ...projected,
          report: {
            ...job.data.schedule.report,
            organization: org.name,
            branding: org.settings,
          },
        };
        if (org.settings.logoDocumentId) {
          const logo = (
            await db.query(
              "SELECT f.content,r.data FROM files f JOIN records r ON r.id=f.record_id JOIN projects p ON p.id=r.project_id WHERE r.id=$1 AND p.org_id=$2",
              [org.settings.logoDocumentId, job.org_id],
            )
          ).rows[0];
          if (logo?.data.scanStatus === "clean") d.report.logo = logo.content;
        }
        if (recipient && d.report.type === "portfolio") {
          d.report.portfolio = [];
          const ps = (
            await db.query(
              "SELECT id FROM projects WHERE org_id=$1 AND created_at<=$2 ORDER BY created_at",
              [job.org_id, job.data.asOf],
            )
          ).rows.filter(
            (p) =>
              ["admin", "pm"].includes(recipient.role) ||
              recipient.project_ids.includes(p.id),
          );
          for (const p of ps) {
            const source = await loadProject(db, recipient, p.id, {
              asOf: job.data.asOf,
            });
            const summary = dashboard(
              source.project,
              visibleRecords(source.records, recipient.role),
              { from: job.data.scope.from, to: job.data.scope.to },
              job.data.asOf,
            );
            if (summary.project.data.archived !== d.report.includeArchived)
              continue;
            if (
              !Object.entries(d.report.portfolioFilters || {}).every(
                ([k, v]) =>
                  !v ||
                  (k === "health"
                    ? summary.health === v
                    : k === "overdue"
                      ? summary.metrics.some(
                          (m) => m.key === "overdue" && !!m.value,
                        )
                      : String((summary.project.data as any)[k] || "") === v),
              )
            )
              continue;
            const metrics = financialRoles.includes(recipient.role)
              ? summary.metrics
              : summary.metrics.filter(
                  (m) =>
                    !summary.analysis.financialMetrics.some(
                      (f) => f.key === m.key,
                    ),
                );
            d.report.portfolio.push({
              projectId: p.id,
              name: summary.project.data.name,
              customer: summary.project.data.customer,
              health: summary.health,
              forecast: summary.project.data.forecastFinish,
              metrics,
            });
          }
        }
        if (recipient) {
          const attachments = [];
          if (["pdf", "both"].includes(job.data.schedule.format))
            attachments.push({
              filename: "fieldboard-report.pdf",
              content: (await makePdf(d, org.name)).toString("base64"),
            });
          if (["xlsx", "both"].includes(job.data.schedule.format))
            attachments.push({
              filename: "fieldboard-report.xlsx",
              content: (await makeExcel(d, org.name)).toString("base64"),
            });
          payload = {
            role: recipient.role,
            access: JSON.stringify(recipient.project_ids),
            to: recipient.email,
            subject: job.data.schedule.name,
            text: `${org.name}\n${d.project.data.name}\nSnapshot: ${job.data.asOf}\nPeriod: ${job.data.scope.from} to ${job.data.scope.to}\nThe attached report contains data your current role is authorized to view.`,
            attachments,
          };
        } else {
          assert(
            process.env.APP_ORIGIN,
            503,
            "APP_ORIGIN is required for customer publication emails",
          );
          const token = randomBytes(32).toString("hex"),
            id = randomUUID(),
            expires = new Date(
              Date.now() + job.data.schedule.publicationDays * 86400000,
            ).toISOString();
          await db.query(
            "INSERT INTO publications(id,project_id,token_hash,snapshot,expires_at) VALUES($1,$2,$3,$4,$5)",
            [
              id,
              job.project_id,
              hash(token),
              JSON.stringify(publicSnapshot(projected, org.name)),
              expires,
            ],
          );
          await event(
            db,
            actor,
            job.project_id,
            "publication",
            id,
            "scheduled_publication",
            1,
            { expiresAt: expires, asOf: job.data.asOf },
          );
          payload = {
            access: JSON.stringify([]),
            to: job.data.recipient.email,
            subject: job.data.schedule.name,
            text: `${org.name}\nApproved project snapshot: ${d.project.data.name}\n${process.env.APP_ORIGIN}/share/${token}\nExpires: ${expires}\nInternal labor, financials, comments and documents are excluded.`,
            attachments: [],
          };
        }
        await db.query("UPDATE mail_jobs SET data=$1 WHERE id=$2", [
          JSON.stringify({ ...job.data, payload }),
          job.id,
        ]);
      }
      await deliverMail(
        payload.to,
        payload.subject,
        payload.text,
        payload.attachments.map((a: any) => ({
          ...a,
          content: Buffer.from(a.content, "base64"),
        })),
        `<${job.id}@fieldboard.local>`,
      );
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE mail_jobs SET state='sent',delivered_at=now(),lease_until=NULL,last_error='',data=$1 WHERE id=$2",
          [JSON.stringify({ ...job.data, payload: undefined }), job.id],
        );
        await event(
          tx,
          actor,
          job.project_id,
          "mail",
          job.id,
          "smtp_accepted",
          1,
          {
            scheduleId: job.schedule_id,
            recipient: job.recipient_key,
            asOf: job.data.asOf,
          },
        );
      });
      sent++;
    } catch (e) {
      const status = (e as any).status;
      const terminal = [403, 404, 409].includes(status) || job.attempts >= 5;
      await db.query(
        "UPDATE mail_jobs SET state=$1,available_at=$2,lease_until=NULL,last_error=$3 WHERE id=$4",
        [
          terminal ? "failed" : "queued",
          new Date(
            Date.now() + Math.min(60, 2 ** job.attempts) * 60000,
          ).toISOString(),
          String((e as Error).message).slice(0, 300),
          job.id,
        ],
      );
    }
  }
  return sent;
}
export function installSchedules(app: Express, db: DB) {
  const check = async (req: any, res: any) => {
    const u = res.locals.user as User;
    assert(["admin", "pm"].includes(u.role), 403, "Manager access required");
    return { u, p: await authorizedProject(db, u, req.params.id) };
  };
  const validate = async (u: User, p: any, data: any) => {
    if (data.sectionId)
      assert(
        (
          await db.query(
            "SELECT id FROM records WHERE id=$1 AND project_id=$2 AND kind='section'",
            [data.sectionId, p.id],
          )
        ).rows.length,
        400,
        "Invalid section",
      );
    for (const id of data.recipientIds) {
      const recipient = await scheduleActor(db, id, u.org_id);
      assert(
        recipient && recipient.role !== "viewer",
        400,
        "Choose an active internal recipient",
      );
      await authorizedProject(db, recipient, p.id);
    }
    if (data.externalEmails.length)
      assert(
        process.env.APP_ORIGIN,
        503,
        "Set APP_ORIGIN before customer publication delivery",
      );
  };
  app.get("/api/projects/:id/report-schedules", async (req, res) => {
    await check(req, res);
    res.json({
      configured: mailConfigured(),
      schedules: (
        await db.query(
          "SELECT * FROM report_schedules WHERE project_id=$1 ORDER BY created_at",
          [req.params.id],
        )
      ).rows,
      jobs: (
        await db.query(
          "SELECT id,schedule_id,recipient_key,state,attempts,last_error,delivered_at,created_at FROM mail_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.params.id],
        )
      ).rows,
    });
  });
  app.post("/api/projects/:id/report-schedules", async (req, res) => {
    const { u, p } = await check(req, res);
    const data = scheduleSchema.parse(req.body.data);
    await validate(u, p, data);
    const id = randomUUID();
    const row = await db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "INSERT INTO report_schedules(id,project_id,created_by,data,next_run_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [id, p.id, u.id, JSON.stringify(data), nextRun(data, new Date())],
        )
      ).rows[0];
      await event(tx, u, p.id, "report_schedule", id, "created", 1, r);
      return r;
    });
    res.status(201).json(row);
  });
  app.patch(
    "/api/projects/:id/report-schedules/:scheduleId",
    async (req, res) => {
      const { u, p } = await check(req, res);
      const data = scheduleSchema.parse(req.body.data),
        version = z.number().int().positive().parse(req.body.version);
      await validate(u, p, data);
      res.json(
        await db.transaction(async (tx) => {
          const r = (
            await tx.query(
              "UPDATE report_schedules SET data=$1,version=version+1,next_run_at=$2 WHERE id=$3 AND project_id=$4 AND version=$5 RETURNING *",
              [
                JSON.stringify(data),
                nextRun(data, new Date()),
                req.params.scheduleId,
                p.id,
                version,
              ],
            )
          ).rows[0];
          assert(r, 409, "Schedule changed; refresh");
          await event(
            tx,
            u,
            p.id,
            "report_schedule",
            r.id,
            "updated",
            r.version,
            r,
          );
          return r;
        }),
      );
    },
  );
  app.post(
    "/api/projects/:id/report-schedules/:scheduleId/run",
    async (req, res) => {
      const { u, p } = await check(req, res);
      assert(
        mailConfigured(),
        503,
        "Configure SMTP before requesting delivery",
      );
      const key = z.string().min(1).max(150).parse(req.get("Idempotency-Key"));
      await db.transaction(async (tx) => {
        const row = (
          await tx.query(
            "SELECT * FROM report_schedules WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [req.params.scheduleId, p.id],
          )
        ).rows[0];
        assert(row?.data.active, 409, "Schedule unavailable or paused");
        await enqueueSchedule(tx, row, "manual:" + key);
        await event(
          tx,
          u,
          p.id,
          "report_schedule",
          row.id,
          "delivery_requested",
          row.version,
          {},
        );
      });
      res.status(202).json({ queued: true });
    },
  );
}
