// Real Linux GPUI integration test for Changes Plus. No production edits,
// synthetic pane model or pointer automation. Needs herdr-app, hc, a display and Git.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, cp, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const exec = promisify(execFile), pause = ms => new Promise(r => setTimeout(r, ms));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceHome = process.env.HERDR_APP_HOME || path.join(homedir(), '.config/herdr-app');
const keep = process.argv.includes('--keep');
await mkdir(path.join(homedir(), '.cache'), { recursive: true });
const root = await mkdtemp(path.join(homedir(), '.cache/changes-plus-live-'));
const fixtures = path.join(root, 'fixtures');
const home = path.join(root, 'app'), env = { ...process.env, HERDR_APP_HOME: home, HERDR_TELEMETRY: '0' };
const report = { root, fixtures, platform: process.platform, claims: 'Linux GPUI only; no Windows/macOS GUI claim', cli: [], checks: [], screenshots: [] };
let child, tab, originalTabs = [], baseline;
const json = async (name, value) => writeFile(path.join(root, name + '.json'), JSON.stringify(value, null, 2) + '\n');
async function app(...args) {
  try {
    const { stdout, stderr } = await exec('herdr-app', args, { env, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    let result = stdout.trim(); try { result = JSON.parse(result); } catch {}
    report.cli.push({ args, result, stderr });
    if (result?.error) throw new Error(JSON.stringify(result));
    return result;
  } catch (error) { report.cli.push({ args, error: error.message, stdout: error.stdout, stderr: error.stderr }); throw error; }
}
const doApp = (command, args = {}) => app('do', command, JSON.stringify(args));
const tabs = value => (value.spaces || []).flatMap(s => s.tabs || []);
async function shot(name) { const file = path.join(root, name + '.png'); await app('shot', file); report.screenshots.push(file); }
async function git(cwd, ...args) {
  const { stdout } = await exec('git', args, { cwd });
  return stdout.trim();
}
const gitAt = async (cwd, ...args) => (await exec('git', args, { cwd })).stdout.trim();
async function readState(file, serial) {
  for (let n = 0; n < 40; n++) {
    try { const state = JSON.parse(await readFile(path.join(home, file), 'utf8')); if (state.serial > (serial || 0)) return state; } catch {}
    await pause(100);
  }
  return null;
}
async function snapshot(name) {
  await doApp('changes-plus.snapshot');
  const side = await readState('driver-state.json', snapshot.serial);
  assert.ok(side?.serial > (snapshot.serial || 0), 'Sidebar snapshot not delivered'); snapshot.serial = side.serial;
  let preview = null;
  if (side.panes.some(p => p.mod === 'changes-plus' && p.tab === tab)) {
    await doApp('changes-plus.preview-snapshot');
    preview = await readState('preview-state.json', snapshot.previewSerial);
    if (preview) snapshot.previewSerial = preview.serial;
  }
  const ls = await app('ls'), status = await app('status');
  await json(name, { sidebar: side, preview, ls, status });
  assert.deepEqual(status.errors || [], [], 'Host/mod errors');
  assert.deepEqual(status.overlays || [], [], 'An overlay obstructs the visual test');
  return { state: { ...side, previewState: preview }, ls, status, panes: side.panes.filter(p => p.tab === tab) };
}
async function waitCommits() {
  for (let n = 0; n < 60; n++) {
    const s = await snapshot('latest');
    if (!s.state.commitsLoading && s.state.commits.length > 0 && s.state.historyGroups.length) return s;
    await pause(300);
  }
  throw new Error('Timed out waiting for commit history');
}
async function waitCommitFiles() {
  for (let n = 0; n < 60; n++) {
    const s = await snapshot('latest');
    if (!s.state.commitFilesLoading && s.state.commitFiles.length > 0) return s;
    await pause(300);
  }
  throw new Error('Timed out waiting for commit files');
}
async function waitPanes(count) {
  for (let n = 0; n < 50; n++) {
    const s = await snapshot('latest'); if (s.panes.length === count) return s;
    await pause(200);
  }
  throw new Error('Timed out waiting for ' + count + ' workarea panes');
}
try {
  // A real repository with a modified, an untracked and a conflicted file.
  await mkdir(path.join(fixtures, 'nested'), { recursive: true });
  await writeFile(path.join(fixtures, 'sample.txt'),
    Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  await writeFile(path.join(fixtures, 'nested', 'code.ts'), 'export const n = 1;\n');
  await git(fixtures, 'init', '-q');
  await git(fixtures, 'config', 'user.email', 'test@example.com');
  await git(fixtures, 'config', 'user.name', 'Test');
  await git(fixtures, 'add', '-A');
  await git(fixtures, 'commit', '-qm', 'base');
  // A local bare remote with the base pushed gives the Commits tab a real
  // unpushed group to read (no network, no fetch).
  const remote = path.join(root, 'remote.git');
  await gitAt(root, 'init', '--bare', '-q', remote);
  await git(fixtures, 'remote', 'add', 'origin', remote);
  const baseBranch = await git(fixtures, 'branch', '--show-current');
  await git(fixtures, 'push', '-q', '-u', 'origin', baseBranch);
  await git(fixtures, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${baseBranch}`);
  await git(fixtures, 'checkout', '-qb', 'other');
  await writeFile(path.join(fixtures, 'nested', 'code.ts'), 'export const n = 2; // incoming\n');
  await git(fixtures, 'commit', '-qam', 'other');
  await git(fixtures, 'checkout', '-q', '-');
  await writeFile(path.join(fixtures, 'nested', 'code.ts'), 'export const n = 3; // ours\n');
  await git(fixtures, 'commit', '-qam', 'ours');
  try { await git(fixtures, 'merge', 'other'); } catch { /* conflict is the fixture */ }
  // Working-tree change and untracked file added after the conflict.
  const changed = Array.from({ length: 25 }, (_, i) => i === 12 ? 'line 13 CHANGED' : `line ${i + 1}`).join('\n') + '\n';
  await writeFile(path.join(fixtures, 'sample.txt'), changed);
  await writeFile(path.join(fixtures, 'untracked.md'), '# brand new\n\nUntracked file line\n');
  const statusFixture = await git(fixtures, 'status', '--porcelain=v1');
  assert.ok(statusFixture.includes('UU nested/code.ts'), 'Conflict fixture missing');

  await mkdir(path.join(home, 'mods'), { recursive: true });
  // herdr-core restores live panes from earlier windows, including Files Plus
  // ones from other tests. Install it too so the host reports no missing mod.
  await cp(path.join(repo, 'mods/files-plus'), path.join(home, 'mods/files-plus'), { recursive: true,
    filter: p => !p.endsWith('.d.ts') && !p.endsWith('jsconfig.json') && !path.relative(path.join(repo, 'mods/files-plus'), p).split(path.sep).includes('test') });
  report.host = await app('--version');
  const userSettings = JSON.parse(await readFile(path.join(sourceHome, 'settings.json'), 'utf8'));
  report.font = userSettings.font_family || userSettings.font || 'Geist Mono';
  await writeFile(path.join(home, 'settings.json'), JSON.stringify({ ...userSettings, font: report.font, font_size: 20, sounds: { enabled: false } }));
  await writeFile(path.join(home, 'shared.json'), JSON.stringify({ 'frame.welcomed': 'finished', 'workspace.panels': ['files', 'changes'] }));
  for (const file of ['seen.json']) { try { await cp(path.join(sourceHome, file), path.join(home, file)); } catch {} }
  const install = path.join(home, 'mods/changes-plus');
  await cp(path.join(repo, 'mods/changes-plus'), install, { recursive: true,
    filter: p => !p.endsWith('.d.ts') && !p.endsWith('jsconfig.json') && !path.relative(path.join(repo, 'mods/changes-plus'), p).split(path.sep).includes('test') });
  // Host imports are sandboxed to each mod folder; keep an unmodified nested copy for inheritance.
  const driver = path.join(install, 'production');
  await cp(path.join(repo, 'mods/changes-plus'), driver, { recursive: true,
    filter: p => !p.endsWith('.d.ts') && !p.endsWith('jsconfig.json') && !path.relative(path.join(repo, 'mods/changes-plus'), p).split(path.sep).includes('test') });
  // The only test injection is a separate subclass. The copied production mod stays byte-for-byte unchanged.
  await writeFile(path.join(install, 'main.js'), `import ChangesPlus from './production/main.js';
import { groupCommits } from './production/lib/commits.js';
import { panes, focused, shared, settings, props, appHome } from 'herdr';
import * as fs from 'fs/promises';
export default class Driver extends ChangesPlus {
 command(command, cx) {
  const files = { 'open:modified': 'sample.txt', 'open:untracked': 'untracked.md', 'open:conflict': 'nested/code.ts' };
  if (files[command] && !this.preview) return this.pick(files[command], cx);
  if (command === 'full' && !this.preview) return this.toggleFull(cx);
  if (command === 'commits' && !this.preview) return this.setTab('commit', cx);
  if (command === 'changes' && !this.preview) return this.setTab('changes', cx);
  if (command === 'snapshot' && !this.preview) {
   const t = focused()?.tab;
   const value = { serial: this.serial = (this.serial || 0) + 1, panes: panes(), focused: focused(), settings: settings(), props: props(),
    preview: this.preview, files: this.files, groups: this.groups, open: this.open, full: this.fullFile, on: this.on,
    tab: this.tab, commits: this.commits, commitsLoading: this.commitsLoading, commitsError: this.commitsError,
    remote: this.remote, branch: this.branch, historyGroups: this.tab === 'commit' && !this.selectedCommit
      ? groupCommits({ commits: this.commits, remote: this.remote, remoteHead: this.remoteHead, behind: this.behind, branch: this.branch, done: this.commitsDone }) : [],
    selectedCommit: this.selectedCommit, commitFiles: this.commitFiles, commitFilesLoading: this.commitFilesLoading,
    request: t ? shared('changes-plus.diff.' + t) : null };
   cx.spawn(async () => { await fs.writeFile(appHome() + '/driver-state.json', JSON.stringify(value)); });
   return;
  }
  if (command === 'preview-snapshot' && this.preview) {
   const r = this.req();
   const value = { serial: this.serial = (this.serial || 0) + 1, panes: panes(), props: props(), preview: true,
    rows: this.rows, full: this.fullFile, request: r ? shared(r.channel) : null, note: this.note };
   cx.spawn(async () => { await fs.writeFile(appHome() + '/preview-state.json', JSON.stringify(value)); });
   return;
  }
  return super.command(command, cx);
 }
}
`);
  await app('check', install);
  const log = await open(path.join(root, 'app.log'), 'w');
  child = spawn('herdr-app', [], { env, stdio: ['ignore', log.fd, log.fd] }); await log.close();
  let ready = false;
  for (let n = 0; n < 80; n++) { try { await app('status'); ready = true; break; } catch { await pause(250); } }
  assert.ok(ready, 'Isolated window did not start; see app.log');
  await doApp('overlay.close', { id: 'frame-welcome' });
  baseline = await app('ls'); originalTabs = tabs(baseline).map(t => t.id);
  const layout = JSON.parse(await readFile(path.join(home, 'layouts/main.json'), 'utf8'));
  function patch(node) {
    if (node.id === 'panel') node.hidden = false;
    if (node.content?.mod === 'changes') node.content = { mod: 'changes-plus' };
    for (const c of node.children || []) patch(c);
  }
  patch(layout);
  await writeFile(path.join(home, 'layouts/changes-plus-live.json'), JSON.stringify(layout, null, 2));
  const created = await doApp('tab.new', { name: 'Changes Plus isolated pane test ' + path.basename(root), folder: fixtures, argv: ['sh', '-c', 'printf "FONT SIZE 20 / unified diff\\n"; exec sh'] });
  report.created = created; tab = created.tab;
  if (!tab) { const now = await app('ls'); tab = tabs(now).find(t => !originalTabs.includes(t.id))?.id; }
  assert.ok(tab && !originalTabs.includes(tab), 'Could not identify dedicated test tab safely');
  await doApp('tab.select', { id: tab });
  await doApp('layout.switch', { name: 'changes-plus-live' });
  await pause(1400);
  await doApp('layout.select', { stack: 'panel-body', child: 'changes' });
  await doApp('layout.show', { id: 'panel' });
  await pause(600);
  let s = await snapshot('01-groups');
  assert.equal(s.state.preview, false);
  assert.equal(s.state.settings.font_size, 20);
  assert.equal(s.state.settings.font_family, report.font);
  assert.deepEqual(s.state.groups.map(g => g.key), ['conflicts', 'changed', 'untracked']);
  assert.ok(s.state.groups.find(g => g.key === 'conflicts').files.some(f => f.path === 'nested/code.ts'));
  assert.ok(s.state.groups.find(g => g.key === 'changed').files.some(f => f.path === 'sample.txt'));
  assert.ok(s.state.groups.find(g => g.key === 'untracked').files.some(f => f.path === 'untracked.md'));
  assert.equal(s.panes.length, 1);
  await shot('01-sidebar-groups'); report.checks.push('native layout: Changes Plus sections for conflicts, changed, untracked');
  await doApp('changes-plus.open:modified'); s = await waitPanes(2); await pause(700);
  s = await snapshot('02-diff-split');
  const preview = s.panes.find(p => p.mod === 'changes-plus'); assert.ok(preview);
  assert.equal(s.state.request.file, 'sample.txt');
  assert.equal(s.state.request.root, fixtures);
  assert.equal(s.state.preview, false);
  assert.ok(s.state.previewState?.rows.some(r => r.kind === '@'));
  assert.ok(s.state.previewState?.rows.some(r => r.kind === '+' && r.newNo != null));
  await shot('02-unified-diff'); report.checks.push('click splits a real right pane in the active tab; unified rows have hunk and new line numbers');
  const rowsBefore = s.state.previewState.rows.length;
  await doApp('changes-plus.full'); await pause(900); s = await snapshot('02b-full-file');
  assert.equal(s.state.full, true);
  assert.ok(s.state.previewState.rows.length > rowsBefore + 10, 'Full file did not show the whole file');
  await shot('02b-full-file-toggle'); report.checks.push('Full file replaces the short hunk with the whole file in the unified view');
  await doApp('changes-plus.full'); await pause(900);
  const revision = s.state.request.revision;
  await doApp('changes-plus.open:untracked'); await pause(700); s = await snapshot('03-reuse');
  assert.equal(s.panes.length, 2);
  assert.equal(s.panes.find(p => p.mod === 'changes-plus').pane, preview.pane);
  assert.equal(s.state.request.file, 'untracked.md');
  assert.notEqual(s.state.request.revision, revision);
  assert.ok(s.state.previewState?.rows.some(r => r.kind === '+' && r.text === '# brand new'));
  await shot('03-reused-untracked'); report.checks.push('same-tab diff pane reused and shared request/revision updated');
  await doApp('changes-plus.full'); await pause(900); s = await snapshot('04-full-file');
  assert.equal(s.state.full, true);
  assert.ok(s.state.previewState.rows.length >= 3);
  await shot('04-full-file-toggle'); report.checks.push('Full file shares state and reloads the unified diff');

  // Commits tab: real local bare remote, unpushed grouping, commit files and diff.
  await doApp('changes-plus.full'); await pause(500); // back to changed hunks only
  await doApp('changes-plus.commits'); s = await waitCommits(); s = await snapshot('07-commits-groups');
  assert.equal(s.state.tab, 'commit');
  assert.ok(s.state.commits.length >= 2);
  assert.deepEqual(s.state.historyGroups.map(g => g.scope), ['branch', 'remote']);
  assert.ok(s.state.historyGroups[0].count >= 1);
  await shot('07-commits-tabs'); report.checks.push('Commits tab reads real history with unpushed/remote groups');
  const commit = s.state.commits.find(c => c.subject === 'ours') ?? s.state.commits[0];
  await doApp(`changes-plus.commit:${commit.short}`); s = await waitCommitFiles(); s = await snapshot('08-commit-detail');
  assert.ok(s.state.selectedCommit);
  assert.ok(s.state.commitFiles.some(f => f.path === 'nested/code.ts'));
  await shot('08-commit-files'); report.checks.push('opening a commit lists the files it changed');
  await doApp('changes-plus.open:nested/code.ts'); await pause(800); s = await snapshot('09-commit-diff');
  assert.equal(s.state.request.scope, 'commit');
  assert.equal(s.state.request.commit.hash, s.state.selectedCommit.hash);
  assert.ok(s.state.previewState.rows.some(r => r.kind === '@'));
  await shot('09-commit-unified-diff'); report.checks.push('commit file reuses the unified diff pane via git show');
  await doApp('changes-plus.changes'); await pause(400);
  await doApp('pane.zoom', { pane: preview.pane }); await pause(400); s = await snapshot('05-zoom');
  assert.equal(s.panes.find(p => p.pane === preview.pane).zoomed, true);
  await shot('05-native-zoom');
  await doApp('pane.zoom', { pane: preview.pane }); await pause(300);
  await doApp('pane.close', { pane: preview.pane }); s = await waitPanes(1);
  assert.equal(s.state.preview, false);
  assert.equal(s.state.groups.length, 3);
  await shot('06-close-keeps-sidebar'); report.checks.push('native pane.zoom toggles; close removes diff only, sidebar keeps its groups');
  report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  report.cleanup = {};
  if (keep && report.passed) report.cleanup.keptForManualTesting = { home, tab, pid: child?.pid };
  if (!(keep && report.passed) && tab && !originalTabs.includes(tab)) {
    try { report.cleanup.closeTab = await doApp('tab.close', { id: tab, confirmed: true }); report.cleanup.ls = await app('ls'); assert.ok(!tabs(report.cleanup.ls).some(t => t.id === tab)); }
    catch (e) { report.cleanup.error = e.message; process.exitCode = 1; }
  }
  if (child && !(keep && report.passed)) {
    try { report.cleanup.closeWindow = await doApp('window.close'); } catch (e) { report.cleanup.windowError = e.message; }
    if (child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), pause(3000)]);
    if (child.exitCode === null) { child.kill('SIGTERM'); report.cleanup.terminatedOwnWindow = true; }
  }
  if (keep && report.passed && child) child.unref();
  await json('results', report);
  console.log(JSON.stringify({ passed: !!report.passed && !process.exitCode, checks: report.checks, error: report.error, artifacts: root, report: path.join(root, 'results.json') }, null, 2));
}
