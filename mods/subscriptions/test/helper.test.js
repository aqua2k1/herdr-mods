import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("helper initializes, queries once and cleans up a fake app-server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "herdr-subscriptions-test-"));
  const cli = join(dir, "fake-codex");
  try {
    await writeFile(cli, `#!/usr/bin/env python3
import json, sys
assert sys.argv[1:] == ["app-server"]
for line in sys.stdin:
    req = json.loads(line)
    if req["method"] == "initialize":
        print(json.dumps({"id": 1, "result": {}}), flush=True)
    elif req["method"] == "initialized":
        pass
    elif req["method"] == "account/rateLimits/read":
        print(json.dumps({"id": 2, "result": {"rateLimits": {"primary": {"usedPercent": 42}}}}), flush=True)
    else:
        raise RuntimeError("unexpected method")
`, { mode: 0o755 });
    const result = spawnSync("python3", ["mods/subscriptions/helpers/codex-limits.py"], {
      env: { ...process.env, HERDR_SUBSCRIPTIONS_CODEX_BIN: cli }, encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).result.rateLimits.primary.usedPercent, 42);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("helper reports missing CLI", () => {
  const result = spawnSync("python3", ["mods/subscriptions/helpers/codex-limits.py"], {
    env: { ...process.env, HERDR_SUBSCRIPTIONS_CODEX_BIN: "/does-not-exist/codex" }, encoding: "utf8",
  });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /未找到 Codex/);
});
