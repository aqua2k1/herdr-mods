import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directory, PER_FOLDER, TOTAL } from "../lib/directory.js";

function mock(platform, response) {
  const calls = [];
  return { calls, dependencies: { platform, exec: async (...args) => {
    calls.push(args);
    return response(...args);
  } } };
}
test("limits and POSIX NUL transport retain literal names, order and routing", async () => {
  assert.equal(PER_FOLDER, 500);
  assert.equal(TOTAL, 5000);
  const f = mock("windows", () => ({ code: 0, stdout: "d\0中文\n目录\0f\0a\\b\t ' $()\0" }));
  assert.deepEqual(await directory("/a ' $(no)", "linuxvm", f.dependencies),
    [{ name: "中文\n目录", dir: true }, { name: "a\\b\t ' $()", dir: false }]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "sh");
  assert.equal(f.calls[0][1].at(-1), "/a ' $(no)");
  assert.deepEqual(f.calls[0][2], { on: "linuxvm" });
});

test("Windows uses LiteralPath, UTF-8, quote doubling and native link checks", async () => {
  const path = "C:\\中文 [x] O'Brien ‘quoted’ ‚low‛ $()";
  for (const stdout of ["", "[]", '{"name":"中文😀","dir":false}', '[{"name":"link","dir":true}]']) {
    const f = mock("windows", () => ({ code: 0, stdout }));
    const expected = stdout ? JSON.parse(stdout) : [];
    assert.deepEqual(await directory(path, null, f.dependencies), Array.isArray(expected) ? expected : [expected]);
    const [command, args, options] = f.calls[0];
    assert.equal(command, "powershell");
    assert.deepEqual(options, { on: null });
    assert.deepEqual(args.slice(0, 2), ["-NoProfile", "-Command"]);
    const script = args[2];
    for (const fragment of ["[Console]::OutputEncoding", "UTF8Encoding", "-LiteralPath $p", "-Force",
      "Select-Object -First 501", "ReparsePoint", "$_.LinkType", "$_.Target[0]", "[IO.Directory]::Exists"]) {
      assert.ok(script.includes(fragment), fragment);
    }
    assert.ok(script.endsWith("'" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"));
  }
});

test("only missing remote sh triggers PowerShell fallback on the same machine", async () => {
  const f = mock("linux", command => {
    if (command === "sh") throw new Error("herdr.exec: cannot start sh: program not found");
    return { code: 0, stdout: '{"name":"中文","dir":true}' };
  });
  assert.deepEqual(await directory("C:/folder", "winvm", f.dependencies), [{ name: "中文", dir: true }]);
  assert.deepEqual(f.calls.map(([cmd, , opts]) => [cmd, opts.on]), [["sh", "winvm"], ["powershell", "winvm"]]);
});

test("failures are propagated rather than masked by fallback", async () => {
  for (const [on, failure, expected] of [
    ["vm", new Error("connection lost"), "connection lost"],
    ["vm", new Error("cannot start sh: permission denied"), "permission denied"],
    [null, new Error("cannot start sh: program not found"), "program not found"],
    ["vm", { code: 1, stderr: "denied" }, "denied"],
    [null, { code: 1, stderr: "" }, "Cannot list this folder"],
  ]) {
    const f = mock("linux", () => { if (failure instanceof Error) throw failure; return failure; });
    await assert.rejects(directory("/root", on, f.dependencies), new RegExp(expected));
    assert.equal(f.calls.length, 1);
  }
  const f = mock("windows", () => ({ code: 1, stderr: "Windows denied" }));
  await assert.rejects(directory("C:/root", null, f.dependencies), /Windows denied/);
  const invalid = mock("windows", () => ({ code: 0, stdout: "invalid json" }));
  await assert.rejects(directory("C:/root", null, invalid.dependencies), SyntaxError);
});

const run = promisify(execFile);
const realDependencies = { platform: "linux", exec: async (command, args) => {
  try {
    const { stdout, stderr } = await run(command, args, { encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (e) {
    if (typeof e.code !== "number") throw e;
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
} };

test("Linux real enumeration: literal paths, Unicode, hidden names, symlinks and NUL framing", { skip: process.platform !== "linux" }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "files-plus-"));
  const root = join(temp, "O'Brien ‘中文’ [*] $(touch INJECTED);");
  try {
    await mkdir(root);
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "目录"));
    const files = ["a\\b", "line\nbreak", "tab\tfile", "-dash", ".hidden", "..hidden", "中文😀.txt", "'\"$();[*]"];
    await Promise.all(files.map(name => writeFile(join(root, name), "")));
    await writeFile(join(root, "目录", "child.txt"), "hello");
    await symlink("目录", join(root, "dir-link"));
    await symlink("a\\b", join(root, "file-link"));
    await symlink("missing", join(root, "dangling"));
    await symlink(".", join(root, "cycle"));
    const actual = await directory(root, null, realDependencies);
    const expected = [
      ...files.map(name => ({ name, dir: false })),
      { name: "目录", dir: true }, { name: "dir-link", dir: true },
      { name: "file-link", dir: false }, { name: "dangling", dir: false }, { name: "cycle", dir: true },
    ];
    const sort = entries => entries.sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(sort(actual), sort(expected));
    assert.deepEqual(await directory(join(root, "dir-link"), null, realDependencies), [{ name: "child.txt", dir: false }]);
    await mkdir(join(root, "empty"));
    assert.deepEqual(await directory(join(root, "empty"), null, realDependencies), []);
    await assert.rejects(directory(join(root, "missing"), null, realDependencies));
    await assert.rejects(directory(join(root, "a\\b"), null, realDependencies));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("Linux real enumeration returns at most 500+1, not a truncated 500", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "files-plus-limit-"));
  try {
    await mkdir(join(root, ".git"));
    await Promise.all(Array.from({ length: 500 }, (_, i) => writeFile(join(root, String(i).padStart(4, "0")), "")));
    assert.equal((await directory(root, null, realDependencies)).length, 500);
    await writeFile(join(root, "extra"), "");
    assert.equal((await directory(root, null, realDependencies)).length, 501);
    await writeFile(join(root, "extra2"), "");
    const entries = await directory(root, null, realDependencies);
    assert.equal(entries.length, 501);
    assert.ok(entries.every(entry => entry.name !== ".git"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
