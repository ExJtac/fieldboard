import type { Project, RecordRow, Scope, Metric } from "./domain.ts";
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (v: number) => Math.round(v * 100) / 100;
export function workingDays(
  start: string,
  end: string,
  days: number[],
  holidays: string[] = [],
) {
  if (!start || !end) return null;
  const a = Date.parse(start + "T12:00:00Z"),
    b = Date.parse(end + "T12:00:00Z");
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  const first = sign === 1 ? a + 86400000 : b;
  const last = sign === 1 ? b : a - 86400000;
  const count = Math.floor((last - first) / 86400000) + 1;
  const workdays = new Set(days);
  let total = Math.floor(count / 7) * workdays.size;
  for (let i = 0; i < count % 7; i++)
    if (workdays.has(new Date(first + i * 86400000).getUTCDay())) total++;
  for (const holiday of new Set(holidays)) {
    const day = Date.parse(holiday + "T12:00:00Z");
    if (day >= first && day <= last && workdays.has(new Date(day).getUTCDay()))
      total--;
  }
  return sign * total;
}
export function dashboard(
  project: Project,
  records: RecordRow[],
  scope: Scope = {},
  asOf = new Date().toISOString(),
) {
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: project.data.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(asOf));
  const sections = records
    .filter((r) => r.kind === "section")
    .sort((a, b) =>
      a.data.name.localeCompare(b.data.name, undefined, { numeric: true }),
    );
  const tasks = records.filter(
    (r) =>
      r.kind === "task" &&
      (!scope.sectionId || r.data.sectionId === scope.sectionId),
  );
  const leaf = tasks.filter((r) => r.data.kind === "task");
  const taskIds = new Set(tasks.map((t) => t.id));
  const materials = records.filter(
    (r) => r.kind === "material" && taskIds.has(r.data.taskId),
  );
  const scopedReports = records.filter(
    (r) =>
      r.kind === "report" &&
      taskIds.has(r.data.taskId) &&
      r.data.status === "approved" &&
      r.data.date <= localToday,
  );
  const reports = scopedReports.filter(
    (r) =>
      (!scope.from || r.data.date >= scope.from) &&
      (!scope.to || r.data.date <= scope.to),
  );
  const cumulative = scopedReports.filter(
    (r) => !scope.to || r.data.date <= scope.to,
  );
  const issues = records.filter(
    (r) =>
      r.kind === "issue" &&
      (!scope.sectionId ||
        r.data.sectionId === scope.sectionId ||
        taskIds.has(r.data.taskId)),
  );
  const crew = records.filter(
    (r) =>
      r.kind === "crew" &&
      (!scope.sectionId || r.data.sectionId === scope.sectionId) &&
      (!scope.from || r.data.end >= scope.from) &&
      (!scope.to || r.data.start <= scope.to),
  );
  const version = JSON.stringify({
    project: project.version,
    records: records.map((r) => [r.id, r.version]).sort(),
  });
  const metric = (
    key: string,
    label: string,
    value: number | null,
    unit: string,
    calculation: string,
    sources: string[],
    coverage: string,
    missing = false,
  ): Metric => ({
    key,
    label,
    value: value === null ? null : round(value),
    unit,
    calculation,
    sourceRecordIds: sources,
    sourceVersion: version,
    asOf,
    scope,
    missingData: value === null || missing,
    coverage,
  });
  const useTasks =
    leaf.length > 0 && leaf.every((t) => t.data.estimatedHours !== null);
  const estimate = useTasks
    ? sum(leaf.map((t) => t.data.estimatedHours))
    : !scope.sectionId
      ? project.data.estimatedHours
      : null;
  const actual = reports.length ? sum(reports.map((r) => r.data.hours)) : null;
  const progressItems = leaf.map((t) => {
    const rs = cumulative.filter((r) => r.data.taskId === t.id);
    const installed = sum(rs.map((r) => r.data.quantity));
    const earned = rs.filter(
      (r) => r.data.earnedHours !== null && r.data.earnedHours !== undefined,
    );
    const manual = rs
      .filter(
        (r) =>
          r.data.manualPercent !== null && r.data.manualPercent !== undefined,
      )
      .sort(
        (a, b) =>
          a.data.date.localeCompare(b.data.date) ||
          new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
      );
    const method = t.data.progressMethod || "quantity";
    const measured =
      method === "earned_hours" && t.data.estimatedHours > 0 && earned.length
        ? Math.min(
            1,
            sum(earned.map((r) => r.data.earnedHours)) / t.data.estimatedHours,
          )
        : method === "manual" && manual.length
          ? manual.at(-1)!.data.manualPercent / 100
          : method === "quantity" && t.data.quantity > 0 && rs.length
            ? Math.min(1, installed / t.data.quantity)
            : null;
    return {
      task: t,
      ratio:
        t.data.actualFinish && t.data.actualFinish <= (scope.to || localToday)
          ? 1
          : measured,
    };
  });
  const totalWeight = sum(leaf.map((t) => t.data.estimatedHours || 0));
  const progressKnown =
    progressItems.length > 0 &&
    progressItems.every(
      (p) => p.ratio !== null && p.task.data.estimatedHours > 0,
    );
  const progress =
    progressKnown && totalWeight > 0
      ? (sum(progressItems.map((p) => p.ratio! * p.task.data.estimatedHours)) /
          totalWeight) *
        100
      : null;
  const remaining = progressKnown
    ? sum(progressItems.map((p) => (1 - p.ratio!) * p.task.data.estimatedHours))
    : null;
  const ready = leaf.filter((t) => {
    const needed = materials.filter((m) => m.data.taskId === t.id);
    return (
      sections.find((s) => s.id === t.data.sectionId)?.data.released &&
      t.data.prerequisitesCleared &&
      (t.data.requiresMaterials === false || needed.length > 0) &&
      needed.every(
        (m) =>
          ["received", "partial"].includes(m.data.status) &&
          m.data.received >= m.data.required,
      )
    );
  });
  const unresolved = issues.filter((i) => i.data.status === "open");
  const blockers = unresolved.filter(
    (i) =>
      i.data.type === "blocker" &&
      ["high", "critical"].includes(i.data.severity),
  );
  const holds = materials.filter((m) =>
    ["on_hold", "backordered", "rejected"].includes(m.data.status),
  );
  const latestFinish = (field: string) =>
    tasks
      .filter((t) => t.data.kind !== "summary")
      .map((t) => t.data[field])
      .filter(Boolean)
      .sort()
      .at(-1) || "";
  const baseline = scope.sectionId
    ? latestFinish("baselineFinish")
    : project.data.baselineFinish;
  const forecast = scope.sectionId
    ? latestFinish("forecastFinish")
    : project.data.forecastFinish;
  const variance = workingDays(
    baseline,
    forecast,
    project.data.workDays,
    project.data.holidays,
  );
  const milestones = tasks.filter((t) => t.data.kind === "milestone");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: project.data.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(asOf));
  const overdue = milestones.filter(
    (t) =>
      t.data.baselineFinish &&
      t.data.baselineFinish < (scope.to || today) &&
      !t.data.actualFinish,
  );
  const late = materials.filter((m) => {
    const task = tasks.find((t) => t.id === m.data.taskId);
    return (
      m.data.received < m.data.required &&
      m.data.expectedDate &&
      ((task?.data.forecastStart &&
        m.data.expectedDate > task.data.forecastStart) ||
        m.data.expectedDate < (scope.to || today))
    );
  });
  const capacity = sum(
    crew.map((c) => {
      const start =
        scope.from && scope.from > c.data.start ? scope.from : c.data.start;
      const end = scope.to && scope.to < c.data.end ? scope.to : c.data.end;
      const prev = new Date(start + "T12:00Z");
      prev.setUTCDate(prev.getUTCDate() - 1);
      return Math.max(
        0,
        (workingDays(
          prev.toISOString().slice(0, 10),
          end,
          project.data.workDays,
          project.data.holidays,
        ) || 0) *
          c.data.workers *
          c.data.hoursPerDay -
          c.data.unavailableHours,
      );
    }),
  );
  const metrics = [
    metric(
      "estimated_hours",
      "Estimated field hours",
      estimate,
      "h",
      useTasks ? "approved_leaf_task_estimates_sum" : "project_labor_baseline",
      useTasks ? leaf.map((t) => t.id) : [project.id],
      useTasks
        ? "All field tasks have estimates"
        : "Project baseline; PM hours excluded",
    ),
    metric(
      "actual_hours",
      "Approved field hours",
      actual,
      "h",
      "approved_nonvoided_reports_sum",
      reports.map((r) => r.id),
      reports.length
        ? `${reports.length} approved reports in date range`
        : "No approved time records",
    ),
    metric(
      "progress",
      "Verified progress",
      progress,
      "%",
      "effort_weighted_approved_task_progress_method",
      [...leaf.map((t) => t.id), ...cumulative.map((r) => r.id)],
      `${progressItems.filter((p) => p.ratio !== null).length}/${leaf.length} tasks with verified completion; cumulative to end date`,
    ),
    metric(
      "remaining_hours",
      "Remaining field effort",
      remaining,
      "h",
      "sum_estimate_times_one_minus_approved_progress",
      [...leaf.map((t) => t.id), ...cumulative.map((r) => r.id)],
      "Approved quantity, earned-hour or manual progress; never inferred from hours spent",
    ),
    metric(
      "schedule_variance",
      "Schedule variance",
      variance,
      "workdays",
      "forecast_minus_approved_baseline_work_calendar",
      scope.sectionId ? tasks.map((t) => t.id) : [project.id],
      baseline && forecast
        ? `${baseline} → ${forecast}`
        : "Approved baseline or forecast missing",
    ),
    metric(
      "blockers",
      "Critical blockers",
      blockers.length,
      "open",
      "unresolved_high_or_critical_blockers",
      blockers.map((i) => i.id),
      "Recorded blockers; unreported conditions unknown",
    ),
    metric(
      "material_ready",
      "Material-ready activities",
      leaf.length ? (ready.length / leaf.length) * 100 : null,
      "%",
      "all_requirements_sufficient_and_release_and_prerequisites",
      [
        ...leaf.map((t) => t.id),
        ...materials.map((m) => m.id),
        ...sections
          .filter((s) => !scope.sectionId || s.id === scope.sectionId)
          .map((s) => s.id),
      ],
      `${ready.length}/${leaf.length} tasks; absent requirements are unconfirmed`,
      leaf.some(
        (t) =>
          t.data.requiresMaterials !== false &&
          !materials.some((m) => m.data.taskId === t.id),
      ),
    ),
    metric(
      "crew_capacity",
      "Scheduled crew capacity",
      crew.length ? capacity : null,
      "h",
      "calendar_capacity_less_unavailability",
      crew.map((c) => c.id),
      "Assignment period intersected with selected dates",
    ),
    metric(
      "material_holds",
      "Material holds",
      holds.length,
      "items",
      "hold_backorder_rejected_count",
      holds.map((m) => m.id),
      "Confirmed record status",
    ),
    metric(
      "overdue",
      "Overdue milestones",
      overdue.length,
      "items",
      "approved_due_passed_without_actual",
      overdue.map((t) => t.id),
      "Uses organization timezone",
    ),
    metric(
      "overtime",
      "Approved overtime",
      reports.length ? sum(reports.map((r) => r.data.overtimeHours)) : null,
      "h",
      "approved_report_overtime_sum",
      reports.map((r) => r.id),
      "Included in actual field hours",
    ),
    metric(
      "budget",
      "Approved budget",
      null,
      "USD",
      "unavailable",
      [],
      "No approved financial inputs",
    ),
  ];
  const reasons = [
    ...blockers.map((i) => i.data.name),
    ...late.map(
      (m) =>
        `${m.data.name}: delivery risk${m.data.confirmed ? "" : " (unconfirmed)"}`,
    ),
    ...(variance !== null && variance > (project.data.lateThresholdDays || 0)
      ? [`${variance} working days beyond baseline`]
      : []),
  ];
  const health = reasons.length
    ? "attention"
    : variance === null || progress === null
      ? "unknown"
      : "on_track";
  const trend = [...new Set(reports.map((r) => r.data.date))]
    .sort()
    .map((day) => ({
      date: day,
      hours: sum(
        reports.filter((r) => r.data.date === day).map((r) => r.data.hours),
      ),
      quantity: sum(
        reports.filter((r) => r.data.date === day).map((r) => r.data.quantity),
      ),
      note: "Quantities may use different units; inspect activity records",
    }));
  return {
    project,
    asOf,
    scope,
    health,
    reasons,
    metrics,
    tasks,
    sections,
    materials,
    issues,
    crew,
    reports: records.filter(
      (r) =>
        r.kind === "report" &&
        taskIds.has(r.data.taskId) &&
        (!scope.from || r.data.date >= scope.from) &&
        (!scope.to || r.data.date <= scope.to),
    ),
    revisions: records.filter(
      (r) =>
        r.kind === "revision" &&
        (!scope.sectionId || taskIds.has(r.data.taskId)),
    ),
    documents: records.filter(
      (r) =>
        r.kind === "document" &&
        (!scope.sectionId || r.data.sectionId === scope.sectionId),
    ),
    milestones,
    trend,
    lateMaterialIds: late.map((m) => m.id),
    readyTaskIds: ready.map((t) => t.id),
  };
}
export type Dashboard = ReturnType<typeof dashboard>;
export function publicSnapshot(d: Dashboard, organization: string) {
  return {
    organization,
    project: {
      name: d.project.data.name,
      code: d.project.data.code,
      customer: d.project.data.customer,
      phase: d.project.data.phase,
      sample: d.project.data.sample,
    },
    asOf: d.asOf,
    scope: d.scope,
    metrics: d.metrics
      .filter((m) =>
        ["progress", "schedule_variance", "material_ready", "overdue"].includes(
          m.key,
        ),
      )
      .map(
        ({ key, label, value, unit, coverage, missingData, calculation }) => ({
          key,
          label,
          value,
          unit,
          coverage,
          missingData,
          calculation,
        }),
      ),
    milestones: d.milestones.map((t) => ({
      name: t.data.name,
      baselineFinish: t.data.baselineFinish,
      forecastFinish: t.data.forecastFinish,
      actualFinish: t.data.actualFinish,
    })),
    notice:
      "Approved publication snapshot. Internal notes, labor, rates, documents and unpublished revisions are excluded.",
  };
}
