'use strict';
// JSON document store with atomic writes. One file per collection under <userData>/data.
// Every accessor returns the { success, code, response } envelope used by the renderer.
const fs = require('node:fs');
const path = require('node:path');

let dataDir = null;

const DEFAULTS = {
  accounts: [],
  servers: [],
  groups: [],
  parties: [],
  roster: {},
  autoforja: {},
  map: {},
  application: {},
  settings: {
    background: false,
    language: 'pt-br',
    party: { enableMemoryRead: true, defaultKeyDelayMs: 50, showHp: true, showMp: true, showXp: true, showLevel: true, showChi: true, showAmuleto: true, warnAmuletLow: true, showHierograma: true, warnHierogramaLow: true },
    classIconTheme: 1,
  },
};

function init(dir) {
  dataDir = dir;
  fs.mkdirSync(dataDir, { recursive: true });
}

function file(name) {
  if (!/^[a-z]+$/.test(name)) throw new Error('Coleção inválida');
  return path.join(dataDir, name + '.json');
}

function readRaw(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(DEFAULTS[name] ?? null);
    throw err;
  }
}

function writeRaw(name, value) {
  const f = file(name);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

function get(name) {
  try {
    return { success: true, code: 200, response: readRaw(name) };
  } catch {
    return { success: false, code: 500 };
  }
}

function set(name, value) {
  try {
    writeRaw(name, value);
    return { success: true, code: 200 };
  } catch {
    return { success: false, code: 500 };
  }
}

const getDir = () => dataDir;

module.exports = { init, get, set, readRaw, writeRaw, getDir, DEFAULTS };
