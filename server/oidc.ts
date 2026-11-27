import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import type { Express } from "express";
import type { DB } from "./db.ts";
import { assert } from "./domain.ts";
import { hash, session } from "./auth.ts";
import { event } from "./store.ts";
export async function mappedIdentity(db: DB, issuer: string, subject: string) {
  return (
    await db.query(
      "SELECT u.id FROM oidc_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2 AND u.active=true",
      [issuer, subject],
    )
  ).rows[0];
}
export function installOidc(
  app: Express,
  db: DB,
  options: {
    production?: boolean;
    origin?: string;
    oidcConfig?: oidc.Configuration;
  },
) {
  let configuration: Promise<oidc.Configuration> | undefined;
  const config = () => {
    if (options.oidcConfig) return Promise.resolve(options.oidcConfig);
    assert(
      process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && options.origin,
      503,
      "Single sign-on is not configured",
    );
    assert(
      process.env.OIDC_ISSUER.startsWith("https://"),
      500,
      "OIDC issuer must use HTTPS",
    );
    return (configuration ??= oidc.discovery(
      new URL(process.env.OIDC_ISSUER),
      process.env.OIDC_CLIENT_ID,
      process.env.OIDC_CLIENT_SECRET,
    ));
  };
  app.get("/api/auth/oidc/start", async (req, res) => {
    const c = await config();
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier(),
      browser = randomBytes(32).toString("hex");
    await db.query("DELETE FROM oidc_flows WHERE expires_at<now()");
    await db.query(
      "INSERT INTO oidc_flows(state_hash,browser_hash,verifier,nonce,expires_at) VALUES($1,$2,$3,$4,$5)",
      [
        hash(state),
        hash(browser),
        verifier,
        nonce,
        new Date(Date.now() + 600000).toISOString(),
      ],
    );
    res.cookie("fb_oidc", browser, {
      httpOnly: true,
      sameSite: "lax",
      secure: !!options.production,
      maxAge: 600000,
      path: "/api/auth/oidc",
    });
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: options.origin + "/api/auth/oidc/callback",
      scope: "openid email",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    res.redirect(url.href);
  });
  app.get("/api/auth/oidc/callback", async (req, res) => {
    const c = await config();
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const flow = (
      await db.query(
        "DELETE FROM oidc_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *",
        [hash(state), hash(req.cookies.fb_oidc || "")],
      )
    ).rows[0];
    assert(
      flow,
      403,
      "Single sign-on state is invalid or expired; start again",
    );
    res.clearCookie("fb_oidc", { path: "/api/auth/oidc" });
    const tokens = await oidc.authorizationCodeGrant(
      c,
      new URL(req.originalUrl, options.origin),
      {
        pkceCodeVerifier: flow.verifier,
        expectedState: state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims()!;
    const mapped = await mappedIdentity(db, claims.iss, claims.sub);
    assert(
      mapped,
      403,
      "Your administrator must map this SSO identity to an account before sign-in",
    );
    await session(db, mapped.id, res, !!options.production);
    res.redirect("/");
  });
}
// Mapping is explicit: verified email claims never silently link local accounts.
export function installOidcMapping(app: Express, db: DB) {
  app.get("/api/oidc-mappings", async (req, res) => {
    const u = res.locals.user;
    assert(u.role === "admin", 403, "Administrator required");
    res.json(
      (
        await db.query(
          "SELECT i.issuer,i.subject,i.user_id,u.name FROM oidc_identities i JOIN users u ON u.id=i.user_id JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1",
          [u.org_id],
        )
      ).rows,
    );
  });
  app.post("/api/oidc-mappings", async (req, res) => {
    const u = res.locals.user;
    assert(u.role === "admin", 403, "Administrator required");
    const { z } = await import("zod");
    const b = z
      .object({ userId: z.string(), subject: z.string().min(1).max(500) })
      .parse(req.body);
    assert(
      process.env.OIDC_ISSUER,
      503,
      "Configure OIDC_ISSUER on the server first",
    );
    await db.transaction(async (tx) => {
      const member = (
        await tx.query("SELECT * FROM users WHERE id=$1 AND org_id=$2", [
          b.userId,
          u.org_id,
        ])
      ).rows[0];
      assert(
        member,
        404,
        "Only the account home organization may map its login identity",
      );
      await tx.query(
        "INSERT INTO oidc_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
        [process.env.OIDC_ISSUER, b.subject, b.userId],
      );
      await event(tx, u, null, "identity", b.userId, "oidc_mapped", 1, {
        issuer: process.env.OIDC_ISSUER,
        subject: b.subject,
      });
    });
    res.status(201).json({ ok: true });
  });
  app.delete("/api/oidc-mappings/:userId", async (req, res) => {
    const u = res.locals.user;
    assert(u.role === "admin", 403, "Administrator required");
    await db.transaction(async (tx) => {
      assert(
        (
          await tx.query("SELECT id FROM users WHERE id=$1 AND org_id=$2", [
            req.params.userId,
            u.org_id,
          ])
        ).rows.length,
        404,
        "Account not found",
      );
      await tx.query("DELETE FROM oidc_identities WHERE user_id=$1", [
        req.params.userId,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [
        req.params.userId,
      ]);
      await event(
        tx,
        u,
        null,
        "identity",
        req.params.userId,
        "oidc_unmapped",
        1,
        {},
      );
    });
    res.json({ ok: true });
  });
}
