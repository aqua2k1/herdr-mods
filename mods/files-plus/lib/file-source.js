// No Node or herdr imports: dependencies belong to the caller.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// The caller loads/caches helpers and injects scripts: { posix, windows }.
// This keeps helpers/read-image.* the only source of executable script logic.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Strict canonical Base64, bounded before allocation; no Buffer/atob required.
export function decodeBase64(value) {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) ||
      value.length % 4 !== 0) throw new Error("Invalid image Base64 length");
  let padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const length = value.length / 4 * 3 - padding;
  if (length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5 MiB");
  const bytes = new Uint8Array(length);
  let out = 0;
  for (let i = 0; i < value.length; i += 4) {
    const last = i + 4 === value.length;
    const a = ALPHABET.indexOf(value[i]), b = ALPHABET.indexOf(value[i + 1]);
    const c = last && padding === 2 ? 0 : ALPHABET.indexOf(value[i + 2]);
    const d = last && padding ? 0 : ALPHABET.indexOf(value[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0 ||
        (last && padding === 2 && (b & 15)) ||
        (last && padding === 1 && (c & 3))) throw new Error("Invalid image Base64");
    bytes[out++] = (a << 2) | (b >> 4);
    if (out < length) bytes[out++] = (b << 4) | (c >> 2);
    if (out < length) bytes[out++] = (c << 6) | d;
  }
  return bytes;
}

// A 1 MiB payload can exceed the native Windows VM's per-turn time budget.
export async function decodeBase64Cooperative(value, yieldControl, isCurrent = () => true) {
  if (typeof value !== "string" || value.length % 4 || value.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) {
    throw new Error("Invalid image Base64 length");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array(value.length / 4 * 3 - padding); let offset = 0;
  for (let start = 0; start < value.length; start += 65536) {
    if (!isCurrent()) throw new Error("Media request is stale");
    const end = Math.min(value.length, start + 65536), part = value.slice(start, end);
    if (end < value.length && part.includes("=")) throw new Error("Invalid image Base64");
    const bytes = decodeBase64(part); output.set(bytes, offset); offset += bytes.length;
    if (end < value.length) await yieldControl();
  }
  if (offset !== output.length) throw new Error("Invalid image Base64");
  return output;
}

export function parseImageDimensions(bytes) {
  const bad = () => { throw new Error("Unsupported or malformed image (PNG/JPEG only)"); };
  const u16 = i => bytes[i] * 256 + bytes[i + 1];
  const u32 = i => bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
  const result = (width, height, extension) => {
    if (!width || !height) return bad();
    return { width, height, extension };
  };
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    if (bytes.length < 33 || u32(8) !== 13 ||
        ![73,72,68,82].every((v,i) => bytes[12+i] === v)) return bad();
    const w = u32(16), h = u32(20);
    if (w > 0x7fffffff || h > 0x7fffffff) return bad(); // PNG specification, not a pixel budget.
    return result(w, h, "png");
  }
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return bad();
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i++] !== 255) return bad();
    while (bytes[i] === 255) i++;
    if (i >= bytes.length) return bad();
    const marker = bytes[i++];
    if (marker === 0 || marker === 216 || marker === 217 || marker === 218) return bad();
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (i + 2 > bytes.length) return bad();
    const length = u16(i);
    if (length < 2 || i + length > bytes.length) return bad();
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8 || !bytes[i+7] || length !== 8 + 3 * bytes[i+7]) return bad();
      return result(u16(i+5), u16(i+3), "jpg");
    }
    i += length;
  }
  return bad();
}

function checkPath(path) {
  if (typeof path !== "string" || !path || path.includes("\0")) throw new Error("Invalid file path");
}

export const IMAGE_CHUNK_BYTES = 1024 * 1024;

// scripts: { posix: shSource, windows: psSource }; script is a single-platform alias.
// Remote always probes sh first. platform selects only LOCAL execution (never the remote OS).
// V2 lines: magic, offset, total size, total chunks, payload length, version, Base64, EOF.
// version hashes full bounded content + file metadata on every request. Helpers check
// metadata before/after reading; later chunks and the zero-byte final check must match.
// isCurrent is optional: stale work throws before another exec (no in-flight cancellation).
export async function readBinary(path, on, { exec, platform, scripts, script, isCurrent = () => true, yieldControl = async () => {} } = {}) {
  checkPath(path);
  if (typeof exec !== "function") throw new Error("exec dependency is required");
  const windows = platform === "win32" || platform === "windows";
  const sources = scripts || (typeof script === "string" ? { [windows ? "windows" : "posix"]: script } : {});
  let kind = on ? "posix" : windows ? "windows" : "posix";
  let selected = false;
  const quote = value => "'" + String(value).replace(/['‘’‚‛]/g, "$&$&") + "'";
  const missingSh = error => error?.code === "ENOENT" ||
    /cannot start sh: (?:program not found|no such file or directory|the system cannot find the file specified)/i.test(error?.message || "") ||
    ((error?.code === 127 || error?.code === 1) &&
      /(?:\bsh(?:[. ]exe)?\b[^\n]*(?:not found|no such file|not recognized)|(?:cannot find|could not find)[^\n]*\bsh\b)/i.test(error.stderr || error.message || ""));
  async function request(offset, count, version) {
    for (;;) {
      if (!isCurrent()) throw new Error("Media request is stale");
      const source = sources[kind];
      if (typeof source !== "string" || !source.trim()) throw new Error("Image helper script dependency is required: " + kind);
      const args = kind === "posix"
        ? ["-c", source, "files-plus-image", path, String(offset), String(count), version]
        : ["-NoProfile", "-NonInteractive", "-Command",
          "& {\n" + source + "\n} " + [path, offset, count, version].map(quote).join(" ")];
      let r;
      try { r = await exec(kind === "posix" ? "sh" : "powershell", args, { on, timeout: 30000 }); }
      catch (error) {
        if (on && !selected && kind === "posix" && missingSh(error)) { kind = "windows"; continue; }
        throw error;
      }
      if (r?.code !== 0) {
        if (on && !selected && kind === "posix" && missingSh(r)) { kind = "windows"; continue; }
        throw new Error(r?.stderr || "Cannot read image");
      }
      selected = true;
      if (!isCurrent()) throw new Error("Media request is stale");
      if (typeof r.stdout !== "string" || r.stdout.length > 4 * Math.ceil(IMAGE_CHUNK_BYTES / 3) + 256)
        throw new Error("Invalid image response length");
      const f = r.stdout.split("\n");
      if (f.length !== 8 || f[0] !== "FILES_PLUS_IMAGE_V2" || f[7] !== "" ||
          !f.slice(1, 5).every(x => /^(0|[1-9][0-9]*)$/.test(x)) || !/^[a-f0-9]{64}$/.test(f[5]))
        throw new Error("Invalid image response");
      const [gotOffset, size, chunks, length] = f.slice(1, 5).map(Number);
      if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5 MiB");
      if (gotOffset !== offset || offset > size || chunks !== Math.ceil(size / IMAGE_CHUNK_BYTES) ||
          length !== Math.min(count, size - offset) || (version && version !== f[5]))
        throw new Error("Image changed or invalid chunk response");
      const bytes = await decodeBase64Cooperative(f[6], yieldControl, isCurrent);
      if (bytes.length !== length) throw new Error("Incomplete image response");
      return { bytes, size, chunks, version: f[5] };
    }
  }
  const first = await request(0, IMAGE_CHUNK_BYTES, "");
  const bytes = new Uint8Array(first.size);
  bytes.set(first.bytes);
  let offset = first.bytes.length;
  while (offset < first.size) {
    const part = await request(offset, IMAGE_CHUNK_BYTES, first.version);
    if (part.size !== first.size || part.chunks !== first.chunks) throw new Error("Image changed between chunks");
    bytes.set(part.bytes, offset);
    offset += part.bytes.length;
  }
  // Recheck even one-chunk files, including edits after the last data response.
  const last = await request(first.size, 0, first.version);
  if (last.size !== first.size || last.chunks !== first.chunks) throw new Error("Image changed after read");
  return bytes;
}

export async function readImage(path, on, options = {}) {
  const bytes = await readBinary(path, on, options);
  return { bytes, ...parseImageDimensions(bytes) };
}

export async function readText(path, on, { readTextFile } = {}) {
  checkPath(path);
  if (typeof readTextFile !== "function") throw new Error("readTextFile dependency is required");
  // Host readTextFile enforces its own 1 MiB limit. This is a display cap,
  // not range I/O; notably the current remote host implementation uses cat.
  const text = await readTextFile(path, { on });
  if (typeof text !== "string") throw new Error("File is no longer available");
  // Include controls other than normal text whitespace; scan before truncation.
  if (/[\x00-\x08\x0e-\x1f\x7f]/.test(text)) throw new Error("Binary file · no text preview");
  const limit = 400000, notice = "\n… (file truncated)";
  if (text.length <= limit) return text;
  let end = limit - notice.length;
  if (text.charCodeAt(end-1) >= 0xd800 && text.charCodeAt(end-1) <= 0xdbff) end--;
  return text.slice(0, end) + notice;
}
