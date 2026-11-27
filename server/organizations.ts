import type { Express } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import { assert, roles, type User } from "./domain.ts";
import { hash } from "./auth.ts";
import { event } from "./store.ts";
export function installOrganizations(app: Express, db: DB) {
  app.get("/api/organizations", async (req, res) => {
    const u = res.locals.user as User;
    res.json(
      (
        await db.query(
          "SELECT o.id,o.name,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1 AND m.active=true ORDER BY o.name",
          [u.id],
        )
      ).rows,
    );
  });
  app.post("/api/organizations", async (req, res) => {
    const u = res.locals.user as User;
    assert(u.role === "admin", 403, "Administrator access required");
    const name = z.string().trim().min(1).max(150).parse(req.body.name);
    const org = await db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        id,
        name,
      ]);
      await tx.query(
        "INSERT INTO memberships(user_id,org_id,role) VALUES($1,$2,'admin')",
        [u.id, id],
      );
      await event(
        tx,
        { ...u, org_id: id },
        null,
        "organization",
        id,
        "created",
        1,
        { name },
      );
      return { id, name };
    });
    res.status(201).json(org);
  });
  app.post("/api/organizations/:orgId/switch", async (req, res) => {
    const u = res.locals.user as User;
    assert(
      (
        await db.query(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND org_id=$2 AND active=true",
          [u.id, req.params.orgId],
        )
      ).rows.length,
      403,
      "Organization membership required",
    );
    await db.query(
      "UPDATE sessions SET org_id=$1 WHERE token_hash=$2 AND user_id=$3",
      [req.params.orgId, hash(req.cookies.fb_session || ""), u.id],
    );
    res.json({ ok: true });
  });
  app.post("/api/memberships", async (req, res) => {
    const u = res.locals.user as User;
    assert(u.role === "admin", 403, "Administrator access required");
    const b = z
      .object({
        email: z.email().transform((s) => s.toLowerCase()),
        role: z.enum(roles),
        projectIds: z.array(z.string()).max(200),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const member = (
        await tx.query("SELECT id FROM users WHERE email=$1 AND active=true", [
          b.email,
        ])
      ).rows[0];
      assert(
        member,
        404,
        "Create the account first, or enter an existing installation account",
      );
      assert(member.id !== u.id, 400, "You cannot change your own access");
      for (const id of b.projectIds)
        assert(
          (
            await tx.query(
              "SELECT id FROM projects WHERE id=$1 AND org_id=$2",
              [id, u.org_id],
            )
          ).rows.length,
          400,
          "Invalid project assignment",
        );
      await tx.query(
        "INSERT INTO memberships(user_id,org_id,role,project_ids) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,org_id) DO UPDATE SET role=excluded.role,project_ids=excluded.project_ids,active=true",
        [member.id, u.org_id, b.role, JSON.stringify(b.projectIds)],
      );
      await event(tx, u, null, "membership", member.id, "access_granted", 1, {
        role: b.role,
        projectIds: b.projectIds,
      });
    });
    res.status(201).json({ ok: true });
  });
}
