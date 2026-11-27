import { mkdir, writeFile } from "node:fs/promises";
import { dashboard } from "../server/metrics.ts";
import { makePdf, makeExcel } from "../server/exports.ts";
import {
  projectSchema,
  schemas,
  type Project,
  type RecordRow,
} from "../server/domain.ts";
const project: Project = {
  id: "export-check",
  org_id: "sample",
  version: 1,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  data: projectSchema.parse({
    name: "Sample campus - Building A",
    code: "DEMO",
    customer: "Sample customer",
    estimatedHours: 100,
    baselineFinish: "2026-11-20",
    forecastFinish: "2026-11-25",
    sample: true,
  }),
};
const record = (
  id: string,
  kind: "section" | "task" | "report",
  data: any,
): RecordRow => ({
  id,
  project_id: project.id,
  kind,
  data: schemas[kind].parse(data),
  version: 1,
  created_at: project.created_at,
  updated_at: project.updated_at,
});
const d = dashboard(
  project,
  [
    record("s", "section", { name: "Section 1", released: true }),
    record("t", "task", {
      name: "Conduit installation",
      sectionId: "s",
      estimatedHours: 100,
      quantity: 20,
    }),
    record("m", "task", {
      name: "Handover milestone",
      sectionId: "s",
      kind: "milestone",
      baselineFinish: "2026-11-20",
      forecastFinish: "2026-11-25",
    }),
    record("r", "report", {
      date: "2026-11-20",
      taskId: "t",
      hours: 12,
      quantity: 4,
      accomplishments: "Sample installed conduits",
      status: "approved",
    }),
  ],
  {},
  "2026-11-26T12:00:00Z",
);
await mkdir(".data/export-check", { recursive: true });
await writeFile(
  ".data/export-check/report.pdf",
  await makePdf(d, "CAS-TX Sample"),
);
await writeFile(
  ".data/export-check/report.xlsx",
  await makeExcel(d, "CAS-TX Sample"),
);
console.log("Wrote synthetic PDF and Excel verification reports.");
