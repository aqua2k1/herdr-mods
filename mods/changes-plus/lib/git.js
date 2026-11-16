// Pure Git-result parsing for Changes Plus. No host APIs here, so the grouping
// and diff-numbering rules can be tested with node:test. Native Changes does the
// reading; these are the same commands and parsing, split out from rendering.

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const LIMITS = { files: 1000, lines: 1500, line: 4000 };

export const countLines = text => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

export const statusArgs = () => ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
export const headArgs = () => ["rev-parse", "--verify", "HEAD"];
export const topLevelArgs = () => ["rev-parse", "--show-toplevel"];

export function numstatArgs(hasHead) {
  return hasHead
    ? [[...READ, "diff", "HEAD", "--numstat", "-z", "--no-renames"]]
    : [
        [...READ, "diff", "--cached", "--numstat", "-z", "--no-renames"],
        [...READ, "diff", "--numstat", "-z", "--no-renames"],
      ];
}

export function diffArgs({ hasHead, path, full = false }) {
  return [
    ...READ, "diff", ...(hasHead ? ["HEAD"] : []),
    ...(full ? ["--unified=2000"] : []),
    "--no-ext-diff", "--no-textconv", "--no-color", "--", path,
  ];
}

// Before the first commit the cached and working-tree numstats can name the
// same file; native Changes adds both instead of replacing them.
export function mergeStats(target, source) {
  for (const [path, stat] of Object.entries(source)) {
    const old = target[path] ?? { add: 0, del: 0 };
    target[path] = {
      add: old.add + stat.add,
      del: old.del + stat.del,
      binary: Boolean(old.binary || stat.binary),
    };
  }
  return target;
}

export function parseNumstat(stdout) {
  const stats = {};
  for (const entry of stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = {
      add: old.add + (Number(a) || 0),
      del: old.del + (Number(d) || 0),
      binary: a === "-" || Boolean(old.binary),
    };
  }
  return stats;
}

export function parseStatus(stdout, stats, hasHead) {
  const files = [];
  const entries = stdout.split("\0").filter(Boolean);
  for (const entry of entries.slice(0, LIMITS.files)) {
    const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
    const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
    const status = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
    const stat = stats[path] ?? { add: 0, del: 0 };
    files.push({ path, status, fresh, conflict, hasHead, ...stat });
  }
  return { files, limited: entries.length > LIMITS.files };
}

// Read-only grouping: the native Changes states, arranged with Better Changes'
// section headings. No staged/unstaged concept and no staging actions.
export function groupFiles(files) {
  const groups = [
    { key: "conflicts", label: "Conflicts", tone: "ansi1", files: [] },
    { key: "changed", label: "Changed", tone: "accent", files: [] },
    { key: "untracked", label: "Untracked", tone: "muted", files: [] },
  ];
  for (const file of files) {
    const key = file.conflict ? "conflicts" : file.fresh ? "untracked" : "changed";
    groups.find(group => group.key === key).files.push(file);
  }
  for (const group of groups) group.files.sort((a, b) => a.path.localeCompare(b.path));
  return groups.filter(group => group.files.length);
}

// Numbers each unified row once, old and new separately, so a frame only draws
// the rows on screen and both gutter columns show the real file line numbers.
export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map(line => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (match) {
      old = Number(match[1]); next = Number(match[2]);
      return { kind: "@", text: line };
    }
    const kind = line[0];
    const text = line.slice(1) || " ";
    if (kind === "-") return { kind, oldNo: old++, newNo: null, text };
    if (kind === "+") return { kind, oldNo: null, newNo: next++, text };
    if (kind === " ") { const oldNo = old++; return { kind, oldNo, newNo: next++, text }; }
    return { kind: "", oldNo: null, newNo: null, text: line };
  });
}

// An untracked file has no Git diff, so it is shown as one added hunk.
export function untrackedLines(text) {
  const clean = text.slice(0, 400000).replace(/\n$/, "");
  return [`@@ -0,0 +1,${countLines(text)} @@`, ...clean.split("\n").map(line => `+${line}`)];
}

export function limitLines(lines) {
  return lines.slice(0, LIMITS.lines).map(line =>
    line.length > LIMITS.line ? line.slice(0, LIMITS.line) + "… (line truncated)" : line);
}
