import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resources } from "../lib/resources.js";

test("media assets use watched paths; close revokes the lease and deletes owned files", async t => {
  const home = await mkdtemp(join(tmpdir(), "files-plus-resources-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const resources = new Resources(home);
  const value = await resources.image({ bytes: new Uint8Array([1, 2]), extension: "png", width: 2, height: 1 });
  assert.match(value.asset, /^layouts\/files-plus-assets\//);
  assert.equal(await readFile(resources.lease, "utf8"), "alive");
  assert.deepEqual([...await readFile(value.path)], [1, 2]);
  await resources.close();
  await assert.rejects(readFile(resources.lease)); await assert.rejects(readFile(value.path));
  await assert.rejects(resources.init(), /closed/); assert.throws(() => resources.allocate("png"), /closed/);
});

test("late cleanup is idempotent even after close cleared the ownership set", async t => {
  const home = await mkdtemp(join(tmpdir(), "files-plus-resources-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const resources = new Resources(home); await resources.init();
  const output = resources.allocatePdf(); await resources.close();
  await mkdir(join(home, "layouts/files-plus-assets"), { recursive: true });
  await writeFile(output.path, "late");
  await resources.remove(output); await assert.rejects(readFile(output.path));
  await resources.remove(output);
});
