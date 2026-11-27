import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { DB } from "./db.ts";
import type { Response, Request } from "express";
const scrypt = promisify(scryptCallback);
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, key] = encoded.split(":");
  if (!salt || !key) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const saved = Buffer.from(key, "hex");
  return saved.length === derived.length && timingSafeEqual(saved, derived);
}
export async function session(
  db: DB,
  id: string,
  res: Response,
  secure: boolean,
  orgId?: string,
) {
  if (!orgId)
    orgId = (
      await db.query(
        "SELECT m.org_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.active=true ORDER BY (m.org_id=u.org_id) DESC,m.org_id LIMIT 1",
        [id],
      )
    ).rows[0]?.org_id;
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at,org_id) VALUES($1,$2,$3,$4)",
    [
      hash(token),
      id,
      new Date(Date.now() + 12 * 3600_000).toISOString(),
      orgId || null,
    ],
  );
  res.cookie("fb_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: 12 * 3600_000,
    path: "/",
  });
}
export async function getUser(db: DB, req: Request) {
  const cookie = req.cookies.fb_session;
  if (typeof cookie !== "string") return null;
  return (
    (
      await db.query(
        "SELECT u.id,COALESCE(m.org_id,u.org_id) AS org_id,u.name,u.email,COALESCE(m.role,u.role) AS role,COALESCE(m.project_ids,u.project_ids) AS project_ids FROM users u JOIN sessions s ON u.id=s.user_id LEFT JOIN memberships m ON m.user_id=u.id AND m.org_id=COALESCE(s.org_id,u.org_id) WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true AND (m.active=true OR (m.user_id IS NULL AND (s.org_id IS NULL OR s.org_id=u.org_id)))",
        [hash(cookie)],
      )
    ).rows[0] || null
  );
}
