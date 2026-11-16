import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { encodeBase64Cooperative } from "./base64.js";

const WINDOWS_PUBLISH = `$ErrorActionPreference = 'Stop'; & {
param($encoded, $temporary, $output, $lease)
try {
  if (-not [IO.File]::Exists($lease)) { throw 'Preview resources are closed' }
  $bytes = [Convert]::FromBase64String([IO.File]::ReadAllText($encoded, [Text.Encoding]::UTF8))
  if ($bytes.Length -gt 5242880) { throw 'Media exceeds 5 MiB' }
  [IO.File]::WriteAllBytes($temporary, $bytes)
  if (-not [IO.File]::Exists($lease)) { throw 'Preview resources are closed' }
  [IO.File]::Move($temporary, $output)
  if (-not [IO.File]::Exists($lease)) { [IO.File]::Delete($output); throw 'Preview resources are closed' }
} finally {
  foreach ($path in @($encoded, $temporary)) {
    try { if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) } } catch { }
  }
}
}`;
const psQuote = value => "'" + value.replace(/['‘’‚‛]/g, "$&$&") + "'";

// Platform compatibility is isolated here, not in resource ownership/rendering.
export class CacheWriter {
  constructor({ platform, exec, directory, lease }) {
    this.platform = platform; this.exec = exec; this.directory = directory;
    this.lease = lease; this.staging = new Set(); this.closed = false;
  }

  async write(output, bytes, options = {}) {
    if (this.closed) throw new Error("Preview resources are closed");
    if (this.platform === "windows" || this.platform === "win32") await this.writeWindows(output, bytes, options);
    else await fs.writeFile(output, bytes);
  }

  async writeWindows(output, bytes, { yieldControl } = {}) {
    if (typeof this.exec !== "function") throw new Error("Windows media cache requires exec");
    await fs.mkdir(this.directory, { recursive: true });
    if (this.closed) throw new Error("Preview resources are closed");
    const name = `${this.directory}/${randomUUID()}`;
    const encoded = name + ".b64", temporary = name + ".part";
    this.staging.add(encoded); this.staging.add(temporary);
    try {
      // Native Windows Herdr 0.1.16 can silently write empty Uint8Arrays.
      // Text writes work; stage Base64 rather than exceeding Windows' 32K argv.
      await fs.writeFile(encoded, await encodeBase64Cooperative(bytes, yieldControl));
      if (this.closed) throw new Error("Preview resources are closed");
      const command = WINDOWS_PUBLISH + " " + [encoded, temporary, output, this.lease].map(psQuote).join(" ");
      const result = await this.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { timeout: 30000 });
      if (result?.code !== 0) throw new Error(result?.stderr || "Cannot publish Windows media cache");
    } finally {
      await Promise.all([encoded, temporary].map(path => fs.unlink(path).catch(() => {})));
      this.staging.delete(encoded); this.staging.delete(temporary);
      if (this.closed) await fs.unlink(output).catch(() => {});
    }
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.staging].map(path => fs.unlink(path).catch(() => {})));
    this.staging.clear();
    await fs.rmdir(this.directory).catch(() => {});
  }
}
