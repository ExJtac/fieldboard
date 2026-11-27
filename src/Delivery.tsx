import { useEffect, useState } from "react";
import { api, send } from "./api";
import { Editor, type Field } from "./forms";
import type { Dashboard } from "../server/metrics";
import { reportTypes, reportTitles } from "../server/reporting";
export function BillingSettings() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    api("/billing")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const open = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await send("/billing/" + path, {}, "POST", crypto.randomUUID());
      location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>Dashboard access</h2>
      {data && (
        <>
          <p>
            {data.mode === "open_source"
              ? "Open-source edition · all dashboard features included."
              : `Hosted subscription: ${data.status.replaceAll("_", " ")}`}
          </p>
          {data.validUntil && (
            <p>
              Current access period ends{" "}
              {new Date(data.validUntil).toLocaleString()}.
            </p>
          )}
          {data.mode === "stripe" && (
            <>
              <p>
                {data.allowed
                  ? "Your organization has dashboard access."
                  : "An organization administrator can activate this workspace through hosted checkout. Access updates after the signed payment confirmation arrives."}
              </p>
              {data.canManage && (
                <div className="button-row">
                  {!data.allowed && (
                    <button
                      className="button"
                      disabled={busy || !data.checkoutConfigured}
                      onClick={() => void open("checkout")}
                    >
                      Activate dashboard
                    </button>
                  )}
                  {data.status !== "not_subscribed" && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void open("portal")}
                    >
                      Manage subscription
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => location.reload()}
                  >
                    Refresh access
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
export function ReportSchedules({
  d,
  team,
  report,
}: {
  d: Dashboard;
  team: any[];
  report: any;
}) {
  const [data, setData] = useState<any>(null),
    [edit, setEdit] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const path = `/projects/${d.project.id}/report-schedules`;
  const refresh = () =>
    api(path)
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30000);
    return () => clearInterval(t);
  }, [path]);
  const fields: Field[] = [
    { key: "name", label: "Schedule name", required: true },
    {
      key: "cadence",
      label: "Repeat",
      type: "select",
      options: ["daily", "weekly", "monthly"].map((value) => ({
        value,
        label: value,
      })),
    },
    {
      key: "weekday",
      label: "Weekly day (Sunday 0 to Saturday 6)",
      type: "number",
      min: 0,
      max: 6,
    },
    {
      key: "monthDay",
      label: "Monthly day (1–28)",
      type: "number",
      min: 1,
      max: 28,
    },
    { key: "time", label: "Local delivery time", type: "time", required: true },
    {
      key: "timezone",
      label: "Time zone",
      required: true,
      help: "IANA name, such as America/Chicago",
    },
    {
      key: "lookbackDays",
      label: "Reporting period (days)",
      type: "number",
      min: 1,
      max: 90,
    },
    {
      key: "sectionId",
      label: "Section",
      type: "select",
      options: [
        { value: "", label: "All sections" },
        ...d.sections.map((r) => ({ value: r.id, label: r.data.name })),
      ],
    },
    {
      key: "recipientIds",
      label: "Internal recipients (authorized attachments)",
      type: "multi",
      options: team
        .filter((t) => t.role !== "viewer")
        .map((t) => ({ value: t.id, label: `${t.name} · ${t.role}` })),
    },
    {
      key: "externalEmails",
      label: "Customer email addresses (one per line)",
      type: "lines",
      help: "Each customer receives an approved, expiring snapshot link. Portfolio reports are internal only.",
    },
    {
      key: "publicationDays",
      label: "Customer link expires after days",
      type: "number",
      min: 1,
      max: 90,
    },
    {
      key: "format",
      label: "Internal attachment format",
      type: "select",
      options: ["pdf", "xlsx", "both"].map((value) => ({
        value,
        label: value.toUpperCase(),
      })),
    },
    {
      key: "reportType",
      label: "Report layout",
      type: "select",
      options: reportTypes.map((value) => ({
        value,
        label: reportTitles[value],
      })),
    },
    { key: "reportTitle", label: "Report title" },
    { key: "active", label: "Schedule active", type: "checkbox" },
  ];
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Scheduled report delivery</h2>
          <p className="muted">
            Timezone-aware delivery with permission checks, retries and an audit
            trail.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            setEdit({
              data: {
                name: "Weekly project update",
                cadence: "weekly",
                weekday: 1,
                monthDay: 1,
                time: "07:00",
                timezone: d.project.data.timezone,
                lookbackDays: 7,
                sectionId: "",
                recipientIds: [],
                externalEmails: [],
                publicationDays: 7,
                format: "pdf",
                report,
                active: true,
              },
            })
          }
        >
          New schedule
        </button>
      </div>
      {data && !data.configured && (
        <p className="notice">
          Schedules can be prepared now. Configure SMTP on the server to enable
          delivery.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data?.schedules.map((s: any) => (
        <div className="list-row" key={s.id}>
          <div>
            <strong>{s.data.name}</strong>
            <p>
              {s.data.active ? "Active" : "Paused"} · {s.data.cadence} at{" "}
              {s.data.time} {s.data.timezone}
              <br />
              Next: {new Date(s.next_run_at).toLocaleString()} ·{" "}
              {reportTitles[s.data.report.type]}
            </p>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={() => setEdit(s)}>
              Edit
            </button>
            <button
              className="button secondary"
              disabled={!data.configured || !s.data.active}
              onClick={async () => {
                try {
                  await send(
                    path + "/" + s.id + "/run",
                    {},
                    "POST",
                    crypto.randomUUID(),
                  );
                  setMessage(
                    "Delivery queued. The worker checks every minute.",
                  );
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Send now
            </button>
          </div>
        </div>
      ))}
      {data?.jobs.length > 0 && (
        <>
          <h3>Recent deliveries</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>State</th>
                  <th>Attempts</th>
                  <th>Last result</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j: any) => (
                  <tr key={j.id}>
                    <td>
                      {j.recipient_key.startsWith("user:")
                        ? team.find((t) => t.id === j.recipient_key.slice(5))
                            ?.name || "Former member"
                        : j.recipient_key.slice(6)}
                    </td>
                    <td>{j.state === "sent" ? "Accepted by SMTP" : j.state}</td>
                    <td>{j.attempts}</td>
                    <td>
                      {j.last_error ||
                        (j.delivered_at &&
                          new Date(j.delivered_at).toLocaleString()) ||
                        "Awaiting worker"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {edit && (
        <Editor
          title={edit.id ? "Edit report schedule" : "New report schedule"}
          fields={fields}
          initial={{
            ...edit.data,
            reportType: edit.data.report.type,
            reportTitle: edit.data.report.title || "",
          }}
          onClose={() => setEdit(null)}
          onSave={async (values: any) => {
            const { reportType, reportTitle, ...rest } = values;
            await send(
              path + (edit.id ? "/" + edit.id : ""),
              {
                data: {
                  ...rest,
                  externalEmails: rest.externalEmails
                    .map((email: string) => email.trim())
                    .filter(Boolean),
                  report: {
                    ...edit.data.report,
                    type: reportType,
                    title: reportTitle,
                  },
                },
                ...(edit.id ? { version: edit.version } : {}),
              },
              edit.id ? "PATCH" : "POST",
            );
            setEdit(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}
