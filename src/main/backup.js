'use strict';
// Backups are plain folders of the JSON collections: <dest>/pw-helper-backup-<timestamp>/*.json
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const PREFIX = 'pw-helper-backup-';
const COLLECTIONS = ['accounts', 'servers', 'groups', 'parties', 'roster', 'autoforja', 'map', 'application', 'settings'];

function defaultPath(documentsDir) {
  return path.join(documentsDir, 'PW Helper Backups');
}

function backup(dest) {
  if (!dest) throw new Error('Destino não informado');
  const name = PREFIX + new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(dest, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const c of COLLECTIONS) {
    fs.writeFileSync(path.join(dir, c + '.json'), JSON.stringify(store.readRaw(c), null, 2));
  }
  return { name, path: dir };
}

function list(dest) {
  if (!dest || !fs.existsSync(dest)) return [];
  return fs.readdirSync(dest, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
    .map((e) => ({ name: e.name, path: path.join(dest, e.name), mtime: fs.statSync(path.join(dest, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/** Restores a backup folder. Validates every file first so a corrupt backup cannot half-restore. */
function restore(dir) {
  if (!dir || !path.basename(dir).startsWith(PREFIX)) throw new Error('Pasta de backup inválida');
  const staged = {};
  for (const c of COLLECTIONS) {
    const f = path.join(dir, c + '.json');
    if (!fs.existsSync(f)) continue;
    staged[c] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  if (!Object.keys(staged).length) throw new Error('Backup vazio');
  for (const [c, v] of Object.entries(staged)) store.writeRaw(c, v);
  return Object.keys(staged);
}

module.exports = { backup, list, restore, defaultPath };
