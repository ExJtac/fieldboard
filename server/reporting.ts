import { z } from "zod";
import type { Dashboard } from "./metrics.ts";
export const reportTypes = [
  "weekly_owner",
  "gc_lookahead",
  "schedule_performance",
  "open_issues",
  "manpower_forecast",
  "material_risks",
  "productivity",
  "milestone_log",
  "portfolio",
] as const;
export const reportSchema = z.object({
  includeArchived: z.boolean().default(false),
  portfolioFilters: z
    .record(z.string().max(50), z.string().max(500))
    .default({}),
  type: z.enum(reportTypes).default("weekly_owner"),
  title: z.string().max(150).optional(),
  sections: z
    .array(
      z.enum([
        "metrics",
        "schedule",
        "issues",
        "resources",
        "materials",
        "productivity",
        "curve",
        "evidence",
      ]),
    )
    .max(8)
    .optional(),
});
export const reportTitles: Record<string, string> = {
  weekly_owner: "Weekly owner report",
  gc_lookahead: "GC coordination lookahead",
  schedule_performance: "Schedule performance",
  open_issues: "Open issues",
  manpower_forecast: "Manpower forecast",
  material_risks: "Material risks",
  productivity: "Productivity by activity",
  milestone_log: "Milestone log",
  portfolio: "Project portfolio rollup",
};
export function reportTables(d: Dashboard, configuration: any = {}) {
  const type = configuration.type || "weekly_owner";
  const sections =
    configuration.sections ||
    (
      {
        weekly_owner: ["metrics", "schedule", "issues", "curve"],
        gc_lookahead: ["schedule", "issues", "materials"],
        schedule_performance: ["schedule", "curve"],
        open_issues: ["issues"],
        manpower_forecast: ["resources"],
        material_risks: ["materials"],
        productivity: ["productivity"],
        milestone_log: ["schedule"],
        portfolio: [],
      } as any
    )[type];
  const tables: { name: string; columns: string[]; rows: any[][] }[] = [];
  const within = (r: any) =>
    !d.scope.from ||
    !r.data.forecastFinish ||
    r.data.forecastFinish >= d.scope.from;
  if (sections.includes("schedule"))
    tables.push({
      name: type === "milestone_log" ? "Milestone log" : "Schedule",
      columns: [
        "Activity",
        "Baseline",
        "Forecast",
        "Actual",
        "Float (workdays)",
      ],
      rows: (type === "milestone_log"
        ? d.milestones
        : d.tasks.filter((r) => r.data.kind !== "summary")
      )
        .filter(within)
        .filter(
          (r) =>
            !d.scope.to ||
            !r.data.forecastStart ||
            r.data.forecastStart <= d.scope.to,
        )
        .map((r) => [
          r.data.name,
          r.data.baselineFinish || "Unconfirmed",
          r.data.forecastFinish || "Unconfirmed",
          r.data.actualFinish || "Incomplete",
          d.analysis?.schedule.tasks.find((t) => t.id === r.id)?.floatDays ??
            "Unavailable",
        ]),
    });
  if (sections.includes("issues"))
    tables.push({
      name: "Open issues",
      columns: [
        "Issue",
        "Type",
        "Severity",
        "Owner",
        "Due",
        "Probability × impact",
        "Reference",
      ],
      rows: d.issues
        .filter((r) => r.data.status === "open")
        .map((r) => [
          r.data.name,
          r.data.type,
          r.data.severity,
          r.data.owner || "Unassigned",
          r.data.dueDate || "Unconfirmed",
          r.data.probability && r.data.impact
            ? r.data.probability * r.data.impact
            : "Unscored",
          r.data.reference || "",
        ]),
    });
  if (sections.includes("materials"))
    tables.push({
      name: "Material risks",
      columns: [
        "Material",
        "Status",
        "Required",
        "Net received",
        "Arrival earliest",
        "Arrival latest",
        "Commitment",
        "PO",
        "Return reference",
      ],
      rows: d.materials
        .filter(
          (r) =>
            r.data.received - (r.data.returned || 0) < r.data.required ||
            ["on_hold", "rejected", "backordered"].includes(r.data.status),
        )
        .map((r) => [
          r.data.name,
          r.data.status,
          r.data.required,
          r.data.received - (r.data.returned || 0),
          r.data.arrivalEarliest || r.data.expectedDate || "Unconfirmed",
          r.data.arrivalLatest || r.data.expectedDate || "Unconfirmed",
          r.data.confirmed ? "Supplier confirmed" : "Unconfirmed",
          r.data.po || "",
          r.data.returnReference || "",
        ]),
    });
  if (sections.includes("resources"))
    tables.push({
      name: "Manpower forecast",
      columns: [
        "Date",
        "Scheduled hours",
        "Available assigned hours",
        "Overallocations",
      ],
      rows: (d.analysis?.resources.daily || []).map((r) => [
        r.date,
        r.scheduledHours,
        r.availableHours,
        r.conflicts
          .map((c) => `${c.name}: ${c.requested}/${c.capacity}h`)
          .join("; ") || "None",
      ]),
    });
  if (sections.includes("productivity"))
    tables.push({
      name: "Activity productivity",
      columns: [
        "Activity",
        "Unit",
        "Installed",
        "Approved hours",
        "Units per hour",
        "Baseline remaining",
        "Labor EAC",
        "Production forecast",
      ],
      rows: (d.analysis?.productivity || []).map((r) => [
        r.name,
        r.unit,
        r.quantity ?? "No data",
        r.hours ?? "No data",
        r.unitsPerHour ?? "No data",
        r.remainingHours ?? "No data",
        r.estimateAtCompletionHours ?? "No data",
        r.forecastFinish || "Unavailable",
      ]),
    });
  if (sections.includes("curve"))
    tables.push({
      name: "Planned vs actual",
      columns: [
        "Date",
        "Planned percent",
        "Verified percent",
        "Remaining percent",
      ],
      rows: (d.analysis?.curve || []).map((r) => [
        r.date,
        r.planned ?? "No data",
        r.actual ?? "No data",
        r.actual === null ? "No data" : 100 - r.actual,
      ]),
    });
  return {
    tables,
    sections,
    title: configuration.title || reportTitles[type] || "Project report",
  };
}
