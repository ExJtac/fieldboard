import PDFDocument from "pdfkit";
import { openDb, migrate } from "../server/db.ts";
import { createApp, errorHandler } from "../server/app.ts";
import request from "supertest";
import assert from "node:assert/strict";
import { resolve } from "node:path";
process.env.CLAMSCAN_PATH = resolve("scripts/clamav-docker.mjs");
const db = await openDb(":memory:");
await migrate(db);
const app = createApp(db);
app.use(errorHandler);
const admin = request.agent(app);
const post = (url: string, data: any) =>
  admin.post(url).set("X-Fieldboard-Request", "1").send(data);
try {
  await post("/api/auth/setup", {
    name: "Scanner tester",
    organization: "Scanner QA",
    email: "scan@sample.test",
    password: "scanner-test-password",
  });
  const p = (
    await post("/api/projects", {
      name: "Scanner test",
      code: "SCAN",
      customer: "Sample",
    })
  ).body;
  const clean = Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF",
  );
  const eicar = Buffer.from(
    "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=",
    "base64",
  );
  const upload = (bytes: Buffer, name: string) =>
    admin
      .post(`/api/projects/${p.id}/documents`)
      .set("X-Fieldboard-Request", "1")
      .field("name", name)
      .attach("file", bytes, name + ".pdf");
  const good = await upload(clean, "Clean evidence");
  assert.equal(good.status, 201, JSON.stringify(good.body));
  assert.equal(good.body.data.scanStatus, "clean");
  assert.equal(
    (await admin.get(`/api/projects/${p.id}/documents/${good.body.id}`)).status,
    200,
  );
  const pdf = new PDFDocument();
  const chunks: Buffer[] = [];
  const ready = new Promise<Buffer>((resolve) => {
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
  });
  pdf.text("Harmless antivirus test attachment");
  pdf.file(eicar, { name: "eicar.com" });
  pdf.end();
  const bad = await upload(await ready, "EICAR test");
  assert.equal(bad.status, 201);
  assert.equal(bad.body.data.scanStatus, "quarantined");
  assert.equal(
    (await admin.get(`/api/projects/${p.id}/documents/${bad.body.id}`)).status,
    409,
  );
  console.log(
    "PASS: real ClamAV with downloaded signature databases clears clean evidence, quarantines EICAR and blocks its download.",
  );
} finally {
  await db.close();
}
