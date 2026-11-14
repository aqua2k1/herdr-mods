import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "../mods/subscriptions/providers/codex.js";

// Explicitly opt-in: uses your locally signed-in Codex account. No model turn.
const helper = fileURLToPath(new URL("../mods/subscriptions/helpers/codex-limits.py", import.meta.url));
const response = spawnSync("python3", [helper], { encoding: "utf8", timeout: 20000 });
assert.equal(response.status, 0, response.error?.message || response.stderr);
const snapshot = parse(response.stdout);
assert.ok(snapshot.quotas.length > 0, "Expected at least one actual quota");
assert.ok(Number.isFinite(snapshot.observedAt));
for (const quota of snapshot.quotas) {
  assert.equal(typeof quota.id, "string");
  assert.ok(Number.isFinite(quota.usedPercent));
  assert.ok(quota.usedPercent >= 0, "Usage must be non-negative");
  if (quota.resetsAt !== null) assert.ok(Number.isFinite(quota.resetsAt));
}
// Print only normalized display fields, not raw account identifiers or credits.
console.log(JSON.stringify(snapshot, null, 2));
