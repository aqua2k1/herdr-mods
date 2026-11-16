import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPdf, inspectPdf } from "../lib/pdf-source.js";

const run = promisify(execFile);
const python = process.env.PDF_TEST_PYTHON || "python3";
const exec = async (command, args, { timeout }) => {
  try {
    const r = await run(command, args, { timeout, maxBuffer: 2 * 1024 * 1024 });
    return { code: 0, ...r };
  } catch (e) {
    if (typeof e.code === "number") return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    throw e;
  }
};

// All test PDFs are generated locally; no downloads or dependency installation.
test("real PDF helper (optional Python pypdfium2/Pillow)", async t => {
  try { await run(python, ["-c", "import pypdfium2; from PIL import Image"], { timeout: 5000 }); }
  catch (error) { t.skip("Optional Python/pypdfium2/Pillow unavailable: " + error.message); return; }
  const home = await mkdtemp(join(tmpdir(), "files-plus PDF 中文 ' $-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const helper = join(home, "mods/files-plus/helpers/render-pdf.py");
  const cache = join(home, "cache/files-plus/pdf");
  await mkdir(join(home, "mods/files-plus/helpers"), { recursive: true });
  await copyFile(new URL("../helpers/render-pdf.py", import.meta.url), helper);
  const source = join(home, "two pages 中文 ' ; $(echo nope) [x].pdf");
  const huge = join(home, "huge.pdf");
  await run(python, ["-c", `import sys, pypdfium2 as p
with p.PdfDocument.new() as d:
 for width,height in [(200,300),(400,250)]:
  d.new_page(width,height).close()
 d.save(sys.argv[1])
with p.PdfDocument.new() as d:
 d.new_page(10000,10000).close()
 d.save(sys.argv[2])`, source, huge], { timeout: 10000 });
  const call = (path, page = 1, scale = 1, output = join(cache, "preview.png"), flags = []) =>
    exec(python, [...flags, "-X", "utf8", helper, path, String(page), String(scale), output], { timeout: 15000 });

  await t.test("two real pages render PNG with correct dimensions and scale", async () => {
    for (const [page, scale, width, height] of [[1, 1, 200, 300], [2, 0.5, 200, 125], [1, 0.25, 50, 75], [2, 3, 1200, 750]]) {
      const r = await call(source, page, scale);
      assert.equal(r.code, 0, r.stderr);
      const meta = JSON.parse(r.stdout);
      assert.deepEqual(meta, { pages: 2, page, width, height, path: join(cache, "preview.png") });
      const png = await readFile(meta.path);
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), width);
      assert.equal(png.readUInt32BE(20), height);
      assert.ok(png.length <= 16 * 1024 * 1024);
    }
  });
  const infoCall = (path, lease, flags = []) => exec(python,
    [...flags, "-X", "utf8", helper, "--info", path, ...(lease ? [lease] : [])], { timeout: 15000 });
  await t.test("info reads mixed page sizes without creating render output", async () => {
    const before = await readdir(cache);
    const result = await infoCall(source);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { pages: 2, sizes: [{ width: 200, height: 300 }, { width: 400, height: 250 }] });
    assert.deepEqual(await readdir(cache), before);
    assert.deepEqual(JSON.parse((await infoCall(huge)).stdout), { pages: 1, sizes: [{ width: 10000, height: 10000 }] });
    if (python === "python3") assert.deepEqual(await inspectPdf(source, { helper }, { exec }), JSON.parse(result.stdout));
  });
  await t.test("info CropBox and intrinsic rotation agree with rendered dimensions", async () => {
    const rotated = join(home, "crop-rotate.pdf");
    await run(python, ["-c", `import sys, pypdfium2 as p
with p.PdfDocument.new() as d:
 for rotation in (0,90,180,270):
  page=d.new_page(400,500)
  page.set_cropbox(20,30,320,430)
  page.set_rotation(rotation)
  page.close()
 d.save(sys.argv[1])`, rotated], { timeout: 10000 });
    const result = await infoCall(rotated);
    assert.equal(result.code, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.deepEqual(info, { pages: 4, sizes: [{ width: 300, height: 400 }, { width: 400, height: 300 }, { width: 300, height: 400 }, { width: 400, height: 300 }] });
    for (let page = 1; page <= info.pages; page++) {
      const rendered = await call(rotated, page);
      assert.equal(rendered.code, 0, rendered.stderr);
      const { width, height } = JSON.parse(rendered.stdout);
      assert.deepEqual({ width, height }, info.sizes[page - 1]);
    }
  });
  await t.test("info shares errors, dependencies and lease validation", async () => {
    const corrupt = join(home, "info-corrupt.pdf");
    await writeFile(corrupt, "%PDF-1.7\\nbroken");
    assert.match((await infoCall(corrupt)).stderr, /damaged|invalid/i);
    assert.match((await infoCall(source, undefined, ["-S"])).stderr, /pypdfium2.*Pillow/);
    assert.match((await infoCall("https://example.com/a.pdf")).stderr, /Remote PDF/);
    const owner = join(home, "layouts/files-plus-assets/info-owner");
    await mkdir(owner, { recursive: true });
    const lease = join(owner, ".alive");
    assert.match((await infoCall(source, lease)).stderr, /closed/);
    await writeFile(lease, "alive");
    assert.equal((await infoCall(source, lease)).code, 0);
    await rm(lease);
    assert.match((await infoCall(source, lease)).stderr, /closed/);
    assert.match((await infoCall(source, join(home, ".alive"))).stderr, /Invalid preview lease/);
  });
  await t.test("info never renders; count, dimensions, JSON and late lease budgets enforced", async () => {
    await run(python, ["-c", `import importlib.util, sys, pypdfium2 as p
s=importlib.util.spec_from_file_location('helper',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
def forbidden(*a,**k): raise AssertionError('info attempted rendering or forms/JS')
p.PdfPage.render=forbidden; p.PdfDocument.init_forms=forbidden
assert m.inspect(sys.argv[2])['pages']==2
m.MAX_INFO_PAGES=1
try: m.inspect(sys.argv[2])
except m.PreviewError as e: assert '10000' in str(e)
else: raise AssertionError('page budget not enforced')
m.MAX_INFO_PAGES=10000; m.MAX_INFO_BYTES=16
try: m.inspect(sys.argv[2])
except m.PreviewError as e: assert '2 MiB' in str(e)
else: raise AssertionError('metadata budget not enforced')
m.MAX_INFO_BYTES=2*1024*1024
for size in [(0,100),(-1,100),(float('nan'),100),(100,float('inf'))]:
 p.PdfPage.get_size=lambda self: size
 try: m.inspect(sys.argv[2])
 except m.PreviewError as e: assert 'dimensions' in str(e)
 else: raise AssertionError('invalid dimensions accepted')
p.PdfPage.get_size=lambda self: (100,200)
calls=0
def revoked(lease):
 global calls
 calls+=1
 return calls<4
m.check_lease=revoked
try: m.inspect(sys.argv[2], 'test')
except m.PreviewError as e: assert 'closed' in str(e)
else: raise AssertionError('late revoked lease accepted')`, helper, source], { timeout: 15000 });
  });
  await t.test("JS source integrates with real helper", async st => {
    if (python !== "python3") { st.skip("integration uses default python3"); return; }
    const meta = await renderPdf(source, { page: 2, scale: 1, helper }, { exec });
    assert.equal(meta.pages, 2);
    assert.equal(meta.width, 400);
    await readFile(meta.path);
  });
  await t.test("page errors, corrupt/encrypted input, scale and pixel budgets", async () => {
    for (const page of [0, -1, 3]) {
      const r = await call(source, page);
      assert.notEqual(r.code, 0);
      assert.match(JSON.parse(r.stderr).error, /page/i);
    }
    for (const scale of [0.1, 3.1, "nan"]) {
      assert.match((await call(source, 1, scale)).stderr, /scale/);
    }
    const corrupt = join(home, "corrupt.pdf");
    await writeFile(corrupt, "%PDF-1.7\nbroken");
    assert.match((await call(corrupt)).stderr, /damaged|invalid/i);
    assert.match((await call(huge)).stderr, /pixel budget/);
  });
  await t.test("encrypted PDF explicitly rejected (fitz only a test fixture dependency)", async st => {
    try { await run(python, ["-c", "import fitz"], { timeout: 5000 }); }
    catch { st.skip("Optional fitz test fixture dependency unavailable"); return; }
    for (const password of ["secret", ""]) {
      const encrypted = join(home, "encrypted.pdf");
      await rm(encrypted, { force: true });
      await run(python, ["-c", `import fitz, sys
with fitz.open(sys.argv[1]) as d:
 d.save(sys.argv[2], encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner-secret', user_pw=sys.argv[3])`, source, encrypted, password], { timeout: 10000 });
      assert.match((await call(encrypted)).stderr, /[Ee]ncrypted/);
      assert.match((await infoCall(encrypted)).stderr, /[Ee]ncrypted/);
    }
  });
  await t.test("missing dependencies are actionable; output cannot escape cache", async () => {
    const missing = await call(source, 1, 1, join(cache, "missing.png"), ["-S"]);
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /pypdfium2.*Pillow/);
    const outside = join(home, "outside.png");
    assert.match((await call(source, 1, 1, outside)).stderr, /output/);
    assert.match((await call("https://example.com/a.pdf")).stderr, /Remote PDF/);
    assert.ok(!(await readdir(home)).includes("outside.png"));
  });
  await t.test("watched assets render, and revoking a lease prevents late helper output", async () => {
    await run(python, ["-c", `import importlib.util, pathlib, sys
s=importlib.util.spec_from_file_location('helper',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
home=pathlib.Path(sys.argv[1]).resolve().parents[3]; assets=home/'layouts/files-plus-assets'; owner=assets/'test-owner'; owner.mkdir(parents=True)
lease=owner/'.alive'; lease.write_text('alive'); output=assets/'watched.png'
m.render(sys.argv[2],1,1,str(output),str(lease)); assert output.is_file(); output.unlink()
original=m.os.replace
def replace_then_close(source,target):
 lease.unlink(); original(source,target)
m.os.replace=replace_then_close
try: m.render(sys.argv[2],1,1,str(output),str(lease))
except m.PreviewError as e: assert 'closed' in str(e)
else: raise AssertionError('revoked lease accepted')
assert not output.exists(); assert not list(assets.glob('*.tmp'))`, helper, source], { timeout: 15000 });
  });
  await t.test("PNG output budget bounds writes and removes partial files", async () => {
    // Exercise writer deterministically without relying on PNG compressibility.
    await run(python, ["-c", `import importlib.util, io, sys
s=importlib.util.spec_from_file_location('helper', sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
f=io.BytesIO(); w=m.BoundedWriter(f); w.write(b'x' * m.MAX_OUTPUT)
try: w.write(b'x')
except m.PreviewError: pass
else: raise AssertionError('budget not enforced')
assert len(f.getvalue()) == m.MAX_OUTPUT
# Force a real render to exceed its output cap and verify temp-file cleanup.
m.MAX_OUTPUT=16
try: m.render(sys.argv[2], 1, 1, sys.argv[3])
except m.PreviewError: pass
else: raise AssertionError('render budget not enforced')`, helper, source, join(cache, "budget.png")], { timeout: 15000 });
    assert.ok(!(await readdir(cache)).some(name => name.endsWith(".tmp") || name === "budget.png"));
  });
  await t.test("cache symlink escape rejected (Linux verified)", async st => {
    if (process.platform === "win32") { st.skip("symlink creation may need privileges on Windows"); return; }
    await rm(join(home, "cache"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "files-plus-outside-"));
    st.after(() => rm(outside, { recursive: true, force: true }));
    await symlink(outside, join(home, "cache"));
    assert.match((await call(source)).stderr, /inside appHome/);
    assert.deepEqual(await readdir(outside), []);
  });
});
