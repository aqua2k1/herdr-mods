import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { encodeWindowsText } from "../lib/delivery.js";

test("Windows PowerShell -File decodes parameter-like text without posting notifications", t => {
  if (process.platform !== "win32" && !process.env.WSL_INTEROP && !process.env.WSL_DISTRO_NAME) {
    t.skip("Requires Windows PowerShell on Windows or WSL");
    return;
  }
  const available = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"], { timeout: 10000 });
  if (available.error || available.status !== 0) {
    t.skip("Windows PowerShell unavailable");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "herdr notification text "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "decode.ps1");
  const script = readFileSync(new URL("../scripts/windows-toast.ps1", import.meta.url), "utf8");
  const boundary = script.indexOf("# Prefer Herdr's registered identity.");
  assert.ok(boundary > 0);
  // Only execute the actual parameter binding and decoder; exclude every toast API.
  const decoder = script.slice(0, boundary);
  assert.ok(!decoder.includes("Get-StartApps"));
  assert.ok(!decoder.includes("ToastNotificationManager"));
  writeFileSync(path, decoder + '\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n@{ title = $Title; body = $Message } | ConvertTo-Json -Compress\n');
  let windowsPath = path;
  if (process.platform !== "win32") {
    const converted = spawnSync("wslpath", ["-w", path], { encoding: "utf8", timeout: 5000 });
    assert.equal(converted.status, 0, converted.stderr);
    windowsPath = converted.stdout.trim();
  }
  for (const [title, body] of [["-Message:hello", "-Title"], ["中文 😀\n<&> '\" $()", ""], ["literal %20", "-Message:bad"]]) {
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", windowsPath,
      "-TitleHex", encodeWindowsText(title), "-MessageHex", encodeWindowsText(body)], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.deepEqual(JSON.parse(result.stdout.replace(/^\uFEFF/, "")), { title, body });
  }
});
