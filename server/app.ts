import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import multer from "multer";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DB } from "./db.ts";
import {
  HttpError,
  assert,
  projectSchema,
  schemas,
  roles,
  date,
  type User,
  type Kind,
  type RecordRow,
  type Scope,
} from "./domain.ts";
import {
  hash,
  passwordHash,
  verifyPassword,
  session,
  getUser,
} from "./auth.ts";
import {
  authorizedProject,
  loadProject,
  addRecord,
  changeRecord,
  changeProject,
  event,
} from "./store.ts";
import { dashboard, publicSnapshot } from "./metrics.ts";
import { seedPilot } from "./seed.ts";
import { makePdf, makeExcel } from "./exports.ts";
import { installTransfer } from "./transfer.ts";
const credentials = z.object({
  email: z
    .email()
    .max(250)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(200),
});
const scopeSchema = z
  .object({
    sectionId: z.string().max(100).optional(),
    from: date.optional(),
    to: date.optional(),
    asOf: z.iso.datetime().optional(),
  })
  .refine((s) => !s.from || !s.to || s.from <= s.to, "Start must precede end");
export function createApp(
  db: DB,
  options: { production?: boolean; origin?: string; setupToken?: string } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: options.production ? undefined : false,
      strictTransportSecurity: options.production ? undefined : false,
    }),
  );
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== (options.origin || `${req.protocol}://${req.get("host")}`)
      )
        return next(new HttpError(403, "Cross-origin write rejected"));
      if (req.headers["sec-fetch-site"] === "cross-site")
        return next(new HttpError(403, "Cross-site write rejected"));
      if (req.path !== "/health" && req.headers["x-fieldboard-request"] !== "1")
        return next(new HttpError(403, "Missing request verification"));
    }
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.get("/api/auth/status", async (req, res) => {
    const user = await getUser(db, req);
    res.json({
      setupRequired: !(await db.query("SELECT id FROM users LIMIT 1")).rows
        .length,
      user,
      setupTokenRequired: !!options.setupToken || !!options.production,
    });
  });
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    const body = credentials
      .extend({
        name: z.string().trim().min(1).max(100),
        organization: z.string().trim().min(1).max(150),
        sample: z.boolean().default(false),
        setupToken: z.string().optional(),
      })
      .parse(req.body);
    if (options.production || options.setupToken)
      assert(
        options.setupToken &&
          body.setupToken &&
          hash(body.setupToken) === hash(options.setupToken),
        403,
        "Valid setup token required",
      );
    const pw = await passwordHash(body.password);
    const user = await db.transaction(async (tx) => {
      await tx.exec("LOCK TABLE users IN EXCLUSIVE MODE");
      assert(
        !(await tx.query("SELECT id FROM users LIMIT 1")).rows.length,
        409,
        "Setup already completed",
      );
      const org = randomUUID();
      await tx.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        org,
        body.organization,
      ]);
      const u: User = {
        id: randomUUID(),
        org_id: org,
        name: body.name,
        email: body.email,
        role: "admin",
        project_ids: [],
      };
      await tx.query(
        "INSERT INTO users(id,org_id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [u.id, org, u.name, u.email, u.role, pw],
      );
      await event(tx, u, null, "user", u.id, "setup", 1, {
        name: u.name,
        role: u.role,
      });
      if (body.sample) await seedPilot(tx, u);
      return u;
    });
    await session(db, user.id, res, !!options.production);
    res.status(201).json({ user });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const body = credentials.parse(req.body);
    const user = (
      await db.query("SELECT * FROM users WHERE email=$1 AND active=true", [
        body.email,
      ])
    ).rows[0];
    const valid = await verifyPassword(
      body.password,
      user?.password_hash ||
        "00000000000000000000000000000000:" + "00".repeat(64),
    );
    assert(user && valid, 401, "Email or password is incorrect");
    await session(db, user.id, res, !!options.production);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies.fb_session || ""),
    ]);
    res.clearCookie("fb_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/publications/:token", async (req, res) => {
    const p = (
      await db.query(
        "SELECT snapshot,expires_at FROM publications WHERE token_hash=$1 AND revoked=false AND expires_at>now()",
        [hash(req.params.token)],
      )
    ).rows[0];
    assert(p, 404, "This report is unavailable, expired or revoked");
    res.json(p);
  });
  app.use("/api", async (req, res, next) => {
    const user = await getUser(db, req);
    if (!user) return next(new HttpError(401, "Please sign in"));
    res.locals.user = user;
    next();
  });
  const user = (res: Response) => res.locals.user as User;
  const allow = (u: User, allowed: string[]) =>
    assert(
      allowed.includes(u.role),
      403,
      "Your role cannot perform this action",
    );
  const mutation = async (
    req: Request,
    res: Response,
    fn: (tx: DB, u: User, p: any) => Promise<any>,
  ) => {
    const u = user(res);
    return db.transaction(async (tx) => {
      await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        req.params.id,
      ]);
      const p = await authorizedProject(tx, u, String(req.params.id));
      return fn(tx, u, p);
    });
  };
  const getDashboard = async (req: Request, res: Response) => {
    const scope = scopeSchema.parse(req.query) as Scope;
    assert(
      !scope.asOf || Date.parse(scope.asOf) <= Date.now(),
      400,
      "Future snapshots are unavailable",
    );
    return db.transaction(async (tx) => {
      await tx.query("SELECT id FROM projects WHERE id=$1 FOR SHARE", [
        req.params.id,
      ]);
      const { project, records } = await loadProject(
        tx,
        user(res),
        String(req.params.id),
        scope,
      );
      if (scope.sectionId)
        assert(
          records.some((r) => r.kind === "section" && r.id === scope.sectionId),
          400,
          "Section does not belong to this project",
        );
      return dashboard(
        project,
        records,
        scope,
        scope.asOf || new Date().toISOString(),
      );
    });
  };
  app.get("/api/me", async (req, res) => {
    const u = user(res);
    const org = (
      await db.query("SELECT * FROM organizations WHERE id=$1", [u.org_id])
    ).rows[0];
    res.json({ user: u, organization: org });
  });
  app.get("/api/projects", async (req, res) => {
    const u = user(res);
    if (u.role === "viewer") return res.json([]);
    let ps = (
      await db.query(
        "SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at DESC",
        [u.org_id],
      )
    ).rows;
    if (!["admin", "pm"].includes(u.role))
      ps = ps.filter((p) => u.project_ids.includes(p.id));
    res.json(ps);
  });
  app.get("/api/portfolio", async (req, res) => {
    const u = user(res);
    allow(u, ["admin", "pm", "foreman", "purchasing"]);
    const result = await db.transaction(async (tx) => {
      let ps = (
        await tx.query(
          "SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at DESC",
          [u.org_id],
        )
      ).rows;
      if (!["admin", "pm"].includes(u.role))
        ps = ps.filter((p) => u.project_ids.includes(p.id));
      return Promise.all(
        ps.map(async (p) =>
          dashboard(
            p,
            (
              await tx.query<RecordRow>(
                "SELECT * FROM records WHERE project_id=$1",
                [p.id],
              )
            ).rows,
          ),
        ),
      );
    });
    res.json(result);
  });
  app.post("/api/projects", async (req, res) => {
    const u = user(res);
    allow(u, ["admin", "pm"]);
    const data = projectSchema.parse({ ...req.body, sample: false });
    res.status(201).json(
      await db.transaction(async (tx) => {
        const p = (
          await tx.query(
            "INSERT INTO projects(id,org_id,data) VALUES($1,$2,$3) RETURNING *",
            [randomUUID(), u.org_id, JSON.stringify(data)],
          )
        ).rows[0];
        await event(tx, u, p.id, "project", p.id, "created", 1, p);
        return p;
      }),
    );
  });
  app.post("/api/sample", async (req, res) => {
    const u = user(res);
    allow(u, ["admin"]);
    res.json({ id: await db.transaction((tx) => seedPilot(tx, u)) });
  });
  app.patch("/api/projects/:id", async (req, res) =>
    res.json(
      await mutation(req, res, async (tx, u, p) => {
        allow(u, ["admin", "pm"]);
        const data = projectSchema.parse(req.body.data);
        assert(
          data.baselineFinish === p.data.baselineFinish &&
            data.forecastFinish === p.data.forecastFinish,
          400,
          "Use an approved schedule revision to change dates",
        );
        assert(
          data.sample === p.data.sample,
          400,
          "Sample provenance cannot be removed",
        );
        return changeProject(
          tx,
          u,
          p,
          data,
          z.number().int().positive().parse(req.body.version),
        );
      }),
    ),
  );
  app.get("/api/projects/:id/dashboard", async (req, res) =>
    res.json(await getDashboard(req, res)),
  );
  app.get("/api/projects/:id/metrics/:key", async (req, res) => {
    const d = await getDashboard(req, res);
    const m = d.metrics.find((m) => m.key === req.params.key);
    assert(m, 404, "Metric not found");
    const ids = new Set(m.sourceRecordIds);
    const source = await loadProject(db, user(res), String(req.params.id), {
      asOf: d.asOf,
    });
    res.json({
      metric: m,
      records: [source.project, ...source.records].filter((r) => ids.has(r.id)),
    });
  });
  app.get("/api/projects/:id/events", async (req, res) => {
    await authorizedProject(db, user(res), req.params.id);
    res.json(
      (
        await db.query(
          "SELECT seq,entity_id,entity_kind,actor_name,action,version,created_at FROM events WHERE project_id=$1 ORDER BY seq DESC LIMIT 200",
          [req.params.id],
        )
      ).rows,
    );
  });
  const roleFor = (kind: Kind) =>
    kind === "report"
      ? ["admin", "pm", "foreman"]
      : kind === "material"
        ? ["admin", "pm", "purchasing"]
        : kind === "issue"
          ? ["admin", "pm", "foreman", "purchasing"]
          : ["admin", "pm"];
  async function validateReferences(
    tx: DB,
    projectId: string,
    kind: Kind,
    data: any,
  ) {
    const projectRow = (
      await tx.query("SELECT data FROM projects WHERE id=$1", [projectId])
    ).rows[0];
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: projectRow.data.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (data.sectionId) {
      const s = (
        await tx.query(
          "SELECT id FROM records WHERE id=$1 AND project_id=$2 AND kind='section'",
          [data.sectionId, projectId],
        )
      ).rows[0];
      assert(s, 400, "Section does not belong to this project");
    }
    if (data.taskId) {
      const task = (
        await tx.query(
          "SELECT * FROM records WHERE id=$1 AND project_id=$2 AND kind='task'",
          [data.taskId, projectId],
        )
      ).rows[0];
      assert(task, 400, "Task does not belong to this project");
      if (["report", "material"].includes(kind))
        assert(
          task.data.kind === "task",
          400,
          "Select a field task, not a summary or milestone",
        );
      if (kind === "issue" && data.sectionId)
        assert(
          task.data.sectionId === data.sectionId,
          400,
          "Task and section must match",
        );
    }
    if (kind === "task") {
      if (data.actualFinish)
        assert(
          data.actualFinish <= today,
          400,
          "Completion cannot be in the future",
        );
      for (const prefix of ["baseline", "forecast"])
        assert(
          !data[`${prefix}Start`] ||
            !data[`${prefix}Finish`] ||
            data[`${prefix}Start`] <= data[`${prefix}Finish`],
          400,
          "Task finish must follow its start",
        );
    }
    if (kind === "report")
      assert(
        data.date <= today,
        400,
        "Actual reports cannot be dated in the future",
      );
  }
  app.post("/api/projects/:id/records/:kind", async (req, res) =>
    res.status(201).json(
      await mutation(req, res, async (tx, u, p) => {
        const kind = z
          .enum([
            "section",
            "task",
            "material",
            "issue",
            "report",
            "crew",
            "revision",
          ])
          .parse(req.params.kind);
        allow(u, roleFor(kind));
        const data = schemas[kind].parse(req.body.data);
        if (kind === "report")
          assert(
            ["draft", "submitted"].includes((data as any).status),
            400,
            "Reports must pass approval",
          );
        if (kind === "revision")
          assert(
            (data as any).status === "submitted",
            400,
            "Revisions must pass approval",
          );
        await validateReferences(tx, p.id, kind, data);
        const key = req.get("Idempotency-Key");
        assert(key && key.length <= 150, 400, "Idempotency-Key is required");
        const existing = (
          await tx.query(
            "SELECT response FROM idempotency WHERE user_id=$1 AND key=$2",
            [u.id, key],
          )
        ).rows[0];
        if (existing) {
          assert(
            existing.response.project_id === p.id &&
              existing.response.kind === kind,
            409,
            "Idempotency key used for another request",
          );
          return existing.response;
        }
        const row = await addRecord(tx, u, p.id, kind, data);
        await tx.query(
          "INSERT INTO idempotency(user_id,key,response) VALUES($1,$2,$3)",
          [u.id, key, JSON.stringify(row)],
        );
        return row;
      }),
    ),
  );
  app.patch("/api/projects/:id/records/:recordId", async (req, res) =>
    res.json(
      await mutation(req, res, async (tx, u, p) => {
        const row = (
          await tx.query<RecordRow>(
            "SELECT * FROM records WHERE id=$1 AND project_id=$2",
            [req.params.recordId, p.id],
          )
        ).rows[0];
        assert(row, 404, "Record not found");
        allow(u, roleFor(row.kind));
        assert(
          !["revision", "document"].includes(row.kind),
          400,
          "Use the dedicated workflow",
        );
        const data = schemas[row.kind].parse(req.body.data) as any;
        if (row.kind === "report") {
          assert(
            ["draft", "rejected"].includes(row.data.status),
            409,
            "Submitted and approved reports are immutable; void approved reports with a reason",
          );
          assert(
            ["draft", "submitted"].includes(data.status),
            400,
            "Reports must pass approval",
          );
        }
        if (row.kind === "task") {
          for (const key of [
            "baselineStart",
            "baselineFinish",
            "forecastStart",
            "forecastFinish",
          ])
            assert(
              data[key] === row.data[key],
              400,
              "Use a schedule revision to change dates",
            );
        }
        await validateReferences(tx, p.id, row.kind, data);
        return changeRecord(
          tx,
          u,
          row,
          data,
          z.number().int().positive().parse(req.body.version),
        );
      }),
    ),
  );
  app.post("/api/projects/:id/approvals/:recordId/decision", async (req, res) =>
    res.json(
      await mutation(req, res, async (tx, u, p) => {
        allow(u, ["admin", "pm"]);
        const body = z
          .object({
            decision: z.enum(["approved", "rejected", "voided"]),
            version: z.number().int().positive(),
            reason: z.string().trim().min(3).max(2000),
          })
          .parse(req.body);
        const row = (
          await tx.query<RecordRow>(
            "SELECT * FROM records WHERE id=$1 AND project_id=$2",
            [req.params.recordId, p.id],
          )
        ).rows[0];
        assert(
          row && ["report", "revision"].includes(row.kind),
          404,
          "Approval not found",
        );
        assert(row.version === body.version, 409, "Approval changed; refresh");
        assert(
          body.decision === "voided"
            ? row.kind === "report" && row.data.status === "approved"
            : row.data.status === "submitted",
          409,
          "Approval has already been decided",
        );
        if (row.kind === "revision" && body.decision === "approved") {
          const fields = row.data.taskId
            ? [
                "baselineStart",
                "baselineFinish",
                "forecastStart",
                "forecastFinish",
              ]
            : ["baselineFinish", "forecastFinish"];
          if (row.data.taskId) {
            const task = (
              await tx.query<RecordRow>(
                "SELECT * FROM records WHERE id=$1 AND project_id=$2",
                [row.data.taskId, p.id],
              )
            ).rows[0];
            assert(task, 400, "Task missing");
            const data = { ...task.data };
            for (const field of fields)
              if (row.data[field]) data[field] = row.data[field];
            await validateReferences(tx, p.id, "task", data);
            await changeRecord(
              tx,
              u,
              task,
              data,
              task.version,
              "schedule_revision_approved",
            );
          } else {
            const data = { ...p.data };
            for (const field of fields)
              if (row.data[field]) data[field] = row.data[field];
            await changeProject(
              tx,
              u,
              p,
              data,
              p.version,
              "schedule_revision_approved",
            );
          }
        }
        return changeRecord(
          tx,
          u,
          row,
          {
            ...row.data,
            status: body.decision,
            decisionNote: body.reason,
            decidedBy: u.id,
            decidedAt: new Date().toISOString(),
          },
          body.version,
          body.decision,
        );
      }),
    ),
  );
  app.get("/api/views", async (req, res) =>
    res.json(
      (
        await db.query("SELECT data FROM views WHERE user_id=$1", [
          user(res).id,
        ])
      ).rows[0]?.data || { hidden: [], order: [], favorites: [] },
    ),
  );
  app.put("/api/views", async (req, res) => {
    const data = z
      .object({
        hidden: z.array(z.string()).max(30),
        order: z.array(z.string()).max(30),
        favorites: z.array(z.string()).max(200),
        filters: z.record(z.string(), z.string()).optional(),
      })
      .parse(req.body);
    await db.query(
      "INSERT INTO views(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      [user(res).id, JSON.stringify(data)],
    );
    res.json(data);
  });
  app.get("/api/users", async (req, res) => {
    allow(user(res), ["admin"]);
    res.json(
      (
        await db.query(
          "SELECT id,name,email,role,project_ids,active FROM users WHERE org_id=$1 ORDER BY name",
          [user(res).org_id],
        )
      ).rows,
    );
  });
  app.post("/api/users", async (req, res) => {
    const u = user(res);
    allow(u, ["admin"]);
    const body = credentials
      .extend({
        name: z.string().trim().min(1).max(100),
        role: z.enum(roles),
        projectIds: z.array(z.string()).max(200),
      })
      .parse(req.body);
    const pw = await passwordHash(body.password);
    res.status(201).json(
      await db.transaction(async (tx) => {
        for (const id of body.projectIds)
          assert(
            (
              await tx.query(
                "SELECT id FROM projects WHERE id=$1 AND org_id=$2",
                [id, u.org_id],
              )
            ).rows.length,
            400,
            "Invalid project assignment",
          );
        const id = randomUUID();
        await tx.query(
          "INSERT INTO users(id,org_id,name,email,password_hash,role,project_ids) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            u.org_id,
            body.name,
            body.email,
            pw,
            body.role,
            JSON.stringify(body.projectIds),
          ],
        );
        await event(tx, u, null, "user", id, "created", 1, {
          name: body.name,
          role: body.role,
          projectIds: body.projectIds,
        });
        return { id };
      }),
    );
  });
  app.patch("/api/users/:userId", async (req, res) => {
    const u = user(res);
    allow(u, ["admin"]);
    const b = z
      .object({
        role: z.enum(roles),
        projectIds: z.array(z.string()),
        active: z.boolean(),
      })
      .parse(req.body);
    assert(
      req.params.userId !== u.id,
      400,
      "You cannot change your own access",
    );
    await db.transaction(async (tx) => {
      for (const id of b.projectIds)
        assert(
          (
            await tx.query(
              "SELECT id FROM projects WHERE id=$1 AND org_id=$2",
              [id, u.org_id],
            )
          ).rows.length,
          400,
          "Invalid project assignment",
        );
      const r = (
        await tx.query(
          "UPDATE users SET role=$1,project_ids=$2,active=$3 WHERE id=$4 AND org_id=$5 RETURNING id",
          [
            b.role,
            JSON.stringify(b.projectIds),
            b.active,
            req.params.userId,
            u.org_id,
          ],
        )
      ).rows[0];
      assert(r, 404, "User not found");
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [r.id]);
      await event(tx, u, null, "user", r.id, "access_changed", 1, b);
    });
    res.json({ ok: true });
  });
  app.post("/api/password", async (req, res) => {
    const b = z
      .object({
        currentPassword: z.string(),
        newPassword: z.string().min(12).max(200),
      })
      .parse(req.body);
    const u = user(res);
    const row = (
      await db.query("SELECT password_hash FROM users WHERE id=$1", [u.id])
    ).rows[0];
    assert(
      await verifyPassword(b.currentPassword, row.password_hash),
      403,
      "Current password is incorrect",
    );
    const pw = await passwordHash(b.newPassword);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        pw,
        u.id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await event(tx, u, null, "user", u.id, "password_changed", 1, {});
    });
    await session(db, u.id, res, !!options.production);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/publications", async (req, res) => {
    allow(user(res), ["admin", "pm"]);
    const body = z
      .object({ days: z.number().int().min(1).max(90) })
      .parse(req.body);
    const d = await getDashboard(req, res);
    const organization = (
      await db.query("SELECT name FROM organizations WHERE id=$1", [
        user(res).org_id,
      ])
    ).rows[0].name;
    const token = randomBytes(32).toString("hex"),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + body.days * 86400_000).toISOString();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO publications(id,project_id,token_hash,snapshot,expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          d.project.id,
          hash(token),
          JSON.stringify(publicSnapshot(d, organization)),
          expiresAt,
        ],
      );
      await event(
        tx,
        user(res),
        d.project.id,
        "publication",
        id,
        "published",
        1,
        { expiresAt, asOf: d.asOf, scope: d.scope },
      );
    });
    res.status(201).json({ id, url: `/share/${token}`, expiresAt });
  });
  app.get("/api/projects/:id/publications", async (req, res) => {
    await authorizedProject(db, user(res), req.params.id);
    allow(user(res), ["admin", "pm"]);
    res.json(
      (
        await db.query(
          "SELECT id,expires_at,revoked,created_at FROM publications WHERE project_id=$1 ORDER BY created_at DESC",
          [req.params.id],
        )
      ).rows,
    );
  });
  app.delete(
    "/api/projects/:id/publications/:publicationId",
    async (req, res) => {
      await mutation(req, res, async (tx, u, p) => {
        allow(u, ["admin", "pm"]);
        const row = (
          await tx.query(
            "UPDATE publications SET revoked=true WHERE id=$1 AND project_id=$2 RETURNING id",
            [req.params.publicationId, p.id],
          )
        ).rows[0];
        assert(row, 404, "Publication not found");
        await event(tx, u, p.id, "publication", row.id, "revoked", 2, {});
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/projects/:id/exports", async (req, res) => {
    const d = await getDashboard(req, res);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO exports(id,project_id,snapshot,created_by) VALUES($1,$2,$3,$4)",
        [id, d.project.id, JSON.stringify(d), user(res).id],
      );
      await event(
        tx,
        user(res),
        d.project.id,
        "export",
        id,
        "snapshot_saved",
        1,
        { asOf: d.asOf, scope: d.scope },
      );
    });
    res.status(201).json({ id });
  });
  app.get("/api/projects/:id/exports", async (req, res) => {
    await authorizedProject(db, user(res), req.params.id);
    res.json(
      (
        await db.query(
          "SELECT id,created_at FROM exports WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50",
          [req.params.id],
        )
      ).rows,
    );
  });
  app.get("/api/projects/:id/exports/:exportId/:format", async (req, res) => {
    await authorizedProject(db, user(res), req.params.id);
    const e = (
      await db.query(
        "SELECT snapshot FROM exports WHERE id=$1 AND project_id=$2",
        [req.params.exportId, req.params.id],
      )
    ).rows[0];
    assert(e, 404, "Export not found");
    const org = (
      await db.query("SELECT name FROM organizations WHERE id=$1", [
        user(res).org_id,
      ])
    ).rows[0].name;
    const format = z.enum(["pdf", "xlsx", "json"]).parse(req.params.format);
    const buffer =
      format === "pdf"
        ? await makePdf(e.snapshot, org)
        : format === "xlsx"
          ? await makeExcel(e.snapshot, org)
          : Buffer.from(JSON.stringify(e.snapshot, null, 2));
    res
      .set(
        "Content-Disposition",
        `attachment; filename="fieldboard-${req.params.exportId}.${format}"`,
      )
      .type(
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : format === "pdf"
            ? "application/pdf"
            : "application/json",
      )
      .send(buffer);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/projects/:id/documents",
    upload.single("file"),
    async (req, res) => {
      const u = user(res);
      allow(u, ["admin", "pm", "foreman"]);
      await authorizedProject(db, u, String(req.params.id));
      assert(req.file, 400, "Choose a file");
      const file = req.file;
      const magic = file.buffer;
      const mime =
        magic.subarray(0, 5).toString() === "%PDF-"
          ? "application/pdf"
          : magic
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : magic[0] === 255 && magic[1] === 216 && magic[2] === 255
              ? "image/jpeg"
              : null;
      assert(mime, 400, "Only PDF, PNG and JPEG files are supported");
      let scanStatus: "clean" | "quarantined" = "quarantined";
      if (process.env.CLAMSCAN_PATH) {
        const dir = await mkdtemp(join(tmpdir(), "fieldboard-"));
        try {
          const path = join(dir, "upload");
          await writeFile(path, magic);
          await promisify(execFile)(
            process.env.CLAMSCAN_PATH,
            ["--no-summary", path],
            { timeout: 30_000 },
          );
          scanStatus = "clean";
        } catch {
          scanStatus = "quarantined";
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      const data = schemas.document.parse({
        name: req.body.name || file.originalname,
        sectionId: req.body.sectionId || "",
        reference: req.body.reference || "",
        filename: file.originalname
          .replace(/[^a-zA-Z0-9._ -]/g, "_")
          .slice(0, 180),
        mime,
        size: file.size,
        scanStatus,
        sha256: hash(file.buffer.toString("base64")),
      });
      res.status(201).json(
        await mutation(req, res, async (tx, actor, p) => {
          await validateReferences(tx, p.id, "document", data);
          const r = await addRecord(tx, actor, p.id, "document", data);
          await tx.query("INSERT INTO files(record_id,content) VALUES($1,$2)", [
            r.id,
            file.buffer.toString("base64"),
          ]);
          return r;
        }),
      );
    },
  );
  app.get("/api/projects/:id/documents/:documentId", async (req, res) => {
    await authorizedProject(db, user(res), req.params.id);
    const row = (
      await db.query(
        "SELECT r.data,f.content FROM records r JOIN files f ON f.record_id=r.id WHERE r.id=$1 AND r.project_id=$2 AND r.kind='document'",
        [req.params.documentId, req.params.id],
      )
    ).rows[0];
    assert(row, 404, "Document not found");
    assert(
      row.data.scanStatus === "clean",
      409,
      "File is quarantined until a malware scanner clears it",
    );
    res
      .set("Content-Disposition", `attachment; filename="${row.data.filename}"`)
      .type(row.data.mime)
      .send(Buffer.from(row.content, "base64"));
  });
  app.post("/api/projects/:id/documents/:documentId/scan", async (req, res) => {
    allow(user(res), ["admin", "pm"]);
    await authorizedProject(db, user(res), req.params.id);
    assert(
      process.env.CLAMSCAN_PATH,
      503,
      "Configure CLAMSCAN_PATH to scan attachments",
    );
    const row = (
      await db.query<RecordRow & { content: string }>(
        "SELECT r.*,f.content FROM records r JOIN files f ON f.record_id=r.id WHERE r.id=$1 AND r.project_id=$2",
        [req.params.documentId, req.params.id],
      )
    ).rows[0];
    assert(row, 404, "Document not found");
    const dir = await mkdtemp(join(tmpdir(), "fieldboard-"));
    try {
      const path = join(dir, "upload");
      await writeFile(path, Buffer.from(row.content, "base64"));
      await promisify(execFile)(
        process.env.CLAMSCAN_PATH,
        ["--no-summary", path],
        { timeout: 30_000 },
      );
      await mutation(req, res, (tx, u) =>
        changeRecord(
          tx,
          u,
          row,
          { ...row.data, scanStatus: "clean" },
          row.version,
          "scan_passed",
        ),
      );
      res.json({ ok: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  installTransfer(app, db);
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  return app;
}
export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  if (error.code === "23505")
    return res.status(409).json({ error: "This record already exists" });
  if (error instanceof HttpError)
    return res.status(error.status).json({ error: error.message });
  if (error instanceof multer.MulterError)
    return res.status(400).json({ error: error.message });
  if (error.type === "entity.too.large")
    return res.status(413).json({ error: "Request exceeds the 1 MB limit" });
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "Invalid JSON" });
  console.error("Request failed:", error.message);
  res.status(500).json({
    error: "Request failed. Please retry or contact your administrator.",
  });
}
