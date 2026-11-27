import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import request from "supertest";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { openDb, migrate, type DB } from "../server/db.ts";
import { createApp, errorHandler } from "../server/app.ts";
import {
  scheduleSchema,
  nextRun,
  enqueueDueSchedules,
  processMailJobs,
} from "../server/schedules.ts";
import { backupData, restoreData } from "../server/backup.ts";
const savedEnv = { ...process.env };
let db: DB,
  app: any,
  admin: any,
  orgId: string,
  ownerId: string,
  projectId: string,
  workerId: string,
  worker: any;
const mails: string[] = [];
let reject = false;
const smtp = net.createServer((socket) => {
  socket.write("220 localhost test SMTP\r\n");
  let buffer = "",
    body = "",
    data = false;
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line === ".") {
          data = false;
          mails.push(body);
          body = "";
          socket.write("250 queued\r\n");
        } else body += line + "\r\n";
        continue;
      }
      if (/^(EHLO|HELO)/.test(line)) socket.write("250 localhost\r\n");
      else if (line === "DATA") {
        data = true;
        socket.write("354 send data\r\n");
      } else if (line === "QUIT") {
        socket.end("221 bye\r\n");
      } else if (line.startsWith("RCPT") && reject)
        socket.write("451 temporary test failure\r\n");
      else socket.write("250 OK\r\n");
    }
  });
});
const write = (
  a: any,
  method: string,
  url: string,
  data: any,
  key: string = randomUUID(),
) =>
  a[method](url)
    .set("X-Fieldboard-Request", "1")
    .set("Idempotency-Key", key)
    .send(data);
const schedule = (overrides: any = {}) =>
  scheduleSchema.parse({
    name: "Weekly delivery",
    cadence: "weekly",
    weekday: 1,
    time: "07:00",
    timezone: "America/Chicago",
    recipientIds: [ownerId],
    ...overrides,
  });
async function create(data: any) {
  const r = await write(
    admin,
    "post",
    `/api/projects/${projectId}/report-schedules`,
    { data },
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function queue(id: string, key: string = randomUUID()) {
  const r = await write(
    admin,
    "post",
    `/api/projects/${projectId}/report-schedules/${id}/run`,
    {},
    key,
  );
  assert.equal(r.status, 202, JSON.stringify(r.body));
}
before(async () => {
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String((smtp.address() as any).port),
    SMTP_FROM: "reports@fieldboard.test",
    APP_ORIGIN: "http://localhost",
    ALLOW_SIGNUP: "1",
  });
  delete process.env.BILLING_MODE;
  db = await openDb(process.env.TEST_DELIVERY_DATABASE_URL || ":memory:");
  await migrate(db);
  app = createApp(db);
  app.use(errorHandler);
  admin = request.agent(app);
  const r = await write(admin, "post", "/api/auth/setup", {
    name: "Owner",
    organization: "Mail tests",
    email: "owner@delivery.test",
    password: "delivery-test-password",
  });
  assert.equal(r.status, 201);
  ownerId = r.body.user.id;
  orgId = (await admin.get("/api/me")).body.organization.id;
  projectId = (
    await write(admin, "post", "/api/projects", {
      name: "Delivery project",
      code: "MAIL",
      customer: "GC",
    })
  ).body.id;
  workerId = (
    await write(admin, "post", "/api/users", {
      name: "Worker",
      email: "worker@delivery.test",
      password: "delivery-test-password",
      role: "foreman",
      projectIds: [projectId],
    })
  ).body.id;
  worker = request.agent(app);
  await write(worker, "post", "/api/auth/login", {
    email: "worker@delivery.test",
    password: "delivery-test-password",
  });
});
after(async () => {
  await db.close();
  await new Promise<void>((r) => smtp.close(() => r()));
  for (const k of Object.keys(process.env))
    if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});
test("timezone scheduling handles weekly/monthly cadence and DST missing/repeated times", () => {
  const daily = schedule({ cadence: "daily", time: "02:30" });
  assert.equal(
    nextRun(daily, new Date("2026-03-08T07:00:00Z")),
    "2026-03-09T07:30:00.000Z",
  );
  const fall = schedule({ cadence: "daily", time: "01:30" });
  assert.equal(
    nextRun(fall, new Date("2026-11-01T05:00:00Z")),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    nextRun(fall, new Date("2026-11-01T06:31:00Z")),
    "2026-11-02T07:30:00.000Z",
  );
  assert.equal(
    nextRun(schedule(), new Date("2026-11-23T14:00:00Z")),
    "2026-11-30T13:00:00.000Z",
  );
  assert.equal(
    nextRun(
      schedule({ cadence: "monthly", monthDay: 28 }),
      new Date("2026-11-29T00:00:00Z"),
    ),
    "2026-12-28T13:00:00.000Z",
  );
});
test("schedules persist, deduplicate runs, deliver PDF/Excel and external expiring approved links", async () => {
  const s = await create(
    schedule({ format: "both", externalEmails: ["customer@delivery.test"] }),
  );
  await queue(s.id, "same-click");
  await queue(s.id, "same-click");
  assert.equal(
    (await db.query("SELECT id FROM mail_jobs WHERE schedule_id=$1", [s.id]))
      .rows.length,
    2,
  );
  const n = mails.length;
  assert.equal(await processMailJobs(db), 2);
  assert.equal(mails.length, n + 2);
  const internal = mails
    .slice(n)
    .find((x) => x.includes("To: owner@delivery.test"))!;
  assert(internal.includes("fieldboard-report.pdf"));
  assert(internal.includes("fieldboard-report.xlsx"));
  const external = mails
    .slice(n)
    .find((x) => x.includes("To: customer@delivery.test"))!;
  assert(!external.includes("filename="));
  const decoded = external.replace(/=\r\n/g, "").replace(/=3D/g, "=");
  const token = decoded.match(/\/share\/([a-f0-9]{64})/)?.[1];
  assert(token);
  const shared = await request(app).get("/api/publications/" + token);
  assert.equal(shared.status, 200);
  assert(!("finances" in shared.body.snapshot));
  const jobs = (await admin.get(`/api/projects/${projectId}/report-schedules`))
    .body.jobs;
  assert(jobs.every((j: any) => j.state === "sent"));
  assert(!JSON.stringify(jobs).includes(token));
  assert.equal(await processMailJobs(db), 0);
  await db.query("UPDATE report_schedules SET next_run_at=$1 WHERE id=$2", [
    "2026-01-01T00:00:00Z",
    s.id,
  ]);
  assert.equal(await enqueueDueSchedules(db), 1);
  assert.equal(await enqueueDueSchedules(db), 0);
  await processMailJobs(db);
  assert.equal(
    (
      await write(
        worker,
        "post",
        `/api/projects/${projectId}/report-schedules`,
        { data: schedule() },
      )
    ).status,
    403,
  );
});
test("delivery retries temporary SMTP rejection and rechecks project access before sending", async () => {
  const s = await create(schedule({ recipientIds: [workerId] }));
  await queue(s.id);
  reject = true;
  assert.equal(await processMailJobs(db), 0);
  reject = false;
  let j = (
    await db.query("SELECT * FROM mail_jobs WHERE schedule_id=$1", [s.id])
  ).rows[0];
  assert.equal(j.state, "queued");
  assert.equal(j.attempts, 1);
  assert(j.last_error);
  await db.query("UPDATE mail_jobs SET available_at=now() WHERE id=$1", [j.id]);
  assert.equal(await processMailJobs(db), 1);
  j = (await db.query("SELECT * FROM mail_jobs WHERE id=$1", [j.id])).rows[0];
  assert.equal(j.state, "sent");
  assert.equal(j.attempts, 2);
  await queue(s.id);
  await write(admin, "patch", "/api/users/" + workerId, {
    role: "foreman",
    projectIds: [],
    active: true,
  });
  const n = mails.length;
  assert.equal(await processMailJobs(db), 0);
  assert.equal(mails.length, n);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM mail_jobs WHERE schedule_id=$1 AND state='failed'",
        [s.id],
      )
    ).rows[0].n,
    1,
  );
  await write(admin, "patch", "/api/users/" + workerId, {
    role: "foreman",
    projectIds: [projectId],
    active: true,
  });
});
test("portfolio schedules remain internal and queued deliveries survive encrypted-backup data restore", async () => {
  assert.throws(() =>
    schedule({
      report: { type: "portfolio" },
      externalEmails: ["customer@delivery.test"],
    }),
  );
  const s = await create(schedule({ report: { type: "portfolio" } }));
  await queue(s.id);
  const backup = await backupData(db);
  const copy = await openDb(":memory:");
  try {
    await migrate(copy);
    await restoreData(copy, backup);
    assert.equal(
      (
        await copy.query("SELECT id FROM mail_jobs WHERE schedule_id=$1", [
          s.id,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await copy.close();
  }
  assert.equal(await processMailJobs(db), 1);
});
test("paused schedules cancel queued mail and stale edits fail without sending", async () => {
  const s = await create(schedule());
  await queue(s.id);
  const changed = await write(
    admin,
    "patch",
    `/api/projects/${projectId}/report-schedules/${s.id}`,
    { data: { ...s.data, active: false }, version: s.version },
  );
  assert.equal(changed.status, 200);
  assert.equal(
    (
      await write(
        admin,
        "patch",
        `/api/projects/${projectId}/report-schedules/${s.id}`,
        { data: s.data, version: s.version },
      )
    ).status,
    409,
  );
  const n = mails.length;
  assert.equal(await processMailJobs(db), 0);
  assert.equal(mails.length, n);
  assert.equal(
    (await db.query("SELECT state FROM mail_jobs WHERE schedule_id=$1", [s.id]))
      .rows[0].state,
    "failed",
  );
});
test("external retries reuse one frozen publication and SMTP-disabled schedules do not accumulate jobs", async () => {
  const s = await create(
    schedule({ recipientIds: [], externalEmails: ["retry@delivery.test"] }),
  );
  await queue(s.id);
  reject = true;
  assert.equal(await processMailJobs(db), 0);
  reject = false;
  const before = (await db.query("SELECT count(*)::int n FROM publications"))
    .rows[0].n;
  await db.query(
    "UPDATE mail_jobs SET available_at=now() WHERE schedule_id=$1",
    [s.id],
  );
  assert.equal(await processMailJobs(db), 1);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM publications")).rows[0].n,
    before,
  );
  await db.query("UPDATE report_schedules SET next_run_at=$1 WHERE id=$2", [
    "2026-01-01T00:00:00Z",
    s.id,
  ]);
  const host = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  assert.equal(await enqueueDueSchedules(db), 0);
  process.env.SMTP_HOST = host;
  assert.equal(await enqueueDueSchedules(db), 1);
  await processMailJobs(db);
});
test("public workspace signup requires an emailed one-use token and creates an isolated organization", async () => {
  const guest = request.agent(app),
    n = mails.length;
  const r = await write(guest, "post", "/api/auth/register", {
    name: "New owner",
    organization: "Verified org",
    email: "new@delivery.test",
    password: "delivery-new-password",
  });
  assert.equal(r.status, 202);
  assert.equal((await guest.get("/api/me")).status, 401);
  assert.equal(mails.length, n + 1);
  const text = mails[n].replace(/=\r\n/g, "").replace(/=3D/g, "=");
  const token = text.match(/token=([a-f0-9]{64})/)?.[1];
  assert(token);
  assert.equal(
    (await guest.get("/api/auth/verify").query({ token })).status,
    302,
  );
  const me = (await guest.get("/api/me")).body;
  assert.equal(me.user.role, "admin");
  assert.notEqual(me.organization.id, orgId);
  assert.deepEqual((await guest.get("/api/projects")).body, []);
  assert.equal(
    (await guest.get("/api/auth/verify").query({ token })).status,
    400,
  );
});
test("hosted entitlements verify signed webhooks, reconcile current state, deduplicate and gate tenant access", async () => {
  Object.assign(process.env, {
    BILLING_MODE: "stripe",
    STRIPE_SECRET_KEY: "sk_test_local_contract_only",
    STRIPE_WEBHOOK_SECRET: "whsec_local_contract_only",
    STRIPE_PRICE_ID: "price_dashboard",
  });
  const stripe = new Stripe("sk_test_local_contract_only");
  let status = "active",
    checkout: any,
    portal: any;
  stripe.subscriptions.retrieve = async () =>
    ({
      id: "sub_test",
      customer: "cus_test",
      metadata: { organizationId: orgId },
      status,
      items: {
        data: [
          {
            price: { id: "price_dashboard" },
            current_period_end: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
      },
    }) as any;
  stripe.checkout.sessions.create = async (parameters: any) => {
    checkout = parameters;
    return { url: "https://checkout.stripe.com/local-contract-test" } as any;
  };
  stripe.billingPortal.sessions.create = async (parameters: any) => {
    portal = parameters;
    return { url: "https://billing.stripe.com/local-contract-test" } as any;
  };
  const billApp = createApp(db, { billingClient: stripe });
  billApp.use(errorHandler);
  const owner = request.agent(billApp);
  await write(owner, "post", "/api/auth/login", {
    email: "owner@delivery.test",
    password: "delivery-test-password",
  });
  assert.equal((await owner.get("/api/projects")).status, 402);
  assert.equal((await owner.get("/api/me")).body.entitlement.allowed, false);
  assert.equal(
    (await write(owner, "post", "/api/billing/checkout", {})).status,
    200,
  );
  assert.equal(checkout.subscription_data.metadata.organizationId, orgId);
  assert.equal(checkout.line_items[0].price, "price_dashboard");
  const webhook = async (id: string, signature = true) => {
    const payload = JSON.stringify({
      id,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_test", metadata: { organizationId: orgId } } },
    });
    return request(billApp)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set(
        "stripe-signature",
        signature
          ? stripe.webhooks.generateTestHeaderString({
              payload,
              secret: process.env.STRIPE_WEBHOOK_SECRET!,
            })
          : "bad",
      )
      .send(payload);
  };
  assert.equal((await webhook("evt_bad", false)).status, 400);
  assert.equal((await webhook("evt_active")).status, 200);
  assert.equal((await webhook("evt_active")).status, 200);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM billing_events")).rows[0].n,
    1,
  );
  assert.equal((await owner.get("/api/projects")).status, 200);
  assert.equal((await owner.get("/api/me")).body.entitlement.allowed, true);
  await write(owner, "post", "/api/billing/portal", {});
  assert.equal(portal.customer, "cus_test");
  assert.equal(
    (await write(owner, "post", "/api/billing/checkout", {})).status,
    409,
  );
  status = "canceled";
  assert.equal((await webhook("evt_canceled")).status, 200);
  assert.equal((await owner.get("/api/projects")).status, 402);
  status = "active";
  assert.equal((await webhook("evt_recovered")).status, 200);
  await db.query(
    "UPDATE subscriptions SET valid_until=now()-interval '1 hour' WHERE org_id=$1",
    [orgId],
  );
  assert.equal((await owner.get("/api/projects")).status, 402);
  delete process.env.BILLING_MODE;
});
