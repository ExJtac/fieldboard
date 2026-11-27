import https from "node:https";
import http from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const key = await readFile(".data/tls-check/key.pem"),
  cert = await readFile(".data/tls-check/cert.pem");
const proxy = https.createServer({ key, cert }, (req, res) => {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: 4313,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, "x-forwarded-proto": "https" },
    },
    (r) => {
      res.writeHead(r.statusCode!, r.headers);
      r.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
await new Promise<void>((r) => proxy.listen(4314, "127.0.0.1", r));
let cookie = "";
const call = (path: string, body?: any) =>
  new Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }>(
    (resolve, reject) => {
      const req = https.request(
        {
          hostname: "127.0.0.1",
          servername: "localhost",
          port: 4314,
          path: "/api" + path,
          method: body ? "POST" : "GET",
          ca: cert,
          headers: {
            "Content-Type": "application/json",
            "X-Fieldboard-Request": "1",
            Origin: "https://localhost:4314",
            Cookie: cookie,
          },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => {
            if (r.headers["set-cookie"])
              cookie = r.headers["set-cookie"][0].split(";")[0];
            resolve({
              status: r.statusCode!,
              data: JSON.parse(Buffer.concat(chunks).toString()),
              headers: r.headers,
            });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    },
  );
try {
  assert.equal((await call("/health")).status, 200);
  const setup = (await call("/auth/status")).data;
  const login = await call(
    setup.setupRequired ? "/auth/setup" : "/auth/login",
    setup.setupRequired
      ? {
          name: "Container QA",
          organization: "Container staging",
          email: "container@sample.test",
          password: "container-staging-password",
          setupToken: "standalone-acceptance-install-token",
        }
      : {
          email: "container@sample.test",
          password: "container-staging-password",
        },
  );
  assert.equal(login.status, setup.setupRequired ? 201 : 200);
  assert(login.headers["set-cookie"]?.[0].includes("Secure"));
  assert(login.headers["set-cookie"]?.[0].includes("HttpOnly"));
  assert.equal((await call("/me")).status, 200);
  const p = await call("/projects", {
    name: "Container acceptance",
    code: "DOCKER",
    customer: "Synthetic staging",
  });
  assert.equal(p.status, 201);
  const d = await call(`/projects/${p.data.id}/dashboard`);
  assert.equal(d.status, 200);
  assert.equal(
    d.data.metrics.find((m: any) => m.key === "actual_hours").value,
    null,
  );
  console.log(
    "PASS: Compose PostgreSQL app boots, HTTPS setup/login succeeds with Secure HttpOnly cookies, and project dashboard persists.",
  );
} finally {
  await new Promise<void>((r) => proxy.close(() => r()));
}
