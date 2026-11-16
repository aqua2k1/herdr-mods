// Real GPUI window + real files, not mocks. Requires a working desktop/display,
// herdr-app, Python 3 with Pillow/pypdfium2; --remote NAME also uses a connected hc.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remote = process.argv.includes("--remote") ? process.argv[process.argv.indexOf("--remote") + 1] : null;
if (process.argv.includes("--remote") && !remote) throw new Error("--remote requires a connected machine name");
const cache = path.join(homedir(), ".cache"); await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, "files-plus-live-"));
const home = path.join(root, "app"), fixtures = path.join(root, "fixtures");
const env = { ...process.env, HERDR_APP_HOME: home, HERDR_TELEMETRY: "0" };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const app = async (...args) => {
  const { stdout } = await run("herdr-app", args, { env, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (args[0] !== "shot" && stdout.trim().startsWith("{")) {
    const result = JSON.parse(stdout); if (result.error) throw new Error(result.error);
  }
  return stdout.trim();
};
const requests = [];
const server = http.createServer((req, res) => { requests.push(req.url); res.writeHead(404); res.end(); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let processApp, remoteRoot;
const cases = [], artifacts = [], rssKiB = [];
async function remoteExec(command, args = []) {
  const { stdout } = await run("hc", ["exec", "--json", "--on", remote, "--timeout", "30", "--", command, ...args], { timeout: 40000, maxBuffer: 16 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result.error || result.code !== 0 || result.timed_out) throw new Error(JSON.stringify(result));
  return Buffer.from(result.stdout || "", "base64").toString("utf8");
}
async function show(file, on = null, folder = fixtures) {
  await writeFile(path.join(home, "layouts", "files-plus-live.json"), JSON.stringify({
    id: "files-plus-live", type: "block", content: { mod: "files-plus", props: { role: file ? "preview" : "sidebar", root: folder, on, ...(file ? { file } : {}) } },
  }));
  await pause(on ? 4500 : 900);
}
async function shot(name, color) {
  const file = path.join(root, name + ".png"); await app("shot", file); artifacts.push(file);
  if (color) await run("python3", ["-c", "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGB'); c=tuple(bytes.fromhex(sys.argv[2])); n=sum(1 for p in im.getdata() if sum(abs(a-b) for a,b in zip(p,c))<12); assert n>500, f'Expected rendered content color {c}, got {n} pixels'", file, color]);
  cases.push(name);
}
try {
  await mkdir(fixtures, { recursive: true }); await mkdir(path.join(home, "mods"), { recursive: true });
  await writeFile(path.join(home, "shared.json"), JSON.stringify({ "frame.welcomed": "finished" }));
  await cp(path.join(repo, "mods", "files-plus"), path.join(home, "mods", "files-plus"), { recursive: true,
    filter: source => !source.endsWith(".d.ts") && !source.endsWith("jsconfig.json") &&
      !path.relative(path.join(repo, "mods", "files-plus"), source).split(path.sep).includes("test") });
  await run("python3", ["-c", `
from pathlib import Path
from PIL import Image,ImageDraw
import sys
root=Path(sys.argv[1]); im=Image.new('RGB',(1600,1000),'#18324c'); d=ImageDraw.Draw(im)
for x in range(0,1600,100): d.line((x,0,x,1000),fill='#376080')
for y in range(0,1000,100): d.line((0,y,1600,y),fill='#376080')
d.rectangle((400,250,1200,750),outline='#ffb545',width=8)
d.text((550,490),'Files Plus - ORIGINAL 1600 x 1000',fill='white')
im.save(root/'图片 test.png'); im.save(root/'photo.jpg')
b=(root/'图片 test.png').read_bytes(); (root/'boundary.png').write_bytes(b+b'\\0'*(5*1024*1024-len(b)))
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>']
for n,w,h,label,color in [(3,600,800,'PDF PAGE ONE','1 0 0'),(5,800,600,'PDF PAGE TWO','0 0 1')]:
 content=f'{color} rg 60 60 200 140 re f BT /F1 32 Tf 60 {h-80} Td ({label}) Tj ET'.encode()
 objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /Font << /F1 7 0 R >> >> /Contents {n+1} 0 R >>'.encode())
 objects.append(b'<< /Length '+str(len(content)).encode()+b' >>\\nstream\\n'+content+b'\\nendstream')
objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
pdf=b'%PDF-1.4\\n'; offsets=[0]
for n,obj in enumerate(objects,1): offsets.append(len(pdf)); pdf+=f'{n} 0 obj\\n'.encode()+obj+b'\\nendobj\\n'
xref=len(pdf); pdf+=f'xref\\n0 {len(offsets)}\\n0000000000 65535 f \\n'.encode()
for offset in offsets[1:]: pdf+=f'{offset:010d} 00000 n \\n'.encode()
pdf+=f'trailer\\n<< /Size {len(offsets)} /Root 1 0 R >>\\nstartxref\\n{xref}\\n%%EOF\\n'.encode(); (root/'two pages.pdf').write_bytes(pdf)
(root/'hello.ts').write_text('interface Preview { readonly original: boolean; }\\nconst value: Preview = { original: true };\\nconsole.log(value);\\n')
(root/'broken.png').write_bytes(b'not a PNG')
(root/'subfolder').mkdir()
`, fixtures]);
  await writeFile(path.join(fixtures, "README.md"), `# Files Plus real preview\n\n**Native Markdown** with \`inline code\`.\n\n- Code\n- Image\n\n| Type | View |\n| --- | --- |\n| Code | Native editor |\n\n\`\`\`js\nconst original = true;\n\`\`\`\n\n![blocked](http://127.0.0.1:${port}/image.png)\n\n<img src="http://127.0.0.1:${port}/html.png">\n\n![ref][remote]\n[remote]: http://127.0.0.1:${port}/reference.png\n`);
  await app("check", path.join(home, "mods", "files-plus"));
  const log = await import("node:fs").then(fs => fs.openSync(path.join(root, "app.log"), "w"));
  processApp = spawn("herdr-app", [], { env, stdio: ["ignore", log, log] });
  await import("node:fs").then(fs => fs.closeSync(log));
  let ready = false;
  for (let n = 0; n < 60; n++) { try { await app("status"); ready = true; break; } catch { await pause(500); } }
  assert.ok(ready, "GPUI window did not start; inspect " + path.join(root, "app.log"));
  await show(null); await app("do", "layout.switch", JSON.stringify({ name: "files-plus-live" })); await pause(800);
  await shot("01-tree");
  await show("图片 test.png"); await shot("02-image-fit", "18324c");
  await app("do", "files-plus.actual"); await pause(250); await shot("03-image-100", "18324c");
  await app("do", "files-plus.zoom-in"); await pause(250); await shot("04-image-125", "18324c");
  await show("photo.jpg"); await shot("05-jpeg", "18324c");
  await show("boundary.png"); await pause(1500); await shot("05b-local-5MiB-image", "18324c");
  await show("README.md"); await shot("06-markdown");
  await app("do", "files-plus.source"); await pause(250); await shot("07-markdown-source");
  await pause(500); assert.deepEqual(requests, [], "Markdown made implicit network requests"); cases.push("markdown-network-zero");
  await show("hello.ts"); await shot("08-code");
  await show("two pages.pdf"); await pause(1000); await shot("09-pdf-page-1", "ff0000");
  await app("do", "files-plus.next"); await pause(1000); await shot("10-pdf-page-2", "0000ff");
  await app("do", "files-plus.actual");
  for (let n = 0; n < 4; n++) await app("do", "files-plus.zoom-out");
  await app("do", "files-plus.previous"); await pause(1600);
  await shot("10b-pdf-continuous-two-pages", "ff0000");
  await run("python3", ["-c", "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGB'); n=sum(1 for p in im.getdata() if sum(abs(a-b) for a,b in zip(p,(0,0,255)))<12); assert n>500, f'Second PDF page not visible together with first: {n} pixels'", path.join(root, "10b-pdf-continuous-two-pages.png")]);
  await show("broken.png"); await shot("11-corrupt-image-error");
  if (process.argv.includes("--stress")) {
    for (let n = 0; n < 12; n++) {
      await show(n % 2 ? "photo.jpg" : "图片 test.png");
      if (process.platform === "linux") {
        const status = await readFile(`/proc/${processApp.pid}/status`, "utf8");
        rssKiB.push(Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]));
      }
    }
    cases.push("12-image-switches");
  }
  if (remote) {
    // This live fixture runner targets a POSIX remote with Python; source-layer
    // Windows execution is covered separately by the real PowerShell tests.
    remoteRoot = `/tmp/files-plus-live-${randomUUID()}`;
    await remoteExec("python3", ["-c", "from pathlib import Path; import sys; Path(sys.argv[1]).mkdir(mode=0o700)", remoteRoot]);
    const png = (await readFile(path.join(fixtures, "图片 test.png"))).toString("base64");
    const pdf = (await readFile(path.join(fixtures, "two pages.pdf"))).toString("base64");
    await remoteExec("python3", ["-c", "import base64,sys; from pathlib import Path; p=Path(sys.argv[1]); b=base64.b64decode(sys.argv[2]); (p/'remote.png').write_bytes(b+b'\\0'*(5*1024*1024-len(b))); (p/'remote.pdf').write_bytes(base64.b64decode(sys.argv[3]))", remoteRoot, png, pdf]);
    await show("remote.png", remote, remoteRoot); await shot("12-remote-5MiB-image", "18324c");
    await show("remote.pdf", remote, remoteRoot); await pause(1500); await shot("13-remote-pdf", "ff0000");
  }
  // Standalone renderer harness has no model pane to close; replace it with the tree.
  await show(null); await pause(700);
  const status = JSON.parse(await app("status"));
  assert.deepEqual(status.errors.filter(e => /files-plus/i.test(e)), [], "MOD reported an error");
  await run("python3", ["-c", "from pathlib import Path; import sys; p=Path(sys.argv[1]); files=[str(f) for base in [p/'layouts/files-plus-assets',p/'data/files-plus',p/'cache/files-plus'] if base.exists() for f in base.rglob('*') if f.is_file() and f.name != '.alive']; assert not files, files", home]);
  cases.push("cache-files-released");
  const report = { host: await app("--version"), platform: process.platform, remote, cases, markdownRequests: requests, rssKiB, status, artifacts };
  await writeFile(path.join(root, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: cases.length, artifacts: root, report: path.join(root, "results.json") }, null, 2));
} catch (error) {
  await writeFile(path.join(root, "failure.json"), JSON.stringify({ error: error.message, cases, artifacts }, null, 2));
  console.error("Live test failed; artifacts:", root);
  throw error;
} finally {
  if (remoteRoot) await remoteExec("python3", ["-c", "import shutil,sys; shutil.rmtree(sys.argv[1])", remoteRoot]).catch(e => console.error("Remote cleanup failed:", e.message));
  processApp?.kill("SIGTERM");
  await new Promise(resolve => server.close(resolve));
}
