// Commit history: pure Git-output parsing and Better Changes-style grouping.
// No host APIs here, so history rules can be covered by node:test.
export const COMMITS_PER_PAGE = 50;
const NO_HELPERS = ["--no-renames", "--no-ext-diff", "--no-textconv"];
const LOG_FORMAT = "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s%x00%b%x1e";

export const logArgs = (count, skip) => ["log", "--no-color", LOG_FORMAT, "-n", String(count), "--skip", String(skip)];
export const branchArgs = () => ["rev-parse", "--abbrev-ref", "HEAD"];
export const upstreamArgs = () => ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"];
export const defaultBranchArgs = () => ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"];
export const mergeBaseArgs = ref => ["merge-base", "HEAD", ref];
export const revListArgs = range => ["rev-list", range];
export const countArgs = range => ["rev-list", "--count", range];
export const originUrlArgs = () => ["remote", "get-url", "origin"];
export const commitFilesArgs = (hash, flag) =>
  ["show", "--diff-merges=first-parent", "--format=", ...NO_HELPERS, flag, "-z", hash];

// The same whole-file trick as the working-tree diff: a huge unified context
// turns a commit's diff into the whole file as it was at that commit.
export function commitDiffArgs({ hash, path, full = false }) {
  return [
    "show", "--diff-merges=first-parent", "--format=",
    ...NO_HELPERS, "--no-color", ...(full ? ["--unified=2000"] : []), hash, "--", path,
  ];
}

// git log records separated by \x1e; fields by \0: hash, short, author, email,
// unix time, subject, body. Git adds a newline after each record.
export function parseLog(text) {
  return text.split("\x1e").filter(record => record.includes("\0")).map(record => {
    const [hash, short, author, email, at, subject, body = ""] = record.replace(/^\n/, "").split("\0");
    return { hash, short, author, email, at: Number(at), subject, body: body.trim() };
  });
}

// Combine `show --numstat -z` and `show --name-status -z` for one commit.
export function parseCommitFiles(numstat, nameStatus) {
  const status = new Map();
  const fields = nameStatus.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) status.set(fields[i + 1], fields[i][0]);
  return numstat.split("\0").filter(Boolean).map(line => {
    const [add, del, path] = line.split("\t");
    const binary = add === "-";
    return { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), binary, status: status.get(path) ?? "M" };
  });
}

export function timeAgo(at, now = Date.now() / 1000) {
  const seconds = Math.max(0, now - at);
  for (const [unit, size] of [["y", 31536000], ["mo", 2592000], ["w", 604800], ["d", 86400], ["h", 3600], ["m", 60]])
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  return "just now";
}

export function githubRepo(remote) {
  const match = /^(?:(?:https?|git):\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/(?:git@)?github\.com(?::[0-9]+)?\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec((remote ?? "").trim());
  return match && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(match[1]) ? match[1] : null;
}

// `remote` is the unpushed comparison: { ref, name, unpushed:Set<string> }.
// `remoteHead` is the recorded default branch: { name, target, behind, ahead:Set }.
// Nothing here fetches; all counts come from the last fetch in the clone.
export function groupCommits({ commits, remote, remoteHead, behind, branch, done = true }) {
  const more = done ? "" : "+";
  const addGroup = (groups, group) => { if (group.commits.length) groups.push(group); };
  if (!remote) {
    return [{ scope: "branch", label: branch ?? "HEAD", count: `${commits.length}${more}`, detail: null, commits, withMore: true }];
  }
  const pushed = commits.filter(commit => !remote.unpushed.has(commit.hash));
  const groups = [];
  const notPulled = n => n ? `${n} not pulled` : null;
  const detail = (...parts) => parts.filter(Boolean).join(" · ");
  addGroup(groups, {
    scope: "branch", label: branch ?? "HEAD", count: remote.unpushed.size, detail: null,
    commits: commits.filter(commit => remote.unpushed.has(commit.hash)), withMore: false,
  });
  if (remoteHead && remoteHead.target !== remote.name) {
    addGroup(groups, {
      scope: "remote", label: remote.name, count: pushed.filter(c => remoteHead.ahead.has(c.hash)).length,
      detail: notPulled(behind), commits: pushed.filter(c => remoteHead.ahead.has(c.hash)), withMore: false,
    });
    addGroup(groups, {
      scope: "default", label: remoteHead.name,
      count: `${pushed.filter(c => !remoteHead.ahead.has(c.hash)).length}${more}`,
      detail: detail(remoteHead.target, notPulled(remoteHead.behind)),
      commits: pushed.filter(c => !remoteHead.ahead.has(c.hash)), withMore: true,
    });
    return groups;
  }
  addGroup(groups, {
    scope: "remote", label: remote.name, count: `${pushed.length}${more}`,
    detail: detail(remoteHead?.name, notPulled(behind)), commits: pushed, withMore: true,
  });
  return groups;
}
