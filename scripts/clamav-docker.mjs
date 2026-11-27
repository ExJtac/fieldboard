#!/usr/bin/env node
// Optional native-host bridge to an existing maintained ClamAV container.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const container = process.env.CLAMAV_CONTAINER || "fieldboard-scanner";
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container))
  throw new Error("Invalid scanner container name");
const source = process.argv.at(-1),
  target = "/tmp/fieldboard-" + randomUUID();
let result = 2;
try {
  execFileSync("docker", ["cp", source, `${container}:${target}`], {
    stdio: "pipe",
  });
  execFileSync(
    "docker",
    ["exec", container, "clamscan", "--no-summary", target],
    { stdio: "pipe", timeout: 25000 },
  );
  result = 0;
} catch (e) {
  result = e.status || 2;
} finally {
  try {
    execFileSync("docker", ["exec", container, "rm", "-f", target], {
      stdio: "pipe",
    });
  } catch {
    result = 2;
  }
}
process.exit(result);
