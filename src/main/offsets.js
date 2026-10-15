'use strict';
// Offsets: per-server memory maps (module + pointer chains) used by the memory reader.
// Same schema the original validates: { version, servers: { key: { label, module, [static_module], [arch], attributes } } }.
// Source order: user file in the data dir -> bundled default. "Refresh" re-reads the optional HTTPS source
// (settings.offsetsUrl) and falls back to the local file when none is configured.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const HEX_RE = /^0x[0-9A-Fa-f]+$/;
const MAX_BYTES = 1048576;
const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'offsets.default.json');

function validate(j) {
  if (!j || !j.version || !j.servers || typeof j.servers !== 'object') throw new Error('Schema inválido: campos obrigatórios ausentes (version, servers)');
  for (const [key, s] of Object.entries(j.servers)) {
    if (!s.label || typeof s.label !== 'string') throw new Error(`Schema inválido: servidor "${key}" sem campo "label"`);
    if (!s.module || typeof s.module !== 'string') throw new Error(`Schema inválido: servidor "${key}" sem campo "module"`);
    if (!s.attributes || typeof s.attributes !== 'object') throw new Error(`Schema inválido: servidor "${key}" sem campo "attributes"`);
    for (const [name, a] of Object.entries(s.attributes)) {
      for (const f of ['base', 'offset']) if (a[f] && !HEX_RE.test(a[f])) throw new Error(`Valor hex inválido em ${key}.${name}.${f}: ${a[f]}`);
      if (Array.isArray(a.chain)) for (const c of a.chain) if (!HEX_RE.test(c)) throw new Error(`Valor hex inválido em ${key}.${name}.chain: ${c}`);
    }
  }
  return j;
}

function download(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) return reject(new Error('URL deve usar HTTPS: ' + url));
    const req = https.get(url, { timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error('Resposta grande demais')); } else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

/** Server entry -> worker-ready shape: { module, ptr, specs[] } (specs keep hex strings; the worker parses them). */
function specsFor(server) {
  const ptr = server.arch === 'x64' ? 8 : 4;
  const specs = Object.entries(server.attributes).map(([name, a]) => ({ name, ...a }));
  return { module: server.module, ptr, specs };
}

class Offsets {
  constructor(dataDir, { getUrl = () => '', fetchText = download, defaultFile = DEFAULT_FILE } = {}) {
    this.file = path.join(dataDir, 'offsets.json');
    this.defaultFile = defaultFile;
    this.getUrl = getUrl;
    this.fetchText = fetchText;
    this.loaded = null;
  }

  readFile(f) { return validate(JSON.parse(fs.readFileSync(f, 'utf8'))); }

  load() {
    for (const f of [this.file, this.defaultFile]) {
      try { this.loaded = this.readFile(f); return this.loaded; } catch { /* try next */ }
    }
    this.loaded = null;
    return null;
  }

  save(j) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(j));
  }

  info() {
    const l = this.loaded;
    if (!l) return null;
    return {
      version: l.version, module: l.module,
      servers: Object.fromEntries(Object.entries(l.servers).map(([k, s]) => [k, { label: s.label }])),
      updatedAt: l.updated_at ?? null,
    };
  }

  server(key) { return this.loaded?.servers?.[key] ?? null; }

  /** Returns { updated, version, previousVersion }. Throws when the configured source fails. */
  async refresh() {
    const previous = this.loaded?.version ?? null;
    const url = this.getUrl();
    let next;
    if (url) next = validate(JSON.parse(await this.fetchText(url)));
    else next = this.readFile(fs.existsSync(this.file) ? this.file : this.defaultFile);
    this.loaded = next;
    if (url) this.save(next);
    return { updated: previous !== null && next.version !== previous, version: next.version, previousVersion: previous };
  }

  /** Imports a user-provided JSON file as the active offsets. */
  importFile(f) {
    const j = this.readFile(f);
    this.save(j);
    const previous = this.loaded?.version ?? null;
    this.loaded = j;
    return { updated: previous !== j.version, version: j.version, previousVersion: previous };
  }
}

module.exports = { Offsets, validate, specsFor };
