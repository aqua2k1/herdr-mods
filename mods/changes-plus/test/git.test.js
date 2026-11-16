import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS, statusArgs, headArgs, topLevelArgs, numstatArgs, diffArgs,
  parseNumstat, mergeStats, parseStatus, groupFiles, diffRows, untrackedLines, limitLines,
} from "../lib/git.js";

test("Git reads never write under .git and keep remote routing to the caller", () => {
  assert.deepEqual(statusArgs(), ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  assert.deepEqual(headArgs(), ["rev-parse", "--verify", "HEAD"]);
  assert.deepEqual(topLevelArgs(), ["rev-parse", "--show-toplevel"]);
  assert.deepEqual(numstatArgs(true), [["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "diff", "HEAD", "--numstat", "-z", "--no-renames"]]);
  assert.equal(numstatArgs(false).length, 2);
  const args = diffArgs({ hasHead: true, path: "src/a b.ts", full: true });
  assert.ok(args.includes("HEAD"));
  assert.ok(args.includes("--unified=2000"));
  assert.ok(args.includes("--no-ext-diff"));
  assert.deepEqual(args.slice(-2), ["--", "src/a b.ts"]);
  assert.equal(diffArgs({ hasHead: false, path: "f" }).includes("HEAD"), false);
});

test("numstat merges cached and working counts before the first commit", () => {
  const first = parseNumstat("2\t1\tREADME.md\0-\t-\tlogo.png\0");
  assert.deepEqual(first, {
    "README.md": { add: 2, del: 1, binary: false },
    "logo.png": { add: 0, del: 0, binary: true },
  });
  const second = parseNumstat("3\t0\tREADME.md\0");
  mergeStats(first, second);
  assert.deepEqual(first["README.md"], { add: 5, del: 1, binary: false });
  assert.equal(first["logo.png"].binary, true);
});

test("status keeps native letters and marks conflicts and untracked files", () => {
  const stats = { "src/a.ts": { add: 4, del: 2 }, "new.ts": { add: 3, del: 0 } };
  const { files, limited } = parseStatus(" M src/a.ts\0?? new.ts\0UU both.ts\0 D gone.ts\0A  made.ts\0", stats, true);
  assert.deepEqual(files.map(f => [f.path, f.status]), [
    ["src/a.ts", "M"], ["new.ts", "A"], ["both.ts", "U"], ["gone.ts", "D"], ["made.ts", "A"],
  ]);
  assert.equal(files[0].add, 4);
  assert.equal(files[1].fresh, true);
  assert.equal(files[2].conflict, true);
  assert.equal(files[4].hasHead, true);
  assert.equal(limited, false);
  assert.equal(parseStatus(Array.from({ length: LIMITS.files + 1 }, (_, i) => `?? f${i}`).join("\0"), {}, true).limited, true);
});

test("grouping shows only non-empty sections in native state order", () => {
  const files = [
    { path: "z.ts", status: "M" }, { path: "u.ts", status: "U", conflict: true },
    { path: "n.ts", status: "A", fresh: true }, { path: "a.ts", status: "M" },
  ];
  const groups = groupFiles(files);
  assert.deepEqual(groups.map(g => g.key), ["conflicts", "changed", "untracked"]);
  assert.deepEqual(groups[1].files.map(f => f.path), ["a.ts", "z.ts"]);
  assert.deepEqual(groupFiles([{ path: "m.ts", status: "M" }]).map(g => g.key), ["changed"]);
});

test("unified rows number old and new lines separately", () => {
  const rows = diffRows(["@@ -10,2 +12,3 @@", " keep", "-old", "+new", "+extra", "\\ No newline"]);
  assert.deepEqual(rows[0], { kind: "@", text: "@@ -10,2 +12,3 @@" });
  assert.deepEqual(rows[1], { kind: " ", oldNo: 10, newNo: 12, text: "keep" });
  assert.deepEqual(rows[2], { kind: "-", oldNo: 11, newNo: null, text: "old" });
  assert.deepEqual(rows[3], { kind: "+", oldNo: null, newNo: 13, text: "new" });
  assert.deepEqual(rows[4], { kind: "+", oldNo: null, newNo: 14, text: "extra" });
  assert.deepEqual(rows[5], { kind: "", oldNo: null, newNo: null, text: "\\ No newline" });
});

test("untracked files become one all-added hunk and output stays bounded", () => {
  assert.deepEqual(untrackedLines("a\nb\n"), ["@@ -0,0 +1,2 @@", "+a", "+b"]);
  assert.deepEqual(untrackedLines(""), ["@@ -0,0 +1,0 @@", "+"]);
  const long = Array.from({ length: LIMITS.lines + 5 }, (_, i) => `line ${i}`);
  assert.equal(limitLines(long).length, LIMITS.lines);
  assert.ok(limitLines(["x".repeat(LIMITS.line + 10)])[0].endsWith("… (line truncated)"));
});
