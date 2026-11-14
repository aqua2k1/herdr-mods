import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { credentialService, initialCredentialState, credentialOperation } from "../lib/credentials.js";
import { PythonUnavailableError } from "../lib/python.js";

test("Python credential store: modes, atomic updates, deletion, fallback, traversal and secret safety", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", [fileURLToPath(new URL("./credentials-store.py", import.meta.url))],
    { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

function fakeTransport({ failWrite = false } = {}) {
  const calls = [], writes = [];
  return {
    calls, writes,
    appHome: () => "/private/herdr",
    exec: async (command, args) => {
      if (args[0] === "-c") return { code: 0, stdout: "herdr-python-ok\n" };
      calls.push({ command, args });
      const action = args[2];
      const result = action === "prepare" ? { token: ".deepseek-api-test.pending" } :
        action === "status" ? { configured: true, source: "file" } : { ok: true };
      return { code: 0, stdout: JSON.stringify(result) };
    },
    writeFile: async (...args) => { writes.push(args); if (failWrite) throw new Error("sensitive raw error"); },
  };
}
const credential = { id: "deepseek-api", env: "DEEPSEEK_API_KEY" };

test("secret only reaches private draft write, never exec arguments", async () => {
  const transport = fakeTransport();
  const service = credentialService(transport);
  await service.save(credential, "test-only-key");
  assert.equal(transport.writes[0][1], "test-only-key");
  assert.equal(transport.writes[0].length, 2);
  assert.equal(JSON.stringify(transport.calls).includes("test-only-key"), false);
  assert.deepEqual(transport.calls.map(c => c.args[2]), ["prepare", "commit", "discard"]);
});
test("failed write discards pending file and does not expose raw errors", async () => {
  const transport = fakeTransport({ failWrite: true });
  await assert.rejects(credentialService(transport).save(credential, "test-only-key"), /保存凭据失败/);
  assert.deepEqual(transport.calls.map(c => c.args[2]), ["prepare", "discard"]);
});
test("rejects invalid input before creating any file", async () => {
  const transport = fakeTransport();
  for (const input of ["", "abc\ndef", "a b", "x".repeat(8193)]) {
    await assert.rejects(credentialService(transport).save(credential, input));
  }
  assert.equal(transport.calls.length, 0);
});
test("credential state sanitizes errors and deduplicates operations", async () => {
  const state = initialCredentialState();
  let finish;
  const pending = credentialOperation(state, () => new Promise(r => { finish = r; }), () => {});
  assert.equal(await credentialOperation(state, async () => assert.fail(), () => {}), false);
  finish();
  assert.equal(await pending, true);
  await credentialOperation(state, async () => { throw new Error("secret-value"); }, () => {});
  assert.equal(state.error.includes("secret-value"), false);
  assert.equal(state.busy, false);
  await credentialOperation(state, async () => { throw new PythonUnavailableError(); }, () => {});
  assert.match(state.error, /Python 3.9\+/);
});
