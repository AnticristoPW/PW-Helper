'use strict';
// Click capture ("listen-click") and click mirroring ("sync click") on top of the global mouse hook.
const { EventEmitter } = require('node:events');

class MouseTools extends EventEmitter {
  /** deps: { input, ctl, store, roster, sessions, broadcast } */
  constructor(deps) {
    super();
    this.d = deps;
    this.sync = { enabled: false, allParties: false };
    this.capturing = 0;       // active listen-click requests
    this.mirrorBusyUntil = 0; // ignore clicks produced by our own mirrored (foreground) clicks
    deps.input.on('click', (ev) => this.onClick(ev));
  }

  applyMode() {
    this.d.input.setMouse(this.capturing > 0 ? this.captureMode : this.sync.enabled ? 'on' : 'off');
  }

  /** Waits for the next click inside any PW window. Resolves with { button, pid, client: {x, y} }. */
  listenClick(pid, block = false, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
      if (pid) this.d.ctl.focus(pid).catch(() => {});
      this.capturing++;
      this.captureMode = block ? 'block' : 'on';
      this.applyMode();
      const done = (fn, v) => { this.removeListener('raw', onRaw); clearTimeout(timer); this.capturing--; this.applyMode(); fn(v); };
      const onRaw = (ev) => done(resolve, { button: ev.button, pid: ev.pid, client: { x: ev.x, y: ev.y }, screen: { x: ev.sx, y: ev.sy } });
      const timer = setTimeout(() => done(reject, new Error('tempo esgotado')), timeoutMs);
      const onCancel = () => { this.removeListener('cancel', onCancel); done(reject, new Error('cancelado')); };
      this.on('raw', onRaw);
      this.once('cancel', onCancel);
    });
  }

  cancelListen() { this.emit('cancel'); }

  setSync(enabled, allParties) {
    this.sync = { enabled: !!enabled, allParties: allParties ?? this.sync.allParties };
    this.applyMode();
    this.d.broadcast('sync-click-changed', this.sync);
    return this.sync;
  }

  toggleSync() { return this.setSync(!this.sync.enabled); }

  onClick(ev) {
    this.emit('raw', ev);
    if (!this.sync.enabled || this.capturing > 0 || ev.button !== 'left' || Date.now() < this.mirrorBusyUntil) return;
    this.mirror(ev);
  }

  /** Repeats a click made in one PW window at the same client position in the other windows of its party. */
  mirror(ev) {
    const owner = this.d.sessions.list().find((s) => s.pid === ev.pid);
    if (!owner) return;
    const parties = (this.d.store.get('parties').response || []).filter((p) => !p.archived);
    const mine = parties.find((p) => this.d.roster.memberIds(p.id).includes(owner.id));
    if (!mine) return;
    const scope = this.sync.allParties ? parties : [mine];
    const targets = new Set();
    for (const p of scope) for (const m of this.d.sessions.members(this.d.roster.memberIds(p.id))) if (!m.crashState && m.pid !== ev.pid) targets.add(m.pid);
    const background = !!mine.backgroundExecution;
    if (!background) this.mirrorBusyUntil = Date.now() + 150 * targets.size + 300;
    (async () => {
      for (const pid of targets) {
        try { await this.d.ctl.click(pid, ev.x, ev.y, background); } catch { /* window gone */ }
      }
      if (!background) await this.d.ctl.focus(ev.pid).catch(() => {});
    })();
  }
}

module.exports = { MouseTools };
