import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { CacheWriter } from "./cache-writer.js";

// Herdr watches layouts/ assets and evicts decoded GPUI images on deletion.
// data/ and cache/ are NOT watched: unlink alone would leak the native cache.
// These PNG/JPEG assets never change layout JSON or MOD source.
export class Resources {
  constructor(home, { platform, exec } = {}) {
    this.base = home.replace(/[\\/]$/, "");
    const owner = randomUUID();
    this.relative = `layouts/files-plus-assets/${owner}`;
    this.directory = `${this.base}/${this.relative}`;
    this.files = new Set(); this.closed = false;
    this.lease = `${this.directory}/.alive`;
    this.writer = new CacheWriter({ platform, exec, lease: this.lease,
      directory: `${this.base}/data/files-plus-staging/${owner}` });
  }

  async init() {
    if (this.closed) throw new Error("Preview resources are closed");
    this.initializing ??= (async () => {
      await fs.mkdir(this.directory, { recursive: true });
      if (this.closed) throw new Error("Preview resources are closed");
      await fs.writeFile(this.lease, "alive");
      if (this.closed) {
        await fs.unlink(this.lease).catch(() => {});
        throw new Error("Preview resources are closed");
      }
    })();
    await this.initializing;
  }

  allocate(extension) {
    if (this.closed) throw new Error("Preview resources are closed");
    if (!/^[a-z0-9]+$/.test(extension)) throw new Error("Invalid cache file type");
    const asset = `${this.relative}/${randomUUID()}.${extension}`;
    const path = `${this.base}/${asset}`;
    this.files.add(path);
    return { path, asset };
  }

  allocatePdf() {
    if (this.closed) throw new Error("Preview resources are closed");
    const asset = `layouts/files-plus-assets/${randomUUID()}.png`;
    const path = `${this.base}/${asset}`;
    this.files.add(path);
    return { path, asset };
  }

  async binary(bytes, extension, options) {
    await this.init();
    const target = this.allocate(extension);
    try { await this.writer.write(target.path, bytes, options); }
    catch (e) { await this.remove(target); throw e; }
    return target;
  }

  async image(value, options) {
    const target = await this.binary(value.bytes, value.extension, options);
    return { ...target, width: value.width, height: value.height };
  }

  async remove(resource) {
    if (!resource?.path || !resource.path.startsWith(`${this.base}/layouts/files-plus-assets/`)) return;
    await fs.unlink(resource.path).catch(() => {});
    this.files.delete(resource.path);
  }

  async close() {
    this.closed = true;
    await fs.unlink(this.lease).catch(() => {});
    await Promise.all([...this.files].map(path => fs.unlink(path).catch(() => {})));
    this.files.clear();
    await this.writer.close();
    await fs.rmdir(this.directory).catch(() => {});
  }
}
