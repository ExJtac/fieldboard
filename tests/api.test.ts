import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { openDb, migrate, type DB } from "../server/db.ts";
import { createApp, errorHandler } from "../server/app.ts";
let db: DB,
  app: any,
  admin: any,
  foreman: any,
  viewer: any,
  project: any,
  section: any,
  task: any,
  report: any,
  material: any;
const write = (
  agent: any,
  method: string,
  path: string,
  data: any,
  key = randomUUID(),
) =>
  agent[method](path)
    .set("X-Fieldboard-Request", "1")
    .set("Idempotency-Key", key)
    .send(data);
const metric = (d: any, k: string) => d.metrics.find((m: any) => m.key === k);
before(async () => {
  db = await openDb(":memory:");
  await migrate(db);
  app = createApp(db);
  app.use(errorHandler);
  admin = request.agent(app);
  foreman = request.agent(app);
  viewer = request.agent(app);
});
after(async () => {
  await db.close();
});
test("install, authenticate, create persisted project and section", async () => {
  assert.equal(
    (await request(app).get("/api/auth/status")).body.setupRequired,
    true,
  );
  const setup = await write(admin, "post", "/api/auth/setup", {
    name: "Test Admin",
    organization: "Test Company",
    email: "admin@example.test",
    password: "secure-test-password",
    sample: false,
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  assert.match(setup.headers["set-cookie"][0], /HttpOnly/);
  assert.match(setup.headers["set-cookie"][0], /SameSite=Strict/);
  assert.equal(
    (
      await write(admin, "post", "/api/auth/setup", {
        name: "Second",
        organization: "Other",
        email: "other@example.test",
        password: "secure-test-password",
      })
    ).status,
    409,
  );
  project = (
    await write(admin, "post", "/api/projects", {
      name: "Acceptance project",
      code: "ACC",
      customer: "Test GC",
      estimatedHours: 100,
      baselineFinish: "2026-11-20",
      forecastFinish: "2026-11-25",
    })
  ).body;
  assert(project.id);
  section = (
    await write(admin, "post", `/api/projects/${project.id}/records/section`, {
      data: {
        name: "Section A",
        released: true,
        releaseReference: "GC release 01",
      },
    })
  ).body;
  task = (
    await write(admin, "post", `/api/projects/${project.id}/records/task`, {
      data: {
        name: "Install cable",
        sectionId: section.id,
        estimatedHours: 100,
        quantity: 10,
        unit: "lines",
        prerequisitesCleared: true,
        forecastStart: "2026-11-18",
        forecastFinish: "2026-11-25",
      },
    })
  ).body;
  assert(task.id);
  assert.equal((await db.query("SELECT id FROM projects")).rows.length, 1);
});
test("new project is no data, not fabricated progress", async () => {
  const res = await admin.get(`/api/projects/${project.id}/dashboard`);
  assert.equal(res.status, 200);
  assert.equal(metric(res.body, "actual_hours").value, null);
  assert.equal(metric(res.body, "progress").value, null);
  assert.equal(metric(res.body, "budget").value, null);
});
test("role and project checks are enforced on the server", async () => {
  for (const role of ["foreman", "viewer"])
    assert.equal(
      (
        await write(admin, "post", "/api/users", {
          name: role,
          email: `${role}@example.test`,
          password: "secure-test-password",
          role,
          projectIds: [project.id],
        })
      ).status,
      201,
    );
  await write(foreman, "post", "/api/auth/login", {
    email: "foreman@example.test",
    password: "secure-test-password",
  });
  await write(viewer, "post", "/api/auth/login", {
    email: "viewer@example.test",
    password: "secure-test-password",
  });
  assert.equal(
    (await foreman.get(`/api/projects/${project.id}/dashboard`)).status,
    200,
  );
  assert.equal(
    (await viewer.get(`/api/projects/${project.id}/dashboard`)).status,
    403,
  );
  assert.deepEqual((await viewer.get("/api/projects")).body, []);
  assert.equal(
    (
      await write(foreman, "post", "/api/users", {
        name: "Bad",
        email: "bad@example.test",
        password: "secure-test-password",
        role: "admin",
        projectIds: [],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await write(foreman, "post", "/api/projects", {
        name: "Bad",
        code: "B",
        customer: "C",
      })
    ).status,
    403,
  );
});
test("idempotent submission and single approval produce exact hours once", async () => {
  const key = randomUUID();
  const input = {
    data: {
      date: "2026-11-20",
      taskId: task.id,
      hours: 12,
      pmHours: 2,
      overtimeHours: 2,
      quantity: 3,
      accomplishments: "Installed three lines",
      status: "submitted",
    },
  };
  report = (
    await write(
      foreman,
      "post",
      `/api/projects/${project.id}/records/report`,
      input,
      key,
    )
  ).body;
  assert(report.id, JSON.stringify(report));
  const retry = await write(
    foreman,
    "post",
    `/api/projects/${project.id}/records/report`,
    input,
    key,
  );
  assert.equal(retry.body.id, report.id);
  assert.equal(
    metric(
      (await admin.get(`/api/projects/${project.id}/dashboard`)).body,
      "actual_hours",
    ).value,
    null,
  );
  assert.equal(
    (
      await write(
        foreman,
        "post",
        `/api/projects/${project.id}/approvals/${report.id}/decision`,
        { decision: "approved", version: 1, reason: "Verified" },
      )
    ).status,
    403,
  );
  const [a, b] = await Promise.all([
    write(
      admin,
      "post",
      `/api/projects/${project.id}/approvals/${report.id}/decision`,
      { decision: "approved", version: 1, reason: "Verified field quantities" },
    ),
    write(
      admin,
      "post",
      `/api/projects/${project.id}/approvals/${report.id}/decision`,
      { decision: "approved", version: 1, reason: "Verified field quantities" },
    ),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const d = (await admin.get(`/api/projects/${project.id}/dashboard`)).body;
  assert.equal(metric(d, "actual_hours").value, 12);
  assert.equal(metric(d, "progress").value, 30);
  assert.equal(metric(d, "remaining_hours").value, 70);
  assert.equal(metric(d, "overtime").value, 2);
  const sources = (
    await admin.get(`/api/projects/${project.id}/metrics/actual_hours`)
  ).body;
  assert.equal(sources.records.length, 1);
  assert.equal(sources.records[0].id, report.id);
});
test("approved records are immutable; version conflicts reject stale edits", async () => {
  assert.equal(
    (
      await write(
        foreman,
        "patch",
        `/api/projects/${project.id}/records/${report.id}`,
        { data: { ...report.data, hours: 500 }, version: 1 },
      )
    ).status,
    409,
  );
  const r = await write(
    admin,
    "patch",
    `/api/projects/${project.id}/records/${task.id}`,
    { data: { ...task.data, name: "Cable installation" }, version: 1 },
  );
  assert.equal(r.status, 200);
  task = r.body;
  assert.equal(
    (
      await write(
        admin,
        "patch",
        `/api/projects/${project.id}/records/${task.id}`,
        { data: task.data, version: 1 },
      )
    ).status,
    409,
  );
});
test("late material affects readiness and risks without changing baseline", async () => {
  material = (
    await write(admin, "post", `/api/projects/${project.id}/records/material`, {
      data: {
        name: "CAT6A",
        taskId: task.id,
        required: 10,
        received: 3,
        unit: "lines",
        status: "backordered",
        expectedDate: "2026-12-01",
        confirmed: false,
      },
    })
  ).body;
  assert(material.id);
  const d = (await admin.get(`/api/projects/${project.id}/dashboard`)).body;
  assert.equal(metric(d, "material_ready").value, 0);
  assert(d.lateMaterialIds.includes(material.id));
  assert.equal(d.project.data.baselineFinish, "2026-11-20");
  assert(d.reasons.some((s: string) => s.includes("unconfirmed")));
});
test("historical snapshots preserve approved baseline before a revision", async () => {
  const exportId = (
    await write(admin, "post", `/api/projects/${project.id}/exports`, {})
  ).body.id;
  const saved = (
    await db.query("SELECT snapshot FROM exports WHERE id=$1", [exportId])
  ).rows[0].snapshot;
  const oldAsOf = saved.asOf;
  const rev = (
    await write(admin, "post", `/api/projects/${project.id}/records/revision`, {
      data: {
        name: "GC release revision",
        baselineFinish: "2026-12-04",
        forecastFinish: "2026-12-07",
        reason: "Approved GC access change",
        status: "submitted",
      },
    })
  ).body;
  assert.equal(
    (await admin.get(`/api/projects/${project.id}/dashboard`)).body.project.data
      .baselineFinish,
    "2026-11-20",
  );
  assert.equal(
    (
      await write(
        admin,
        "post",
        `/api/projects/${project.id}/approvals/${rev.id}/decision`,
        { decision: "approved", version: 1, reason: "GC signed change" },
      )
    ).status,
    200,
  );
  const historical = (
    await admin
      .get(`/api/projects/${project.id}/dashboard`)
      .query({ asOf: oldAsOf })
  ).body;
  assert.equal(historical.project.data.baselineFinish, "2026-11-20");
  assert.equal(
    (await admin.get(`/api/projects/${project.id}/dashboard`)).body.project.data
      .baselineFinish,
    "2026-12-04",
  );
  const stored = (
    await admin.get(`/api/projects/${project.id}/exports/${exportId}/json`)
  ).body;
  assert.equal(stored.project.data.baselineFinish, "2026-11-20");
  const pdf = await admin
    .get(`/api/projects/${project.id}/exports/${exportId}/pdf`)
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: any[] = [];
      res.on("data", (c: any) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  const excel = await admin
    .get(`/api/projects/${project.id}/exports/${exportId}/xlsx`)
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: any[] = [];
      res.on("data", (c: any) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(excel.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(excel.body);
  const sheet = book.getWorksheet("Dashboard")!;
  let actual: any;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === "Approved field hours")
      actual = row.getCell(2).value;
  });
  assert.equal(actual, 12);
});
test("publications are scoped, read-only, expiring and revocable", async () => {
  const p = await write(
    admin,
    "post",
    `/api/projects/${project.id}/publications`,
    { days: 1 },
  );
  assert.equal(p.status, 201);
  const token = p.body.url.split("/").at(-1);
  const published = await request(app).get(`/api/publications/${token}`);
  assert.equal(published.status, 200);
  const body = JSON.stringify(published.body);
  assert(!body.includes("Installed three lines"));
  assert(!body.includes("actor_id"));
  assert(!body.includes("sourceRecordIds"));
  assert(
    !published.body.snapshot.metrics.some((m: any) => m.key === "actual_hours"),
  );
  assert.equal((await viewer.get(`/api/publications/${token}`)).status, 200);
  assert.equal(
    (
      await write(viewer, "post", `/api/projects/${project.id}/publications`, {
        days: 1,
      })
    ).status,
    403,
  );
  await write(
    admin,
    "delete",
    `/api/projects/${project.id}/publications/${p.body.id}`,
    {},
  );
  assert.equal(
    (await request(app).get(`/api/publications/${token}`)).status,
    404,
  );
  const exp = await write(
    admin,
    "post",
    `/api/projects/${project.id}/publications`,
    { days: 1 },
  );
  await db.query(
    "UPDATE publications SET expires_at='2000-01-01' WHERE id=$1",
    [exp.body.id],
  );
  assert.equal(
    (
      await request(app).get(
        "/api/publications/" + exp.body.url.split("/").at(-1),
      )
    ).status,
    404,
  );
});
test("tenant boundaries and cross-project references cannot be bypassed", async () => {
  await db.query(
    "INSERT INTO organizations(id,name) VALUES('other-org','Other')",
  );
  await db.query(
    "INSERT INTO projects(id,org_id,data) VALUES('other-project','other-org',$1)",
    [JSON.stringify(project.data)],
  );
  assert.equal(
    (await admin.get("/api/projects/other-project/dashboard")).status,
    404,
  );
  assert.equal(
    (
      await write(admin, "post", "/api/projects/other-project/records/issue", {
        data: { name: "Bad" },
      })
    ).status,
    404,
  );
  const p = (
    await write(admin, "post", "/api/projects", {
      name: "Second project",
      code: "SEC",
      customer: "Other GC",
    })
  ).body;
  assert.equal(
    (await foreman.get(`/api/projects/${p.id}/dashboard`)).status,
    404,
  );
  assert.equal(
    (
      await write(admin, "post", `/api/projects/${p.id}/records/report`, {
        data: {
          date: "2026-11-20",
          taskId: task.id,
          hours: 1,
          accomplishments: "Bad",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin
        .get(`/api/projects/${project.id}/dashboard`)
        .query({ sectionId: "other-section" })
    ).status,
    400,
  );
});
test("CSRF and validation reject unverified writes and impossible dates", async () => {
  assert.equal((await admin.post("/api/projects").send({})).status, 403);
  assert.equal(
    (
      await admin
        .post("/api/projects")
        .set("X-Fieldboard-Request", "1")
        .set("Origin", "https://evil.test")
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (
      await write(admin, "post", `/api/projects/${project.id}/records/report`, {
        data: {
          date: "2026-02-30",
          taskId: task.id,
          hours: 1,
          accomplishments: "Bad",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await write(admin, "post", `/api/projects/${project.id}/records/report`, {
        data: {
          date: "2026-11-20",
          taskId: task.id,
          hours: -1,
          accomplishments: "Bad",
        },
      })
    ).status,
    400,
  );
});
test("upload remains quarantined without scanner and cannot be downloaded", async () => {
  const up = await admin
    .post(`/api/projects/${project.id}/documents`)
    .set("X-Fieldboard-Request", "1")
    .field("name", "Evidence")
    .attach("file", Buffer.from("%PDF-1.4\nSample"), "evidence.pdf");
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.data.scanStatus, "quarantined");
  assert.equal(
    (await admin.get(`/api/projects/${project.id}/documents/${up.body.id}`))
      .status,
    409,
  );
  const bad = await admin
    .post(`/api/projects/${project.id}/documents`)
    .set("X-Fieldboard-Request", "1")
    .attach("file", Buffer.from("<script>alert(1)</script>"), "bad.pdf");
  assert.equal(bad.status, 400);
});
test("voiding approval removes its contribution while preserving audit history", async () => {
  const before = (
    await admin.get(`/api/projects/${project.id}/dashboard`)
  ).body.reports.find((r: any) => r.id === report.id);
  assert.equal(
    (
      await write(
        admin,
        "post",
        `/api/projects/${project.id}/approvals/${report.id}/decision`,
        {
          decision: "voided",
          version: before.version,
          reason: "Correct duplicate field documentation",
        },
      )
    ).status,
    200,
  );
  const d = (await admin.get(`/api/projects/${project.id}/dashboard`)).body;
  assert.equal(metric(d, "actual_hours").value, null);
  const logs = (await admin.get(`/api/projects/${project.id}/events`)).body;
  assert(
    logs.some((e: any) => e.entity_id === report.id && e.action === "approved"),
  );
  assert(
    logs.some((e: any) => e.entity_id === report.id && e.action === "voided"),
  );
  assert(logs.every((e: any) => e.actor_name && e.created_at));
});
test("Sample seed is idempotent with known baseline and unconfirmed actuals", async () => {
  const first = await write(admin, "post", "/api/sample", {});
  const second = await write(admin, "post", "/api/sample", {});
  assert.equal(first.body.id, second.body.id);
  const d = (await admin.get(`/api/projects/${first.body.id}/dashboard`)).body;
  assert.equal(d.sections.length, 5);
  assert.equal(d.sections.filter((s: any) => s.data.released).length, 1);
  assert.equal(metric(d, "estimated_hours").value, 1800);
  assert.equal(metric(d, "actual_hours").value, null);
  assert.equal(metric(d, "progress").value, null);
  assert.equal(d.project.data.pmHours, 180);
});
test("project setup import remaps source IDs and templates reset release state", async () => {
  const structure = (await admin.get(`/api/projects/${project.id}/structure`))
    .body;
  assert.equal(structure.schemaVersion, 1);
  assert.equal(structure.materials[0].data.received, 0);
  assert.equal(structure.materials[0].data.status, "unconfirmed");
  const imported = await write(admin, "post", "/api/import", {
    ...structure,
    project: { ...structure.project, name: "Imported setup", code: "IMP" },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const d = (await admin.get(`/api/projects/${imported.body.id}/dashboard`))
    .body;
  assert.notEqual(d.tasks[0].id, task.id);
  assert.equal(d.materials[0].data.taskId, d.tasks[0].id);
  assert.equal(d.reports.length, 0);
  assert.equal(metric(d, "actual_hours").value, null);
  const template = await write(
    admin,
    "post",
    `/api/projects/${project.id}/template`,
    { name: "Test construction template" },
  );
  assert.equal(template.status, 201);
  const next = await write(
    admin,
    "post",
    `/api/templates/${template.body.id}/projects`,
    { name: "Templated project", code: "TMP", customer: "New GC" },
  );
  assert.equal(next.status, 201, JSON.stringify(next.body));
  const td = (await admin.get(`/api/projects/${next.body.id}/dashboard`)).body;
  assert.equal(td.sections[0].data.released, false);
  assert.equal(td.project.data.baselineFinish, "");
  assert.equal(td.tasks[0].data.forecastFinish, "");
  assert.equal(td.materials[0].data.received, 0);
  const count = (await db.query("SELECT id FROM projects")).rows.length;
  structure.tasks[0].data.sectionId = "unknown";
  assert.equal(
    (await write(admin, "post", "/api/import", structure)).status,
    400,
  );
  assert.equal((await db.query("SELECT id FROM projects")).rows.length, count);
});
