import { z } from "zod";
const text = z.string().trim().min(1).max(500);
const note = z.string().trim().max(8000).default("");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    "Invalid calendar date",
  );
const optionalDate = z.union([date, z.literal("")]).default("");
const number = z.number().finite().min(0).max(1e8);
export const roles = [
  "admin",
  "pm",
  "foreman",
  "purchasing",
  "viewer",
] as const;
export const projectSchema = z.object({
  name: text,
  code: text,
  customer: text,
  location: note,
  manager: note,
  phase: z
    .enum(["Planning", "Mobilization", "Construction", "Closeout"])
    .default("Planning"),
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
    }, "Invalid timezone"),
  estimatedHours: number.nullable().default(null),
  pmHours: number.nullable().default(null),
  baselineFinish: optionalDate,
  forecastFinish: optionalDate,
  workDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .default([1, 2, 3, 4, 5]),
  holidays: z.array(date).default([]),
  archived: z.boolean().default(false),
  sample: z.boolean().default(false),
  externalId: z.string().max(200).default(""),
  lateThresholdDays: z.number().int().min(0).max(365).default(0),
});
export type ProjectData = z.infer<typeof projectSchema>;
export const schemas = {
  section: z.object({
    name: text,
    released: z.boolean().default(false),
    releaseReference: note,
  }),
  task: z.object({
    name: text,
    sectionId: text,
    kind: z.enum(["task", "milestone", "summary"]).default("task"),
    estimatedHours: number.nullable().default(null),
    quantity: number.nullable().default(null),
    unit: z.string().max(40).default("units"),
    baselineStart: optionalDate,
    baselineFinish: optionalDate,
    forecastStart: optionalDate,
    forecastFinish: optionalDate,
    actualFinish: optionalDate,
    progressMethod: z
      .enum(["quantity", "earned_hours", "manual"])
      .default("quantity"),
    requiresMaterials: z.boolean().default(true),
    prerequisitesCleared: z.boolean().default(false),
    notes: note,
  }),
  material: z.object({
    name: text,
    taskId: text,
    required: number,
    received: number.default(0),
    unit: text,
    status: z
      .enum([
        "unconfirmed",
        "ordered",
        "acknowledged",
        "partial",
        "received",
        "backordered",
        "substituted",
        "rejected",
        "on_hold",
      ])
      .default("unconfirmed"),
    supplier: note,
    po: note,
    expectedDate: optionalDate,
    confirmed: z.boolean().default(false),
    notes: note,
  }),
  issue: z.object({
    name: text,
    taskId: z.string().default(""),
    sectionId: z.string().default(""),
    type: z.enum(["blocker", "risk", "rfi"]).default("blocker"),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    owner: note,
    dueDate: optionalDate,
    status: z.enum(["open", "closed"]).default("open"),
    notes: note,
  }),
  report: z
    .object({
      date,
      taskId: text,
      crew: note,
      hours: number,
      pmHours: number.default(0),
      overtimeHours: number.default(0),
      quantity: number.default(0),
      earnedHours: number.nullable().default(null),
      manualPercent: z.number().min(0).max(100).nullable().default(null),
      accomplishments: text,
      weather: note,
      safety: note,
      delays: note,
      deliveries: note,
      status: z
        .enum(["draft", "submitted", "approved", "rejected", "voided"])
        .default("draft"),
      decisionNote: note,
    })
    .refine(
      (r) => r.overtimeHours <= r.hours,
      "Overtime must be included in field hours",
    ),
  crew: z
    .object({
      name: text,
      sectionId: text,
      workers: z.number().int().min(1).max(10000),
      start: date,
      end: date,
      hoursPerDay: z.number().min(0).max(24).default(8),
      unavailableHours: number.default(0),
      notes: note,
    })
    .refine((r) => r.end >= r.start, "End must follow start"),
  revision: z.object({
    name: text,
    taskId: z.string().default(""),
    baselineStart: optionalDate,
    baselineFinish: optionalDate,
    forecastStart: optionalDate,
    forecastFinish: optionalDate,
    reason: text,
    status: z.enum(["submitted", "approved", "rejected"]).default("submitted"),
  }),
  document: z.object({
    name: text,
    sectionId: z.string().default(""),
    reference: note,
    filename: text,
    mime: text,
    size: number,
    scanStatus: z.enum(["clean", "quarantined"]),
    sha256: text,
  }),
};
export type Kind = keyof typeof schemas;
export interface RecordRow {
  id: string;
  project_id: string;
  kind: Kind;
  data: any;
  version: number;
  updated_at: string;
  created_at: string;
}
export interface Project {
  id: string;
  org_id: string;
  data: ProjectData;
  version: number;
  updated_at: string;
  created_at: string;
}
export interface User {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: (typeof roles)[number];
  project_ids: string[];
}
export interface Scope {
  sectionId?: string;
  from?: string;
  to?: string;
  asOf?: string;
}
export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  calculation: string;
  sourceRecordIds: string[];
  sourceVersion: string;
  asOf: string;
  scope: Scope;
  missingData: boolean;
  coverage: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
