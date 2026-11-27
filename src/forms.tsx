import { useState } from "react";
import type { Dashboard } from "../server/metrics";
import type { Kind, RecordRow } from "../server/domain";
import { X } from "lucide-react";
export type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  min?: number;
  max?: number;
  step?: string;
};
const f = (
  key: string,
  label: string,
  type = "text",
  required = false,
): Field => ({ key, label, type, required });
const select = (key: string, label: string, values: string[]): Field => ({
  key,
  label,
  type: "select",
  options: values.map((v) => ({ value: v, label: v.replaceAll("_", " ") })),
});
export const projectFields: Field[] = [
  f("name", "Project name", "text", true),
  f("code", "Project code", "text", true),
  f("customer", "Customer", "text", true),
  f("location", "Location"),
  f("manager", "Project manager"),
  select("phase", "Phase", [
    "Planning",
    "Mobilization",
    "Construction",
    "Closeout",
  ]),
  f("timezone", "Project timezone"),
  f("division", "Division"),
  f("team", "Team"),
  f("tags", "Tags (one per line)", "lines"),
  f("workstreams", "Workstreams (one per line)", "lines"),
  select("contractStage", "Contract stage", [
    "prospect",
    "awarded",
    "active",
    "complete",
  ]),
  select("forecastMethod", "Production forecast method", [
    "none",
    "approved_productivity",
  ]),
  select("productionWindow", "Production window (days)", ["7", "14", "30"]),
  f("missingUpdateDays", "Missing update warning (days)", "number"),
  f("readinessWarningPercent", "Material readiness warning below %", "number"),
  f("riskWarningScore", "Risk warning score (1–25)", "number"),
  f("escalationDays", "Escalate overdue issues after days", "number"),
  select("manualStatus", "Manager-reported status", [
    "unconfirmed",
    "on_track",
    "attention",
    "blocked",
  ]),
  f("manualStatusReason", "Manager status evidence", "textarea"),
  f("estimatedHours", "Approved field labor baseline (hours)", "number"),
  f("pmHours", "PM labor baseline (hours)", "number"),
  f("baselineFinish", "Approved baseline finish", "date"),
  f("forecastFinish", "Current forecast finish", "date"),
  f("lateThresholdDays", "Schedule warning threshold (workdays)", "number"),
];
export const projectDefault = {
  name: "",
  code: "",
  customer: "",
  location: "",
  manager: "",
  phase: "Planning",
  timezone: "America/Denver",
  estimatedHours: null,
  pmHours: null,
  baselineFinish: "",
  forecastFinish: "",
  workDays: [1, 2, 3, 4, 5],
  holidays: [],
  archived: false,
  sample: false,
  externalId: "",
  lateThresholdDays: 0,
  division: "",
  team: "",
  tags: [],
  workstreams: [],
  contractStage: "active",
  forecastMethod: "none",
  productionWindow: "14",
  missingUpdateDays: 7,
  readinessWarningPercent: 50,
  riskWarningScore: 12,
  escalationDays: 2,
  manualStatus: "unconfirmed",
  manualStatusReason: "",
};
export function recordFields(
  kind: Kind,
  d: Dashboard,
  editing = false,
): Field[] {
  const section: Field = {
    key: "sectionId",
    label: "Section",
    type: "select",
    required: true,
    options: d.sections.map((s) => ({ value: s.id, label: s.data.name })),
  };
  const task: Field = {
    key: "taskId",
    label: "Activity",
    type: "select",
    required: true,
    options: d.tasks
      .filter(
        (t) => !["report", "material"].includes(kind) || t.data.kind === "task",
      )
      .map((t) => ({ value: t.id, label: t.data.name })),
  };
  switch (kind) {
    case "section":
      return [
        f("name", "Section name", "text", true),
        f("released", "GC has released this section", "checkbox"),
        f("releaseReference", "Release evidence / reference", "textarea"),
      ];
    case "task":
      return [
        f("name", "Activity name", "text", true),
        section,
        select("kind", "Activity type", ["task", "milestone", "summary"]),
        f("estimatedHours", "Approved field estimate (hours)", "number"),
        f("quantity", "Measured target quantity", "number"),
        f("unit", "Quantity unit"),
        select("progressMethod", "Progress measurement", [
          "quantity",
          "earned_hours",
          "manual",
        ]),
        f(
          "requiresMaterials",
          "Activity requires tracked materials",
          "checkbox",
        ),
        ...(!editing
          ? [
              f("baselineStart", "Approved baseline start", "date"),
              f("baselineFinish", "Approved baseline finish", "date"),
              f("forecastStart", "Forecast start", "date"),
              f("forecastFinish", "Forecast finish", "date"),
            ]
          : []),
        {
          key: "predecessorIds",
          label: "Finish-to-start predecessors",
          type: "multi",
          options: d.tasks
            .filter((t) => t.data.kind !== "summary")
            .map((t) => ({ value: t.id, label: t.data.name })),
        },
        f("durationDays", "Working duration for dependency forecast", "number"),
        f("actualFinish", "Verified completion date", "date"),
        f(
          "completionReference",
          "Completion evidence / inspection reference",
          "textarea",
        ),
        f("prerequisitesCleared", "Prerequisites cleared", "checkbox"),
        f("notes", "Evidence / notes", "textarea"),
      ];
    case "material":
      return [
        f("name", "Material name", "text", true),
        task,
        f("required", "Required quantity", "number", true),
        f("received", "Accepted / allocatable quantity", "number", true),
        f("unit", "Unit", "text", true),
        select("status", "Order status", [
          "unconfirmed",
          "ordered",
          "acknowledged",
          "partial",
          "received",
          "backordered",
          "substituted",
          "rejected",
          "on_hold",
        ]),
        f("supplier", "Supplier"),
        f("po", "Purchase order reference"),
        f("expectedDate", "Expected arrival", "date"),
        f("arrivalEarliest", "Arrival range: earliest", "date"),
        f("arrivalLatest", "Arrival range: latest", "date"),
        f("leadTimeDays", "Supplier lead time (days)", "number"),
        f("returned", "Returned quantity (deducted from received)", "number"),
        f("returnReference", "Return reference"),
        f("deliveryReference", "Delivery evidence / packing slip"),
        f("confirmed", "Supplier has confirmed arrival date", "checkbox"),
        f("notes", "Delivery evidence / notes", "textarea"),
      ];
    case "issue":
      return [
        f("name", "Issue or question", "text", true),
        { ...section, required: false },
        { ...task, required: false },
        select("type", "Type", ["blocker", "risk", "rfi", "submittal"]),
        select("severity", "Severity", ["low", "medium", "high", "critical"]),
        f("owner", "Owner"),
        {
          key: "ownerId",
          label: "Notify assigned team member",
          type: "select",
          options: [],
        },
        {
          key: "probability",
          label: "Probability (1–5)",
          type: "number",
          min: 1,
          max: 5,
        },
        {
          key: "impact",
          label: "Impact (1–5)",
          type: "number",
          min: 1,
          max: 5,
        },
        f("raisedDate", "Date raised", "date"),
        f("closedDate", "Date closed", "date"),
        f("reference", "RFI / submittal reference"),
        {
          key: "evidenceIds",
          label: "Evidence",
          type: "multi",
          options: d.documents.map((r) => ({
            value: r.id,
            label: r.data.name,
          })),
        },
        f("dueDate", "Response due", "date"),
        select("status", "Status", ["open", "closed"]),
        f("notes", "Details / evidence", "textarea"),
      ];
    case "report":
      return [
        f("date", "Work date", "date", true),
        task,
        f("crew", "Crew / people on site"),
        f("hours", "Field hours (including overtime)", "number", true),
        f("pmHours", "PM hours", "number"),
        f("overtimeHours", "Overtime portion of field hours", "number"),
        f("quantity", "Installed quantity for this activity", "number"),
        f("earnedHours", "Earned standard hours (if configured)", "number"),
        {
          key: "manualPercent",
          label: "Reported completion % (if configured)",
          type: "number",
          min: 0,
          max: 100,
        },
        f("accomplishments", "Accomplishments", "textarea", true),
        f("weather", "Weather"),
        f("safety", "Safety notes", "textarea"),
        f("delays", "Delays / constraints", "textarea"),
        f("deliveries", "Deliveries", "textarea"),
        f("signoff", "Submitted by / sign-off", "text"),
        {
          key: "revisionOf",
          label: "Revises a voided or rejected report",
          type: "select",
          options: d.reports
            .filter((r) => ["voided", "rejected"].includes(r.data.status))
            .map((r) => ({
              value: r.id,
              label: `${r.data.date}: ${r.data.accomplishments}`,
            })),
        },
        {
          key: "evidenceIds",
          label: "Photos, tests and evidence",
          type: "multi",
          options: d.documents.map((r) => ({
            value: r.id,
            label: r.data.name,
          })),
        },
        select("status", "Save as", ["draft", "submitted"]),
      ];
    case "crew":
      return [
        f("name", "Crew name (use consistently across projects)", "text", true),
        section,
        {
          key: "memberIds",
          label: "Named people (replaces worker count for capacity)",
          type: "multi",
          options: (d.analysis?.resources.resources || [])
            .filter((r) => r.data.active)
            .map((r) => ({ value: r.id, label: r.data.name })),
        },
        f("workers", "Workers (for unnamed crews)", "number", true),
        f("start", "Assignment start", "date", true),
        f("end", "Assignment end", "date", true),
        f("hoursPerDay", "Hours per worker / workday", "number", true),
        f(
          "unavailableHours",
          "Known unavailable hours in assignment",
          "number",
        ),
        f("notes", "Assignment notes", "textarea"),
      ];
    case "finance":
      return [
        f("name", "Entry name", "text", true),
        select("type", "Entry type", ["budget", "cost", "revenue", "contract"]),
        f("amount", "Approved source amount (USD)", "number", true),
        f("date", "Accounting date", "date", true),
        { ...section, required: false },
        { ...task, required: false },
        f(
          "reference",
          "Source invoice / budget approval reference",
          "text",
          true,
        ),
        f("notes", "Notes", "textarea"),
      ];
    case "request":
      return [
        f("name", "Request title", "text", true),
        select("type", "Approval type", [
          "release",
          "field_change",
          "substitution",
          "publication",
        ]),
        {
          key: "targetId",
          label: "Target section, activity or material",
          type: "select",
          options: [...d.sections, ...d.tasks, ...d.materials].map((r) => ({
            value: r.id,
            label: `${r.kind}: ${r.data.name}`,
          })),
        },
        f("reason", "Reason", "textarea", true),
        f("reference", "Evidence / reference"),
        f("dueDate", "Decision due", "date"),
        f("publicationDays", "Publication validity (days)", "number"),
      ];
    case "revision":
      return [
        f("name", "Revision title", "text", true),
        {
          ...task,
          required: false,
          help: "Leave blank to revise the project finish dates.",
        },
        f("baselineStart", "New approved baseline start", "date"),
        f("baselineFinish", "New approved baseline finish", "date"),
        f("forecastStart", "New forecast start", "date"),
        f("forecastFinish", "New forecast finish", "date"),
        f("reason", "Reason and supporting reference", "textarea", true),
      ];
    default:
      return [];
  }
}
export function recordDefault(kind: Kind, d: Dashboard) {
  const s = d.sections[0]?.id || "",
    t = d.tasks.find((t) => t.data.kind === "task")?.id || "";
  const today = new Date().toLocaleDateString("en-CA");
  switch (kind) {
    case "section":
      return { name: "", released: false, releaseReference: "" };
    case "task":
      return {
        name: "",
        sectionId: s,
        kind: "task",
        estimatedHours: null,
        quantity: null,
        unit: "units",
        baselineStart: "",
        baselineFinish: "",
        forecastStart: "",
        forecastFinish: "",
        actualFinish: "",
        prerequisitesCleared: false,
        requiresMaterials: true,
        progressMethod: "quantity",
        notes: "",
      };
    case "material":
      return {
        name: "",
        taskId: t,
        required: 0,
        received: 0,
        unit: "units",
        status: "unconfirmed",
        supplier: "",
        po: "",
        expectedDate: "",
        confirmed: false,
        notes: "",
      };
    case "issue":
      return {
        name: "",
        taskId: "",
        sectionId: "",
        type: "blocker",
        severity: "medium",
        owner: d.project.data.manager,
        dueDate: "",
        status: "open",
        notes: "",
      };
    case "report":
      return {
        date: today,
        taskId: t,
        crew: "",
        hours: 0,
        pmHours: 0,
        overtimeHours: 0,
        quantity: 0,
        earnedHours: null,
        manualPercent: null,
        accomplishments: "",
        weather: "",
        safety: "",
        delays: "",
        deliveries: "",
        status: "draft",
        decisionNote: "",
      };
    case "crew":
      return {
        name: "",
        sectionId: s,
        workers: 4,
        start: today,
        end: today,
        hoursPerDay: 8,
        unavailableHours: 0,
        notes: "",
      };
    case "finance":
      return {
        name: "",
        type: "cost",
        amount: null,
        date: today,
        taskId: "",
        sectionId: "",
        reference: "",
        notes: "",
        status: "submitted",
      };
    case "request":
      return {
        name: "",
        type: "release",
        targetId: "",
        targetVersion: null,
        reason: "",
        reference: "",
        dueDate: "",
        publicationDays: 7,
        status: "submitted",
      };
    case "revision":
      return {
        name: "",
        taskId: "",
        baselineStart: "",
        baselineFinish: "",
        forecastStart: "",
        forecastFinish: "",
        reason: "",
        status: "submitted",
      };
    default:
      return {};
  }
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        className={`modal ${wide ? "wide" : ""}`}
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const focusables = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button,input,select,textarea,a[href]",
              ),
            ).filter((el) => !el.hasAttribute("disabled"));
            const first = focusables[0],
              last = focusables.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            autoFocus
            className="icon-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </dialog>
    </div>
  );
}
export function Editor({
  title,
  fields,
  initial,
  onSave,
  onClose,
  submit = "Save record",
  description,
}: {
  title: string;
  fields: Field[];
  initial: any;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
  submit?: string;
  description?: string;
}) {
  const [data, setData] = useState(initial),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave(data);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {description && <p className="form-description">{description}</p>}
        <div className="form-grid">
          {fields.map((field) => (
            <label
              className={
                ["textarea", "checkbox"].includes(field.type || "")
                  ? "full"
                  : ""
              }
              key={field.key}
            >
              {field.type !== "checkbox" && (
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
              )}
              {field.type === "multi" ? (
                <select
                  multiple
                  aria-label={field.label}
                  value={data[field.key] || []}
                  onChange={(e) =>
                    setData({
                      ...data,
                      [field.key]: Array.from(e.target.selectedOptions).map(
                        (o) => o.value,
                      ),
                    })
                  }
                >
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "lines" ? (
                <textarea
                  rows={3}
                  value={(data[field.key] || []).join("\n")}
                  onChange={(e) =>
                    setData({
                      ...data,
                      [field.key]: e.target.value.split("\n"),
                    })
                  }
                />
              ) : field.type === "select" ? (
                <select
                  required={field.required}
                  value={data[field.key] ?? ""}
                  onChange={(e) =>
                    setData({ ...data, [field.key]: e.target.value })
                  }
                >
                  <option value="">Choose…</option>
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  rows={3}
                  required={field.required}
                  value={data[field.key] ?? ""}
                  onChange={(e) =>
                    setData({ ...data, [field.key]: e.target.value })
                  }
                />
              ) : field.type === "checkbox" ? (
                <span className="check">
                  <input
                    type="checkbox"
                    checked={!!data[field.key]}
                    onChange={(e) =>
                      setData({ ...data, [field.key]: e.target.checked })
                    }
                  />
                  {field.label}
                </span>
              ) : (
                <input
                  type={field.type || "text"}
                  required={field.required}
                  min={field.type === "number" ? (field.min ?? 0) : undefined}
                  max={field.max}
                  step={
                    field.type === "number" ? field.step || "any" : undefined
                  }
                  value={data[field.key] ?? ""}
                  onChange={(e) =>
                    setData({
                      ...data,
                      [field.key]:
                        field.type === "number"
                          ? e.target.value === ""
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}{" "}
              {field.help && <small>{field.help}</small>}
            </label>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={saving}>
            {saving ? "Saving…" : submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function RecordDetails({
  record,
  documents = [],
  onClose,
}: {
  record: RecordRow;
  documents?: RecordRow[];
  onClose: () => void;
}) {
  return (
    <Modal
      title={record.data.name || record.data.accomplishments || "Source record"}
      onClose={onClose}
    >
      {(record.data.evidenceIds || []).length > 0 && (
        <section>
          <h3>Linked evidence</h3>
          {record.data.evidenceIds.map((id: string) => {
            const doc = documents.find((r) => r.id === id);
            return (
              <p key={id}>
                {doc?.data.scanStatus === "clean" ? (
                  <a
                    href={`/api/projects/${record.project_id}/documents/${id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {doc.data.name} · {doc.data.category}
                  </a>
                ) : (
                  doc?.data.name || "Evidence unavailable"
                )}
                {doc && doc.data.scanStatus !== "clean"
                  ? " · awaiting clean scan"
                  : ""}
              </p>
            );
          })}
        </section>
      )}
      <dl className="details">
        {Object.entries(record.data).map(([key, value]) => (
          <div key={key}>
            <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
            <dd>
              {typeof value === "boolean"
                ? value
                  ? "Yes"
                  : "No"
                : String(value ?? "Unconfirmed") || "Unconfirmed"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Source {record.id} · Version {record.version}
      </p>
    </Modal>
  );
}
