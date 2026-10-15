'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/main/store');
const roster = require('../src/main/roster');
const backup = require('../src/main/backup');
const { buildCommands, firstCharacterId, Runner } = require('../src/main/presets');
const { keyToVk } = require('../src/main/winctl');
const { splitArgs } = require('../src/main/game');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pwh-'));
const members = [{ id: 'a', pid: 100, crashState: false }, { id: 'b', pid: 200, crashState: false }, { id: 'c', pid: 300, crashState: true }];
const simple = (characterId, key, delay = 0) => ({ isPresetCall: false, simpleCommand: { characterId, key, delay } });

test('keyToVk maps common keys and rejects junk', () => {
  assert.equal(keyToVk('F1'), 0x70);
  assert.equal(keyToVk('f8'), 0x77);
  assert.equal(keyToVk('A'), 0x41);
  assert.equal(keyToVk('5'), 0x35);
  assert.equal(keyToVk('???'), null);
});

test('splitArgs keeps quoted groups together', () => {
  assert.deepEqual(splitArgs('-a "b c" d'), ['-a', 'b c', 'd']);
  assert.deepEqual(splitArgs(''), []);
});

test('auto preset skips crashed members and uses party intervals', () => {
  const cmds = buildCommands({ autoCommands: { mainIntervalMs: 10, secondaryIntervalMs: 20 } }, { id: 'p', type: 'auto' }, members);
  assert.equal(cmds.length, 16); // 8 keys x 2 live members
  assert.ok(cmds.every((c) => c.pid !== 300));
  assert.equal(cmds[0].delay, 10);
  assert.equal(cmds[cmds.length - 1].delay, 20);
});

test('custom preset drops commands of absent characters', () => {
  const preset = { id: 'p', type: 'custom', commands: [simple('a', 'F1'), simple('zzz', 'F2'), simple('c', 'F3')] };
  const cmds = buildCommands({}, preset, members);
  assert.deepEqual(cmds.map((c) => c.key), ['F1']);
  assert.equal(firstCharacterId(cmds), 'a');
});

test('preset calls nest, and cycles are cut', () => {
  const party = { presets: { presets: [
    { id: 'x', type: 'custom', commands: [simple('a', 'F1'), { isPresetCall: true, presetCall: { targetPresetId: 'y', waitCompletion: true } }] },
    { id: 'y', type: 'custom', commands: [simple('b', 'F2'), { isPresetCall: true, presetCall: { targetPresetId: 'x' } }] },
  ] } };
  const cmds = buildCommands(party, party.presets.presets[0], members);
  const call = cmds[1];
  assert.equal(call.wait, true);
  assert.equal(call.preset[0].key, 'F2');
  assert.deepEqual(call.preset[1].preset, []); // back-reference to x is empty
});

test('Runner presses keys in order, focusing first when not in background', async () => {
  const log = [];
  const ctl = { focus: async (p) => log.push(['focus', p]), key: async (p, vk) => log.push(['key', p, vk]), click: async () => {} };
  const events = [];
  const r = new Runner(ctl, (e) => events.push(e));
  r.start('j', [{ pid: 1, key: 'F1', delay: 0 }, { pid: 2, key: 'F2', delay: 0 }], {});
  await new Promise((res) => setTimeout(res, 50));
  assert.deepEqual(log, [['focus', 1], ['key', 1, 0x70], ['focus', 2], ['key', 2, 0x71]]);
  assert.deepEqual(events, ['job-started', 'job-ended']);
  assert.equal(r.isRunning('j'), false);
});

test('Runner loop can be cancelled and cancelForPid stops matching jobs', async () => {
  let n = 0;
  const ctl = { focus: async () => {}, key: async () => { n++; }, click: async () => {} };
  const r = new Runner(ctl);
  r.start('loop', [{ pid: 7, key: 'F1', delay: 5 }], { loop: true, background: true });
  await new Promise((res) => setTimeout(res, 60));
  assert.ok(n > 2);
  r.cancelForPid(7);
  await new Promise((res) => setTimeout(res, 30));
  const after = n;
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(n, after);
  assert.equal(r.isRunning('loop'), false);
});

test('roster: an account lives in one party at most, prune drops stale entries', () => {
  store.init(tmp());
  roster.assign('p1', 'a1');
  roster.assign('p2', 'a1');
  assert.deepEqual(roster.memberIds('p1'), []);
  assert.deepEqual(roster.memberIds('p2'), ['a1']);
  roster.assign('p2', 'a2');
  assert.equal(roster.prune(new Set(['p2']), new Set(['a2'])), true);
  assert.deepEqual(roster.memberIds('p2'), ['a2']);
});

test('backup/restore round-trips and rejects non-backup folders', () => {
  store.init(tmp());
  store.set('accounts', [{ id: '1', login: 'x' }]);
  const dest = tmp();
  const b = backup.backup(dest);
  store.set('accounts', []);
  assert.equal(backup.list(dest).length, 1);
  backup.restore(b.path);
  assert.deepEqual(store.get('accounts').response, [{ id: '1', login: 'x' }]);
  assert.throws(() => backup.restore(dest));
});

test('click-only commands run with the right mouse button; shortcuts match modifiers', async () => {
  const calls = [];
  const ctl = { focus: async () => {}, key: async (...a) => calls.push(['key', ...a]), click: async (pid, x, y, bg, right) => calls.push(['click', pid, x, y, right]) };
  const members = [{ id: 'a1', pid: 10 }];
  const preset = { id: 'p', type: 'custom', commands: [{ isPresetCall: false, simpleCommand: { characterId: 'a1', key: '', delay: 0, clickCoordinates: { x: 5, y: 6 }, clickButton: 'right' } }] };
  const cmds = buildCommands({ presets: { presets: [preset] } }, preset, members);
  const runner = new Runner(ctl);
  runner.start('j', cmds, {});
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(calls, [['click', 10, 5, 6, true]]);
  const { matchesShortcut } = require('../src/main/input');
  assert.equal(matchesShortcut({ id: 120, ctrl: true }, { vk: 120, shift: false, ctrl: true, alt: false }), true);
  assert.equal(matchesShortcut({ id: 120 }, { vk: 120, shift: false, ctrl: true, alt: false }), false);
});
