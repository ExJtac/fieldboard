import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { DB } from "./db.ts";
import {
  assert,
  projectSchema,
  schemas,
  type User,
  type RecordRow,
} from "./domain.ts";
import { authorizedProject, addRecord, event } from "./store.ts";
const entry = (schema: z.ZodType) =>
  z.object({ id: z.string().min(1).max(100), data: schema });
export const transferSchema = z.object({
  schemaVersion: z.literal(1),
  project: projectSchema,
  sections: z.array(entry(schemas.section)).max(500),
  tasks: z.array(entry(schemas.task)).max(5000),
  materials: z.array(entry(schemas.material)).max(10000),
});
export function installTransfer(app: Express, db: DB) {
  const allow = (user: User) =>
    assert(
      ["admin", "pm"].includes(user.role),
      403,
      "Project manager access required",
    );
  const structure = async (u: User, id: string, clean = false) => {
    const p = await authorizedProject(db, u, id);
    const rows = (
      await db.query<RecordRow>("SELECT * FROM records WHERE project_id=$1", [
        id,
      ])
    ).rows;
    return {
      schemaVersion: 1,
      project: clean
        ? {
            ...p.data,
            archived: false,
            baselineFinish: "",
            forecastFinish: "",
            externalId: "",
          }
        : p.data,
      sections: rows
        .filter((r) => r.kind === "section")
        .map((r) => ({
          id: r.id,
          data: clean
            ? { ...r.data, released: false, releaseReference: "" }
            : r.data,
        })),
      tasks: rows
        .filter((r) => r.kind === "task")
        .map((r) => ({
          id: r.id,
          data: {
            ...r.data,
            actualFinish: "",
            ...(clean
              ? {
                  baselineStart: "",
                  baselineFinish: "",
                  forecastStart: "",
                  forecastFinish: "",
                  prerequisitesCleared: false,
                }
              : {}),
          },
        })),
      materials: rows
        .filter((r) => r.kind === "material")
        .map((r) => ({
          id: r.id,
          data: {
            ...r.data,
            received: 0,
            status: "unconfirmed",
            confirmed: false,
            expectedDate: "",
            po: "",
            notes: clean ? "" : r.data.notes,
          },
        })),
    };
  };
  const importStructure = async (u: User, input: any) => {
    allow(u);
    const data = transferSchema.parse(input);
    return db.transaction(async (tx) => {
      const p = (
        await tx.query(
          "INSERT INTO projects(id,org_id,data) VALUES($1,$2,$3) RETURNING *",
          [
            randomUUID(),
            u.org_id,
            JSON.stringify({ ...data.project, archived: false }),
          ],
        )
      ).rows[0];
      await event(tx, u, p.id, "project", p.id, "structure_imported", 1, p);
      const ids = new Map<string, string>();
      for (const section of data.sections) {
        assert(!ids.has(section.id), 400, "Duplicate source ID");
        const row = await addRecord(tx, u, p.id, "section", section.data);
        ids.set(section.id, row.id);
      }
      const sectionIds = new Set(ids.keys());
      for (const task of data.tasks) {
        const d = task.data as any;
        assert(
          !ids.has(task.id) && sectionIds.has(d.sectionId),
          400,
          "Invalid task section or duplicate source ID",
        );
        assert(
          !d.actualFinish,
          400,
          "Structure imports cannot assert completed work",
        );
        for (const prefix of ["baseline", "forecast"])
          assert(
            !d[`${prefix}Start`] ||
              !d[`${prefix}Finish`] ||
              d[`${prefix}Start`] <= d[`${prefix}Finish`],
            400,
            "Task finish must follow start",
          );
        const row = await addRecord(tx, u, p.id, "task", {
          ...d,
          sectionId: ids.get(d.sectionId),
        });
        ids.set(task.id, row.id);
      }
      const taskIds = new Set(data.tasks.map((t) => t.id));
      for (const material of data.materials) {
        const d = material.data as any;
        assert(
          !ids.has(material.id) && taskIds.has(d.taskId),
          400,
          "Invalid material task or duplicate source ID",
        );
        assert(
          d.received === 0 && d.status === "unconfirmed",
          400,
          "Record actual receipts in the material register after import",
        );
        const row = await addRecord(tx, u, p.id, "material", {
          ...d,
          taskId: ids.get(d.taskId),
        });
        ids.set(material.id, row.id);
      }
      return p;
    });
  };
  app.get("/api/projects/:id/structure", async (req, res) => {
    const u = res.locals.user as User;
    allow(u);
    const data = await structure(u, req.params.id);
    res
      .set(
        "Content-Disposition",
        'attachment; filename="fieldboard-project-structure.json"',
      )
      .json(data);
  });
  app.post("/api/import", async (req, res) =>
    res.status(201).json(await importStructure(res.locals.user, req.body)),
  );
  app.get("/api/templates", async (req, res) => {
    const u = res.locals.user as User;
    allow(u);
    res.json(
      (
        await db.query(
          "SELECT id,name,created_at FROM templates WHERE org_id=$1 ORDER BY name",
          [u.org_id],
        )
      ).rows,
    );
  });
  app.post("/api/projects/:id/template", async (req, res) => {
    const u = res.locals.user as User;
    allow(u);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(200) })
      .parse(req.body);
    const data = await structure(u, req.params.id, true),
      id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO templates(id,org_id,name,data) VALUES($1,$2,$3,$4)",
        [id, u.org_id, name, JSON.stringify(data)],
      );
      await event(tx, u, req.params.id, "template", id, "created", 1, { name });
    });
    res.status(201).json({ id });
  });
  app.post("/api/templates/:templateId/projects", async (req, res) => {
    const u = res.locals.user as User;
    allow(u);
    const { name, code, customer } = z
      .object({
        name: z.string().trim().min(1).max(500),
        code: z.string().trim().min(1).max(500),
        customer: z.string().trim().min(1).max(500),
      })
      .parse(req.body);
    const template = (
      await db.query("SELECT data FROM templates WHERE id=$1 AND org_id=$2", [
        req.params.templateId,
        u.org_id,
      ])
    ).rows[0];
    assert(template, 404, "Template not found");
    res.status(201).json(
      await importStructure(u, {
        ...template.data,
        project: { ...template.data.project, name, code, customer },
      }),
    );
  });
}
