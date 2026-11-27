import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, migrate } from "../server/db.ts";
test("disk-backed PostgreSQL data survives a clean process lifecycle", async () => {
  const folder = await mkdtemp(join(tmpdir(), "fieldboard-persistence-"));
  try {
    const first = await openDb(folder);
    await migrate(first);
    await first.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      "retained",
      "Retained organization",
    ]);
    await first.close();
    const second = await openDb(folder);
    await migrate(second);
    assert.equal(
      (
        await second.query("SELECT name FROM organizations WHERE id=$1", [
          "retained",
        ])
      ).rows[0].name,
      "Retained organization",
    );
    await second.close();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
