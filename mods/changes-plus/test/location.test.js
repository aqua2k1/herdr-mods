import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocation, locationKey, joinPath, machineFor } from "../lib/location.js";

const spaces = [{ id: "inactive", active: false }, { id: "s", active: true, folder: "/space", machine: "vm" }];
const panes = [{ pane: "p", cwd: "/pane" }];
test("snapshot arrays/objects retain native pane, focus, space precedence", () => {
  const input = { spaces, panes, focused: { pane: "p", cwd: "/focus" } };
  assert.deepEqual(resolveLocation(input), { root: "/pane", on: "vm", file: null, space: "s" });
  assert.equal(resolveLocation({ ...input, panes: [] }).root, "/focus");
  assert.equal(resolveLocation({ spaces, panes, focused: { pane: "mod", cwd: "" } }).root, "/space");
  assert.deepEqual(resolveLocation(), { root: undefined, on: null, file: null, space: undefined });
  assert.equal(resolveLocation({ spaces }).on, "vm");
});

test("layout terminal routing is independent of the active space machine", () => {
  for (const [terminal, on] of [["remote/term/extra", "remote"], ["local", null], [null, null]]) {
    assert.deepEqual(resolveLocation({ spaces, panes, focused: { pane: null, terminal, cwd: "/terminal" } }),
      { root: "/terminal", on, file: null, space: "s" });
  }
});

test("explicit props pin root, machine and file regardless of focus", () => {
  const props = { root: "C:\\固定", on: "win", file: "中文.txt" };
  const fixed = resolveLocation({ spaces, panes, focused: { pane: "p" }, props });
  assert.deepEqual(fixed, { ...props, space: null });
  assert.deepEqual(resolveLocation({ props }), fixed);
  assert.deepEqual(resolveLocation({ spaces, props: { root: "/fixed" } }),
    { root: "/fixed", on: null, file: null, space: null });
  assert.equal(resolveLocation({ spaces, props: { root: "" } }).root, "");
  assert.equal(resolveLocation({ spaces, props: { on: "ignored", file: "ignored" } }).root, "/space");
});

test("identity is stable across field order and distinguishes machines, spaces and files", () => {
  const loc = { root: "/root", on: null, file: null, space: "s" };
  assert.equal(locationKey(loc), locationKey({ space: "s", file: null, on: null, root: "/root" }));
  for (const change of [{ root: "/Root" }, { on: "vm" }, { file: "a" }, { space: "other" }]) {
    assert.notEqual(locationKey(loc), locationKey({ ...loc, ...change }));
  }
  assert.notEqual(locationKey({ root: "/a\\b" }), locationKey({ root: "/a/b" }));
});

test("a POSIX folder routes to its machine when focus has no pane", () => {
  const spaces = [
    { id: "local", machine: null, folder: "C:\\Users\\me" },
    { id: "remote", machine: "wsl-arch", folder: "/home/me/project" },
  ];
  assert.equal(machineFor("/home/me/project/src", { pane: null, terminal: "wsl-arch/t3" }, spaces), "wsl-arch");
  assert.equal(machineFor("/home/me/project/src", { pane: null, terminal: "t3" }, spaces), "wsl-arch");
  assert.equal(machineFor("/home/me/other", { pane: "p1", terminal: "t3" }, spaces), null);
  assert.equal(machineFor("C:\\Users\\me", { pane: null, terminal: "t3" }, spaces), null);
});

test("join paths without rewriting Unix backslashes or normalizing filenames", () => {
  for (const [root, relative, expected] of [
    ["/", "a", "/a"], ["/root///", "a", "/root/a"],
    ["/root\\", "a\\b", "/root\\/a\\b"], ["/root", "dir/a\\b", "/root/dir/a\\b"],
    ["C:\\", "a", "C:\\a"], ["C:\\root\\", "dir/a", "C:\\root\\dir/a"],
    ["C:/root/", "a", "C:/root/a"], ["\\\\server\\share\\", "a", "\\\\server\\share\\a"],
    ["/root", "", "/root"], ["", "a\\b", "a\\b"], ["/root", "../a", "/root/../a"],
  ]) assert.equal(joinPath(root, relative), expected);
});
