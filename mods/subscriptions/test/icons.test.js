import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROVIDERS } from "../providers/index.js";

test("each configured provider icon is bundled locally with explicit tint behavior", async () => {
  for (const provider of PROVIDERS) {
    assert.match(provider.icon.path, /^icons\/[a-z0-9-]+\.svg$/);
    assert.equal(typeof provider.icon.tint, "boolean");
    const asset = await readFile(new URL("../" + provider.icon.path, import.meta.url), "utf8");
    assert.match(asset, /<svg\b/);
    assert.match(asset, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(asset, /<script\b|(?:href|src)="https?:/i);
  }
});
