import type { Express } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db.ts";
import { assert, type User } from "./domain.ts";
import { hash, passwordHash, session } from "./auth.ts";
import { deliverMail, mailConfigured } from "./mail.ts";
import { event } from "./store.ts";
export function signupEnabled() {
  return (
    process.env.ALLOW_SIGNUP === "1" &&
    mailConfigured() &&
    !!process.env.APP_ORIGIN
  );
}
export function installSignup(
  app: Express,
  db: DB,
  authLimit: any,
  production = false,
) {
  app.post("/api/auth/register", authLimit, async (req, res) => {
    assert(signupEnabled(), 403, "Public workspace signup is disabled");
    const data = z
      .object({
        name: z.string().trim().min(1).max(100),
        organization: z.string().trim().min(1).max(150),
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(200),
      })
      .parse(req.body);
    if (
      !(await db.query("SELECT id FROM users WHERE email=$1", [data.email]))
        .rows.length
    ) {
      const token = randomBytes(32).toString("hex");
      await db.query("DELETE FROM signup_verifications WHERE expires_at<now()");
      await db.query(
        "INSERT INTO signup_verifications(token_hash,data,expires_at) VALUES($1,$2,$3)",
        [
          hash(token),
          JSON.stringify({
            name: data.name,
            organization: data.organization,
            email: data.email,
            passwordHash: await passwordHash(data.password),
          }),
          new Date(Date.now() + 3600000).toISOString(),
        ],
      );
      await deliverMail(
        data.email,
        "Verify your Fieldboard workspace",
        `Verify this email address to create your Fieldboard organization:\n${process.env.APP_ORIGIN}/api/auth/verify?token=${token}\nThis one-use link expires in one hour. If you did not request a workspace, ignore this email.`,
      );
    }
    res
      .status(202)
      .json({
        verificationRequired: true,
        message:
          "If this email can register, a verification link has been sent. Existing accounts can sign in.",
      });
  });
  app.get("/api/auth/verify", authLimit, async (req, res) => {
    assert(signupEnabled(), 403, "Public workspace signup is disabled");
    const token = z.string().length(64).parse(req.query.token);
    const u = await db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "DELETE FROM signup_verifications WHERE token_hash=$1 AND expires_at>now() RETURNING data",
          [hash(token)],
        )
      ).rows[0];
      assert(row, 400, "Verification link is invalid or expired");
      const d = row.data;
      assert(
        !(await tx.query("SELECT id FROM users WHERE email=$1", [d.email])).rows
          .length,
        409,
        "Account already exists; sign in",
      );
      const org = randomUUID(),
        id = randomUUID();
      await tx.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        org,
        d.organization,
      ]);
      await tx.query(
        "INSERT INTO users(id,org_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,'admin')",
        [id, org, d.name, d.email, d.passwordHash],
      );
      await tx.query(
        "INSERT INTO memberships(user_id,org_id,role) VALUES($1,$2,'admin')",
        [id, org],
      );
      const user: User = {
        id,
        org_id: org,
        name: d.name,
        email: d.email,
        role: "admin",
        project_ids: [],
      };
      await event(tx, user, null, "user", id, "email_verified_signup", 1, {
        name: d.name,
      });
      return user;
    });
    await session(db, u.id, res, production, u.org_id);
    res.redirect("/");
  });
}
