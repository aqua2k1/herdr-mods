import test from "node:test";
import assert from "node:assert/strict";
import { pythonRunner } from "../lib/python.js";

test("Python interpreter discovery is cached and shared by concurrent calls", async () => {
  const calls = [];
  const run = pythonRunner(async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: args[0] === "-c" ? "herdr-python-ok\n" : "{}" };
  });
  await Promise.all([run(["helper.py", "status"], { timeout: 123 }), run(["balance.py"])]);
  assert.equal(calls.filter(c => c.args[0] === "-c").length, 1);
  assert.deepEqual(calls[1], { command: "python3", args: ["helper.py", "status"], options: { timeout: 123 } });
});

test("Windows launcher fallback uses py -3 and preserves paths with spaces", async () => {
  const calls = [];
  const run = pythonRunner(async (command, args) => {
    calls.push([command, args]);
    if (command === "python3") throw new Error("not found");
    if (command === "python") return { code: 9009, stdout: "Store alias" };
    return { code: 0, stdout: args.includes("-c") ? "herdr-python-ok\n" : "done" };
  });
  const args = ["C:\\Users\\Test User\\credentials.py", "C:\\Users\\Test User", "status"];
  assert.equal((await run(args)).stdout, "done");
  assert.deepEqual(calls.at(-1), ["py", ["-3", ...args]]);
});

test("failed helper operations are never retried with another interpreter", async () => {
  const calls = [];
  const run = pythonRunner(async (command, args) => {
    calls.push(command);
    return args[0] === "-c" ? { code: 0, stdout: "herdr-python-ok" } : { code: 1, stdout: "" };
  });
  assert.equal((await run(["credentials.py", "commit"])).code, 1);
  assert.deepEqual(calls, ["python3", "python3"]);
});

test("missing or unsupported Python produces a safe actionable error and can recover", async () => {
  let installed = false;
  const run = pythonRunner(async () => ({ code: 0, stdout: installed ? "herdr-python-ok" : "unsupported" }));
  await assert.rejects(run(["credentials.py"]), /Python 3.9\+/);
  installed = true;
  assert.equal((await run(["credentials.py"])).code, 0);
});
