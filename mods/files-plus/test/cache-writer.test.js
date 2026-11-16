import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename, readdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { encodeBase64, encodeBase64Cooperative } from "../lib/base64.js";
import { decodeBase64Cooperative } from "../lib/file-source.js";
import { Resources } from "../lib/resources.js";

const argsOf = args => [...args[3].matchAll(/'((?:[^']|'')*)'/g)].slice(-4).map(match => match[1].replaceAll("''", "'"));

test("pure JS Base64 matches native encoding, including chunk boundaries and 5 MiB", () => {
  for (const size of [0, 1, 2, 3, 12287, 12288, 12289, 5 * 1024 * 1024]) {
    const bytes = randomBytes(size); assert.equal(encodeBase64(bytes), bytes.toString("base64"));
  }
  assert.throws(() => encodeBase64(new Uint8Array(5 * 1024 * 1024 + 1)), /5 MiB/);
});

test("large media codecs yield between small blocks to respect native VM budgets", async () => {
  const bytes = randomBytes(200000); let yields = 0;
  const encoded = await encodeBase64Cooperative(bytes, async () => { yields++; });
  assert.equal(encoded, bytes.toString("base64")); assert.ok(yields > 1);
  yields = 0;
  const decoded = await decodeBase64Cooperative(encoded, async () => { yields++; });
  assert.deepEqual(Buffer.from(decoded), bytes); assert.ok(yields > 1);
  let current = true;
  await assert.rejects(decodeBase64Cooperative(encoded, async () => { current = false; }, () => current), /stale/);
  await assert.rejects(decodeBase64Cooperative("A".repeat(65532) + "AA==" + "AAAA", async () => {}), /Base64/);
});

test("Windows adapter stages text and publishes exact bytes without a large argv", async t => {
  const home = await mkdtemp(join(tmpdir(), "files-plus cache 中文 ' quoted-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bytes = randomBytes(5 * 1024 * 1024); let calls = 0;
  const resources = new Resources(home, { platform: "windows", exec: async (command, args, options) => {
    calls++; assert.equal(command, "powershell"); assert.equal(options.timeout, 30000);
    assert.ok(args[3].length < 5000); assert.match(args[3], /\[IO.File\]::Move/);
    const [encoded, temporary, output, lease] = argsOf(args);
    await access(lease);
    const staged = await readFile(encoded, "utf8"); assert.equal(staged, bytes.toString("base64"));
    await writeFile(temporary, Buffer.from(staged, "base64")); await rename(temporary, output);
    return { code: 0, stdout: "", stderr: "" };
  } });
  const resource = await resources.binary(bytes, "png");
  assert.deepEqual(await readFile(resource.path), bytes); assert.equal(calls, 1);
  assert.deepEqual(await readdir(resources.writer.directory), []);
  await resources.close(); await assert.rejects(readFile(resource.path));
});

test("Windows publish errors clean staging and cannot leave an empty asset", async t => {
  const home = await mkdtemp(join(tmpdir(), "files-plus-cache-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const resources = new Resources(home, { platform: "win32", exec: async () => ({ code: 1, stderr: "write denied" }) });
  await assert.rejects(resources.binary(new Uint8Array([0, 255]), "png"), /write denied/);
  assert.equal(resources.files.size, 0); assert.deepEqual(await readdir(resources.writer.directory), []);
  await resources.close();
});

test("other platforms retain direct native binary writes", async t => {
  const home = await mkdtemp(join(tmpdir(), "files-plus-cache-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const resources = new Resources(home, { platform: "linux", exec() { assert.fail("no platform helper needed"); } });
  const resource = await resources.binary(new Uint8Array([0, 128, 255]), "png");
  assert.deepEqual([...await readFile(resource.path)], [0, 128, 255]); await resources.close();
});
