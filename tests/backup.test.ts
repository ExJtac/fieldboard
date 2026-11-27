import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDb, migrate } from "../server/db.ts";
import {
  backupData,
  encodeBackup,
  decodeBackup,
  restoreData,
} from "../server/backup.ts";
test("encrypted backup restores relational history, snapshots and files; rejects tampering and nonempty destinations", async () => {
  const source = await openDb(":memory:"),
    target = await openDb(":memory:");
  try {
    await migrate(source);
    await migrate(target);
    await source.query(
      "INSERT INTO organizations(id,name) VALUES('o','Restore test')",
    );
    await source.query(
      "INSERT INTO users(id,org_id,name,email,password_hash,role) VALUES('u','o','Admin','a@b.test','salt:hash','admin')",
    );
    await source.query(
      "INSERT INTO projects(id,org_id,data) VALUES('p','o',$1)",
      [JSON.stringify({ name: "Preserved" })],
    );
    await source.query(
      "INSERT INTO records(id,project_id,kind,data) VALUES('r','p','document',$1)",
      [JSON.stringify({ name: "Document", scanStatus: "clean" })],
    );
    await source.query(
      "INSERT INTO files(record_id,content) VALUES('r','cHJlc2VydmVk')",
    );
    await source.query(
      "INSERT INTO events(id,org_id,project_id,entity_id,entity_kind,actor_id,actor_name,action,version,payload) VALUES('e','o','p','r','document','u','Admin','created',1,'{}')",
    );
    const data = await backupData(source),
      key = randomBytes(32).toString("hex"),
      encoded = encodeBackup(data, key);
    assert(!encoded.includes(Buffer.from("salt:hash")));
    const bad = Buffer.from(encoded);
    bad[bad.length - 1] ^= 1;
    assert.throws(() => decodeBackup(bad, key));
    assert.throws(() => decodeBackup(encoded, randomBytes(32).toString("hex")));
    await restoreData(target, decodeBackup(encoded, key));
    assert.equal(
      (await target.query("SELECT content FROM files WHERE record_id='r'"))
        .rows[0].content,
      "cHJlc2VydmVk",
    );
    assert.equal(
      (await target.query("SELECT actor_name FROM events WHERE id='e'")).rows[0]
        .actor_name,
      "Admin",
    );
    assert.equal((await target.query("SELECT * FROM sessions")).rows.length, 0);
    await assert.rejects(() => restoreData(target, data), /empty database/);
  } finally {
    await source.close();
    await target.close();
  }
});
