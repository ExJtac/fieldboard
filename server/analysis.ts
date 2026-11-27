import type { Project, RecordRow, Scope, Metric } from "./domain.ts";
import { workingDays } from "./metrics.ts";
export const dayAfter = (date: string, n = 1) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function dates(start: string, end: string, max = 3660) {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < max; d = dayAfter(d))
    out.push(d);
  return out;
}
const total = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const round = (n: number) => Math.round(n * 100) / 100;
const work = (p: Project, d: string) =>
  p.data.workDays.includes(new Date(d + "T12:00Z").getUTCDay()) &&
  !p.data.holidays.includes(d);
export function advance(p: Project, start: string, count: number) {
  let d = start;
  for (let i = 0; i < 36600; i++, d = dayAfter(d))
    if (work(p, d) && --count <= 0) return d;
  return null;
}
export function taskRatio(
  t: RecordRow,
  rs: RecordRow[],
  date: string,
): number | null {
  if (t.data.actualFinish && t.data.actualFinish <= date) return 1;
  const r = rs.filter(
    (r) =>
      r.data.taskId === t.id &&
      r.data.status === "approved" &&
      r.data.date <= date,
  );
  if (!r.length) return null;
  if (t.data.progressMethod === "manual") {
    const last = r
      .filter((x) => x.data.manualPercent != null)
      .sort(
        (a, b) =>
          a.data.date.localeCompare(b.data.date) ||
          +new Date(a.updated_at) - +new Date(b.updated_at),
      )
      .at(-1);
    return last ? last.data.manualPercent / 100 : null;
  }
  if (t.data.progressMethod === "earned_hours") {
    const earned = r.filter((x) => x.data.earnedHours != null);
    return earned.length && t.data.estimatedHours > 0
      ? Math.min(
          1,
          total(earned.map((x) => x.data.earnedHours)) / t.data.estimatedHours,
        )
      : null;
  }
  return t.data.quantity > 0
    ? Math.min(1, total(r.map((x) => x.data.quantity)) / t.data.quantity)
    : null;
}
export function plannedRatio(p: Project, t: RecordRow, date: string) {
  const { baselineStart: start, baselineFinish: end } = t.data;
  if (!start || !end || end < start) return null;
  if (date < start) return 0;
  if (date >= end) return 1;
  const all =
    workingDays(dayAfter(start, -1), end, p.data.workDays, p.data.holidays) ||
    0;
  return all > 0
    ? (workingDays(
        dayAfter(start, -1),
        date,
        p.data.workDays,
        p.data.holidays,
      ) || 0) / all
    : null;
}
export function scheduleAnalysis(p: Project, tasks: RecordRow[]) {
  const eligible = tasks.filter((t) => t.data.kind !== "summary");
  const map = new Map(eligible.map((t) => [t.id, t]));
  const ordered: RecordRow[] = [],
    visiting = new Set<string>(),
    done = new Set<string>();
  let invalid = "";
  const visit = (t: RecordRow) => {
    if (visiting.has(t.id)) {
      invalid = "Dependency cycle";
      return;
    }
    if (done.has(t.id)) return;
    visiting.add(t.id);
    for (const id of t.data.predecessorIds || []) {
      const pred = map.get(id);
      if (!pred) {
        invalid = "A predecessor is outside this scope";
        continue;
      }
      visit(pred);
    }
    visiting.delete(t.id);
    done.add(t.id);
    ordered.push(t);
  };
  eligible.forEach(visit);
  const origin = eligible
    .map((t) => t.data.forecastStart || t.data.baselineStart)
    .filter(Boolean)
    .sort()[0];
  if (invalid || !origin)
    return {
      method: "finish_to_start_work_calendar",
      confidence: "unavailable",
      reason: invalid || "Activity start dates are missing",
      tasks: [] as any[],
      finish: null as string | null,
    };
  const result = new Map<string, any>();
  for (const t of ordered) {
    const duration =
      t.data.kind === "milestone"
        ? 0
        : (t.data.durationDays ??
          (t.data.baselineStart && t.data.baselineFinish
            ? workingDays(
                dayAfter(t.data.baselineStart, -1),
                t.data.baselineFinish,
                p.data.workDays,
                p.data.holidays,
              )
            : null));
    if (duration === null)
      return {
        method: "finish_to_start_work_calendar",
        confidence: "unavailable",
        reason: "Working duration or baseline dates are missing",
        tasks: [] as any[],
        finish: null as string | null,
      };
    const constraint = t.data.forecastStart || t.data.baselineStart || origin;
    let startIndex = Math.max(
      0,
      workingDays(
        dayAfter(origin, -1),
        dayAfter(constraint, -1),
        p.data.workDays,
        p.data.holidays,
      ) || 0,
    );
    for (const id of t.data.predecessorIds || [])
      startIndex = Math.max(startIndex, result.get(id)?.endIndex || 0);
    result.set(t.id, {
      id: t.id,
      name: t.data.name,
      duration,
      startIndex,
      endIndex: startIndex + duration,
      sourceRecordIds: [t.id, ...(t.data.predecessorIds || [])],
    });
  }
  const end = Math.max(...[...result.values()].map((x) => x.endIndex));
  for (const t of [...ordered].reverse()) {
    const r = result.get(t.id);
    const successors = eligible.filter((x) =>
      (x.data.predecessorIds || []).includes(t.id),
    );
    r.lateEnd = successors.length
      ? Math.min(...successors.map((x) => result.get(x.id).lateStart))
      : end;
    r.lateStart = r.lateEnd - r.duration;
    r.floatDays = r.lateStart - r.startIndex;
    r.critical = r.floatDays === 0;
    r.start = advance(p, origin, r.startIndex + 1);
    r.finish = advance(p, origin, Math.max(1, r.endIndex));
  }
  return {
    method: "finish_to_start_work_calendar",
    confidence: "calculated_from_entered_constraints",
    reason:
      "Calculated scenario; approved dates remain unchanged until a schedule revision is approved.",
    tasks: [...result.values()],
    finish: advance(p, origin, Math.max(1, end)),
  };
}
export function resourceCapacity(resource: RecordRow, date: string) {
  const d = resource.data;
  return d.active !== false &&
    (d.workDays || [1, 2, 3, 4, 5]).includes(
      new Date(date + "T12:00Z").getUTCDay(),
    ) &&
    !(d.holidays || []).includes(date)
    ? Math.max(
        0,
        d.hoursPerDay -
          total(
            (d.unavailable || [])
              .filter((x: any) => x.date === date)
              .map((x: any) => x.hours),
          ),
      )
    : 0;
}
export function resourceAnalysis(
  p: Project,
  records: RecordRow[],
  scope: Scope,
  today: string,
  limit = 366,
) {
  const resources = records.filter((r) => r.kind === "resource");
  const crews = records.filter(
    (r) =>
      r.kind === "crew" &&
      (!scope.sectionId || r.data.sectionId === scope.sectionId),
  );
  const start = scope.from || today,
    end = scope.to || dayAfter(start, 13);
  const daily = dates(start, end, limit).map((date) => {
    const per = new Map<
      string,
      { requested: number; capacity: number; assignments: string[] }
    >();
    let anonymous = 0;
    for (const crew of crews.filter(
      (c) => c.data.start <= date && c.data.end >= date,
    )) {
      if (!work(p, date)) continue;
      if (crew.data.memberIds?.length)
        for (const id of crew.data.memberIds) {
          const r = resources.find((r) => r.id === id);
          const row = per.get(id) || {
            requested: 0,
            capacity: r ? resourceCapacity(r, date) : 0,
            assignments: [],
          };
          row.requested += crew.data.hoursPerDay;
          row.assignments.push(crew.id);
          per.set(id, row);
        }
      else {
        const count =
          workingDays(
            dayAfter(crew.data.start, -1),
            crew.data.end,
            p.data.workDays,
            p.data.holidays,
          ) || 1;
        anonymous += Math.max(
          0,
          crew.data.workers * crew.data.hoursPerDay -
            (crew.data.unavailableHours || 0) / count,
        );
      }
    }
    return {
      date,
      scheduledHours: round(
        anonymous + total([...per.values()].map((x) => x.requested)),
      ),
      availableHours: round(
        anonymous +
          total(
            [...per.values()].map((x) => Math.min(x.capacity, x.requested)),
          ),
      ),
      conflicts: [...per]
        .filter(([, x]) => x.requested > x.capacity)
        .map(([id, x]) => ({
          id,
          name:
            resources.find((r) => r.id === id)?.data.name ||
            "Unavailable resource",
          ...x,
        })),
    };
  });
  return {
    daily,
    resources,
    start,
    end,
    truncated: dates(start, end, limit + 1).length > limit,
    sourceRecordIds: [...resources, ...crews].map((r) => r.id),
  };
}
export function analyze(
  p: Project,
  records: RecordRow[],
  scope: Scope,
  asOf: string,
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: p.data.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(asOf));
  const cutoff = scope.to && scope.to < today ? scope.to : today;
  const tasks = records.filter(
    (r) =>
      r.kind === "task" &&
      r.data.kind === "task" &&
      (!scope.sectionId || r.data.sectionId === scope.sectionId),
  );
  const ids = new Set(tasks.map((t) => t.id));
  const reports = records.filter(
    (r) =>
      r.kind === "report" &&
      r.data.status === "approved" &&
      ids.has(r.data.taskId) &&
      r.data.date <= cutoff,
  );
  const weighted = (date: string, planned = false) => {
    const items = tasks.map((t) => ({
      w: t.data.estimatedHours,
      v: planned ? plannedRatio(p, t, date) : taskRatio(t, reports, date),
    }));
    const weight = total(items.map((x) => x.w || 0));
    return items.length && items.every((x) => x.w > 0 && x.v !== null) && weight
      ? round((total(items.map((x) => x.w * x.v!)) / weight) * 100)
      : null;
  };
  const minDate =
    scope.from ||
    [
      ...tasks.map((t) => t.data.baselineStart),
      ...reports.map((r) => r.data.date),
    ]
      .filter(Boolean)
      .sort()[0] ||
    cutoff;
  const maxDate =
    scope.to ||
    [cutoff, ...tasks.map((t) => t.data.baselineFinish)]
      .filter(Boolean)
      .sort()
      .at(-1)!;
  const allDays = dates(minDate, maxDate, 3660);
  const step = Math.max(1, Math.ceil(allDays.length / 180));
  const curve = allDays
    .filter((_, i) => i % step === 0 || i === allDays.length - 1)
    .map((date) => ({
      date,
      planned: weighted(date, true),
      actual: date <= cutoff ? weighted(date) : null,
    }));
  const productivity = tasks.map((t) => {
    const rs = reports.filter(
      (r) =>
        r.data.taskId === t.id && (!scope.from || r.data.date >= scope.from),
    );
    const hours = total(rs.map((r) => r.data.hours)),
      quantity = total(rs.map((r) => r.data.quantity));
    const ratio = taskRatio(t, reports, cutoff);
    const all = reports.filter((r) => r.data.taskId === t.id);
    const allHours = total(all.map((r) => r.data.hours));
    const windows = [7, 14, 30].map((days) => {
      const from = dayAfter(cutoff, 1 - days);
      const rr = all.filter((r) => r.data.date >= from);
      const qty = total(rr.map((r) => r.data.quantity));
      const h = total(rr.map((r) => r.data.hours));
      const workdays =
        workingDays(
          dayAfter(from, -1),
          cutoff,
          p.data.workDays,
          p.data.holidays,
        ) || 0;
      return {
        days,
        from,
        to: cutoff,
        quantity: rr.length ? qty : null,
        hours: rr.length ? h : null,
        unitsPerHour: h > 0 ? round(qty / h) : null,
        unitsPerWorkday: rr.length && workdays ? qty / workdays : null,
        sourceRecordIds: rr.map((r) => r.id),
      };
    });
    const w = windows.find(
      (x) => x.days === Number(p.data.productionWindow || 14),
    )!;
    const remainingQty =
      t.data.quantity != null
        ? Math.max(0, t.data.quantity - total(all.map((r) => r.data.quantity)))
        : null;
    const predicted =
      p.data.forecastMethod === "approved_productivity" &&
      t.data.progressMethod === "quantity" &&
      remainingQty !== null &&
      w.unitsPerWorkday &&
      w.unitsPerWorkday > 0
        ? remainingQty === 0
          ? cutoff
          : advance(
              p,
              dayAfter(cutoff),
              Math.ceil(remainingQty / w.unitsPerWorkday),
            )
        : null;
    return {
      id: t.id,
      name: t.data.name,
      unit: t.data.unit,
      quantity: rs.length ? quantity : null,
      hours: rs.length ? hours : null,
      unitsPerHour: hours > 0 ? round(quantity / hours) : null,
      progress: ratio === null ? null : round(ratio * 100),
      remainingHours:
        ratio !== null && t.data.estimatedHours != null
          ? round((1 - ratio) * t.data.estimatedHours)
          : null,
      estimateAtCompletionHours:
        ratio && ratio > 0 ? round(allHours / ratio) : null,
      forecastFinish: predicted,
      forecastMethod: p.data.forecastMethod || "none",
      lastUpdate:
        all
          .map((r) => r.data.date)
          .sort()
          .at(-1) || null,
      windows,
      sourceRecordIds: [t.id, ...all.map((r) => r.id)],
    };
  });
  const missingUpdates = productivity.filter(
    (x) =>
      x.progress !== 100 &&
      (!x.lastUpdate ||
        x.lastUpdate < dayAfter(cutoff, -(p.data.missingUpdateDays || 7))),
  );
  const finance = records.filter(
    (r) =>
      r.kind === "finance" &&
      r.data.status === "approved" &&
      r.data.date <= cutoff &&
      (!scope.sectionId ||
        r.data.sectionId === scope.sectionId ||
        ids.has(r.data.taskId)),
  );
  const entries = (type: string) => finance.filter((r) => r.data.type === type);
  const amount = (type: string) =>
    entries(type).length
      ? total(entries(type).map((r) => r.data.amount))
      : null;
  const budget = amount("budget"),
    cost = amount("cost"),
    revenue = amount("revenue"),
    contract = amount("contract");
  const budgets = entries("budget");
  const evKnown =
    budgets.length > 0 &&
    budgets.every(
      (b) =>
        ids.has(b.data.taskId) &&
        taskRatio(
          tasks.find((t) => t.id === b.data.taskId)!,
          reports,
          cutoff,
        ) !== null,
    ) &&
    tasks.every((t) => budgets.some((b) => b.data.taskId === t.id));
  const pvKnown =
    budgets.length > 0 &&
    budgets.every(
      (b) =>
        ids.has(b.data.taskId) &&
        plannedRatio(
          p,
          tasks.find((t) => t.id === b.data.taskId)!,
          cutoff,
        ) !== null,
    ) &&
    tasks.every((t) => budgets.some((b) => b.data.taskId === t.id));
  const ev = evKnown
    ? total(
        budgets.map(
          (b) =>
            b.data.amount *
            taskRatio(
              tasks.find((t) => t.id === b.data.taskId)!,
              reports,
              cutoff,
            )!,
        ),
      )
    : null;
  const pv = pvKnown
    ? total(
        budgets.map(
          (b) =>
            b.data.amount *
            plannedRatio(
              p,
              tasks.find((t) => t.id === b.data.taskId)!,
              cutoff,
            )!,
        ),
      )
    : null;
  const cpi = ev !== null && cost !== null && cost > 0 ? ev / cost : null,
    spi = ev !== null && pv !== null && pv > 0 ? ev / pv : null;
  const eac = budget !== null && cpi !== null && cpi > 0 ? budget / cpi : null;
  const definitions: [string, string, number | null, string, string][] = [
    ["budget", "Approved budget", budget, "USD", "approved_budget_entries_sum"],
    [
      "actual_cost",
      "Approved actual cost",
      cost,
      "USD",
      "approved_cost_entries_cumulative_to_cutoff",
    ],
    [
      "revenue",
      "Approved recognized revenue",
      revenue,
      "USD",
      "approved_revenue_entries_sum",
    ],
    [
      "gross_margin",
      "Recognized gross margin",
      revenue !== null && cost !== null ? revenue - cost : null,
      "USD",
      "approved_recognized_revenue_minus_approved_cost",
    ],
    [
      "earned_value",
      "Earned value",
      ev,
      "USD",
      "task_budget_times_verified_progress",
    ],
    [
      "planned_value",
      "Planned value",
      pv,
      "USD",
      "task_budget_times_baseline_workday_fraction",
    ],
    [
      "cpi",
      "Cost performance index",
      cpi,
      "ratio",
      "earned_value_divided_by_actual_cost",
    ],
    [
      "spi",
      "Schedule performance index",
      spi,
      "ratio",
      "earned_value_divided_by_planned_value",
    ],
    [
      "cost_eac",
      "Cost estimate at completion",
      eac,
      "USD",
      "approved_budget_divided_by_CPI",
    ],
    [
      "cost_etc",
      "Cost estimate to complete",
      eac !== null && cost !== null ? eac - cost : null,
      "USD",
      "cost_EAC_minus_approved_actual_cost",
    ],
    [
      "forecast_margin",
      "Forecast contract margin",
      contract !== null && eac !== null ? contract - eac : null,
      "USD",
      "approved_contract_value_minus_cost_EAC",
    ],
  ];
  const financialMetrics: Metric[] = definitions.map(
    ([key, label, value, unit, calculation]) => ({
      key,
      label,
      value: value === null ? null : round(value),
      unit,
      calculation,
      sourceRecordIds: [...finance, ...tasks, ...reports].map((r) => r.id),
      sourceVersion: JSON.stringify([
        p.version,
        ...records.map((r) => [r.id, r.version]),
      ]),
      asOf,
      scope,
      missingData: value === null,
      coverage:
        value === null
          ? "Required approved financial or progress inputs unavailable"
          : `Approved USD inputs, cumulative through ${cutoff}; forecasts are estimates`,
    }),
  );
  return {
    curve,
    curveTruncated: allDays.length === 3660,
    productivity,
    missingUpdates,
    financialMetrics,
    finance,
    resources: resourceAnalysis(p, records, scope, cutoff),
    schedule: scheduleAnalysis(
      p,
      records.filter(
        (r) =>
          r.kind === "task" &&
          (!scope.sectionId || r.data.sectionId === scope.sectionId),
      ),
    ),
  };
}
export const financialRoles = ["admin", "pm", "accountant"];
export function visibleRecords(records: RecordRow[], role: string) {
  const manager = ["admin", "pm"].includes(role);
  const assigned = new Set(
    records
      .filter((r) => r.kind === "crew")
      .flatMap((r) => r.data.memberIds || []),
  );
  return records
    .filter(
      (r) =>
        (r.kind !== "finance" || financialRoles.includes(role)) &&
        (r.kind !== "comment" ||
          r.data.visibility !== "management" ||
          financialRoles.includes(role)) &&
        (r.kind !== "resource" || manager || assigned.has(r.id)),
    )
    .map((r) =>
      r.kind === "resource" && !manager
        ? {
            ...r,
            data: {
              ...r.data,
              unavailable: (r.data.unavailable || []).map((x: any) => ({
                ...x,
                reason: "Unavailable",
              })),
            },
          }
        : r,
    );
}
