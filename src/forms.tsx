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
        f("actualFinish", "Verified completion date", "date"),
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
        f("confirmed", "Supplier has confirmed arrival date", "checkbox"),
        f("notes", "Delivery evidence / notes", "textarea"),
      ];
    case "issue":
      return [
        f("name", "Issue or question", "text", true),
        { ...section, required: false },
        { ...task, required: false },
        select("type", "Type", ["blocker", "risk", "rfi"]),
        select("severity", "Severity", ["low", "medium", "high", "critical"]),
        f("owner", "Owner"),
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
        select("status", "Save as", ["draft", "submitted"]),
      ];
    case "crew":
      return [
        f("name", "Crew name (use consistently across projects)", "text", true),
        section,
        f("workers", "Workers", "number", true),
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
              {field.type === "select" ? (
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
  onClose,
}: {
  record: RecordRow;
  onClose: () => void;
}) {
  return (
    <Modal
      title={record.data.name || record.data.accomplishments || "Source record"}
      onClose={onClose}
    >
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
