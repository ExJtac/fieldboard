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
  "accountant",
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
  division: note,
  tags: z.array(z.string().max(80)).max(50).default([]),
  workstreams: z.array(z.string().max(80)).max(50).default([]),
  team: note,
  contractStage: z
    .enum(["prospect", "awarded", "active", "complete"])
    .default("active"),
  forecastMethod: z.enum(["none", "approved_productivity"]).default("none"),
  productionWindow: z.enum(["7", "14", "30"]).default("14"),
  missingUpdateDays: z.number().int().min(1).max(365).default(7),
  readinessWarningPercent: z.number().min(0).max(100).default(50),
  riskWarningScore: z.number().int().min(1).max(25).default(12),
  escalationDays: z.number().int().min(0).max(365).default(2),
  manualStatus: z
    .enum(["unconfirmed", "on_track", "attention", "blocked"])
    .default("unconfirmed"),
  manualStatusReason: note,
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
    predecessorIds: z.array(z.string().max(100)).max(100).default([]),
    durationDays: z.number().int().min(0).max(10000).nullable().default(null),
    completionReference: note,
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
    arrivalEarliest: optionalDate,
    arrivalLatest: optionalDate,
    leadTimeDays: z.number().int().min(0).max(10000).nullable().default(null),
    returned: number.default(0),
    returnReference: note,
    deliveryReference: note,
    confirmed: z.boolean().default(false),
    notes: note,
  }),
  issue: z.object({
    name: text,
    taskId: z.string().default(""),
    sectionId: z.string().default(""),
    type: z.enum(["blocker", "risk", "rfi", "submittal"]).default("blocker"),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    owner: note,
    ownerId: z.string().max(100).default(""),
    probability: z.number().int().min(1).max(5).nullable().default(null),
    impact: z.number().int().min(1).max(5).nullable().default(null),
    raisedDate: optionalDate,
    closedDate: optionalDate,
    reference: note,
    evidenceIds: z.array(z.string().max(100)).max(50).default([]),
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
      signoff: note,
      revisionOf: z.string().max(100).default(""),
      evidenceIds: z.array(z.string().max(100)).max(50).default([]),
    })
    .refine(
      (r) => r.overtimeHours <= r.hours,
      "Overtime must be included in field hours",
    ),
  crew: z
    .object({
      name: text,
      sectionId: text,
      memberIds: z.array(z.string().max(100)).max(500).default([]),
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
  finance: z.object({
    name: text,
    taskId: z.string().default(""),
    sectionId: z.string().default(""),
    type: z.enum(["budget", "cost", "revenue", "contract"]),
    amount: number,
    currency: z.literal("USD").default("USD"),
    date,
    reference: text,
    notes: note,
    status: z
      .enum(["submitted", "approved", "rejected", "voided"])
      .default("submitted"),
  }),
  request: z.object({
    name: text,
    type: z.enum(["release", "field_change", "substitution", "publication"]),
    targetId: z.string().max(100).default(""),
    targetVersion: z.number().int().positive().nullable().default(null),
    sectionId: z.string().default(""),
    taskId: z.string().default(""),
    reason: text,
    reference: note,
    dueDate: optionalDate,
    publicationDays: z.number().int().min(1).max(90).default(7),
    status: z.enum(["submitted", "approved", "rejected"]).default("submitted"),
  }),
  comment: z.object({
    name: text,
    body: z.string().trim().min(1).max(8000),
    targetId: z.string().max(100).default(""),
    visibility: z.enum(["team", "management"]).default("team"),
    mentions: z.array(z.string().max(100)).max(50).default([]),
    authorId: z.string().default(""),
    authorName: z.string().default(""),
    sectionId: z.string().default(""),
    taskId: z.string().default(""),
  }),
  resource: z.object({
    name: text,
    trade: note,
    workDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .default([1, 2, 3, 4, 5]),
    hoursPerDay: z.number().min(0).max(24).default(8),
    holidays: z.array(date).max(1000).default([]),
    unavailable: z
      .array(z.object({ date, hours: z.number().min(0).max(24), reason: note }))
      .max(2000)
      .default([]),
    active: z.boolean().default(true),
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
