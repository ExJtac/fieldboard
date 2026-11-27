import { useEffect, useState } from "react";
import type { Dashboard } from "../server/metrics";
import type { Kind, RecordRow, User } from "../server/domain";
import { api, send, moneyless, fmtDate } from "./api";
import { Editor, Modal, type Field } from "./forms";
import { Badge, MetricCard } from "./widgets";
const F = (
  key: string,
  label: string,
  type = "text",
  required = false,
): Field => ({ key, label, type, required });
export function Analysis({
  d,
  editable,
  onSaved,
}: {
  d: Dashboard;
  editable: boolean;
  onSaved: () => Promise<void>;
}) {
  const a = d.analysis;
  const [error, setError] = useState(""),
    [proposal, setProposal] = useState(false),
    [source, setSource] = useState<any>(null);
  if (!a) return null;
  const series = (key: "planned" | "actual") => {
    let path = "";
    let connected = false;
    a.curve.forEach((p, i) => {
      if (p[key] === null) {
        connected = false;
        return;
      }
      path += `${connected ? "L" : "M"}${50 + (i / Math.max(1, a.curve.length - 1)) * 810},${235 - p[key]! * 2} `;
      connected = true;
    });
    return path;
  };
  return (
    <div className="extended-stack">
      <section className="panel">
        <h2>Planned and verified progress</h2>
        <p>
          Approved task effort weights. Gaps mean missing evidence. Actual
          progress uses records approved at this snapshot.
        </p>
        {a.curve.length > 0 && (
          <svg
            className="progress-chart"
            viewBox="0 0 920 285"
            role="img"
            aria-label="Planned and actual progress curve. Exact values appear in the table below."
          >
            <path d="M50 35V235H860" fill="none" stroke="#9ba8ad" />
            {[0, 25, 50, 75, 100].map((n) => (
              <g key={n}>
                <text x="5" y={239 - n * 2} fontSize="13">
                  {n}%
                </text>
                <path d={`M50 ${235 - n * 2}H860`} stroke="#e3e9e8" />
              </g>
            ))}
            <path
              d={series("planned")}
              fill="none"
              stroke="#6589a9"
              strokeWidth="3"
              strokeDasharray="6 4"
            />
            <path
              d={series("actual")}
              fill="none"
              stroke="#087a5b"
              strokeWidth="3"
            />
            <text x="50" y="269" fontSize="13">
              {a.curve[0]?.date}
            </text>
            <text x="760" y="269" fontSize="13">
              {a.curve.at(-1)?.date}
            </text>
          </svg>
        )}
        <p>— Verified progress · - - Planned baseline</p>
        <details>
          <summary>Curve values and remaining effort</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Planned %</th>
                  <th>Verified %</th>
                  <th>Remaining effort %</th>
                </tr>
              </thead>
              <tbody>
                {a.curve.map((p) => (
                  <tr key={p.date}>
                    <td>{fmtDate(p.date)}</td>
                    <td>{moneyless(p.planned, "%")}</td>
                    <td>{moneyless(p.actual, "%")}</td>
                    <td>
                      {moneyless(
                        p.actual === null ? null : 100 - p.actual,
                        "%",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {a.curveTruncated && (
          <p role="alert">Curve limited to ten years. Narrow the date range.</p>
        )}
      </section>
      <section className="panel">
        <h2>Production by activity</h2>
        <p>
          Units stay separate by activity. Forecasts use the configured{" "}
          {d.project.data.productionWindow || 14}-day rate and the project work
          calendar; they are estimates. Baseline remaining hours use the
          approved effort weight. Labor EAC uses cumulative approved hours
          divided by verified progress.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Units / labor-hour</th>
                <th>Baseline remaining hours</th>
                <th>Labor EAC</th>
                <th>Production finish estimate</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {a.productivity.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSource(p)}
                    >
                      {p.name}
                    </button>
                    <small>{p.unit}</small>
                  </td>
                  <td>{moneyless(p.unitsPerHour)}</td>
                  <td>{moneyless(p.remainingHours, "h")}</td>
                  <td>{moneyless(p.estimateAtCompletionHours, "h")}</td>
                  <td>
                    {p.forecastFinish
                      ? fmtDate(p.forecastFinish)
                      : "Unavailable"}
                  </td>
                  <td>
                    {p.lastUpdate
                      ? fmtDate(p.lastUpdate)
                      : "No approved update"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.missingUpdates.length > 0 && (
          <p className="notice amber">
            {a.missingUpdates.length} activities have missing or stale progress
            updates.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Dependency forecast and critical activities</h2>
            <p>{a.schedule.reason}</p>
          </div>
          {editable && a.schedule.tasks.length > 0 && (
            <button className="button" onClick={() => setProposal(true)}>
              Propose forecast revisions
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Calculated start</th>
                <th>Calculated finish</th>
                <th>Total float</th>
                <th>Critical</th>
              </tr>
            </thead>
            <tbody>
              {a.schedule.tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{fmtDate(t.start)}</td>
                  <td>{fmtDate(t.finish)}</td>
                  <td>{t.floatDays} workdays</td>
                  <td>{t.critical ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Confidence: {a.schedule.confidence.replaceAll("_", " ")}. Method:
          finish-to-start dependencies.
        </p>
        <p>
          Manager-reported status:{" "}
          <strong>
            {(d.project.data.manualStatus || "unconfirmed").replaceAll(
              "_",
              " ",
            )}
          </strong>{" "}
          · {d.project.data.manualStatusReason || "No supporting status note"}
        </p>
      </section>
      {error && <p className="error">{error}</p>}
      {proposal && (
        <Editor
          title="Propose dependency forecasts"
          fields={[
            F("reason", "Reason and supporting evidence", "textarea", true),
          ]}
          initial={{ reason: "" }}
          onClose={() => setProposal(false)}
          onSave={async (b) => {
            await send(`/projects/${d.project.id}/forecast-proposal`, b);
            await onSaved();
          }}
          submit="Submit revisions for approval"
        />
      )}
      {source && (
        <Modal title={source.name} onClose={() => setSource(null)} wide>
          <p>
            Unit: {source.unit}. Labor EAC = cumulative approved hours /
            verified completion fraction.
          </p>
          <table>
            <thead>
              <tr>
                <th>Window</th>
                <th>Installed</th>
                <th>Hours</th>
                <th>Units / hour</th>
              </tr>
            </thead>
            <tbody>
              {source.windows.map((w: any) => (
                <tr key={w.days}>
                  <td>{w.days} days</td>
                  <td>{moneyless(w.quantity)}</td>
                  <td>{moneyless(w.hours)}</td>
                  <td>{moneyless(w.unitsPerHour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Source records</h3>
          {source.sourceRecordIds.map((id: string) => (
            <p key={id}>
              {d.tasks.find((r) => r.id === id)?.data.name ||
                d.reports.find((r) => r.id === id)?.data.accomplishments ||
                id}
              <small>{id}</small>
            </p>
          ))}
        </Modal>
      )}
    </div>
  );
}
export function Financials({
  d,
  open,
  decision,
  metric,
  editable,
  manager,
}: {
  d: Dashboard;
  editable: boolean;
  manager: boolean;
  open: (k: Kind, r?: RecordRow) => void;
  decision: (r: RecordRow) => void;
  metric: (m: any) => void;
}) {
  return (
    <div className="extended-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Approved project financials</h2>
            <p>
              USD source entries require PM approval. EVM needs complete
              activity budgets and verified progress. Costs and revenue are
              cumulative to the selected end date.
            </p>
          </div>
          {editable && (
            <button className="button" onClick={() => open("finance")}>
              Submit financial entry
            </button>
          )}
        </div>
        <div className="metric-grid">
          {d.analysis.financialMetrics.map((m) => (
            <MetricCard key={m.key} metric={m} onClick={() => metric(m)} />
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Financial register</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Type</th>
                <th>USD</th>
                <th>Date</th>
                <th>Reference</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.finances.map((r) => (
                <tr key={r.id}>
                  <td>{r.data.name}</td>
                  <td>{r.data.type}</td>
                  <td>{moneyless(r.data.amount)}</td>
                  <td>{fmtDate(r.data.date)}</td>
                  <td>{r.data.reference}</td>
                  <td>
                    <Badge value={r.data.status} />
                    {r.data.status === "approved" && manager && editable && (
                      <button
                        className="text-button"
                        onClick={() => decision(r)}
                      >
                        Void with reason
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
export function Collaboration({
  d,
  user,
  editable,
  open,
  onSaved,
}: {
  d: Dashboard;
  user: User;
  editable: boolean;
  open: (k: Kind) => void;
  onSaved: () => Promise<void>;
}) {
  const [team, setTeam] = useState<any[]>([]),
    [compose, setCompose] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api(`/projects/${d.project.id}/team`)
      .then(setTeam)
      .catch((e) => setError(e.message));
  }, [d.project.id]);
  return (
    <div className="extended-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Requests and decisions</h2>
            <p>
              Customer releases, field changes, substitutions and customer
              publications.
            </p>
          </div>
          {editable && (
            <button className="button" onClick={() => open("request")}>
              Submit request
            </button>
          )}
        </div>
        {d.requests.map((r) => (
          <article className="approval" key={r.id}>
            <div>
              <h3>{r.data.name}</h3>
              <p>
                {r.data.type} · {r.data.reason}
              </p>
              <small>{r.data.decisionNote}</small>
            </div>
            <Badge value={r.data.status} />
          </article>
        ))}
        {!d.requests.length && <p>No change requests yet.</p>}
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Project conversation</h2>
            <p>
              Comments remain internal. Mention people to place a notification
              in their inbox.
            </p>
          </div>
          {editable && (
            <button className="button" onClick={() => setCompose(true)}>
              Write a comment
            </button>
          )}
        </div>
        {d.comments.map((r) => (
          <article className="comment" key={r.id}>
            <strong>{r.data.authorName}</strong> ·{" "}
            {new Date(r.created_at).toLocaleString()}{" "}
            <Badge value={r.data.visibility} />
            <h3>{r.data.name}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{r.data.body}</p>
            {r.data.targetId && (
              <small>
                Regarding:{" "}
                {[...d.tasks, ...d.issues, ...d.reports, ...d.documents].find(
                  (x) => x.id === r.data.targetId,
                )?.data.name || r.data.targetId}
              </small>
            )}
          </article>
        ))}
        {!d.comments.length && <p>No comments yet.</p>}
        {error && <p className="error">{error}</p>}
      </section>
      {compose && (
        <Editor
          title="Project comment"
          fields={[
            F("name", "Subject", "text", true),
            F("body", "Comment", "textarea", true),
            {
              key: "visibility",
              label: "Visibility",
              type: "select",
              options: (["admin", "pm", "accountant"].includes(user.role)
                ? ["team", "management"]
                : ["team"]
              ).map((x) => ({ value: x, label: x })),
            },
            {
              key: "targetId",
              label: "Related record",
              type: "select",
              options: [...d.tasks, ...d.issues, ...d.documents].map((r) => ({
                value: r.id,
                label: r.data.name,
              })),
            },
            {
              key: "mentions",
              label: "Mention team members",
              type: "multi",
              options: team.map((u) => ({ value: u.id, label: u.name })),
            },
          ]}
          initial={{
            name: "",
            body: "",
            visibility: "team",
            mentions: [],
            targetId: "",
            sectionId: d.scope.sectionId || "",
          }}
          onClose={() => setCompose(false)}
          onSave={async (data) => {
            await send(
              `/projects/${d.project.id}/records/comment`,
              { data },
              "POST",
              crypto.randomUUID(),
            );
            await onSaved();
          }}
        />
      )}
    </div>
  );
}
export function ResourceDirectory({
  d,
  editable,
  onSaved,
}: {
  d: Dashboard;
  editable: boolean;
  onSaved: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<any>(null),
    [leave, setLeave] = useState<any>(null);
  const a = d.analysis.resources;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>People and availability</h2>
          <p>
            Named assignments use each person's calendar. Availability is shared
            across this workspace.
          </p>
        </div>
        {editable && (
          <button className="button" onClick={() => setEdit({})}>
            Add person
          </button>
        )}
      </div>
      {a.resources.map((r) => (
        <article className="approval" key={r.id}>
          <div>
            <strong>{r.data.name}</strong>
            <p>
              {r.data.trade} · {r.data.hoursPerDay} hours/day ·{" "}
              {r.data.active ? "Active" : "Inactive"}
            </p>
            <small>{r.data.unavailable?.length || 0} unavailable dates</small>
          </div>
          {editable && (
            <div className="actions">
              <button className="text-button" onClick={() => setEdit(r)}>
                Calendar
              </button>
              <button className="text-button" onClick={() => setLeave(r)}>
                Time off
              </button>
            </div>
          )}
        </article>
      ))}
      <h3>Daily crew capacity</h3>
      <p>
        {fmtDate(a.start)} to {fmtDate(a.end)}. Named people are counted once
        per day; unavailable hours reduce capacity.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Scheduled hours</th>
              <th>Available assigned hours</th>
              <th>Overallocations</th>
            </tr>
          </thead>
          <tbody>
            {a.daily.map((x) => (
              <tr key={x.date}>
                <td>{fmtDate(x.date)}</td>
                <td>{x.scheduledHours}</td>
                <td>{x.availableHours}</td>
                <td>
                  {x.conflicts
                    .map(
                      (c) =>
                        `${c.name}: ${c.requested}h requested / ${c.capacity}h available`,
                    )
                    .join("; ") || "None"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.truncated && (
        <p>Showing first 366 days. Narrow the date range for later dates.</p>
      )}
      {edit && (
        <Editor
          title={edit.id ? "Resource calendar" : "Add person"}
          fields={[
            F("name", "Name", "text", true),
            F("trade", "Trade"),
            F("hoursPerDay", "Available hours per workday", "number", true),
            {
              key: "workDays",
              label: "Working weekdays",
              type: "multi",
              options: [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((label, i) => ({ value: String(i), label })),
            },
            F(
              "holidays",
              "Non-working dates (YYYY-MM-DD, one per line)",
              "lines",
            ),
            F("active", "Resource active", "checkbox"),
          ]}
          initial={{
            name: "",
            trade: "",
            hoursPerDay: 8,
            workDays: ["1", "2", "3", "4", "5"],
            holidays: [],
            unavailable: [],
            active: true,
            ...edit.data,
            ...(edit.data ? { workDays: edit.data.workDays.map(String) } : {}),
          }}
          onClose={() => setEdit(null)}
          onSave={async (data) => {
            data.workDays = data.workDays.map(Number);
            data.holidays = data.holidays.filter(Boolean);
            await send(
              edit.id ? `/resources/${edit.id}` : "/resources",
              { data, version: edit.version },
              edit.id ? "PATCH" : "POST",
            );
            await onSaved();
          }}
        />
      )}
      {leave && (
        <Modal
          title={`${leave.data.name} · time off`}
          onClose={() => setLeave(null)}
        >
          <TimeOff
            row={leave}
            onSaved={async () => {
              setLeave(null);
              await onSaved();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
function TimeOff({ row, onSaved }: { row: any; onSaved: () => Promise<void> }) {
  const [entries, setEntries] = useState<any[]>(row.data.unavailable || []),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await send(
            `/resources/${row.id}`,
            {
              data: { ...row.data, unavailable: entries },
              version: row.version,
            },
            "PATCH",
          );
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      {entries.map((x, i) => (
        <div className="availability-row" key={i}>
          <label>
            Date
            <input
              type="date"
              required
              value={x.date}
              onChange={(e) =>
                setEntries(
                  entries.map((r, j) =>
                    j === i ? { ...r, date: e.target.value } : r,
                  ),
                )
              }
            />
          </label>
          <label>
            Hours
            <input
              type="number"
              required
              min="0"
              max="24"
              value={x.hours}
              onChange={(e) =>
                setEntries(
                  entries.map((r, j) =>
                    j === i ? { ...r, hours: Number(e.target.value) } : r,
                  ),
                )
              }
            />
          </label>
          <label>
            Reason
            <input
              value={x.reason}
              onChange={(e) =>
                setEntries(
                  entries.map((r, j) =>
                    j === i ? { ...r, reason: e.target.value } : r,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => setEntries(entries.filter((_, j) => i !== j))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          setEntries([...entries, { date: "", hours: 8, reason: "" }])
        }
      >
        Add unavailable date
      </button>
      {error && <p className="error">{error}</p>}
      <button className="button">Save availability</button>
    </form>
  );
}
export function Notifications({
  navigate,
}: {
  navigate: (project: string, page: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [prefs, setPrefs] = useState<any>(null);
  const load = () =>
    api("/notifications")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    api("/preferences")
      .then(setPrefs)
      .catch((e) => setError(e.message));
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="panel">
      <h2>Notification center</h2>
      <p>
        Assignments, mentions, approvals and due-date escalations from projects
        you can access.
      </p>
      {error && <p className="error">{error}</p>}
      {rows.map((r) => (
        <article className="approval" key={r.id}>
          <div>
            <h3>{r.data.title}</h3>
            <small>{new Date(r.created_at).toLocaleString()}</small>
          </div>
          <div className="actions">
            {r.project_id && (
              <button
                className="text-button"
                onClick={() =>
                  navigate(
                    r.project_id,
                    r.data.kind === "comment"
                      ? "Collaboration"
                      : r.data.kind === "issue"
                        ? "Issues & RFIs"
                        : "Approvals",
                  )
                }
              >
                Open project
              </button>
            )}
            {!r.read_at && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await send(`/notifications/${r.id}/read`, {});
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Mark read
              </button>
            )}
          </div>
        </article>
      ))}
      {!rows.length && <p>No notifications yet.</p>}
      {prefs && (
        <fieldset>
          <legend>Notification preferences</legend>
          {Object.keys(prefs).map((k) => (
            <label className="check" key={k}>
              <input
                type="checkbox"
                checked={prefs[k]}
                onChange={async (e) => {
                  const next = { ...prefs, [k]: e.target.checked };
                  try {
                    await send("/preferences", next, "PUT");
                    setPrefs(next);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
              {k}
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
export function WorkspaceSettings({
  user,
  d,
  views,
  saveView,
}: {
  user: User;
  d: Dashboard | null;
  views: any;
  saveView: (v: any) => Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<any>(null),
    [shared, setShared] = useState<any[]>([]),
    [edit, setEdit] = useState(false),
    [template, setTemplate] = useState(false),
    [error, setError] = useState(""),
    [ops, setOps] = useState<any>(null);
  const manager = ["admin", "pm"].includes(user.role);
  const load = async () => {
    try {
      setShared(await api("/shared-views"));
      if (manager) setWorkspace(await api("/workspace"));
      if (user.role === "admin") setOps(await api("/operations"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel">
      <h2>Workspace branding and view templates</h2>
      {workspace && (
        <p>
          {workspace.name} · {workspace.settings.timezone}
        </p>
      )}
      {user.role === "admin" && (
        <button className="button secondary" onClick={() => setEdit(true)}>
          Branding and retention
        </button>
      )}
      <p>
        Shared view templates apply widget order, visibility and filters.
        Project access remains enforced separately.
      </p>
      {manager && (
        <button className="button secondary" onClick={() => setTemplate(true)}>
          Share current view as template
        </button>
      )}
      {shared.map((v) => (
        <article className="approval" key={v.id}>
          <span>
            {v.name} · {v.team || "Organization"}
          </span>
          <div className="actions">
            <button
              className="text-button"
              onClick={() => saveView({ ...views, ...v.data })}
            >
              Apply view
            </button>
            {manager && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api(`/shared-views/${v.id}`, { method: "DELETE" });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Delete template
              </button>
            )}
          </div>
        </article>
      ))}
      {ops && (
        <details>
          <summary>Operations status</summary>
          <p>
            Database: {ops.database}. Attachment scanner:{" "}
            {ops.scannerConfigured
              ? "Configured"
              : "Not configured; uploads remain quarantined"}
            .
          </p>
          <p>
            {ops.counts.projects} projects · {ops.counts.audit_events} audit
            events
          </p>
          <p>
            Backups: run npm run backup with a private destination, then verify
            a restore before deployment. See the operations guide.
          </p>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                const r = await send("/operations/retention", {});
                setError(
                  `Retention completed: ${r.removed} expired artifacts removed.`,
                );
                await load();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Run configured retention
          </button>
        </details>
      )}
      {error && <p role="status">{error}</p>}
      {edit && workspace && (
        <Editor
          title="Workspace branding and retention"
          fields={[
            F("name", "Organization name", "text", true),
            F("timezone", "Organization timezone"),
            F("reportTitle", "Default report title"),
            F("reportFooter", "Report footer", "textarea"),
            F("accent", "Report accent color (#RRGGBB)"),
            {
              key: "logoDocumentId",
              label: "Company logo (clean uploaded image)",
              type: "select",
              options: (d?.documents || [])
                .filter(
                  (r) =>
                    r.data.scanStatus === "clean" &&
                    ["image/png", "image/jpeg"].includes(r.data.mime),
                )
                .map((r) => ({ value: r.id, label: r.data.name })),
            },
            F(
              "automaticRetention",
              "Enable automatic expired-artifact cleanup",
              "checkbox",
            ),
            F(
              "notificationRetentionDays",
              "Read notification retention (days)",
              "number",
            ),
            F("exportRetentionDays", "Saved export retention (days)", "number"),
          ]}
          initial={{ name: workspace.name, ...workspace.settings }}
          onClose={() => setEdit(false)}
          onSave={async ({ name, ...settings }) => {
            await send("/workspace", { name, settings }, "PUT");
            await load();
          }}
        />
      )}
      {template && (
        <Editor
          title="Share dashboard view"
          fields={[
            F("name", "Template name", "text", true),
            F("team", "Team label (blank = organization)"),
          ]}
          initial={{ name: "", team: "" }}
          onClose={() => setTemplate(false)}
          onSave={async (data) => {
            await send("/shared-views", {
              ...data,
              data: {
                hidden: views.hidden,
                order: views.order,
                filters: views.filters || {},
              },
            });
            await load();
          }}
        />
      )}
    </section>
  );
}
export function OrganizationPicker() {
  const [organizations, setOrganizations] = useState<any[]>([]),
    [current, setCurrent] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api("/organizations"), api("/me")])
      .then(([orgs, me]) => {
        setOrganizations(orgs);
        setCurrent(me.user.org_id);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <label className="organization-picker">
      <span className="sr-only">Organization</span>
      <select
        aria-label="Organization"
        value={current}
        onChange={async (e) => {
          try {
            await send(`/organizations/${e.target.value}/switch`, {});
            location.href = "/";
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
export function OrganizationAdmin() {
  const [modal, setModal] = useState(""),
    [members, setMembers] = useState<any[]>([]),
    [mappings, setMappings] = useState<any[]>([]),
    [error, setError] = useState("");
  const load = async () => {
    try {
      setMembers(await api("/users"));
      setMappings(await api("/oidc-mappings"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel">
      <h2>Organizations and single sign-on</h2>
      <p>
        Accounts can hold different roles in separate organizations. Switching
        organizations changes the current session's permissions.
      </p>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() => setModal("organization")}
        >
          Create organization
        </button>
        <button
          className="button secondary"
          onClick={() => setModal("membership")}
        >
          Add existing account
        </button>
        <button className="button secondary" onClick={() => setModal("oidc")}>
          Map SSO identity
        </button>
      </div>
      <p>
        SSO requires a configured HTTPS OpenID Connect provider. Map its stable
        subject identifier to a local account; email alone never grants access.
      </p>
      {mappings.map((m) => (
        <article className="approval" key={m.issuer + m.subject}>
          <div>
            <strong>{m.name}</strong>
            <small>
              {m.issuer} · {m.subject}
            </small>
          </div>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api(`/oidc-mappings/${m.user_id}`, { method: "DELETE" });
                await load();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Remove SSO mapping
          </button>
        </article>
      ))}
      {error && <p className="error">{error}</p>}
      {modal === "organization" && (
        <Editor
          title="Create organization"
          fields={[F("name", "Organization name", "text", true)]}
          initial={{ name: "" }}
          onClose={() => setModal("")}
          onSave={async (data) => {
            const org = await send("/organizations", data);
            await send(`/organizations/${org.id}/switch`, {});
            location.href = "/";
          }}
        />
      )}
      {modal === "membership" && (
        <Editor
          title="Add existing installation account"
          fields={[
            F("email", "Existing account email", "email", true),
            {
              key: "role",
              label: "Role",
              type: "select",
              options: [
                "admin",
                "pm",
                "foreman",
                "purchasing",
                "accountant",
                "viewer",
              ].map((value) => ({ value, label: value })),
            },
          ]}
          initial={{ email: "", role: "foreman" }}
          description="Project-limited roles start with no project access. Assign projects in Team access after adding the account."
          onClose={() => setModal("")}
          onSave={async (data) => {
            await send("/memberships", { ...data, projectIds: [] });
            location.reload();
          }}
        />
      )}
      {modal === "oidc" && (
        <Editor
          title="Map provider identity"
          fields={[
            {
              key: "userId",
              label: "Local account",
              type: "select",
              required: true,
              options: members.map((m) => ({ value: m.id, label: m.name })),
            },
            F("subject", "Provider subject (sub)", "text", true),
          ]}
          initial={{ userId: "", subject: "" }}
          onClose={() => setModal("")}
          onSave={async (data) => {
            await send("/oidc-mappings", data);
            await load();
          }}
        />
      )}
    </section>
  );
}
