import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("DeepSeek helper: request, missing key, sanitized errors, timeout and malformed response", () => {
  const result = spawnSync("python3",
    [fileURLToPath(new URL("./deepseek-helper.py", import.meta.url))],
    { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
