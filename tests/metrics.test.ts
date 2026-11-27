import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboard, workingDays, publicSnapshot } from "../server/metrics.ts";
import {
  projectSchema,
  schemas,
  type Project,
  type RecordRow,
} from "../server/domain.ts";
const p: Project = {
  id: "project",
  org_id: "org",
  data: projectSchema.parse({
    name: "Test",
    code: "T",
    customer: "Customer",
    estimatedHours: 999,
    baselineFinish: "2026-11-20",
    forecastFinish: "2026-11-25",
  }),
  version: 1,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};
const r = (id: string, kind: any, data: any): RecordRow => ({
  id,
  project_id: p.id,
  kind,
  data: (schemas as any)[kind].parse(data),
  version: 1,
  created_at: p.created_at,
  updated_at: p.updated_at,
});
const section = r("s", "section", { name: "First", released: true });
const task = r("t", "task", {
  name: "Install",
  sectionId: "s",
  estimatedHours: 100,
  quantity: 10,
  prerequisitesCleared: true,
});
const report = (
  id: string,
  status: string,
  hours: number,
  quantity: number,
  date = "2026-11-20",
) =>
  r(id, "report", {
    date,
    taskId: "t",
    hours,
    quantity,
    accomplishments: "Installed",
    status,
  });
const metric = (d: ReturnType<typeof dashboard>, key: string) =>
  d.metrics.find((m) => m.key === key)!;
test("empty and unapproved records do not invent actual hours or progress", () => {
  const d = dashboard(
    p,
    [section, task, report("draft", "draft", 20, 5)],
    {},
    "2026-11-26T00:00:00Z",
  );
  assert.equal(metric(d, "actual_hours").value, null);
  assert.equal(metric(d, "progress").value, null);
  assert.equal(metric(d, "budget").value, null);
});
test("approved hours exclude draft, rejected and voided entries", () => {
  const d = dashboard(
    p,
    [
      section,
      task,
      report("ok", "approved", 12, 3),
      report("draft", "draft", 200, 5),
      report("void", "voided", 300, 9),
    ],
    {},
    "2026-11-26T00:00:00Z",
  );
  assert.equal(metric(d, "actual_hours").value, 12);
  assert.deepEqual(metric(d, "actual_hours").sourceRecordIds, ["ok"]);
  assert.equal(metric(d, "progress").value, 30);
  assert.equal(metric(d, "remaining_hours").value, 70);
  assert.equal(metric(d, "estimated_hours").value, 100);
});
test("weighted quantities do not average percentages or count summary tasks", () => {
  const second = r("t2", "task", {
    name: "Second",
    sectionId: "s",
    estimatedHours: 300,
    quantity: 10,
  });
  const summary = r("parent", "task", {
    name: "Summary",
    sectionId: "s",
    kind: "summary",
    estimatedHours: 400,
    quantity: 20,
  });
  const rep = r("b", "report", {
    date: "2026-11-20",
    taskId: "t2",
    hours: 15,
    quantity: 2,
    accomplishments: "Installed",
    status: "approved",
  });
  const d = dashboard(
    p,
    [section, task, second, summary, report("a", "approved", 8, 10), rep],
    {},
    "2026-11-26T00:00:00Z",
  );
  assert.equal(metric(d, "progress").value, 40);
  assert.equal(metric(d, "estimated_hours").value, 400);
});
test("period hours and cumulative progress use explicit different scopes", () => {
  const d = dashboard(
    p,
    [
      section,
      task,
      report("old", "approved", 10, 2, "2026-11-10"),
      report("new", "approved", 5, 3, "2026-11-20"),
    ],
    { from: "2026-11-15", to: "2026-11-21" },
    "2026-11-26T00:00:00Z",
  );
  assert.equal(metric(d, "actual_hours").value, 5);
  assert.equal(metric(d, "progress").value, 50);
  assert.equal(metric(d, "remaining_hours").value, 50);
  assert(metric(d, "progress").sourceRecordIds.includes("old"));
});
test("readiness requires material quantity, release, and cleared prerequisites", () => {
  const material = r("m", "material", {
    name: "Cable",
    taskId: "t",
    required: 10,
    received: 9,
    unit: "ft",
    status: "partial",
  });
  assert.equal(
    metric(dashboard(p, [section, task, material]), "material_ready").value,
    0,
  );
  material.data.received = 10;
  assert.equal(
    metric(dashboard(p, [section, task, material]), "material_ready").value,
    100,
  );
  section.data.released = false;
  assert.equal(
    metric(dashboard(p, [section, task, material]), "material_ready").value,
    0,
  );
  section.data.released = true;
  assert(metric(dashboard(p, [section, task]), "material_ready").missingData);
});
test("working-day variance honors holidays and direction", () => {
  assert.equal(workingDays("2026-11-20", "2026-11-25", [1, 2, 3, 4, 5]), 3);
  assert.equal(
    workingDays("2026-11-20", "2026-11-25", [1, 2, 3, 4, 5], ["2026-11-23"]),
    2,
  );
  assert.equal(workingDays("2026-11-25", "2026-11-20", [1, 2, 3, 4, 5]), -3);
  assert.equal(workingDays("", "2026-11-20", [1]), null);
});
test("section filter cannot use full-project labor baseline", () => {
  const noEstimate = r("unknown", "task", {
    name: "Unknown estimate",
    sectionId: "s",
  });
  const d = dashboard(p, [section, noEstimate], { sectionId: "s" });
  assert.equal(metric(d, "estimated_hours").value, null);
});
test("external snapshots have a strict allowlist without internal source records", () => {
  const d = dashboard(
    p,
    [section, task, report("r", "approved", 15, 2)],
    {},
    "2026-11-26T00:00:00Z",
  );
  const published = publicSnapshot(d, "Org");
  assert(!JSON.stringify(published).includes("approved_hours"));
  assert(!("reports" in published));
  assert(!("tasks" in published));
  assert(!("sourceRecordIds" in published.metrics[0]));
  assert(!("reasons" in published));
});
test("manual and earned-hour progress require explicit approved evidence", () => {
  const manual = r("manual", "task", {
    name: "Manual activity",
    sectionId: "s",
    estimatedHours: 40,
    progressMethod: "manual",
    requiresMaterials: false,
    prerequisitesCleared: true,
  });
  const rep = r("manual-report", "report", {
    date: "2026-11-20",
    taskId: "manual",
    hours: 8,
    manualPercent: 25,
    accomplishments: "Verified quarter complete",
    status: "approved",
  });
  const d = dashboard(p, [section, manual, rep], {}, "2026-11-26T00:00:00Z");
  assert.equal(metric(d, "progress").value, 25);
  assert.equal(metric(d, "remaining_hours").value, 30);
  assert.equal(metric(d, "material_ready").value, 100);
  manual.data.progressMethod = "earned_hours";
  rep.data.earnedHours = 12;
  const e = dashboard(p, [section, manual, rep], {}, "2026-11-26T00:00:00Z");
  assert.equal(metric(e, "progress").value, 30);
  rep.data.earnedHours = null;
  assert.equal(
    metric(dashboard(p, [section, manual, rep]), "progress").value,
    null,
  );
});
