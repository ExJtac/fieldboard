import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Package,
  TriangleAlert,
} from "lucide-react";
import type { Dashboard } from "../server/metrics";
import type { Metric, RecordRow } from "../server/domain";
import { fmtDate, moneyless } from "./api";
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["on_track", "approved", "received", "closed", "released", "clean"].includes(value) ? "green" : ["critical", "backordered", "rejected", "on_hold", "voided", "attention"].includes(value) ? "red" : ["submitted", "partial", "high", "risk"].includes(value) ? "amber" : "slate"}`}
    >
      <span className="badge-dot" />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <LayersIcon />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
function LayersIcon() {
  return <CalendarDays size={22} />;
}
export function MetricCard({
  metric,
  onClick,
}: {
  metric: Metric;
  onClick: () => void;
}) {
  return (
    <button className="kpi" onClick={onClick}>
      <span>
        {metric.label}
        <ArrowUpRight size={15} />
      </span>
      <strong>{moneyless(metric.value, metric.unit)}</strong>
      <small>
        {metric.missingData
          ? "Incomplete coverage"
          : metric.key === "blockers" && metric.value
            ? "Needs attention"
            : "Source-backed calculation"}
        <span
          className={`tiny-dot ${metric.missingData ? "gray" : metric.key === "blockers" && metric.value ? "orange" : "green"}`}
        />
      </small>
    </button>
  );
}
export function Overview({
  d,
  onMetric,
  onRecord,
  navigate,
  hidden,
  order,
}: {
  d: Dashboard;
  onMetric: (m: Metric) => void;
  onRecord: (r: RecordRow) => void;
  navigate: (page: string) => void;
  hidden: string[];
  order: string[];
}) {
  const keys = [
    "progress",
    "actual_hours",
    "remaining_hours",
    "schedule_variance",
    "blockers",
    "material_ready",
  ];
  const cards = keys
    .filter((k) => !hidden.includes(k))
    .sort((a, b) => {
      const ai = order.indexOf(a),
        bi = order.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  const pending = [...d.reports, ...d.revisions].filter(
    (r) => r.data.status === "submitted",
  );
  return (
    <>
      <div className="kpi-grid">
        {cards.map((k) => (
          <MetricCard
            key={k}
            metric={d.metrics.find((m) => m.key === k)!}
            onClick={() => onMetric(d.metrics.find((m) => m.key === k)!)}
          />
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel schedule-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">THE ROAD AHEAD</p>
              <h2>Schedule & milestones</h2>
            </div>
            <button
              className="text-button"
              onClick={() => navigate("Schedule")}
            >
              View schedule <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="finish-pair">
            <div>
              <span>Approved finish</span>
              <strong>{fmtDate(d.project.data.baselineFinish)}</strong>
            </div>
            <ArrowUpRight size={24} />
            <div>
              <span>Current forecast</span>
              <strong>{fmtDate(d.project.data.forecastFinish)}</strong>
            </div>
          </div>
          {d.milestones.length ? (
            <div className="milestones">
              {d.milestones.slice(0, 4).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onRecord(t)}
                  className="milestone"
                >
                  <span className="milestone-node">
                    {t.data.actualFinish ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <CalendarDays size={16} />
                    )}
                  </span>
                  <span>
                    <strong>{t.data.name}</strong>
                    <small>
                      {
                        d.sections.find((s) => s.id === t.data.sectionId)?.data
                          .name
                      }
                    </small>
                  </span>
                  <span>
                    {fmtDate(t.data.forecastFinish)}
                    <small>
                      {t.data.actualFinish ? "Complete" : "Forecast"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty title="Set the next milestone">
              Add an approved milestone to build the picture.
            </Empty>
          )}
          <div className="panel-note">
            <Clock3 size={15} /> Forecast changes require a recorded revision
            and approval.
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">KEEP WORK MOVING</p>
              <h2>Material readiness</h2>
            </div>
            <Package size={19} />
          </div>
          <div className="readiness">
            <div
              className="ring"
              style={
                {
                  "--progress": `${(d.metrics.find((m) => m.key === "material_ready")?.value || 0) * 3.6}deg`,
                } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {d.readyTaskIds.length}
                  <small>
                    {" "}
                    / {d.tasks.filter((t) => t.data.kind === "task").length}
                  </small>
                </strong>
                <span>activities ready</span>
              </div>
            </div>
            <div className="readiness-legend">
              <span>
                <i className="tiny-dot green" /> Ready to install{" "}
                <b>{d.readyTaskIds.length}</b>
              </span>
              <span>
                <i className="tiny-dot orange" /> Delivery risks{" "}
                <b>{d.lateMaterialIds.length}</b>
              </span>
              <span>
                <i className="tiny-dot gray" /> Unconfirmed orders{" "}
                <b>{d.materials.filter((m) => !m.data.confirmed).length}</b>
              </span>
            </div>
          </div>
          <div className="material-list">
            {d.materials.slice(0, 3).map((m) => (
              <button key={m.id} onClick={() => onRecord(m)}>
                <span>
                  {m.data.name}
                  <small>{m.data.supplier || "Supplier unconfirmed"}</small>
                </span>
                <Badge value={m.data.status} />
              </button>
            ))}
          </div>
          <button className="text-button" onClick={() => navigate("Materials")}>
            Open material register <ArrowUpRight size={15} />
          </button>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LABOR, WITH EVIDENCE</p>
              <h2>Approved field hours</h2>
            </div>
            <span className="muted">By work date</span>
          </div>
          {d.trend.length ? (
            <div className="bar-chart">
              {d.trend.slice(-14).map((t) => (
                <div className="bar-column" key={t.date}>
                  <span>{moneyless(t.hours)}</span>
                  <div
                    className="bar"
                    style={{
                      height: Math.max(
                        2,
                        (t.hours /
                          Math.max(...d.trend.map((t) => t.hours), 1)) *
                          135,
                      ),
                    }}
                  />
                  <small>
                    {new Date(t.date + "T12:00:00").toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric" },
                    )}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="The first approved report starts the story">
              Field hours appear here after a PM approves a daily report.
            </Empty>
          )}
          <div className="panel-note">
            {moneyless(
              d.metrics.find((m) => m.key === "estimated_hours")?.value,
              "h",
            )}{" "}
            estimated field labor · {moneyless(d.project.data.pmHours, "h")} PM
            baseline
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DECISIONS THAT MATTER</p>
              <h2>
                Needs your attention{" "}
                <span className="count">
                  {d.issues.filter((i) => i.data.status === "open").length +
                    pending.length}
                </span>
              </h2>
            </div>
            <TriangleAlert size={18} />
          </div>
          {!d.issues.filter((i) => i.data.status === "open").length &&
          !pending.length ? (
            <Empty title="No open decisions">
              New issues and submitted approvals will appear here.
            </Empty>
          ) : (
            <div className="attention-list">
              {d.issues
                .filter((i) => i.data.status === "open")
                .slice(0, 3)
                .map((i) => (
                  <button onClick={() => onRecord(i)} key={i.id}>
                    <span className={`issue-symbol ${i.data.severity}`}>!</span>
                    <span>
                      <strong>{i.data.name}</strong>
                      <small>
                        {i.data.type.toUpperCase()} ·{" "}
                        {i.data.owner || "Unassigned"}
                      </small>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              {pending.slice(0, 2).map((r) => (
                <button onClick={() => navigate("Approvals")} key={r.id}>
                  <span className="issue-symbol">
                    <CheckCircle2 size={17} />
                  </span>
                  <span>
                    <strong>{r.data.name || r.data.accomplishments}</strong>
                    <small>Awaiting PM approval</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          )}
          <button className="text-button" onClick={() => navigate("Approvals")}>
            Review approvals <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
    </>
  );
}
export function Timeline({
  d,
  onRecord,
}: {
  d: Dashboard;
  onRecord: (r: RecordRow) => void;
}) {
  const dates = d.tasks
    .flatMap((t) => [t.data.forecastStart, t.data.forecastFinish])
    .filter(Boolean)
    .sort();
  const start = dates[0],
    end = dates.at(-1);
  const duration =
    start && end
      ? Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400_000)
      : 1;
  return (
    <div className="timeline">
      {d.tasks.map((t) => (
        <button className="timeline-row" key={t.id} onClick={() => onRecord(t)}>
          <span>
            <strong>{t.data.name}</strong>
            <small>
              {d.sections.find((s) => s.id === t.data.sectionId)?.data.name} ·{" "}
              {t.data.kind}
            </small>
          </span>
          <div className="timeline-track">
            {t.data.forecastStart && t.data.forecastFinish ? (
              <span
                className={`timeline-bar ${t.data.actualFinish ? "complete" : ""}`}
                style={{
                  left: `${((Date.parse(t.data.forecastStart) - Date.parse(start)) / 86400_000 / duration) * 85}%`,
                  width: `${Math.max(2, ((Date.parse(t.data.forecastFinish) - Date.parse(t.data.forecastStart)) / 86400_000 / duration) * 85)}%`,
                }}
              >
                {t.data.kind === "milestone" ? "◆" : ""}
              </span>
            ) : (
              <span className="undated">Dates unconfirmed</span>
            )}
          </div>
          <span>{fmtDate(t.data.forecastFinish)}</span>
        </button>
      ))}
      {!d.tasks.length && (
        <Empty title="No activities yet">
          Add the first task or milestone.
        </Empty>
      )}
    </div>
  );
}
