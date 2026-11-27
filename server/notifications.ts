import { randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import type { User } from "./domain.ts";
export async function notifyEvent(
  db: DB,
  u: User,
  projectId: string | null,
  kind: string,
  id: string,
  action: string,
  version: number,
  payload: any,
) {
  if (!projectId || ["export", "notification"].includes(kind)) return;
  const members = (
    await db.query(
      "SELECT u.id,m.role,m.project_ids,p.data AS preferences FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN preferences p ON p.user_id=u.id WHERE m.org_id=$1 AND u.active=true AND m.active=true AND m.role<>'viewer'",
      [u.org_id],
    )
  ).rows;
  for (const m of members) {
    if (
      m.id === u.id ||
      (!["admin", "pm"].includes(m.role) && !m.project_ids.includes(projectId))
    )
      continue;
    if (
      (kind === "finance" ||
        (kind === "comment" && payload.data?.visibility === "management")) &&
      !["admin", "pm", "accountant"].includes(m.role)
    )
      continue;
    const mentioned =
      payload.data?.mentions?.includes(m.id) || payload.data?.ownerId === m.id;
    const category = mentioned
      ? "mentions"
      : action === "created" && payload.data?.status === "submitted"
        ? "approvals"
        : "changes";
    if (
      m.preferences?.[category] === false ||
      (!mentioned && category === "changes" && m.preferences?.changes !== true)
    )
      continue;
    await db.query(
      "INSERT INTO notifications(id,org_id,user_id,project_id,source_key,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,source_key) DO NOTHING",
      [
        randomUUID(),
        u.org_id,
        m.id,
        projectId,
        `${kind}:${id}:${version}:${action}`,
        JSON.stringify({
          title: mentioned
            ? `${u.name} mentioned or assigned you`
            : `${kind}: ${action}`,
          entityId: id,
          kind,
          category,
          author: u.name,
        }),
      ],
    );
  }
}
export async function reminders(db: DB) {
  const rows = (
    await db.query(
      "SELECT r.*,p.org_id,p.data AS project_data FROM records r JOIN projects p ON p.id=r.project_id WHERE r.kind IN ('issue','request') AND p.data->>'archived'<>'true'",
    )
  ).rows;
  for (const r of rows) {
    if (!r.data.dueDate || !["open", "submitted"].includes(r.data.status))
      continue;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: r.project_data.timezone || "America/Denver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (r.data.dueDate > today) continue;
    const days = Math.floor(
        (Date.parse(today) - Date.parse(r.data.dueDate)) / 86400000,
      ),
      escalated = days >= (r.project_data.escalationDays ?? 2);
    const users = (
      await db.query(
        "SELECT u.id,m.role,m.project_ids,p.data AS preferences FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN preferences p ON p.user_id=u.id WHERE m.org_id=$1 AND u.active=true AND m.active=true AND m.role<>'viewer'",
        [r.org_id],
      )
    ).rows;
    for (const u of users) {
      if (
        u.preferences?.reminders === false ||
        (!["admin", "pm"].includes(u.role) &&
          !u.project_ids.includes(r.project_id))
      )
        continue;
      if (
        u.id !== r.data.ownerId &&
        !(escalated && ["admin", "pm"].includes(u.role))
      )
        continue;
      await db.query(
        "INSERT INTO notifications(id,org_id,user_id,project_id,source_key,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,source_key) DO NOTHING",
        [
          randomUUID(),
          r.org_id,
          u.id,
          r.project_id,
          `due:${r.id}:${r.data.dueDate}:${escalated ? "escalated" : "due"}`,
          JSON.stringify({
            title: `${escalated ? "Escalated" : "Due"}: ${r.data.name}`,
            entityId: r.id,
            kind: r.kind,
            category: "reminders",
            dueDate: r.data.dueDate,
          }),
        ],
      );
    }
  }
}
