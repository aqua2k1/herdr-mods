import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Antigravity helper: headless command, whitelist, failures, timeout and cleanup", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3",
    ["-X", "utf8", fileURLToPath(new URL("./agy-usage.py", import.meta.url))],
    { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
