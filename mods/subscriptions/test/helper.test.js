import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const helper = resolve("mods/subscriptions/helpers/codex-limits.py");
const candidates = process.env.PYTHON
  ? [[process.env.PYTHON]]
  : process.platform === "win32" ? [["python"], ["py", "-3"], ["python3"]] : [["python3"], ["python"]];
const python = candidates.find(([bin, ...args]) =>
  spawnSync(bin, [...args, "-c", "import sys; sys.exit(sys.version_info.major != 3)"], { timeout: 5000 }).status === 0);
assert.ok(python, "Python 3 is required to test the helper (or set PYTHON to its executable)");

function runPython(args, options = {}) {
  const [bin, ...prefix] = python;
  return spawnSync(bin, [...prefix, ...args], { encoding: "utf8", timeout: 22000, ...options });
}

function runHelper(cli, options = {}) {
  return runPython([helper], {
    // Deliberately hostile stream defaults: the helper must configure UTF-8.
    env: { ...process.env, PYTHONIOENCODING: "ascii", HERDR_SUBSCRIPTIONS_CODEX_BIN: cli },
    ...options,
  });
}

async function withFake(source, check) {
  const dir = await mkdtemp(join(tmpdir(), "herdr subscriptions test-"));
  const cli = join(dir, "fake codex.py");
  try {
    await writeFile(cli, `import json, os, sys, time
assert sys.argv[1:] == ["app-server"]
with open(os.path.join(os.path.dirname(__file__), "pid"), "w") as f:
    f.write(str(os.getpid()))
${source}\n`);
    const result = runHelper(cli);
    assert.equal(result.error, undefined, String(result.error));
    const pid = Number(await readFile(join(dir, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "helper must reap its app-server");
    await check(result);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("helper initializes, ignores malformed noise, queries once and cleans up a Python app-server", async () => {
  await withFake(`
req = json.loads(sys.stdin.readline())
assert req["id"] == 1 and req["method"] == "initialize"
assert req["params"]["clientInfo"]["name"] == "herdr-subscriptions"
# Include invalid UTF-8, non-JSON, non-object JSON and a premature reply.
sys.stdout.buffer.write(b'\\xff\\nnot-json\\n[]\\n{"id":2,"result":{}}\\n')
sys.stdout.buffer.flush()
# Fragment an initialize response across pipe reads.
sys.stdout.write('{"id":1,')
sys.stdout.flush()
time.sleep(0.05)
print('"result":{}}', flush=True)
assert json.loads(sys.stdin.readline()) == {"method": "initialized"}
assert json.loads(sys.stdin.readline()) == {"id": 2, "method": "account/rateLimits/read", "params": {}}
print(json.dumps({"id": 2, "result": {"rateLimits": {"primary": {"usedPercent": 42}}}}), flush=True)
# Stay alive until the helper terminates us; no duplicate queries are allowed.
assert sys.stdin.readline() == ""
`, (result) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).result.rateLimits.primary.usedPercent, 42);
  });
});

test("helper reports missing CLI and missing Python override in UTF-8", () => {
  for (const name of ["codex", "codex.py"]) {
    const result = runHelper(join(tmpdir(), "herdr-nonexistent-directory", name));
    assert.equal(result.error, undefined);
    assert.equal(result.status, 127);
    assert.match(result.stderr, /未找到 Codex/);
    assert.doesNotMatch(result.stderr, /Traceback/);
  }
});

test("helper handles malformed output followed by EOF", async () => {
  await withFake(`
sys.stdin.readline()
print('not-json\\nnull\\n{"id":', flush=True)
`, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Codex app-server 已退出/);
    assert.doesNotMatch(result.stderr, /Traceback/);
  });
});

test("helper reports initialization errors without querying", async () => {
  await withFake(`
sys.stdin.readline()
print(json.dumps({"id": 1, "error": {"message": "初始化被拒绝"}}, ensure_ascii=True), flush=True)
assert sys.stdin.readline() == ""
`, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /初始化被拒绝/);
  });
});

test("helper bounds output, including a stream of complete lines", async () => {
  await withFake(`
sys.stdin.readline()
sys.stdout.write('[]\\n' * (1024 * 1024))
sys.stdout.flush()
time.sleep(60)
`, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Codex 响应过大/);
  });
});

test("helper times out a silent app-server after 15 seconds and cleans up", async () => {
  const start = performance.now();
  await withFake(`
sys.stdin.readline()
time.sleep(60)
`, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /超时（15 秒）/);
    assert.ok(performance.now() - start >= 15000);
    assert.ok(performance.now() - start < 21000);
  });
});

test("Windows npm shim resolution uses Node directly and rejects unknown batch wrappers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "herdr npm & spaces-"));
  try {
    const entry = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(join(dir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    await writeFile(entry, "");
    await writeFile(join(dir, "node.exe"), "");
    const result = runPython(["-c", `
import os, runpy, sys
from unittest.mock import patch
module = runpy.run_path(sys.argv[1])
dir = sys.argv[2]
# Test the Windows branch on every host without executing a batch file.
with patch.object(os, "name", "nt"), patch.dict(os.environ, {"HERDR_SUBSCRIPTIONS_CODEX_BIN": "codex"}):
    with patch("shutil.which", return_value=os.path.join(dir, "codex.cmd")):
        assert module["command"]() == [os.path.join(dir, "node.exe"), os.path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"), "app-server"]
    with patch("shutil.which", return_value=os.path.join(dir, "untrusted.cmd")):
        try:
            module["command"]()
        except RuntimeError:
            pass
        else:
            raise AssertionError("must reject unknown batch shims")
`, helper, dir]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
