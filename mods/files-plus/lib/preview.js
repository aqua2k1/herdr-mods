const IMAGES = new Set(["png", "jpg", "jpeg"]);
const MARKDOWN = new Set(["md", "markdown", "mdown"]);
const BINARY = new Set(["zip", "gz", "xz", "7z", "tar", "exe", "dll", "so", "dylib", "woff", "woff2", "ttf", "mp4", "mp3", "gif", "webp", "bmp", "ico", "avif"]);

export function previewKind(path) {
  const name = path.split("/").pop();
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return IMAGES.has(ext) ? "image" : MARKDOWN.has(ext) ? "markdown" : ext === "pdf" ? "pdf" : BINARY.has(ext) ? "unsupported" : "code";
}

// A request token, not just a path: reopening the same file must invalidate old work.
export class PreviewRequests {
  constructor() { this.serial = 0; this.closed = false; }
  begin() { this.serial += 1; return this.serial; }
  current(token) { return !this.closed && token === this.serial; }
  close() { this.closed = true; this.serial += 1; }
}
