import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { openDb, migrate } from "../server/db.ts";
import { createApp, errorHandler } from "../server/app.ts";
const write = (a: any, method: string, url: string, body: any) =>
  a[method](url).set("X-Fieldboard-Request", "1").send(body);
test("organization switching enforces memberships and effective per-organization roles", async () => {
  const db = await openDb(":memory:");
  try {
    await migrate(db);
    const app = createApp(db);
    app.use(errorHandler);
    const owner = request.agent(app);
    await write(owner, "post", "/api/auth/setup", {
      name: "Owner",
      organization: "Org A",
      email: "owner@identity.test",
      password: "identity-test-password",
    });
    const orgA = (await owner.get("/api/me")).body.organization.id;
    const member = (
      await write(owner, "post", "/api/users", {
        name: "Member",
        email: "member@identity.test",
        password: "identity-test-password",
        role: "pm",
        projectIds: [],
      })
    ).body.id;
    const orgB = (
      await write(owner, "post", "/api/organizations", { name: "Org B" })
    ).body.id;
    assert(orgB);
    await write(owner, "post", `/api/organizations/${orgB}/switch`, {});
    assert.equal((await owner.get("/api/me")).body.user.org_id, orgB);
    await write(owner, "post", "/api/memberships", {
      email: "member@identity.test",
      role: "purchasing",
      projectIds: [],
    });
    const m = request.agent(app);
    await write(m, "post", "/api/auth/login", {
      email: "member@identity.test",
      password: "identity-test-password",
    });
    assert.equal((await m.get("/api/me")).body.user.role, "pm");
    assert.equal((await m.get("/api/organizations")).body.length, 2);
    await write(m, "post", `/api/organizations/${orgB}/switch`, {});
    assert.equal((await m.get("/api/me")).body.user.role, "purchasing");
    assert.equal(
      (
        await write(m, "post", "/api/projects", {
          name: "Denied",
          code: "D",
          customer: "GC",
        })
      ).status,
      403,
    );
    assert.equal(
      (await write(m, "post", "/api/organizations/not-a-member/switch", {}))
        .status,
      403,
    );
    await write(owner, "patch", `/api/users/${member}`, {
      role: "purchasing",
      projectIds: [],
      active: false,
    });
    assert.equal((await m.get("/api/me")).status, 401);
    await write(m, "post", "/api/auth/login", {
      email: "member@identity.test",
      password: "identity-test-password",
    });
    assert.equal((await m.get("/api/me")).body.user.org_id, orgA);
    assert.equal((await m.get("/api/organizations")).body.length, 1);
  } finally {
    await db.close();
  }
});
test("OpenID code exchange verifies PKCE/state/nonce, maps exact issuer+subject, and rejects replay", async () => {
  const db = await openDb(":memory:");
  await migrate(db);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  let nonce = "",
    subject = "worker-123",
    badNonce = false,
    pkceVerifier = "";
  const provider = express();
  provider.use(express.urlencoded({ extended: false }));
  provider.get("/jwks", (_req, res) => res.json({ keys: [jwk] }));
  provider.post("/token", (req, res) => {
    pkceVerifier = req.body.code_verifier;
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        iss: "https://issuer.test",
        sub: subject,
        aud: "fieldboard-test",
        iat: now,
        exp: now + 300,
        nonce: badNonce ? "wrong" : nonce,
      }),
    ).toString("base64url");
    const input = head + "." + body;
    const jwt =
      input +
      "." +
      sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
    res.json({
      access_token: "test-access",
      token_type: "Bearer",
      id_token: jwt,
      expires_in: 300,
    });
  });
  const server = provider.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const port = (server.address() as any).port;
  const config = new oidc.Configuration(
    {
      issuer: "https://issuer.test",
      authorization_endpoint: "https://issuer.test/authorize",
      token_endpoint: "https://issuer.test/token",
      jwks_uri: "https://issuer.test/jwks",
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
    },
    "fieldboard-test",
    "test-secret",
  );
  config[oidc.customFetch] = async (input, options) =>
    fetch(
      String(input).replace("https://issuer.test", `http://127.0.0.1:${port}`),
      options as RequestInit,
    );
  const app = createApp(db, { origin: "http://localhost", oidcConfig: config });
  app.use(errorHandler);
  const admin = request.agent(app);
  const setup = await write(admin, "post", "/api/auth/setup", {
    name: "SSO User",
    organization: "SSO Org",
    email: "sso@identity.test",
    password: "identity-test-password",
  });
  await db.query(
    "INSERT INTO oidc_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
    ["https://issuer.test", subject, setup.body.user.id],
  );
  try {
    const user = request.agent(app);
    const start = await user.get("/api/auth/oidc/start");
    assert.equal(start.status, 302);
    const url = new URL(start.headers.location);
    nonce = url.searchParams.get("nonce")!;
    const state = url.searchParams.get("state")!;
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      (
        await user
          .get("/api/auth/oidc/callback")
          .query({ code: "code1", state: "wrong" })
      ).status,
      403,
    );
    const callback = await user
      .get("/api/auth/oidc/callback")
      .query({ code: "code1", state });
    assert.equal(callback.status, 302, JSON.stringify(callback.body));
    assert(pkceVerifier.length >= 43);
    assert.equal(
      (await user.get("/api/me")).body.user.email,
      "sso@identity.test",
    );
    assert.equal(
      (
        await user
          .get("/api/auth/oidc/callback")
          .query({ code: "code1", state })
      ).status,
      403,
    );
    const unknown = request.agent(app);
    const start2 = await unknown.get("/api/auth/oidc/start");
    const url2 = new URL(start2.headers.location);
    nonce = url2.searchParams.get("nonce")!;
    subject = "unknown-subject";
    assert.equal(
      (
        await unknown
          .get("/api/auth/oidc/callback")
          .query({ code: "code2", state: url2.searchParams.get("state") })
      ).status,
      403,
    );
    assert.equal((await unknown.get("/api/me")).status, 401);
    const invalid = request.agent(app);
    const start3 = await invalid.get("/api/auth/oidc/start");
    const url3 = new URL(start3.headers.location);
    nonce = url3.searchParams.get("nonce")!;
    badNonce = true;
    const denied = await invalid
      .get("/api/auth/oidc/callback")
      .query({ code: "code3", state: url3.searchParams.get("state") });
    assert(denied.status >= 400);
    assert.equal((await invalid.get("/api/me")).status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.close();
  }
});
