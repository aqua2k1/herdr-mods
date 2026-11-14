import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-notify-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const capture = join(dir, "args");
  const env = { ...process.env, PATH: bin, CAPTURE: capture };
  delete env.WSL_DISTRO_NAME;
  delete env.WSL_INTEROP;
  return {
    dir, env, capture,
    program(name, body = '#!/bin/sh\nprintf "%s\\0" "$@" > "$CAPTURE"\n') {
      writeFileSync(join(bin, name), body, { mode: 0o700 });
    },
    run(script, title, body) {
      return spawnSync("/bin/sh", [join(scripts, script), title, body], { env, encoding: "utf8" });
    },
    args() { return readFileSync(capture, "utf8").split("\0").slice(0, -1); },
  };
}

test("shell scripts have valid syntax", () => {
  for (const name of ["linux-notify.sh", "macos-notify.sh"]) {
    const result = spawnSync("/bin/sh", ["-n", join(scripts, name)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("Linux passes untrusted text as literal arguments", t => {
  const f = sandbox(t);
  f.program("notify-send");
  const title = "-Title 中文 ' \"", body = "$(touch /tmp/DO_NOT_CREATE_HERDR_PROBE)\n<&>";
  const result = f.run("linux-notify.sh", title, body);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.args(), ["--app-name=Herdr", "--expire-time=60000", "--", title, body]);
});

test("missing dependencies fail with diagnostics", t => {
  const f = sandbox(t);
  for (const [script, dependency] of [["linux-notify.sh", "notify-send"], ["macos-notify.sh", "terminal-notifier"]]) {
    const result = f.run(script, "T", "B");
    assert.equal(result.status, 127);
    assert.match(result.stderr, new RegExp(dependency));
  }
});

test("macOS escapes text arguments and uses a Herdr-specific group", t => {
  const f = sandbox(t);
  f.program("terminal-notifier");
  const result = f.run("macos-notify.sh", "-title", "中文\n<&>");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.args(), ["-title", "\\-title", "-message", "\\中文\n<&>", "-group", "herdr-notification"]);
});

test("WSL routes through PowerShell with a converted script path", t => {
  const f = sandbox(t);
  f.env.WSL_DISTRO_NAME = "test";
  f.program("powershell.exe");
  f.program("dirname", '#!/bin/sh\nexec /usr/bin/dirname "$@"\n');
  f.program("od", '#!/bin/sh\nexec /usr/bin/od "$@"\n');
  f.program("tr", '#!/bin/sh\nexec /usr/bin/tr "$@"\n');
  f.program("wslpath", '#!/bin/sh\nprintf "%s" "C:\\Herdr Home\\windows-toast.ps1"\n');
  const result = f.run("linux-notify.sh", "完成", "正文\n<&>");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.args(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\Herdr Home\\windows-toast.ps1", "-TitleHex", "hex:" + Buffer.from("完成").toString("hex"), "-MessageHex", "hex:" + Buffer.from("正文\n<&>").toString("hex")]);
});

test("WSL dependency and notifier failures do not silently fall back", t => {
  const f = sandbox(t);
  f.env.WSL_INTEROP = "/test/interop";
  f.program("notify-send");
  const missing = f.run("linux-notify.sh", "T", "B");
  assert.equal(missing.status, 127);
  assert.match(missing.stderr, /powershell.exe/);
  delete f.env.WSL_INTEROP;
  f.program("notify-send", '#!/bin/sh\nprintf "%s" "delivery denied" >&2\nexit 4\n');
  const denied = f.run("linux-notify.sh", "T", "B");
  assert.equal(denied.status, 4);
  assert.match(denied.stderr, /delivery denied/);
});
