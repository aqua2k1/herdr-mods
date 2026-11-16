import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMITS_PER_PAGE, logArgs, commitFilesArgs, commitDiffArgs, parseLog, parseCommitFiles,
  timeAgo, githubRepo, groupCommits, upstreamArgs, defaultBranchArgs, mergeBaseArgs,
} from "../lib/commits.js";

test("log and show commands read history without fetching", () => {
  assert.deepEqual(logArgs(50, 5).slice(0, 2), ["log", "--no-color"]);
  assert.ok(logArgs(50, 5).includes("--skip"));
  assert.deepEqual(upstreamArgs(), ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  assert.deepEqual(defaultBranchArgs(), ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  assert.deepEqual(mergeBaseArgs("@{u}"), ["merge-base", "HEAD", "@{u}"]);
  assert.ok(commitFilesArgs("abc", "--numstat").includes("--numstat"));
  const full = commitDiffArgs({ hash: "abc", path: "src/a.ts", full: true });
  assert.ok(full.includes("abc"));
  assert.ok(full.includes("--unified=2000"));
  assert.deepEqual(full.slice(-3), ["abc", "--", "src/a.ts"]);
  assert.equal(commitDiffArgs({ hash: "abc", path: "f" }).includes("--unified=2000"), false);
  assert.equal(COMMITS_PER_PAGE, 50);
});

test("git log records parse into commits with author, age and body", () => {
  const text = "\n" + ["h1", "short1", "Ann", "a@x", "1000", "first", "body one"].join("\0") + "\x1e" +
    "\n" + ["h2", "short2", "Bob", "b@x", "2000", "second", ""].join("\0") + "\x1e";
  const commits = parseLog(text);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], { hash: "h1", short: "short1", author: "Ann", email: "a@x", at: 1000, subject: "first", body: "body one" });
  assert.equal(commits[1].body, "");
});

test("commit files combine numstat counts with name-status letters", () => {
  const files = parseCommitFiles("2\t1\tsrc/a.ts\0-\t-\tlogo.png\0", "M\0src/a.ts\0A\0logo.png\0");
  assert.deepEqual(files[0], { path: "src/a.ts", add: 2, del: 1, binary: false, status: "M" });
  assert.deepEqual(files[1], { path: "logo.png", add: 0, del: 0, binary: true, status: "A" });
});

test("without a comparison ref there is one branch group with Load more", () => {
  const commits = [{ hash: "a" }, { hash: "b" }];
  assert.deepEqual(groupCommits({ commits, remote: null, done: false }), [{
    scope: "branch", label: "HEAD", count: "2+", detail: null, commits, withMore: true,
  }]);
});

test("an unpushed branch splits into local and remote groups", () => {
  const commits = [{ hash: "a" }, { hash: "b" }, { hash: "c" }];
  const remote = { ref: "@{u}", name: "origin/main", unpushed: new Set(["a"]) };
  const groups = groupCommits({ commits, remote, behind: 2, branch: "main", done: true });
  assert.deepEqual(groups.map(g => [g.scope, g.count]), [["branch", 1], ["remote", "2"]]);
  assert.deepEqual(groups[0].commits.map(c => c.hash), ["a"]);
  assert.deepEqual(groups[1].commits.map(c => c.hash), ["b", "c"]);
  assert.equal(groups[1].detail, "2 not pulled");
});

test("a feature branch adds a third origin/HEAD group", () => {
  const commits = [{ hash: "a" }, { hash: "b" }, { hash: "c" }, { hash: "d" }];
  const remote = { ref: "@{u}", name: "origin/feature", unpushed: new Set(["a"]) };
  const remoteHead = {
    name: "origin/HEAD", target: "origin/main", behind: 3,
    ahead: new Set(["b", "c"]),
  };
  const groups = groupCommits({ commits, remote, remoteHead, behind: 1, branch: "feature", done: false });
  assert.deepEqual(groups.map(g => g.scope), ["branch", "remote", "default"]);
  assert.deepEqual(groups[1].commits.map(c => c.hash), ["b", "c"]);
  assert.equal(groups[1].detail, "1 not pulled");
  assert.deepEqual(groups[2].commits.map(c => c.hash), ["d"]);
  assert.equal(groups[2].detail, "origin/main · 3 not pulled");
  assert.equal(groups[2].count, "1+");
});

test("age and GitHub remote parsing", () => {
  const now = 2_000_000;
  assert.equal(timeAgo(now - 3600, now), "1h ago");
  assert.equal(timeAgo(now - 30, now), "just now");
  assert.equal(githubRepo("git@github.com:aqua2k1/herdr-mods.git"), "aqua2k1/herdr-mods");
  assert.equal(githubRepo("https://example.com/a/b.git"), null);
});
