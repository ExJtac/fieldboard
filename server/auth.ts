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
) {
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [hash(token), id, new Date(Date.now() + 12 * 3600_000).toISOString()],
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
        "SELECT u.id,u.org_id,u.name,u.email,u.role,u.project_ids FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
        [hash(cookie)],
      )
    ).rows[0] || null
  );
}
