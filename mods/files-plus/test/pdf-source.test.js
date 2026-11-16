import test from "node:test";
import assert from "node:assert/strict";
import { renderPdf, inspectPdf, PDF_TIMEOUT_MS, PDF_MAX_INFO_BYTES } from "../lib/pdf-source.js";

const home = "/tmp/Herdr home";
const helper = home + "/mods/files-plus/helpers/render-pdf.py";
const output = home + "/cache/files-plus/pdf/page.png";
const meta = { pages: 2, page: 1, width: 200, height: 300, path: output };
const success = stdout => async () => ({ code: 0, stdout: JSON.stringify(stdout), stderr: "" });

test("fixed argv preserves special characters, sets timeout, and validates JSON", async () => {
  const path = "/tmp/中文 ' ; $(touch nope) [x].pdf";
  let call;
  assert.deepEqual(await renderPdf(path, { output, helper }, { exec: async (...args) => {
    call = args;
    return { code: 0, stdout: JSON.stringify(meta) };
  } }), meta);
  assert.deepEqual(call, ["python3", ["-X", "utf8", helper, path, "1", "1", output], { timeout: PDF_TIMEOUT_MS }]);
});

test("appHome resolves installed helper and allocates unique cache outputs", async () => {
  const paths = [];
  const exec = async (command, args) => {
    assert.equal(args[2], helper);
    const path = args.at(-1);
    paths.push(path);
    return { code: 0, stdout: JSON.stringify({ ...meta, path }) };
  };
  await Promise.all([renderPdf("a.pdf", {}, { exec, appHome: () => home }), renderPdf("a.pdf", {}, { exec, appHome: home })]);
  assert.equal(new Set(paths).size, 2);
  assert.ok(paths.every(path => path.startsWith(home + "/cache/files-plus/pdf/")));
});

test("invalid pages, scales, remote sources and output escape are rejected before exec", async () => {
  const exec = () => assert.fail("must not execute");
  for (const options of [{ page: 0 }, { page: 1.5 }, { scale: NaN }, { scale: 0.24 }, { scale: 3.01 },
    { output: "/tmp/escape.png" }, { output: home + "/cache/files-plus/pdf/../escape.png" },
    { python: "sh" }, { python: "python3 -c evil" }, { helper: "/tmp/evil.py" }]) {
    await assert.rejects(renderPdf("local.pdf", options, { exec, appHome: home }));
  }
  for (const path of ["https://example.com/a.pdf", "file:///tmp/a.pdf", "//host/a.pdf", "\\\\host\\a.pdf", "bad\0.pdf"]) {
    await assert.rejects(renderPdf(path, {}, { exec, appHome: home }));
  }
});

test("Windows launcher uses -3 and argv; Windows/macOS paths supported without Node path APIs", async () => {
  const winHome = "C:\\Users\\Test User\\Herdr";
  await renderPdf("C:\\PDFs\\a & b.pdf", { python: "py" }, { appHome: winHome, exec: async (command, args, opts) => {
    assert.equal(command, "py");
    assert.deepEqual(args.slice(0, 3), ["-3", "-X", "utf8"]);
    assert.equal(args[3], "C:/Users/Test User/Herdr/mods/files-plus/helpers/render-pdf.py");
    assert.equal(opts.timeout, PDF_TIMEOUT_MS);
    return { code: 0, stdout: JSON.stringify({ ...meta, path: args.at(-1).replaceAll("/", "\\") }) };
  } });
  await renderPdf("/Users/test/a.pdf", {}, { appHome: "/Users/test/Herdr", exec: async (_, args) => ({
    code: 0, stdout: JSON.stringify({ ...meta, path: args.at(-1) }),
  }) });
});

test("rejects malformed, inconsistent, oversized or redirected helper metadata", async () => {
  for (const value of [null, [], { ...meta, page: 2 }, { ...meta, pages: 0 }, { ...meta, width: 1.2 },
    { ...meta, width: 10000, height: 10000 }, { ...meta, path: "/tmp/outside.png" }]) {
    await assert.rejects(renderPdf("a.pdf", { helper, output }, { exec: success(value) }), /metadata/);
  }
  for (const stdout of ["not json", "x".repeat(17000)]) {
    await assert.rejects(renderPdf("a.pdf", { helper, output }, { exec: async () => ({ code: 0, stdout }) }), /JSON/);
  }
});

test("inspect uses fixed info argv, shared configuration and optional lease", async () => {
  const path = "/tmp/中文 ' ; $(touch nope) [x].pdf";
  const lease = home + "/layouts/files-plus-assets/owner/.alive";
  const info = { pages: 2, sizes: [{ width: 200.5, height: 300 }, { width: 250, height: 400 }] };
  for (const python of ["python3", "python", "py"]) {
    assert.deepEqual(await inspectPdf(path, { helper, python, lease }, { exec: async (...args) => {
      assert.deepEqual(args, [python, [...(python === "py" ? ["-3"] : []), "-X", "utf8", helper, "--info", path, lease], { timeout: PDF_TIMEOUT_MS }]);
      return { code: 0, stdout: JSON.stringify(info) };
    } }), info);
  }
  await inspectPdf("a.pdf", {}, { appHome: () => home, exec: success(info) });
  const winHome = "C:\\Users\\Test User\\Herdr";
  await inspectPdf("C:\\a.pdf", { python: "py" }, { appHome: winHome, exec: async (_, args) => {
    assert.deepEqual(args, ["-3", "-X", "utf8", "C:/Users/Test User/Herdr/mods/files-plus/helpers/render-pdf.py", "--info", "C:\\a.pdf"]);
    return { code: 0, stdout: JSON.stringify(info) };
  } });
});

test("inspect rejects unsafe configuration before exec", async () => {
  const exec = () => assert.fail("must not execute");
  for (const path of ["", "https://example.com/a.pdf", "file:///a.pdf", "//host/a.pdf", "\\\\host\\a.pdf", "bad\0.pdf"]) {
    await assert.rejects(inspectPdf(path, {}, { exec, appHome: home }));
  }
  for (const options of [{ python: "sh" }, { python: "python3 -c evil" }, { helper: "/tmp/evil.py" },
    { lease: "/tmp/.alive" }, { lease: home + "/layouts/files-plus-assets/../.alive" }, { lease: "" }]) {
    await assert.rejects(inspectPdf("a.pdf", options, { exec, appHome: home }));
  }
});

test("inspect validates count, sizes and separate 2 MiB UTF-8 budget", async () => {
  const info = { pages: 1, sizes: [{ width: 100.25, height: 200.5 }] };
  for (const value of [null, [], {}, { ...info, pages: 0 }, { ...info, pages: 1.5 }, { ...info, pages: 10001 },
    { ...info, sizes: [] }, { ...info, sizes: {} }, ...[null, [], {}, { width: 0, height: 1 },
      { width: -1, height: 1 }, { width: "100", height: 1 }, { width: 1, height: null }].map(size => ({ pages: 1, sizes: [size] }))]) {
    await assert.rejects(inspectPdf("a.pdf", { helper }, { exec: success(value) }), /metadata/);
  }
  const large = { pages: 10000, sizes: Array.from({ length: 10000 }, () => ({ width: 100.25, height: 200.5 })) };
  assert.ok(JSON.stringify(large).length > 16384);
  assert.deepEqual(await inspectPdf("a.pdf", { helper }, { exec: success(large) }), large);
  for (const stdout of ["not json", '{"pages":1,"sizes":[{"width":1e999,"height":1}]}',
    " ".repeat(PDF_MAX_INFO_BYTES + 1), JSON.stringify({ ...info, extra: "中".repeat(750000) })]) {
    await assert.rejects(inspectPdf("a.pdf", { helper }, { exec: async () => ({ code: 0, stdout }) }), /JSON|metadata/);
  }
  const exact = JSON.stringify(info).padEnd(PDF_MAX_INFO_BYTES, " ");
  assert.deepEqual(await inspectPdf("a.pdf", { helper }, { exec: async () => ({ code: 0, stdout: exact }) }), info);
});

test("inspect reuses dependency/encryption and timeout errors", async () => {
  await assert.rejects(inspectPdf("a.pdf", { helper }, { exec: async () => ({ code: 1, stderr: '{"error":"Encrypted PDF"}' }) }), /Encrypted PDF/);
  await assert.rejects(inspectPdf("a.pdf", { helper }, { exec: async () => { throw new Error("timed out"); } }), /Python 3.9.*pypdfium2\/Pillow.*timed out/);
});

test("dependency/corruption and timeout errors are clear", async () => {
  await assert.rejects(renderPdf("a.pdf", { helper, output }, { exec: async () => ({ code: 1, stderr: '{"error":"Encrypted PDF"}' }) }), /Encrypted PDF/);
  await assert.rejects(renderPdf("a.pdf", { helper, output }, { exec: async () => { throw new Error("timed out"); } }), /Python 3.9.*pypdfium2\/Pillow.*timed out/);
});
