import { notifyEvent } from "./notifications.ts";
import { randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import {
  assert,
  type Project,
  type RecordRow,
  type User,
  type Kind,
  type Scope,
  schemas,
} from "./domain.ts";
export async function event(
  db: DB,
  user: User,
  projectId: string | null,
  kind: string,
  id: string,
  action: string,
  version: number,
  payload: any,
) {
  await db.query(
    "INSERT INTO events(id,org_id,project_id,entity_id,entity_kind,actor_id,actor_name,action,version,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      user.org_id,
      projectId,
      id,
      kind,
      user.id,
      user.name,
      action,
      version,
      JSON.stringify(payload),
    ],
  );
  await notifyEvent(db, user, projectId, kind, id, action, version, payload);
}
export async function authorizedProject(db: DB, user: User, id: string) {
  const p = (
    await db.query<Project>(
      "SELECT * FROM projects WHERE id=$1 AND org_id=$2",
      [id, user.org_id],
    )
  ).rows[0];
  assert(
    p && (["admin", "pm"].includes(user.role) || user.project_ids.includes(id)),
    404,
    "Project not found",
  );
  assert(
    user.role !== "viewer",
    403,
    "Customer viewers use approved publications only",
  );
  return p;
}
export async function loadProject(
  db: DB,
  user: User,
  id: string,
  scope: Scope = {},
) {
  let project = await authorizedProject(db, user, id);
  let records = (
    await db.query<RecordRow>(
      "SELECT * FROM records WHERE project_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
  const resourceRows = (
    await db.query(
      "SELECT *, 'resource' AS kind, '' AS project_id FROM resources WHERE org_id=$1",
      [user.org_id],
    )
  ).rows as RecordRow[];
  records.push(...resourceRows);
  if (scope.asOf) {
    const events = (
      await db.query(
        "SELECT * FROM events WHERE (project_id=$1 OR (org_id=$3 AND entity_kind='resource')) AND created_at<=$2 ORDER BY seq",
        [id, scope.asOf, user.org_id],
      )
    ).rows;
    const map = new Map<string, RecordRow>();
    let historical: Project | undefined;
    for (const e of events) {
      if (e.entity_kind === "project") historical = e.payload;
      else if (Object.keys(schemas).includes(e.entity_kind))
        map.set(e.entity_id, e.payload);
    }
    assert(historical, 404, "Project did not exist at this time");
    project = historical;
    records = [...map.values()];
  }
  return { project, records };
}
export async function addRecord(
  db: DB,
  user: User,
  projectId: string,
  kind: Kind,
  data: any,
) {
  const row = (
    await db.query<RecordRow>(
      "INSERT INTO records(id,project_id,kind,data) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), projectId, kind, JSON.stringify(data)],
    )
  ).rows[0];
  await event(db, user, projectId, kind, row.id, "created", 1, row);
  return row;
}
export async function changeRecord(
  db: DB,
  user: User,
  row: RecordRow,
  data: any,
  version: number,
  action = "updated",
) {
  const updated = (
    await db.query<RecordRow>(
      "UPDATE records SET data=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3 RETURNING *",
      [JSON.stringify(data), row.id, version],
    )
  ).rows[0];
  assert(updated, 409, "This record changed. Refresh before editing.");
  await event(
    db,
    user,
    row.project_id,
    row.kind,
    row.id,
    action,
    updated.version,
    updated,
  );
  return updated;
}
export async function changeProject(
  db: DB,
  user: User,
  p: Project,
  data: any,
  version: number,
  action = "updated",
) {
  const updated = (
    await db.query<Project>(
      "UPDATE projects SET data=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3 RETURNING *",
      [JSON.stringify(data), p.id, version],
    )
  ).rows[0];
  assert(updated, 409, "This project changed. Refresh before editing.");
  await event(
    db,
    user,
    p.id,
    "project",
    p.id,
    action,
    updated.version,
    updated,
  );
  return updated;
}
