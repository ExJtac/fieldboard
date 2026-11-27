import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DB } from "./db.ts";
import { projectSchema, schemas, type User } from "./domain.ts";
import { addRecord, event } from "./store.ts";
export async function seedPilot(db: DB, user: User) {
  const existing = (
    await db.query(
      "SELECT id FROM projects WHERE org_id=$1 AND data->>'externalId'='sample-pilot-v1'",
      [user.org_id],
    )
  ).rows[0];
  if (existing) return existing.id;
  const local = process.env.PILOT_FIXTURE
    ? JSON.parse(await readFile(process.env.PILOT_FIXTURE, "utf8"))
    : {};
  const data = projectSchema.parse({
    name: "Sample campus · Building A",
    code: "DEMO-001",
    customer: "Sample education client",
    location: "Texas",
    manager: user.name,
    phase: "Mobilization",
    estimatedHours: 1800,
    pmHours: 180,
    ...local,
    sample: true,
    externalId: "sample-pilot-v1",
  });
  const p = (
    await db.query(
      "INSERT INTO projects(id,org_id,data) VALUES($1,$2,$3) RETURNING *",
      [randomUUID(), user.org_id, JSON.stringify(data)],
    )
  ).rows[0];
  await event(db, user, p.id, "project", p.id, "sample_created", 1, p);
  const sections = [];
  for (let i = 1; i <= 5; i++)
    sections.push(
      await addRecord(
        db,
        user,
        p.id,
        "section",
        schemas.section.parse({
          name: `Section ${i}`,
          released: i === 1,
          releaseReference:
            i === 1
              ? "Sample specification: first section approved"
              : "GC release unconfirmed",
        }),
      ),
    );
  const definitions = [
    ["Conduit installation", 33, "conduits"],
    ["Blue CAT6A installation", 33, "lines"],
    ["24 × 4 inch cable tray", null, "ft"],
    ["Two-post racks and vertical managers", null, "sets"],
    ["Section 1 handover", null, "milestone"],
  ];
  const tasks = [];
  for (const [name, quantity, unit] of definitions)
    tasks.push(
      await addRecord(
        db,
        user,
        p.id,
        "task",
        schemas.task.parse({
          name,
          sectionId: sections[0].id,
          quantity,
          unit,
          kind: unit === "milestone" ? "milestone" : "task",
          notes:
            "Sample specification only. Dates, task estimates and actual quantities are unconfirmed.",
        }),
      ),
    );
  for (const [name, task, qty, unit, notes] of [
    [
      "10-inch vertical managers",
      tasks[3],
      1,
      "lot",
      "Expected mid-December, subject to order confirmation. Required quantity unconfirmed; lot is a tracking placeholder.",
    ],
    [
      "24 × 4 inch cable tray",
      tasks[2],
      1,
      "lot",
      "Expected mid/late December, subject to order confirmation. Required quantity unconfirmed; lot is a tracking placeholder.",
    ],
  ] as const)
    await addRecord(
      db,
      user,
      p.id,
      "material",
      schemas.material.parse({
        name,
        taskId: task.id,
        required: qty,
        unit,
        notes,
      }),
    );
  await addRecord(
    db,
    user,
    p.id,
    "issue",
    schemas.issue.parse({
      name: "Confirm second-floor GC release",
      sectionId: sections[1].id,
      type: "risk",
      severity: "high",
      owner: user.name,
      notes:
        "Sample: fiber and analog work deferred. No committed release date.",
    }),
  );
  await addRecord(
    db,
    user,
    p.id,
    "issue",
    schemas.issue.parse({
      name: "Approve temporary jetline support method",
      taskId: tasks[2].id,
      sectionId: sections[0].id,
      type: "rfi",
      severity: "medium",
      owner: user.name,
      notes: "Sample: method requires approval before use.",
    }),
  );
  return p.id;
}
