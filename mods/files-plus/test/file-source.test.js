import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm, truncate, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_IMAGE_BYTES, IMAGE_CHUNK_BYTES, decodeBase64, parseImageDimensions, readBinary, readImage, readText } from '../lib/file-source.js';

const run = promisify(execFile);
const sh = await readFile(new URL('../helpers/read-image.sh', import.meta.url), 'utf8');
const ps = await readFile(new URL('../helpers/read-image.ps1', import.meta.url), 'utf8');
const imageWithScript = (path, on, options = {}) => readImage(path, on, { script: options.platform === 'win32' ? ps : sh, ...options });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const version = 'a'.repeat(64);
const response = (bytes, offset = 0, count = IMAGE_CHUNK_BYTES, v = version) =>
  `FILES_PLUS_IMAGE_V2\n${offset}\n${bytes.length}\n${Math.ceil(bytes.length / IMAGE_CHUNK_BYTES)}\n${Math.min(count, bytes.length - offset)}\n${v}\n${bytes.subarray(offset, offset + count).toString('base64')}\n`;
const mockExec = bytes => async (command, args) => {
  const [offset, count] = command === 'sh' ? args.slice(4,6).map(Number) :
    [...args[3].matchAll(/'([0-9]+)'/g)].slice(-2).map(m => Number(m[1]));
  return {code:0, stdout:response(bytes,offset,count)};
};
const nativeExec = async (command, args) => {
  try { const r = await run(command, args, { maxBuffer: 12 * 1024 * 1024 }); return { ...r, code: 0 }; }
  catch (e) { if (typeof e.code !== 'number') throw e; return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
};


test('isCurrent stops before first request, next chunk, final check and fallback', async () => {
  const bytes=Buffer.alloc(MAX_IMAGE_BYTES); png.copy(bytes);
  let calls=0;
  await assert.rejects(readBinary('p','remote',{scripts:{posix:sh},isCurrent:()=>false,exec:async()=>{ calls++; }}), /stale/);
  assert.equal(calls,0);
  for (const stopAfter of [1,5]) {
    calls=0; let current=true;
    await assert.rejects(readImage('p','remote',{scripts:{posix:sh},isCurrent:()=>current,exec:async(c,a)=>{
      const r=await mockExec(bytes)(c,a);
      if(++calls===stopAfter) current=false;
      return r;
    }}),/stale/);
    assert.equal(calls,stopAfter);
  }
  // Expiry between response processing and issuing the next request.
  let checks=0; calls=0;
  await assert.rejects(readBinary('p','remote',{scripts:{posix:sh},isCurrent:()=>++checks<3,exec:async(c,a)=>{
    calls++; return mockExec(bytes)(c,a);
  }}),/stale/);
  assert.equal(calls,1);
  let current=true; calls=0;
  await assert.rejects(readBinary('p','remote',{scripts:{posix:sh,windows:ps},isCurrent:()=>current,exec:async()=>{
    calls++; current=false; throw Object.assign(Error('missing'),{code:'ENOENT'});
  }}),/stale/);
  assert.equal(calls,1);
});

test('binary export returns untyped media and empty bytes without image parsing', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('%PDF-1.7\nnot an image'), Buffer.from([0,255,1,2])]) {
    const result=await readBinary('media','remote',{scripts:{posix:sh,windows:ps},exec:mockExec(bytes)});
    assert.ok(result instanceof Uint8Array);
    assert.deepEqual(Buffer.from(result),bytes);
  }
});

test('real POSIX detects same-size edits, replacements and final-check mutations', {skip:process.platform==='win32'}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'files-plus-version-'));
  try {
    const file=join(dir,'image');
    const original=Buffer.alloc(IMAGE_CHUNK_BYTES+100); png.copy(original);
    for (const mutation of ['same-size','replace','final']) {
      await writeFile(file,original);
      let calls=0;
      const exec=async (c,a) => {
        const r=await nativeExec(c,a);
        if (++calls === (mutation==='final' ? 2 : 1)) {
          const changed=Buffer.from(original); changed[changed.length-1]=1;
          if (mutation==='replace') { await rm(file); await writeFile(file,original); }
          else await writeFile(file,changed);
        }
        return r;
      };
      await assert.rejects(readBinary(file,null,{scripts:{posix:sh},exec}), /changed/);
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});

// Opt-in actual hc --on remote roundtrip; never changes machine/core lifecycle.
test('live hc remote: exact 5 MiB valid PNG, bounded replies, checksum, cleanup',
  {skip:!process.env.FILES_PLUS_REMOTE}, async t => {
    const machine=process.env.FILES_PLUS_REMOTE;
    let maxReply=0, requests=0;
    const hc=async(c,a=[])=>{
      const r=await run('hc',['exec','--json','--on',machine,c,...a],
        {maxBuffer:4*1024*1024,timeout:45000});
      maxReply=Math.max(maxReply,Buffer.byteLength(r.stdout));
      const value=JSON.parse(r.stdout);
      assert.equal(value.truncated,false);
      assert.equal(value.timed_out,false);
      return {...value,stdout:Buffer.from(value.stdout,'base64').toString('utf8'),stderr:Buffer.from(value.stderr,'base64').toString('utf8')};
    };
    // Add a valid ancillary PNG chunk before IEND, yielding exactly 5 MiB.
    const bytes=Buffer.alloc(MAX_IMAGE_BYTES);
    const start=png.length-12, padding=MAX_IMAGE_BYTES-png.length-12;
    png.copy(bytes,0,0,start);
    bytes.writeUInt32BE(padding,start); bytes.write('npAD',start+4,'ascii');
    let crc=0xffffffff;
    for(const byte of bytes.subarray(start+4,start+8+padding)) {
      crc^=byte;
      for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    bytes.writeUInt32BE((crc^0xffffffff)>>>0,start+8+padding);
    png.copy(bytes,MAX_IMAGE_BYTES-12,png.length-12);
    let dir;
    try {
      const made=await hc('mktemp',['-d','/tmp/files-plus-live.XXXXXXXX']);
      assert.equal(made.code,0); dir=made.stdout.trim();
      const file=dir+"/中文 ' image.png";
      const prefix=bytes.subarray(0,start+8).toString('base64');
      const suffix=bytes.subarray(MAX_IMAGE_BYTES-16).toString('base64');
      const created=await hc('sh',['-c',
        'set -eu; { printf %s "$2" | base64 -d; dd if=/dev/zero bs="$3" count=1 2>/dev/null; printf %s "$4" | base64 -d; } > "$1"',
        'create',file,prefix,String(padding),suffix]);
      assert.equal(created.code,0,created.stderr);
      const exec=async(c,a,options)=>{
        assert.equal(options.on,machine); requests++;
        return hc(c,a);
      };
      const result=await readImage(file,machine,{exec,platform:'win32',scripts:{posix:sh,windows:ps}});
      assert.equal(result.width,1); assert.equal(result.height,1);
      assert.deepEqual(Buffer.from(result.bytes),bytes);
      const {createHash}=await import('node:crypto');
      const digest=createHash('sha256').update(bytes).digest('hex');
      const remoteHash=await hc('sha256sum',[file]);
      assert.equal(remoteHash.code,0); assert.equal(remoteHash.stdout.split(' ')[0],digest);
      assert.equal(requests,6);
      assert.ok(maxReply<2*1024*1024);
      t.diagnostic(JSON.stringify({machine,bytes:bytes.length,requests,maxReply,sha256:digest}));
    } finally {
      if(dir) {
        const removed=await hc('rm',['-rf','--',dir]); assert.equal(removed.code,0);
        const check=await hc('test',['!','-e',dir]); assert.equal(check.code,0);
        t.diagnostic('Remote temporary directory removed and absence verified');
      }
    }
});

test('pure JS Base64 equals Node, rejects noncanonical and oversized input', () => {
  for (let length = 0; length < 256; length++) {
    const bytes = Buffer.from(Array.from({length}, (_, i) => (i * 31 + length) & 255));
    assert.deepEqual(Buffer.from(decodeBase64(bytes.toString('base64'))), bytes);
  }
  for (const invalid of ['A', 'AAA', '=AAA', 'A===', 'AA=A', 'AB==', 'AAB=', 'AA\n=', '!!!!', '====', 'AAAA====']) {
    assert.throws(() => decodeBase64(invalid), /Base64/);
  }
  assert.throws(() => decodeBase64('A'.repeat(4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 4)), /length/);
});

test('PNG and JPEG magic/dimensions; no arbitrary pixel cap', () => {
  assert.deepEqual(parseImageDimensions(png), {width: 1, height: 1, extension: 'png'});
  const large = Buffer.from(png); large.writeUInt32BE(100000, 16); large.writeUInt32BE(200000, 20);
  assert.equal(parseImageDimensions(large).height, 200000);
  for (const sof of [0xc0, 0xc2]) {
    const jpeg = Buffer.from([255,216,255,224,0,4,0,0,255,255,sof,0,11,8,0,20,0,30,1,1,17,0]);
    assert.deepEqual(parseImageDimensions(jpeg), {width:30, height:20, extension:'jpg'});
    for (let n=0; n<jpeg.length; n++) assert.throws(() => parseImageDimensions(jpeg.subarray(0,n)));
  }
  const zero = Buffer.from(png); zero.writeUInt32BE(0,16);
  for (const invalid of [zero, png.subarray(0,24), Buffer.from('GIF89a'), Buffer.from([255,216,255,218,0,2])]) assert.throws(() => parseImageDimensions(invalid));
});

test('routing, injected helpers, literal hostile paths and remote OS independence', async () => {
  const path = "-中文 '‘’‚‛ $(touch /tmp/NO) `x`\n; echo bad.png";
  for (const platform of ['linux','darwin','win32']) {
    for (const on of [null, 'remote']) {
      const calls = [];
      await readImage(path, on, { platform, scripts:{posix:sh,windows:ps}, exec:async (...a) => {
        calls.push(a); return mockExec(png)(...a);
      } });
      const call = calls[0];
      assert.deepEqual(call[2], {on, timeout:30000});
      if (!on && platform === 'win32') {
        assert.equal(call[0], 'powershell');
        assert.equal(call[1][3], '& {\n' + ps + '\n} ' + "'" + path.replace(/['‘’‚‛]/g, '$&$&') + "' '0' '1048576' ''");
      } else {
        assert.equal(call[0], 'sh'); assert.equal(call[1][3],path);
        assert.equal(call[1][1], sh);
      }
      assert.equal(calls.length,2);
    }
  }
  await assert.rejects(imageWithScript('x\0y', null, {exec:nativeExec, platform:'linux'}), /path/);
});

test('remote fallback only when sh is missing, not file, utility, permission or network failures', async () => {
  for (const missing of [{code:127,stderr:'sh: not found'}, Object.assign(Error('spawn sh ENOENT'), {code:'ENOENT'}), Error('herdr.exec: cannot start sh: program not found')]) {
    const calls=[];
    await readImage('p', 'remote', {platform:'linux',scripts:{posix:sh,windows:ps},exec:async (c,a) => {
      calls.push(c);
      if(c==='sh') { if(missing instanceof Error) throw missing; return missing; }
      return mockExec(png)(c,a);
    }});
    assert.deepEqual(calls,['sh','powershell','powershell']);
  }
  for (const failure of [{code:127,stderr:'base64: not found'}, {code:1,stderr:'Image is not a regular file'}, {code:126,stderr:'sh: Permission denied'}, Error('offline')]) {
    let calls=0;
    await assert.rejects(readImage('p','remote',{scripts:{posix:sh,windows:ps},exec:async()=>{
      calls++; if(failure instanceof Error) throw failure; return failure;
    }}));
    assert.equal(calls,1);
  }
});

test('helper injection is required, never loads local files implicitly', async () => {
  await assert.rejects(readImage('x', null, {exec:nativeExec,platform:'linux'}), /script dependency/);
});

test('real Windows PowerShell inline helper (Windows or WSL)', async t => {
  const program = process.platform === 'win32' ? 'powershell' : 'powershell.exe';
  try { await run(program,['-NoProfile','-NonInteractive','-Command','exit 0']); }
  catch { t.skip('Windows PowerShell not available'); return; }
  let dir;
  const quote = s => "'" + s.replace(/['‘’‚‛]/g,'$&$&') + "'";
  const command = async source => (await run(program,['-NoProfile','-NonInteractive','-Command',source],{maxBuffer:12*1024*1024})).stdout.trim();
  try {
    dir = await command("$p = Join-Path ([IO.Path]::GetTempPath()) ('files-plus-' + [guid]::NewGuid()); [IO.Directory]::CreateDirectory($p) > $null; [Console]::Write($p)");
    const file=dir+"\\中文 😀 '‘’‚‛ $() ; image.bin";
    await command('[IO.File]::WriteAllBytes('+quote(file)+", [Convert]::FromBase64String('"+png.toString('base64')+"'))");
    const exec = (c,a) => nativeExec(program,a);
    const result=await imageWithScript(file,null,{exec,platform:'win32'});
    assert.deepEqual(Buffer.from(result.bytes),png);
    await command('$s=[IO.File]::OpenWrite('+quote(file)+'); $s.SetLength(5242880); $s.Dispose()');
    assert.equal((await imageWithScript(file,null,{exec,platform:'win32'})).bytes.length,MAX_IMAGE_BYTES);
    await command('$s=[IO.File]::OpenWrite('+quote(file)+'); $s.SetLength(5242881); $s.Dispose()');
    await assert.rejects(imageWithScript(file,null,{exec,platform:'win32'}),/5 MiB/);
  } finally {
    if(dir) await command('Remove-Item -LiteralPath '+quote(dir)+' -Recurse -Force');
  }
});

test('response framing, offsets, sizes, versions, truncation and canonical Base64', async () => {
  const fields=response(png).split('\n');
  const bad = [response(png).slice(0,-1), response(png)+'noise', 'noise'+response(png), response(Buffer.from('not a png'))];
  for (const [i,v] of [[0,'FILES_PLUS_IMAGE_V1'],[1,'1'],[2,'5242881'],[2,'01'],[3,'2'],[4,'1'],[5,'bad'],[6,'AB==']]) {
    const f=[...fields]; f[i]=v; bad.push(f.join('\n'));
  }
  for (const stdout of bad) await assert.rejects(imageWithScript('foo.png', null, {platform:'linux', exec:async () => ({code:0,stdout})}));
  await assert.rejects(imageWithScript('x', null, {platform:'linux',exec:async () => ({code:1,stderr:'denied'})}), /denied/);
  await assert.rejects(imageWithScript('x', null, {platform:'linux',exec:async () => {throw Error('offline');}}), /offline/);
});

test('5 MiB uses five bounded chunks and a final version check; rejects drift', async () => {
  const bytes=Buffer.alloc(MAX_IMAGE_BYTES); png.copy(bytes);
  const calls=[];
  const result=await readImage('p','remote',{scripts:{posix:sh,windows:ps},exec:async(c,a)=>{
    calls.push(a); const r=await mockExec(bytes)(c,a);
    assert.ok(r.stdout.length < 1400000);
    return r;
  }});
  assert.deepEqual(Buffer.from(result.bytes),bytes);
  assert.equal(calls.length,6);
  assert.deepEqual(calls.map(a=>Number(a[4])),[0,1048576,2097152,3145728,4194304,5242880]);
  assert.equal(calls.at(-1)[5],'0');
  assert.ok(calls.slice(1).every(a=>a[6]===version));
  for (const at of [1,5]) {
    let n=0;
    await assert.rejects(readImage('p','remote',{scripts:{posix:sh},exec:async(c,a)=>{
      const r=await mockExec(bytes)(c,a);
      if(n++===at) r.stdout=r.stdout.replace(version,'b'.repeat(64));
      return r;
    }}),/changed/);
  }
});

test('text: routing, total 400000 cap including notice, full binary scan', async () => {
  let call;
  const readTextFile = async (...a) => { call=a; return 'hello'; };
  assert.equal(await readText('p','machine',{readTextFile}), 'hello');
  assert.deepEqual(call,['p',{on:'machine'}]);
  for (const size of [399999,400000,400001,600000]) {
    const text = await readText('p',null,{readTextFile:async()=> 'a'.repeat(size)});
    assert.ok(text.length <= 400000);
    assert.equal(text.includes('truncated'),size>400000);
  }
  for (const value of [null,'a\0b','a'.repeat(400001)+'\0','\x01']) await assert.rejects(readText('p',null,{readTextFile:async()=>value}));
  assert.equal(await readText('p',null,{readTextFile:async()=> '\t\n中文😀\r'}), '\t\n中文😀\r');
});

test('real POSIX helper: hostile filename, 5 MiB, oversize, missing, directory, cleanup', {skip:process.platform==='win32'}, async () => {
  const dir = await mkdtemp(join(tmpdir(),'files-plus-test-'));
  try {
    const name = "-中文 😀 ' $(touch INJECTED) ;\nimage.bin";
    const file = join(dir,name);
    await writeFile(file,png);
    const result = await imageWithScript(file,null,{exec:nativeExec,platform:'linux'});
    assert.deepEqual(Buffer.from(result.bytes),png);
    const helper = await readFile(new URL('../helpers/read-image.sh',import.meta.url),'utf8');
    const direct = await nativeExec('sh',['-c',helper,'test',name].map(x=>x));
    assert.notEqual(direct.code,0); // relative to process cwd, not dir
    const relative = await run('sh',['-c',helper,'test',name],{cwd:dir,maxBuffer:8*1024*1024});
    const fields=relative.stdout.split('\n');
    assert.equal(fields[0],'FILES_PLUS_IMAGE_V2');
    assert.deepEqual(Buffer.from(fields[6],'base64'),png);
    await truncate(file,MAX_IMAGE_BYTES);
    const full = await imageWithScript(file,null,{exec:nativeExec,platform:'linux'});
    assert.equal(full.bytes.length,MAX_IMAGE_BYTES);
    assert.deepEqual(Buffer.from(full.bytes).subarray(0,png.length),png);
    await truncate(file,MAX_IMAGE_BYTES+1);
    await assert.rejects(imageWithScript(file,null,{exec:nativeExec,platform:'linux'}),/5 MiB/);
    await assert.rejects(imageWithScript(join(dir,'missing'),null,{exec:nativeExec,platform:'linux'}),/regular/);
    await assert.rejects(imageWithScript(dir,null,{exec:nativeExec,platform:'linux'}),/regular/);
    await assert.rejects(readFile(join(dir,'INJECTED')));
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('real helper TOCTOU: injected stat grows file before bounded read', {skip:process.platform!=='linux'}, async () => {
  const dir = await mkdtemp(join(tmpdir(),'files-plus-race-'));
  try {
    const file=join(dir,'image'), bin=join(dir,'bin');
    await mkdir(bin); await writeFile(file,png);
    // stat's response is the original size; the read sees a much larger file.
    await writeFile(join(bin,'stat'), '#!/bin/sh\n/usr/bin/stat "$@"\n[ "$2" != %s ] || /usr/bin/truncate -s 50000000 "$RACE_FILE"\n', {mode:0o700});
    const helper=await readFile(new URL('../helpers/read-image.sh',import.meta.url),'utf8');
    await assert.rejects(run('sh',['-c',helper,'test',file],{env:{...process.env,PATH:bin+':'+process.env.PATH,RACE_FILE:file,TMPDIR:dir}}), e => {
      assert.match(e.stderr,/5 MiB during read/); assert.equal(e.stdout,''); return true;
    });
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(dir)).sort(),['bin','image']);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
