import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationCommand, deliverNotification, encodeWindowsText } from "../lib/delivery.js";

function fixture(overrides = {}) {
  const calls = [], warnings = [], seen = new Set();
  const dependencies = {
    appHome: () => "/home/test/Herdr home/",
    claim(id) { if (seen.has(id)) return false; seen.add(id); return true; },
    async exec(...args) { calls.push(args); return { code: 0, stderr: "" }; },
    warn: (...args) => warnings.push(args),
    ...overrides,
  };
  return { calls, warnings, dependencies };
}
const note = { overlay: "o1", title: "完成 ' \" $()", body: "正文\n第二行 <xml>&" };
const inactive = { platform: "linux", active: false };

test("only explicitly inactive windows send; skipped foreground notes are not replayed", async () => {
  for (const win of [{ active: true }, {}, null]) {
    const f = fixture();
    assert.equal(await deliverNotification(note, win, f.dependencies), "skipped");
    assert.equal(await deliverNotification(note, inactive, f.dependencies), "duplicate");
    assert.deepEqual(f.calls, []);
  }
});

test("one local attempt per overlay, with exact title/body and no remote options", async () => {
  const f = fixture();
  assert.equal(await deliverNotification(note, inactive, f.dependencies), "sent");
  assert.equal(await deliverNotification(note, inactive, f.dependencies), "duplicate");
  assert.equal(await deliverNotification({ ...note, overlay: "o2" }, inactive, f.dependencies), "sent");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], ["/bin/sh", [
    "/home/test/Herdr home/mods/desktop-notifications/scripts/linux-notify.sh", note.title, note.body,
  ], { timeout: 5000 }]);
});

test("invalid/check-mode props never launch programs", async () => {
  const f = fixture();
  for (const value of [null, {}, { title: "test" }, { overlay: "o1" }, { ...note, title: 3 }]) {
    assert.equal(await deliverNotification(value, inactive, f.dependencies), "skipped");
  }
  assert.deepEqual(f.calls, []);
});

test("platform adapters and Windows paths", () => {
  assert.deepEqual(notificationCommand("macos", "/Users/test/", "T", "B"), {
    program: "/bin/sh", args: ["/Users/test/mods/desktop-notifications/scripts/macos-notify.sh", "T", "B"],
  });
  const windows = notificationCommand("windows", "C:\\Users\\Test Home\\", "-Title", "<&>中文");
  assert.equal(windows.program, "powershell.exe");
  assert.deepEqual(windows.args.slice(-6), ["-File", "C:\\Users\\Test Home/mods/desktop-notifications/scripts/windows-toast.ps1", "-TitleHex", encodeWindowsText("-Title"), "-MessageHex", encodeWindowsText("<&>中文")]);
  assert.equal(notificationCommand("unknown", "/test", "T", "B"), null);
});

test("Windows transport preserves parameter-like text, Unicode and empty strings", () => {
  for (const value of ["", "-Message:hello", "-Title", "中文 😀\n<&> '\" $()", "literal %20"]) {
    assert.equal(encodeWindowsText(value).toLowerCase(), "hex:" + Buffer.from(value).toString("hex"));
    assert.equal(Buffer.from(encodeWindowsText(value).slice(4), "hex").toString(), value);
  }
});

test("missing body becomes empty, unknown platforms do not launch", async () => {
  const f = fixture();
  await deliverNotification({ overlay: "o2", title: "Title" }, inactive, f.dependencies);
  assert.equal(f.calls[0][1].at(-1), "");
  assert.equal(await deliverNotification(note, { ...inactive, platform: "unknown" }, f.dependencies), "skipped");
  assert.equal(f.calls.length, 1);
});

test("nonzero exits and rejected launches are logged, never retried or thrown", async () => {
  for (const exec of [async () => ({ code: 127, stderr: "missing notifier" }), async () => { throw new Error("timeout"); }]) {
    const f = fixture({ exec });
    assert.equal(await deliverNotification(note, inactive, f.dependencies), "failed");
    assert.equal(f.warnings.length, 1);
    assert.equal(await deliverNotification(note, inactive, f.dependencies), "duplicate");
  }
});

test("toast init dispatches once across reload using localStorage; render is unchanged", async () => {
  const source = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const f = fixture();
  const storage = new Map();
  const pending = [];
  let state = { ...inactive };
  const Toast = new Function("View", "props", "appWindow", "appHome", "exec", "localStorage", "deliverNotification", "console",
    source.replace(/^import .*;$/gm, "").replace("export default class Toast", "return class Toast"),
  )(class {}, () => note, () => state, f.dependencies.appHome, f.dependencies.exec, {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }, deliverNotification, { error: f.dependencies.warn });
  const cx = { spawn: fn => pending.push(fn()) };
  new Toast().init(note, cx);
  state = { platform: "linux", active: true };
  new Toast().init(note, cx);
  await Promise.all(pending);
  assert.equal(f.calls.length, 1);
  assert.ok(source.includes("if (p.action?.name) run(p.action.name, p.action.args ?? {})"));
  assert.ok(!source.slice(source.indexOf("  render(")).includes("deliverNotification"));
});
