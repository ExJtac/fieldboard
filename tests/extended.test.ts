import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { openDb, migrate, type DB } from "../server/db.ts";
import { createApp, errorHandler } from "../server/app.ts";
import {
  analyze,
  scheduleAnalysis,
  resourceAnalysis,
} from "../server/analysis.ts";
import { dashboard } from "../server/metrics.ts";
import {
  projectSchema,
  schemas,
  type RecordRow,
  type Project,
} from "../server/domain.ts";
import { makeExcel, makePdf } from "../server/exports.ts";
import { reportTypes, reportTables } from "../server/reporting.ts";
import ExcelJS from "exceljs";
let db: DB,
  app: any,
  admin: any,
  foreman: any,
  accountant: any,
  foremanId: string,
  accountantId: string;
const write = (
  agent: any,
  method: string,
  url: string,
  body: any,
  key = randomUUID(),
) =>
  agent[method](url)
    .set("X-Fieldboard-Request", "1")
    .set("Idempotency-Key", key)
    .send(body);
const rec = (id: string, kind: any, data: any): RecordRow => ({
  id,
  kind,
  data: schemas[kind as keyof typeof schemas].parse(data),
  project_id: "p",
  version: 1,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
});
const project: Project = {
  id: "p",
  org_id: "o",
  data: projectSchema.parse({
    name: "Analysis fixture",
    code: "A",
    customer: "GC",
    forecastMethod: "approved_productivity",
    productionWindow: "7",
    baselineFinish: "2026-11-27",
    forecastFinish: "2026-11-27",
  }),
  version: 1,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};
const fixture = () => [
  rec("s", "section", { name: "S", released: true }),
  rec("t", "task", {
    name: "Conduit",
    sectionId: "s",
    estimatedHours: 100,
    quantity: 100,
    baselineStart: "2026-11-16",
    baselineFinish: "2026-11-27",
    durationDays: 10,
    requiresMaterials: false,
    prerequisitesCleared: true,
  }),
  rec("r", "report", {
    taskId: "t",
    date: "2026-11-20",
    hours: 20,
    quantity: 25,
    accomplishments: "25 inspected units",
    status: "approved",
  }),
];
before(async () => {
  db = await openDb(process.env.TEST_DATABASE_URL || ":memory:");
  await migrate(db);
  app = createApp(db);
  app.use(errorHandler);
  admin = request.agent(app);
  let r = await write(admin, "post", "/api/auth/setup", {
    email: "owner@extended.test",
    password: "extended-test-password",
    name: "Owner",
    organization: "Extended tests",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const f = await write(admin, "post", "/api/users", {
    email: "foreman@extended.test",
    password: "extended-test-password",
    name: "Foreman",
    role: "foreman",
    projectIds: [],
  });
  foremanId = f.body.id;
  const a = await write(admin, "post", "/api/users", {
    email: "accountant@extended.test",
    password: "extended-test-password",
    name: "Accountant",
    role: "accountant",
    projectIds: [],
  });
  accountantId = a.body.id;
  foreman = request.agent(app);
  accountant = request.agent(app);
});
after(async () => {
  await db.close();
});
async function setup() {
  const p = (
    await write(admin, "post", "/api/projects", {
      name: "Test " + randomUUID(),
      code: "EXT",
      customer: "GC",
    })
  ).body;
  const s = (
    await write(admin, "post", `/api/projects/${p.id}/records/section`, {
      data: { name: "Section" },
    })
  ).body;
  const t = (
    await write(admin, "post", `/api/projects/${p.id}/records/task`, {
      data: {
        name: "Activity",
        sectionId: s.id,
        estimatedHours: 100,
        quantity: 100,
        baselineStart: "2026-11-16",
        baselineFinish: "2026-11-27",
        durationDays: 10,
      },
    })
  ).body;
  for (const [id, role, agent, email] of [
    [foremanId, "foreman", foreman, "foreman@extended.test"],
    [accountantId, "accountant", accountant, "accountant@extended.test"],
  ] as any[]) {
    await write(admin, "patch", `/api/users/${id}`, {
      role,
      projectIds: [p.id],
      active: true,
    });
    await write(agent, "post", "/api/auth/login", {
      email,
      password: "extended-test-password",
    });
  }
  return { p, s, t };
}
async function create(p: any, kind: string, data: any, agent = admin) {
  const r = await write(
    agent,
    "post",
    `/api/projects/${p.id}/records/${kind}`,
    { data },
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function approve(p: any, row: any, decision = "approved") {
  const r = await write(
    admin,
    "post",
    `/api/projects/${p.id}/approvals/${row.id}/decision`,
    {
      version: row.version,
      decision,
      reason: "Reviewed supporting source evidence",
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
test("production curves use approved quantities, working-day windows and missing evidence", () => {
  const rows = fixture();
  rows.push(
    rec("draft", "report", {
      taskId: "t",
      date: "2026-11-21",
      hours: 999,
      quantity: 999,
      accomplishments: "Unapproved",
      status: "draft",
    }),
  );
  const a = analyze(project, rows, {}, "2026-11-23T18:00:00Z");
  assert.equal(a.productivity[0].unitsPerHour, 1.25);
  assert.equal(a.productivity[0].progress, 25);
  assert.equal(a.productivity[0].estimateAtCompletionHours, 80);
  assert.equal(a.productivity[0].remainingHours, 75);
  assert.equal(a.productivity[0].windows[0].quantity, 25);
  assert.equal(a.productivity[0].windows[0].unitsPerWorkday, 5);
  assert.equal(a.productivity[0].forecastFinish, "2026-12-14");
  assert.equal(a.curve.find((x) => x.date === "2026-11-19")!.actual, null);
  assert.equal(a.curve.find((x) => x.date === "2026-11-20")!.actual, 25);
  assert.equal(a.curve.find((x) => x.date === "2026-11-20")!.planned, 50);
});
test("critical-path forward/backward pass respects dependencies and detects cycles", () => {
  const t1 = rec("a", "task", {
      name: "A",
      sectionId: "s",
      durationDays: 2,
      baselineStart: "2026-11-16",
    }),
    t2 = rec("b", "task", {
      name: "B",
      sectionId: "s",
      durationDays: 3,
      predecessorIds: ["a"],
    }),
    t3 = rec("c", "task", {
      name: "C",
      sectionId: "s",
      durationDays: 1,
      predecessorIds: ["a"],
    });
  const a = scheduleAnalysis(project, [t1, t2, t3]);
  assert.equal(a.finish, "2026-11-20");
  assert.equal(a.tasks.find((t) => t.id === "b").start, "2026-11-18");
  assert.equal(a.tasks.find((t) => t.id === "c").floatDays, 2);
  assert.equal(a.tasks.find((t) => t.id === "a").critical, true);
  t1.data.predecessorIds = ["b"];
  assert.equal(
    scheduleAnalysis(project, [t1, t2, t3]).reason,
    "Dependency cycle",
  );
});
test("person calendars deduct date-specific leave and detect overallocations without double-counting capacity", () => {
  const rows = [
    rec("person", "resource", {
      name: "Worker",
      hoursPerDay: 8,
      unavailable: [{ date: "2026-11-23", hours: 4 }],
    }),
    rec("crew1", "crew", {
      name: "Crew 1",
      sectionId: "s",
      workers: 99,
      memberIds: ["person"],
      start: "2026-11-23",
      end: "2026-11-24",
      hoursPerDay: 6,
    }),
    rec("crew2", "crew", {
      name: "Crew 2",
      sectionId: "s",
      workers: 99,
      memberIds: ["person"],
      start: "2026-11-23",
      end: "2026-11-23",
      hoursPerDay: 4,
    }),
  ];
  const a = resourceAnalysis(
    project,
    rows,
    { from: "2026-11-23", to: "2026-11-24" },
    "2026-11-23",
  );
  assert.equal(a.daily[0].scheduledHours, 10);
  assert.equal(a.daily[0].availableHours, 4);
  assert.equal(a.daily[0].conflicts[0].requested, 10);
  assert.equal(a.daily[1].availableHours, 6);
});
test("approved EVM requires complete budget allocation, actual cost and verified progress", () => {
  const rows = fixture();
  rows.push(
    rec("b", "finance", {
      name: "Budget",
      taskId: "t",
      type: "budget",
      amount: 1000,
      date: "2026-11-01",
      reference: "B1",
      status: "approved",
    }),
    rec("c", "finance", {
      name: "Cost",
      taskId: "t",
      type: "cost",
      amount: 200,
      date: "2026-11-20",
      reference: "C1",
      status: "approved",
    }),
    rec("revenue", "finance", {
      name: "Revenue",
      type: "revenue",
      amount: 350,
      date: "2026-11-20",
      reference: "R1",
      status: "approved",
    }),
  );
  const metric = (rs: RecordRow[], key: string) =>
    analyze(project, rs, {}, "2026-11-20T18:00:00Z").financialMetrics.find(
      (m) => m.key === key,
    )!.value;
  assert.equal(metric(rows, "budget"), 1000);
  assert.equal(metric(rows, "earned_value"), 250);
  assert.equal(metric(rows, "planned_value"), 500);
  assert.equal(metric(rows, "cpi"), 1.25);
  assert.equal(metric(rows, "spi"), 0.5);
  assert.equal(metric(rows, "cost_eac"), 800);
  assert.equal(metric(rows, "cost_etc"), 600);
  assert.equal(metric(rows, "gross_margin"), 150);
  rows.push(
    rec("unbudgeted", "task", {
      name: "Missing budget",
      sectionId: "s",
      estimatedHours: 100,
      quantity: 100,
    }),
  );
  assert.equal(metric(rows, "earned_value"), null);
  assert.equal(metric(rows, "cpi"), null);
});
test("finance approval, voiding and field-level restrictions hold across dashboard, exports and drilldown", async () => {
  const { p, t } = await setup();
  const entry = await create(
    p,
    "finance",
    {
      name: "Invoice private",
      taskId: t.id,
      type: "cost",
      amount: 12345,
      date: "2026-11-20",
      reference: "private-invoice",
    },
    accountant,
  );
  let d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(d.metrics.find((m: any) => m.key === "actual_cost").value, null);
  const approved = await approve(p, entry);
  d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(
    d.metrics.find((m: any) => m.key === "actual_cost").value,
    12345,
  );
  const exportId = (
    await write(admin, "post", `/api/projects/${p.id}/exports`, {})
  ).body.id;
  for (const url of [
    `/api/projects/${p.id}/dashboard`,
    `/api/projects/${p.id}/exports/${exportId}/json`,
  ]) {
    const r = await foreman.get(url);
    assert.equal(r.status, 200);
    assert(!JSON.stringify(r.body).includes("private-invoice"));
    assert(!JSON.stringify(r.body).includes("12345"));
  }
  const f = await write(
    foreman,
    "post",
    `/api/projects/${p.id}/records/finance`,
    { data: entry.data },
  );
  assert.equal(f.status, 403);
  await approve(p, approved, "voided");
  d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(d.metrics.find((m: any) => m.key === "actual_cost").value, null);
});
test("release approvals are version checked; duplicate or stale decisions cannot overwrite targets", async () => {
  const { p, s } = await setup();
  const req = await create(p, "request", {
    name: "GC release",
    type: "release",
    targetId: s.id,
    targetVersion: s.version,
    reason: "Written GC authorization",
    reference: "GC-123",
  });
  const row = await approve(p, req);
  assert.equal(row.data.status, "approved");
  const d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(d.sections[0].data.released, true);
  assert.equal(d.sections[0].data.releaseReference, "GC-123");
  assert.equal(
    (
      await write(
        admin,
        "post",
        `/api/projects/${p.id}/approvals/${req.id}/decision`,
        { version: 1, decision: "approved", reason: "Duplicate" },
      )
    ).status,
    409,
  );
  const next = await create(p, "request", {
    name: "GC stale",
    type: "release",
    targetId: s.id,
    targetVersion: 2,
    reason: "Original evidence",
  });
  await write(admin, "patch", `/api/projects/${p.id}/records/${s.id}`, {
    version: 2,
    data: { ...d.sections[0].data, releaseReference: "New evidence" },
  });
  assert.equal(
    (
      await write(
        admin,
        "post",
        `/api/projects/${p.id}/approvals/${next.id}/decision`,
        { version: 1, decision: "approved", reason: "Stale decision" },
      )
    ).status,
    409,
  );
});
test("substitution and field-change approvals preserve approved schedule; publication request yields expiring public snapshot", async () => {
  const { p, t } = await setup();
  const m = await create(p, "material", {
    name: "Cable",
    taskId: t.id,
    required: 10,
    unit: "m",
  });
  const r = await create(p, "request", {
    name: "Substitute cable",
    type: "substitution",
    targetId: m.id,
    targetVersion: 1,
    reason: "Approved equivalent cable",
  });
  await approve(p, r);
  let d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(d.materials[0].data.status, "substituted");
  assert.equal(d.tasks[0].data.baselineFinish, "2026-11-27");
  const publication = await create(p, "request", {
    name: "GC review",
    type: "publication",
    reason: "Approved coordination package",
  });
  const result = await approve(p, publication);
  assert(result.publication.url);
  const pub = await request(app).get(
    "/api/publications/" + result.publication.url.split("/").at(-1),
  );
  assert.equal(pub.status, 200);
  assert(!JSON.stringify(pub.body).includes("Substitute cable"));
});
test("comments and mentions enforce management visibility and create durable notifications", async () => {
  const { p, t } = await setup();
  await create(p, "comment", {
    name: "Install note",
    body: "Please review inspection",
    targetId: t.id,
    mentions: [foremanId],
  });
  let inbox = (await foreman.get("/api/notifications")).body;
  assert(inbox.some((n: any) => n.data.category === "mentions"));
  const note = inbox.find((n: any) => n.data.category === "mentions");
  assert.equal(
    (await write(foreman, "post", `/api/notifications/${note.id}/read`, {}))
      .status,
    200,
  );
  await create(p, "comment", {
    name: "Management",
    body: "Confidential margin discussion",
    visibility: "management",
    mentions: [accountantId],
  });
  const visible = (await foreman.get(`/api/projects/${p.id}/dashboard`)).body;
  assert(!JSON.stringify(visible).includes("Confidential margin"));
  assert.equal(
    (
      await write(foreman, "post", `/api/projects/${p.id}/records/comment`, {
        data: { name: "Bypass", body: "Bad", visibility: "management" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await write(admin, "post", `/api/projects/${p.id}/records/comment`, {
        data: {
          name: "Bad mention",
          body: "Secret",
          visibility: "management",
          mentions: [foremanId],
        },
      })
    ).status,
    400,
  );
});
test("overdue reminders escalate once and respect project access and notification preferences", async () => {
  const { p } = await setup();
  await create(p, "issue", {
    name: "Overdue RFI",
    type: "rfi",
    dueDate: "2026-01-01",
    ownerId: foremanId,
  });
  await foreman.get("/api/notifications");
  await foreman.get("/api/notifications");
  const rows = (
    await db.query(
      "SELECT * FROM notifications WHERE user_id=$1 AND source_key LIKE 'due:%' AND project_id=$2",
      [foremanId, p.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.category, "reminders");
  await write(foreman, "put", "/api/preferences", {
    mentions: true,
    approvals: true,
    changes: false,
    reminders: false,
  });
  await create(p, "issue", {
    name: "Muted reminder",
    dueDate: "2026-01-01",
    ownerId: foremanId,
  });
  await foreman.get("/api/notifications");
  assert.equal(
    (
      await db.query(
        "SELECT * FROM notifications WHERE user_id=$1 AND source_key LIKE 'due:%' AND project_id=$2",
        [foremanId, p.id],
      )
    ).rows.length,
    1,
  );
});
test("dependency proposal requires approval and cyclic task edits roll back", async () => {
  const { p, t, s } = await setup();
  const second = await create(p, "task", {
    name: "Successor",
    sectionId: s.id,
    durationDays: 2,
    predecessorIds: [t.id],
  });
  const cycle = await write(
    admin,
    "patch",
    `/api/projects/${p.id}/records/${t.id}`,
    { version: t.version, data: { ...t.data, predecessorIds: [second.id] } },
  );
  assert.equal(cycle.status, 400);
  const proposals = await write(
    admin,
    "post",
    `/api/projects/${p.id}/forecast-proposal`,
    { reason: "Reviewed dependency scenario" },
  );
  assert.equal(proposals.status, 201);
  let d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(
    d.tasks.find((r: any) => r.id === second.id).data.forecastFinish,
    "",
  );
  assert(d.revisions.length > 0);
  const rev = proposals.body.find((r: any) => r.data.taskId === second.id);
  await approve(p, rev);
  d = (await admin.get(`/api/projects/${p.id}/dashboard`)).body;
  assert.equal(
    d.tasks.find((r: any) => r.id === second.id).data.forecastFinish,
    "2026-12-01",
  );
});
test("resource edits are audited and historical snapshots retain prior calendar", async () => {
  const { p } = await setup();
  const r = await write(admin, "post", "/api/resources", {
    data: { name: "Electrician", hoursPerDay: 8 },
  });
  assert.equal(r.status, 201);
  const historical = (await admin.get(`/api/projects/${p.id}/dashboard`)).body
    .asOf;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    (
      await write(admin, "patch", `/api/resources/${r.body.id}`, {
        version: 1,
        data: { ...r.body.data, hoursPerDay: 4 },
      })
    ).status,
    200,
  );
  const old = (
    await admin
      .get(`/api/projects/${p.id}/dashboard`)
      .query({ asOf: historical })
  ).body;
  assert.equal(
    old.analysis.resources.resources.find((x: any) => x.id === r.body.id).data
      .hoursPerDay,
    8,
  );
  assert.equal(
    (
      await write(foreman, "patch", `/api/resources/${r.body.id}`, {
        version: 2,
        data: r.body.data,
      })
    ).status,
    403,
  );
});
test("all specialized reports produce usable PDF and Excel with filtered data", async () => {
  const d = dashboard(
    project,
    fixture(),
    { from: "2026-11-20", to: "2026-11-23" },
    "2026-11-23T18:00:00Z",
  );
  for (const type of reportTypes) {
    const snapshot = {
      ...d,
      report: {
        type,
        organization: "Brand frozen",
        branding: { reportFooter: "Verified test footer" },
      },
    };
    const pdf = await makePdf(snapshot, "Other");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const excel = await makeExcel(snapshot, "Other");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excel as any);
    assert.equal(wb.creator, "Brand frozen");
    for (const table of reportTables(d, { type }).tables)
      assert(wb.getWorksheet(table.name));
    assert(wb.getWorksheet("Dashboard"));
  }
});
test("branding freezes in snapshot and shared views remain tenant isolated", async () => {
  const { p } = await setup();
  const settings = await write(admin, "put", "/api/workspace", {
    name: "Original branding",
    settings: { reportFooter: "Original footer" },
  });
  assert.equal(settings.status, 200);
  const exp = await write(admin, "post", `/api/projects/${p.id}/exports`, {
    type: "open_issues",
  });
  assert.equal(exp.status, 201);
  await write(admin, "put", "/api/workspace", {
    name: "Changed branding",
    settings: { reportFooter: "New footer" },
  });
  const snap = (
    await admin.get(`/api/projects/${p.id}/exports/${exp.body.id}/json`)
  ).body;
  assert.equal(snap.report.organization, "Original branding");
  assert.equal(snap.report.branding.reportFooter, "Original footer");
  const view = await write(admin, "post", "/api/shared-views", {
    name: "Field team",
    team: "Field",
    data: {
      hidden: ["budget"],
      order: ["actual_hours"],
      filters: { from: "2026-11-01" },
    },
  });
  assert.equal(view.status, 201);
  assert(
    (await foreman.get("/api/shared-views")).body.some(
      (r: any) => r.id === view.body.id,
    ),
  );
  assert.equal(
    (await write(foreman, "delete", `/api/shared-views/${view.body.id}`, {}))
      .status,
    403,
  );
});
test("named crew capacity metric matches person calendar and material returns reduce readiness", () => {
  const rows = fixture();
  rows[1].data.requiresMaterials = true;
  rows.push(
    rec("person", "resource", {
      name: "Person",
      hoursPerDay: 8,
      unavailable: [{ date: "2026-11-23", hours: 4 }],
    }),
    rec("crew", "crew", {
      name: "Crew",
      sectionId: "s",
      memberIds: ["person"],
      workers: 99,
      start: "2026-11-23",
      end: "2026-11-23",
      hoursPerDay: 8,
    }),
    rec("material", "material", {
      name: "Cable",
      taskId: "t",
      required: 10,
      received: 10,
      returned: 1,
      unit: "m",
      status: "received",
      returnReference: "RETURN-1",
    }),
  );
  const d = dashboard(
    project,
    rows,
    { from: "2026-11-23", to: "2026-11-23" },
    "2026-11-23T18:00:00Z",
  );
  assert.equal(d.metrics.find((m) => m.key === "crew_capacity")!.value, 4);
  assert.equal(d.metrics.find((m) => m.key === "material_ready")!.value, 0);
});
test("setup interchange remaps forward dependencies and rejects imported cycles atomically", async () => {
  const { p, s, t } = await setup();
  const second = await create(p, "task", {
    name: "Second",
    sectionId: s.id,
    durationDays: 2,
    predecessorIds: [t.id],
  });
  const structure = (await admin.get(`/api/projects/${p.id}/structure`)).body;
  structure.tasks.reverse();
  const imported = await write(admin, "post", "/api/import", structure);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const d = (await admin.get(`/api/projects/${imported.body.id}/dashboard`))
    .body;
  assert.deepEqual(
    d.tasks.find((r: any) => r.data.name === "Second").data.predecessorIds,
    [d.tasks.find((r: any) => r.data.name === "Activity").id],
  );
  structure.tasks.find((r: any) => r.id === t.id).data.predecessorIds = [
    second.id,
  ];
  const count = (await db.query("SELECT count(*) AS count FROM projects"))
    .rows[0].count;
  assert.equal(
    (await write(admin, "post", "/api/import", structure)).status,
    400,
  );
  assert.equal(
    (await db.query("SELECT count(*) AS count FROM projects")).rows[0].count,
    count,
  );
});
test("retention is opt-in, preserves source history and cannot purge another organization", async () => {
  const { p } = await setup();
  const u = (await admin.get("/api/me")).body.user;
  const exported = await write(
    admin,
    "post",
    `/api/projects/${p.id}/exports`,
    {},
  );
  await db.query("UPDATE exports SET created_at='2020-01-01' WHERE id=$1", [
    exported.body.id,
  ]);
  const before = (
    await db.query("SELECT count(*) AS n FROM events WHERE project_id=$1", [
      p.id,
    ])
  ).rows[0].n;
  await write(admin, "post", "/api/operations/retention", {});
  assert(
    (await db.query("SELECT id FROM exports WHERE id=$1", [exported.body.id]))
      .rows.length,
  );
  await write(admin, "put", "/api/workspace", {
    name: "Retention test",
    settings: { automaticRetention: true, exportRetentionDays: 30 },
  });
  await db.query(
    "INSERT INTO organizations(id,name,settings) VALUES('retention-other','Other',$1)",
    [JSON.stringify({ automaticRetention: true, exportRetentionDays: 30 })],
  );
  await db.query(
    "INSERT INTO projects(id,org_id,data) VALUES('retention-other-project','retention-other',$1)",
    [JSON.stringify(p.data)],
  );
  await db.query(
    "INSERT INTO exports(id,project_id,snapshot,created_by,created_at) VALUES('retention-other-export','retention-other-project','{}','other','2020-01-01')",
  );
  const result = await write(admin, "post", "/api/operations/retention", {});
  assert.equal(result.status, 200);
  assert.equal(
    (await db.query("SELECT id FROM exports WHERE id=$1", [exported.body.id]))
      .rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT id FROM exports WHERE id='retention-other-export'"))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await db.query("SELECT count(*) AS n FROM events WHERE project_id=$1", [
        p.id,
      ])
    ).rows[0].n,
    before,
  );
  assert.equal(
    (await write(foreman, "post", "/api/operations/retention", {})).status,
    403,
  );
});
test("resource directory is restricted to accessible assignments and hides private leave reasons", async () => {
  const { p, s } = await setup();
  const person = (
    await write(admin, "post", "/api/resources", {
      data: {
        name: "Assigned resource",
        unavailable: [
          { date: "2026-11-23", hours: 4, reason: "Private leave detail" },
        ],
      },
    })
  ).body;
  const other = (
    await write(admin, "post", "/api/resources", {
      data: { name: "Unassigned person" },
    })
  ).body;
  await create(p, "crew", {
    name: "Assigned crew",
    sectionId: s.id,
    memberIds: [person.id],
    workers: 1,
    start: "2026-11-23",
    end: "2026-11-24",
  });
  const list = (await foreman.get("/api/resources")).body;
  assert(list.some((r: any) => r.id === person.id));
  assert(!list.some((r: any) => r.id === other.id));
  assert(!JSON.stringify(list).includes("Private leave detail"));
  const d = (await foreman.get(`/api/projects/${p.id}/dashboard`)).body;
  assert(!d.analysis.resources.resources.some((r: any) => r.id === other.id));
});
test("portfolio report honors selected filters and omits projects created after historical snapshot", async () => {
  const { p } = await setup();
  const asOf = (await admin.get(`/api/projects/${p.id}/dashboard`)).body.asOf;
  const later = (
    await write(admin, "post", "/api/projects", {
      name: "Later project",
      code: "LATER",
      customer: "Late GC",
    })
  ).body;
  const filtered = (
    await write(admin, "post", `/api/projects/${p.id}/exports`, {
      type: "portfolio",
      portfolioFilters: { customer: "Late GC" },
    })
  ).body;
  const result = (
    await admin.get(`/api/projects/${p.id}/exports/${filtered.id}/json`)
  ).body;
  assert.deepEqual(
    result.report.portfolio.map((r: any) => r.projectId),
    [later.id],
  );
  const historical = await write(
    admin,
    "post",
    `/api/projects/${p.id}/exports?asOf=${encodeURIComponent(asOf)}`,
    { type: "portfolio" },
  );
  assert.equal(historical.status, 201, JSON.stringify(historical.body));
  const old = (
    await admin.get(`/api/projects/${p.id}/exports/${historical.body.id}/json`)
  ).body;
  assert(!old.report.portfolio.some((r: any) => r.projectId === later.id));
});

test("custom report sections omit unselected metrics, labor and source worksheets", async () => {
  const d = dashboard(project, fixture(), {}, "2026-11-23T18:00:00Z");
  const custom = {
    ...d,
    report: {
      type: "weekly_owner",
      sections: ["issues"],
      title: "Issues only",
    },
  };
  const bytes = await makeExcel(custom, "Custom reports");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as any);
  assert.deepEqual(
    wb.worksheets.map((s) => s.name),
    ["Open issues", "Snapshot"],
  );
  assert((await makePdf(custom, "Custom reports")).length > 500);
});
