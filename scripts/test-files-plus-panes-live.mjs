// Real Linux GPUI integration test. No production edits, synthetic pane model or pointer automation.
// Requires herdr-app, hc, a working display and Python/Pillow for generated fixtures.
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
const fixtureIndex = process.argv.indexOf('--fixtures');
if (fixtureIndex >= 0 && !process.argv[fixtureIndex + 1]) throw new Error('--fixtures requires a directory');
const keep = process.argv.includes('--keep');
await mkdir(path.join(homedir(), '.cache'), { recursive: true });
const root = await mkdtemp(path.join(homedir(), '.cache/files-plus-panes-live-'));
const fixtures = fixtureIndex >= 0 ? path.resolve(process.argv[fixtureIndex + 1]) : path.join(root, 'fixtures');
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
async function snapshot(name) {
  await doApp('files-plus-driver.snapshot');
  let state;
  for (let n = 0; n < 40; n++) {
    try { state = JSON.parse(await readFile(path.join(home, 'driver-state.json'), 'utf8')); if (state.serial > (snapshot.serial || 0)) break; } catch {}
    await pause(100);
  }
  assert.ok(state?.serial > (snapshot.serial || 0), 'Driver snapshot not delivered'); snapshot.serial = state.serial;
  const ls = await app('ls'), status = await app('status');
  await json(name, { driver: state, ls, status });
  assert.deepEqual(status.errors || [], [], 'Host/mod errors');
  assert.deepEqual(status.overlays || [], [], 'An overlay obstructs the visual test');
  return { state, ls, status, panes: state.panes.filter(p => p.tab === tab) };
}
async function waitPanes(count) {
  for (let n = 0; n < 50; n++) {
    const s = await snapshot('latest'); if (s.panes.length === count) return s;
    await pause(200);
  }
  throw new Error('Timed out waiting for ' + count + ' workarea panes');
}
try {
  if (fixtureIndex < 0) {
    await mkdir(path.join(fixtures, 'src/nested'), { recursive: true });
    await exec('python3', ['-c', `from PIL import Image,ImageDraw
from pathlib import Path
import sys
p=Path(sys.argv[1]); im=Image.new('RGB',(1600,1000),'#18324c'); d=ImageDraw.Draw(im)
for x in range(0,1600,100): d.line((x,0,x,1000),fill='#376080')
for y in range(0,1000,100): d.line((0,y,1600,y),fill='#376080')
d.rectangle((400,250,1200,750),outline='#ffb545',width=8)
d.text((550,490),'Files Plus original 1600 x 1000',fill='white')
im.save(p/'图片 test.png'); im.save(p/'photo.jpg')`, fixtures]);
    await writeFile(path.join(fixtures, 'hello.ts'), 'interface Preview { readonly original: boolean; }\nconst value: Preview = { original: true };\nconsole.log(value);\n');
    await writeFile(path.join(fixtures, 'src/nested/example.ts'), 'export const nested = true;\n');
    await writeFile(path.join(fixtures, 'README.md'), '# Native pane preview\n\n**Files stays on the right.**\n\n- Native folder icons and indentation\n- Terminal font settings\n');
  }
  await readFile(path.join(fixtures, '图片 test.png'));
  await mkdir(path.join(home, 'mods'), { recursive: true });
  report.host = await app('--version');
  report.skill = await app('--skill');
  report.commands = await app('commands');
  const userSettings = JSON.parse(await readFile(path.join(sourceHome, 'settings.json'), 'utf8'));
  report.font = userSettings.font_family || userSettings.font || 'Geist Mono';
  await writeFile(path.join(home, 'settings.json'), JSON.stringify({ ...userSettings, font: report.font, font_size: 20, sounds: { enabled: false } }));
  // Suppress first-run overlays in this home only; never copy a user's view/core layout.
  await writeFile(path.join(home, 'shared.json'), JSON.stringify({ 'frame.welcomed': 'finished', 'workspace.panels': ['files', 'changes'] }));
  for (const file of ['seen.json']) { try { await cp(path.join(sourceHome, file), path.join(home, file)); } catch {} }
  await cp(path.join(repo, 'mods/files-plus'), path.join(home, 'mods/files-plus'), { recursive: true,
    filter: p => !p.endsWith('.d.ts') && !p.endsWith('jsconfig.json') && !path.relative(path.join(repo, 'mods/files-plus'), p).split(path.sep).includes('test') });
  await mkdir(path.join(home, 'mods/files-plus-driver'));
  // Host imports are sandboxed to each mod folder; keep an unmodified nested copy for inheritance.
  await cp(path.join(home, 'mods/files-plus'), path.join(home, 'mods/files-plus-driver/production'), { recursive: true });
  // The only test injection is a separate subclass. The copied production FilesPlus stays byte-for-byte unchanged.
  await writeFile(path.join(home, 'mods/files-plus-driver/main.js'), `import FilesPlus from './production/main.js';
import { panes, focused, shared, settings, props, appHome } from 'herdr';
import * as fs from 'fs/promises';
export default class Driver extends FilesPlus {
 command(command, cx) {
  const files = { 'open:image': '图片 test.png', 'open:other': 'photo.jpg', 'open:code': 'hello.ts' };
  if (files[command]) return this.openFile(files[command], cx);
  if (command === 'expand:src') return this.toggle('src', cx);
  if (command === 'expand:nested') return this.toggle('src/nested', cx);
  if (command === 'snapshot') {
   const value = { serial: this.serial = (this.serial || 0) + 1, panes: panes(), focused: focused(), settings: settings(), props: props(), preview: this.preview, file: this.file, root: this.root, entries: [...this.entries], folders: [...this.folders], size: this.liveSize, request: shared('files-plus.preview.' + focused()?.tab) };
   cx.spawn(async () => { await fs.writeFile(appHome() + '/driver-state.json', JSON.stringify(value)); });
   return;
  }
  return super.command(command, cx);
 }
 render(cx) { return super.render(cx).on_size_change(size => { this.liveSize = size; }); }
}
`);
  await writeFile(path.join(home, 'mods/files-plus-driver/mod.json'), JSON.stringify({ place: 'none', focusable: true }));
  await app('check', path.join(home, 'mods/files-plus'));
  await app('check', path.join(home, 'mods/files-plus-driver'));
  const log = await open(path.join(root, 'app.log'), 'w');
  child = spawn('herdr-app', [], { env, stdio: ['ignore', log.fd, log.fd] }); await log.close();
  let ready = false;
  for (let n = 0; n < 80; n++) { try { await app('status'); ready = true; break; } catch { await pause(250); } }
  assert.ok(ready, 'Isolated window did not start; see app.log');
  await doApp('overlay.close', { id: 'frame-welcome' });
  baseline = await app('ls'); originalTabs = tabs(baseline).map(t => t.id);
  await json('00-baseline-ls', baseline);
  // Clone the freshly shipped native layout, preserving the real active-tab workarea.
  const layout = JSON.parse(await readFile(path.join(home, 'layouts/main.json'), 'utf8'));
  function patch(node) {
    if (node.id === 'panel') node.hidden = false;
    if (node.content?.mod === 'files') node.content = { mod: 'files-plus-driver', props: { root: fixtures } };
    for (const child of node.children || []) patch(child);
  }
  patch(layout);
  assert.equal(layout.children.find(n => n.id === 'work').children.find(n => n.id === 'work-body').children.find(n => n.id === 'main').content.tab, 'active');
  await writeFile(path.join(home, 'layouts/files-plus-panes-live.json'), JSON.stringify(layout, null, 2));
  const created = await doApp('tab.new', { name: 'Files Plus isolated pane test ' + path.basename(root), folder: fixtures, argv: ['sh', '-c', 'printf "FONT SIZE 20 / terminal baseline\\nABCDEFGHIJKLMNOPQRSTUVWXYZ\\n0123456789\\n"; exec sh'] });
  report.created = created; tab = created.tab;
  if (!tab) { const now = await app('ls'); tab = tabs(now).find(t => !originalTabs.includes(t.id))?.id; }
  assert.ok(tab && !originalTabs.includes(tab), 'Could not identify dedicated test tab safely');
  await doApp('tab.select', { id: tab });
  await doApp('layout.switch', { name: 'files-plus-panes-live' });
  // Let native tabs finish restoring this space's remembered panel state first.
  await pause(1400);
  await doApp('layout.select', { stack: 'panel-body', child: 'files' });
  await doApp('layout.show', { id: 'panel' });
  await pause(600);
  let s = await snapshot('01-tree');
  assert.equal(s.panes.length, 1); assert.equal(s.state.preview, false); assert.equal(s.state.file, null);
  assert.ok(s.state.entries.flatMap(([, es]) => es).some(e => e.name === '图片 test.png'));
  assert.equal(s.state.settings.font_size, 20); assert.equal(s.state.settings.font_family, report.font);
  await shot('01-tree-terminal-font20'); report.checks.push('native main layout: management | active-tab workarea | Files/Changes tree');
  if (fixtureIndex < 0) {
    await doApp('files-plus-driver.expand:src'); await pause(500);
    await doApp('files-plus-driver.expand:nested'); await pause(500);
    s = await snapshot('01b-nested-tree');
    assert.ok(s.state.folders.includes('src/nested'));
    assert.ok(s.state.entries.find(([folder]) => folder === 'src/nested')[1].some(e => e.name === 'example.ts'));
    await shot('01b-native-icons-indentation'); report.checks.push('nested folders retain native icons, hierarchy and indentation');
  }
  await doApp('files-plus-driver.open:image'); s = await waitPanes(2); await pause(1600);
  s = await snapshot('02-image-split');
  const preview = s.panes.find(p => p.mod === 'files-plus'); assert.ok(preview);
  assert.equal(s.state.request.file, '图片 test.png'); assert.equal(s.state.request.root, fixtures);
  assert.equal(s.state.preview, false); assert.equal(s.state.file, null);
  await shot('02-image-workarea-tree');
  await exec('python3', ['-c', "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGB'); n=sum(1 for p in im.getdata() if sum(abs(a-b) for a,b in zip(p,(24,50,76)))<12); assert n>500, f'Image preview not visible: {n} pixels'", path.join(root, '02-image-workarea-tree.png')]);
  report.checks.push('openFile performs real right pane.split in dedicated tab; sidebar remains tree');
  const revision = s.state.request.revision;
  await doApp('files-plus-driver.open:other'); await pause(900); s = await snapshot('03-reuse');
  assert.equal(s.panes.length, 2); assert.equal(s.panes.find(p => p.mod === 'files-plus').pane, preview.pane);
  assert.equal(s.state.request.file, 'photo.jpg'); assert.notEqual(s.state.request.revision, revision);
  await shot('03-reused-preview'); report.checks.push('same-tab preview reused, shared request/revision updated, pane count unchanged');
  await doApp('pane.zoom', { pane: preview.pane }); await pause(400); s = await snapshot('04-zoom');
  assert.equal(s.panes.find(p => p.pane === preview.pane).zoomed, true);
  await shot('04-native-workarea-zoom');
  await doApp('pane.zoom', { pane: preview.pane }); await pause(300);
  await doApp('pane.close', { pane: preview.pane }); s = await waitPanes(1);
  assert.equal(s.state.preview, false); assert.ok(s.state.entries.length);
  await shot('05-close-keeps-sidebar'); report.checks.push('native pane.zoom toggles; close removes preview only');
  await doApp('files-plus-driver.open:code'); s = await waitPanes(2); await pause(1000);
  await snapshot('06-reopen-code'); await shot('06-reopen-code-font20'); report.checks.push('reopen after close creates preview beside original terminal; code/terminal font screenshot captured');
  await doApp('layout.select', { stack: 'panel-body', child: 'changes' }); await pause(400); await shot('07-native-changes');
  await doApp('layout.select', { stack: 'panel-body', child: 'files' });
  report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  report.cleanup = {};
  if (keep && report.passed) report.cleanup.keptForManualTesting = { home, tab, pid: child?.pid };
  if (!(keep && report.passed) && tab && !originalTabs.includes(tab)) {
    try { report.cleanup.closeTab = await doApp('tab.close', { id: tab, confirmed: true }); report.cleanup.ls = await app('ls'); await json('99-cleanup-ls', report.cleanup.ls); assert.ok(!tabs(report.cleanup.ls).some(t => t.id === tab)); }
    catch (e) { report.cleanup.error = e.message; process.exitCode = 1; }
  }
  if (child && !(keep && report.passed)) {
    try { report.cleanup.closeWindow = await doApp('window.close'); } catch (e) { report.cleanup.windowError = e.message; }
    if (child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), pause(3000)]);
    if (child.exitCode === null) { child.kill('SIGTERM'); report.cleanup.terminatedOwnWindow = true; }
  }
  if (keep && report.passed && child) { child.unref(); }
  await json('results', report);
  console.log(JSON.stringify({ passed: !!report.passed && !process.exitCode, checks: report.checks, error: report.error, artifacts: root, report: path.join(root, 'results.json') }, null, 2));
}
