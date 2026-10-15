'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Offsets, validate, specsFor } = require('../src/main/offsets');
const { MemoryWatcher } = require('../src/main/memory');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pwoff-'));
const sample = (version = '1') => ({ version, servers: { s1: { label: 'S1', module: 'a.exe', arch: 'x64', attributes: { nivel: { base: '0x10', chain: ['0x4'], offset: '0x8', type: 'int' } } } } });

test('bundled offsets validate and expose labels', () => {
  const o = new Offsets(tmp());
  assert.ok(o.load());
  const info = o.info();
  assert.ok(Object.keys(info.servers).length >= 1);
  assert.ok(Object.values(info.servers).every((s) => s.label));
});

test('validate rejects bad hex and missing fields', () => {
  assert.throws(() => validate({ version: '1' }));
  const bad = sample(); bad.servers.s1.attributes.nivel.base = '10';
  assert.throws(() => validate(bad), /hex/);
  const bad2 = sample(); bad2.servers.s1.attributes.nivel.chain = ['zz'];
  assert.throws(() => validate(bad2), /hex/);
});

test('refresh uses the configured source, persists it and reports version changes', async () => {
  const dir = tmp();
  let url = 'https://example.test/o.json', body = sample('1');
  const o = new Offsets(dir, { getUrl: () => url, fetchText: async () => JSON.stringify(body), defaultFile: path.join(dir, 'none.json') });
  assert.equal(o.load(), null);
  let r = await o.refresh();
  assert.deepEqual([r.updated, r.version, r.previousVersion], [false, '1', null]);
  body = sample('2');
  r = await o.refresh();
  assert.deepEqual([r.updated, r.version, r.previousVersion], [true, '2', '1']);
  const again = new Offsets(dir, { defaultFile: path.join(dir, 'none.json') });
  assert.equal(again.load().version, '2');
});

test('specsFor derives pointer size from arch', () => {
  assert.equal(specsFor(sample().servers.s1).ptr, 8);
  assert.equal(specsFor({ ...sample().servers.s1, arch: 'x86' }).ptr, 4);
  assert.equal(specsFor({ ...sample().servers.s1, arch: undefined }).ptr, 4);
});

test('MemoryWatcher polls only servers with a key, cleans errors, stops when empty', async () => {
  const o = new Offsets(tmp(), { defaultFile: path.join(tmp(), 'x') });
  o.loaded = sample();
  const calls = [];
  const ctl = {
    mem: async (pid, mod, ptr, specs) => { calls.push([pid, mod, ptr, specs.length]); return { values: { nivel: 50 }, errors: { hp: 'Exceção ao chamar "ReadChain" com "5" argumento(s): "leitura falhou em 0x1"' } }; },
    memForget: async () => {},
  };
  const w = new MemoryWatcher(ctl, o, { intervalMs: 100000 });
  const got = [];
  w.on('values', (p) => got.push(p));
  w.add('a', 11, 's1'); w.add('b', 12, ''); w.add('c', 13, 'unknown');
  await w.tick();
  assert.deepEqual(calls, [[11, 'a.exe', 8, 1]]);
  assert.equal(got[0].values.nivel, 50);
  assert.equal(got[0].errors.hp, 'leitura falhou em 0x1');
  w.remove('a'); w.remove('b'); w.remove('c');
  assert.equal(w.timer, null);
});
