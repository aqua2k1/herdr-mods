import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { PlatformCacheWriter } from "./platform-compat.js";

// Bind host services without coupling binary reads to filesystem/crypto imports.
export class CacheWriter extends PlatformCacheWriter {
  constructor(options) {
    super({ ...options, fs, randomUUID });
  }
}
