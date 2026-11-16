// Media platform compatibility. Host/filesystem services are injected by callers.
import { encodeBase64Cooperative } from "./base64.js";

const isWindows = platform => platform === "win32" || platform === "windows";
const quotePowerShell = value => "'" + String(value).replace(/['‘’‚‛]/g, "$&$&") + "'";

// Local platform never determines the remote OS: probe sh, fall back only if absent.
export function createBinaryTransport({ exec, platform, scripts, script, on, isCurrent = () => true }) {
  if (typeof exec !== "function") throw new Error("exec dependency is required");
  const windows = isWindows(platform);
  const sources = scripts || (typeof script === "string" ? { [windows ? "windows" : "posix"]: script } : {});
  let kind = on ? "posix" : windows ? "windows" : "posix";
  let selected = false;
  const missingSh = error => error?.code === "ENOENT" ||
    /cannot start sh: (?:program not found|no such file or directory|the system cannot find the file specified)/i.test(error?.message || "") ||
    ((error?.code === 127 || error?.code === 1) &&
      /(?:\bsh(?:[. ]exe)?\b[^\n]*(?:not found|no such file|not recognized)|(?:cannot find|could not find)[^\n]*\bsh\b)/i.test(error.stderr || error.message || ""));
  const fallback = error => on && !selected && kind === "posix" && missingSh(error);

  return async (path, offset, count, version) => {
    for (;;) {
      if (!isCurrent()) throw new Error("Media request is stale");
      let source = sources[kind];
      if (typeof source !== "string" || !source.trim()) throw new Error("Image helper script dependency is required: " + kind);
      // Windows checkouts may add CRLF/BOM. Normalize helper source only;
      // paths and payload arguments must retain their exact contents.
      if (kind === "posix") source = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
      const args = kind === "posix"
        ? ["-c", source, "files-plus-image", path, String(offset), String(count), version]
        : ["-NoProfile", "-NonInteractive", "-Command",
          "& {\n" + source + "\n} " + [path, offset, count, version].map(quotePowerShell).join(" ")];
      let result;
      try { result = await exec(kind === "posix" ? "sh" : "powershell", args, { on, timeout: 30000 }); }
      catch (error) {
        if (fallback(error)) { kind = "windows"; continue; }
        throw error;
      }
      if (result?.code !== 0) {
        if (fallback(result)) { kind = "windows"; continue; }
        throw new Error(result?.stderr || "Cannot read image");
      }
      selected = true;
      if (!isCurrent()) throw new Error("Media request is stale");
      return result.stdout;
    }
  };
}

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

// Platform compatibility is isolated here, not in resource ownership/rendering.
export class PlatformCacheWriter {
  constructor({ platform, exec, directory, lease, fs, randomUUID }) {
    this.fs = fs; this.randomUUID = randomUUID;
    this.platform = platform; this.exec = exec; this.directory = directory;
    this.lease = lease; this.staging = new Set(); this.closed = false;
  }

  async write(output, bytes, options = {}) {
    if (this.closed) throw new Error("Preview resources are closed");
    if (isWindows(this.platform)) await this.writeWindows(output, bytes, options);
    else await this.fs.writeFile(output, bytes);
  }

  async writeWindows(output, bytes, { yieldControl } = {}) {
    if (typeof this.exec !== "function") throw new Error("Windows media cache requires exec");
    await this.fs.mkdir(this.directory, { recursive: true });
    if (this.closed) throw new Error("Preview resources are closed");
    const name = `${this.directory}/${this.randomUUID()}`;
    const encoded = name + ".b64", temporary = name + ".part";
    this.staging.add(encoded); this.staging.add(temporary);
    try {
      // Native Windows Herdr 0.1.16 can silently write empty Uint8Arrays.
      // Text writes work; stage Base64 rather than exceeding Windows' 32K argv.
      await this.fs.writeFile(encoded, await encodeBase64Cooperative(bytes, yieldControl));
      if (this.closed) throw new Error("Preview resources are closed");
      const command = WINDOWS_PUBLISH + " " + [encoded, temporary, output, this.lease].map(quotePowerShell).join(" ");
      const result = await this.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { timeout: 30000 });
      if (result?.code !== 0) throw new Error(result?.stderr || "Cannot publish Windows media cache");
    } finally {
      await Promise.all([encoded, temporary].map(path => this.fs.unlink(path).catch(() => {})));
      this.staging.delete(encoded); this.staging.delete(temporary);
      if (this.closed) await this.fs.unlink(output).catch(() => {});
    }
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.staging].map(path => this.fs.unlink(path).catch(() => {})));
    this.staging.clear();
    await this.fs.rmdir(this.directory).catch(() => {});
  }
}
