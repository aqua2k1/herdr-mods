// Optional preview only: Python 3.9+, pypdfium2 and Pillow must already exist.
// No Node/Herdr imports: inject exec (Herdr's {code,stdout,stderr} contract).
// appHome may be a string/function; alternatively pass the installed helper path.
// This layer requires a local PDF; the caller downloads remote bytes first.
export const PDF_MAX_PIXELS = 16_000_000;
export const PDF_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const PDF_TIMEOUT_MS = 15_000;
export const PDF_MAX_INFO_PAGES = 10_000;
export const PDF_MAX_INFO_BYTES = 2 * 1024 * 1024;
const SUFFIX = "/mods/files-plus/helpers/render-pdf.py";
let sequence = 0;
const slashes = value => value.replace(/\\/g, "/");
const absolute = value => /^(?:\/|[A-Za-z]:\/)/.test(value) && !value.startsWith("//");
const clean = value => typeof value === "string" && value.length > 0 && !/[\0\r\n]/.test(value);

/**
 * Shared trusted configuration and local-source validation for both operations.
 * helper/python are trusted configuration, never PDF metadata.
 * Only python3/python/py are executable; py uses the Windows -3 launcher.
 * exec must enforce timeout and terminate the subprocess on expiry.
 */
function preparePdf(path, { helper, python = "python3", lease }, { exec, appHome }) {
  if (!clean(path)) throw new Error("A local PDF path is required");
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) || path.startsWith("//") || path.startsWith("\\\\")) {
    throw new Error("Remote PDF preview is not supported; use a local PDF");
  }
  if (!["python3", "python", "py"].includes(python)) throw new Error("PDF python must be python3, python or py (not an arbitrary command)");
  if (typeof exec !== "function") throw new Error("PDF preview requires an injected exec");
  let home = typeof appHome === "function" ? appHome() : appHome;
  if (home === undefined && clean(helper) && slashes(helper).endsWith(SUFFIX)) home = slashes(helper).slice(0, -SUFFIX.length);
  if (!clean(home)) throw new Error("PDF preview requires appHome or the installed helper path");
  home = slashes(home).replace(/\/+$/, "");
  if (!absolute(home) || home.split("/").some(p => p === "." || p === "..")) throw new Error("Invalid PDF appHome");
  const installedHelper = home + SUFFIX;
  if (helper !== undefined && (!clean(helper) || slashes(helper) !== installedHelper)) throw new Error("PDF helper must be appHome/mods/files-plus/helpers/render-pdf.py");
  const watched = home + "/layouts/files-plus-assets/";
  if (lease !== undefined && (!clean(lease) || !slashes(lease).startsWith(watched) ||
      !/^(?!\.{1,2}\/)[^/]+\/\.alive$/.test(slashes(lease).slice(watched.length)))) throw new Error("Invalid PDF preview lease");
  return { home, watched, python, exec, prefix: [...(python === "py" ? ["-3"] : []), "-X", "utf8", installedHelper], lease };
}

async function executePdf(config, args, maxBytes = 16_384) {
  const { python, exec, prefix, lease } = config;
  let result;
  try {
    result = await exec(python, [...prefix, ...args, ...(lease ? [lease] : [])], { timeout: PDF_TIMEOUT_MS });
  } catch (error) {
    throw new Error("PDF preview could not run (Python 3.9+ with optional pypdfium2/Pillow required; execution timeout 15s): " + String(error));
  }
  if (result?.code !== 0) {
    let detail = result?.stderr?.trim() || "helper failed";
    try { detail = JSON.parse(detail).error || detail; } catch { /* Plain interpreter errors. */ }
    throw new Error("PDF preview failed: " + String(detail).slice(0, 2000));
  }
  let meta;
  try {
    // UTF-8 byte bound, without relying on Node or TextEncoder in the host.
    if (typeof result.stdout !== "string" || result.stdout.length > maxBytes) throw new Error();
    let bytes = 0;
    for (const char of result.stdout) {
      const cp = char.codePointAt(0);
      bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes > maxBytes) throw new Error();
    }
    meta = JSON.parse(result.stdout);
  } catch { throw new Error("Invalid PDF helper JSON"); }
  return meta;
}

/**
 * inspectPdf(localPath, {helper?, python='python3', lease?}, {exec, appHome?})
 * -> {pages, sizes:[{width,height}]} in unscaled PDF points (CropBox/rotation).
 * Does not render or allocate output. Rejects >10000 pages or >2 MiB JSON.
 */
export async function inspectPdf(path, options = {}, services = {}) {
  const config = preparePdf(path, options, services);
  const meta = await executePdf(config, ["--info", path], PDF_MAX_INFO_BYTES);
  if (!meta || typeof meta !== "object" || Array.isArray(meta) ||
      !Number.isSafeInteger(meta.pages) || meta.pages < 1 || meta.pages > PDF_MAX_INFO_PAGES ||
      !Array.isArray(meta.sizes) || meta.sizes.length !== meta.pages ||
      !meta.sizes.every(size => size && typeof size === "object" && !Array.isArray(size) &&
        [size.width, size.height].every(n => Number.isFinite(n) && n > 0))) {
    throw new Error("Invalid PDF helper metadata (maximum 10000 pages; finite positive dimensions required)");
  }
  return { pages: meta.pages, sizes: meta.sizes.map(({ width, height }) => ({ width, height })) };
}

/**
 * renderPdf(localPath, {page=1, scale=1, output?, helper?, python='python3', lease?},
 *           {exec, appHome?}) -> {pages,page,width,height,path}
 * Defaults to a unique appHome/cache/files-plus/pdf/*.png; caller owns eviction.
 */
export async function renderPdf(path, { page = 1, scale = 1, output, ...options } = {}, services = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("PDF page must be a positive 1-based integer");
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 3) throw new Error("PDF scale must be between 0.25 and 3");
  const config = preparePdf(path, options, services);
  const cache = config.home + "/cache/files-plus/pdf/";
  output ??= cache + `page-${Date.now()}-${++sequence}.png`;
  if (!clean(output)) throw new Error("Invalid PDF output path");
  output = slashes(output);
  const outputRoot = output.startsWith(config.watched) ? config.watched : cache;
  if (!output.startsWith(outputRoot) || !/^[^/]+\.png$/i.test(output.slice(outputRoot.length))) throw new Error("PDF output must be a PNG directly in the controlled appHome cache");
  const meta = await executePdf(config, [path, String(page), String(scale), output]);
  if (!meta || typeof meta !== "object" || Array.isArray(meta) ||
      ![meta.pages, meta.page, meta.width, meta.height].every(n => Number.isSafeInteger(n) && n > 0) ||
      meta.page !== page || meta.page > meta.pages || meta.width * meta.height > PDF_MAX_PIXELS ||
      typeof meta.path !== "string" || slashes(meta.path) !== output) {
    throw new Error("Invalid PDF helper metadata");
  }
  return { pages: meta.pages, page: meta.page, width: meta.width, height: meta.height, path: meta.path };
}
