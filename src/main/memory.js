'use strict';
// Memory reader: polls the offset attributes of every playing client whose server has an offsets key
// and emits { id, pid, values, errors } like the original's "sync-clients:memory-values" event.
const { EventEmitter } = require('node:events');
const { specsFor } = require('./offsets');

// PowerShell wraps .NET exceptions as: Exceção ao chamar "X" com "n" argumento(s): "<message>"
const clean = (m) => { const s = String(m); const i = s.indexOf('argumento(s): "'); return i < 0 ? s : s.slice(i + 15).replace(/"$/, ''); };

class MemoryWatcher extends EventEmitter {
  /**
   * @param ctl     WinCtl-like ({mem, memForget})
   * @param offsets Offsets instance
   * @param opts    { intervalMs, enabled: () => bool }
   */
  constructor(ctl, offsets, { intervalMs = 1000, enabled = () => true } = {}) {
    super();
    this.ctl = ctl;
    this.offsets = offsets;
    this.intervalMs = intervalMs;
    this.enabled = enabled;
    this.targets = new Map(); // accountId -> { pid, key }
    this.last = new Map();    // accountId -> last emitted payload
    this.timer = null;
    this.busy = false;
  }

  add(id, pid, key) {
    this.targets.set(id, { pid, key: key || '' });
    this.ensureTimer();
  }

  setKey(id, key) { const t = this.targets.get(id); if (t) t.key = key || ''; }

  remove(id) {
    const t = this.targets.get(id);
    this.targets.delete(id);
    this.last.delete(id);
    if (t) this.ctl.memForget?.(t.pid).catch(() => {});
    if (!this.targets.size) this.stop();
  }

  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  async tick() {
    if (this.busy || !this.enabled()) return;
    this.busy = true;
    try {
      for (const [id, { pid, key }] of [...this.targets]) {
        const server = key && this.offsets.server(key);
        if (!server) continue;
        const { module, ptr, specs } = specsFor(server);
        let res;
        try { res = await this.ctl.mem(pid, module, ptr, specs); } catch (e) { res = { values: {}, errors: { _: e.message } }; }
        const errors = Object.fromEntries(Object.entries(res.errors || {}).map(([k, v]) => [k, clean(v)]));
        const payload = { id, pid, values: res.values || {}, errors };
        this.last.set(id, payload);
        this.emit('values', payload);
      }
    } finally { this.busy = false; }
  }
}

module.exports = { MemoryWatcher };
