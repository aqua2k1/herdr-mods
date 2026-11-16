import test from 'node:test';
import assert from 'node:assert/strict';
import { createBinaryTransport } from '../lib/platform-compat.js';

test('transport returns opaque stdout without interpreting the binary protocol', async () => {
  const calls = [];
  const execute = createBinaryTransport({
    platform: 'windows', scripts: {posix: '\uFEFFset -eu\r\n'}, on: 'remote',
    exec: async (...args) => { calls.push(args); return {code: 0, stdout: 'opaque response'}; },
  });
  assert.equal(await execute("a\r\nb", 0, 10, ''), 'opaque response');
  assert.deepEqual(calls, [['sh', ['-c', 'set -eu\n', 'files-plus-image', "a\r\nb", '0', '10', ''],
    {on: 'remote', timeout: 30000}]]);
});

test('remote shell choice is retained per transfer and does not fall back after success', async () => {
  for (const initiallyMissing of [false, true]) {
    const calls = [];
    const execute = createBinaryTransport({
      scripts: {posix: 'shell', windows: 'powershell'}, on: 'remote',
      exec: async command => {
        calls.push(command);
        if (command === 'sh' && initiallyMissing || calls.length > 1 + Number(initiallyMissing)) {
          return {code: 127, stderr: 'sh: not found'};
        }
        return {code: 0, stdout: 'ok'};
      },
    });
    assert.equal(await execute('p', 0, 1, ''), 'ok');
    await assert.rejects(execute('p', 1, 0, 'version'), /sh: not found/);
    assert.deepEqual(calls, initiallyMissing ? ['sh', 'powershell', 'powershell'] : ['sh', 'sh']);
  }
});
