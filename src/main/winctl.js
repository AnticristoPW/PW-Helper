'use strict';
// Client for the PowerShell worker (winctl.ps1): focus windows and send keys/clicks by PID.
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const VK = {
  BACKSPACE: 0x08, TAB: 0x09, ENTER: 0x0d, RETURN: 0x0d, SHIFT: 0x10, CTRL: 0x11, ALT: 0x12, ESC: 0x1b, ESCAPE: 0x1b,
  SPACE: 0x20, PAGEUP: 0x21, PAGEDOWN: 0x22, END: 0x23, HOME: 0x24, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28,
  INSERT: 0x2d, DELETE: 0x2e,
};

/** Key name ("F3", "a", "7", "Space") -> Windows virtual-key code, or null when unknown. */
function keyToVk(name) {
  if (name == null) return null;
  const k = String(name).trim().toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return 0x6f + Number(k.slice(1));
  if (/^[A-Z0-9]$/.test(k)) return k.charCodeAt(0);
  if (/^NUM[0-9]$/.test(k)) return 0x60 + Number(k[3]);
  return VK[k] ?? null;
}

class WinCtl {
  constructor(script = path.join(__dirname, 'winctl.ps1')) {
    this.script = script;
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
  }

  start() {
    if (this.proc) return;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
    });
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', () => {
      this.proc = null;
      for (const p of this.pending.values()) p.reject(new Error('winctl encerrado'));
      this.pending.clear();
    });
  }

  call(op, args = {}) {
    this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('winctl: tempo esgotado'));
      }, 10000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(JSON.stringify({ id, op, ...args }) + '\n');
    });
  }

  focus(pid) { return this.call('focus', { pid }); }
  /** PID of the window that currently has the keyboard focus. */
  foregroundPid() { return this.call('fg'); }
  key(pid, vk, background = false) { return this.call('key', { pid, vk, background }); }
  click(pid, x, y, background = false, right = false) { return this.call('click', { pid, x, y, background, right }); }
  async info(pid) {
    const raw = await this.call('info', { pid });
    if (!raw) return null;
    const [title, x, y, width, height, minimized] = raw.split('\t');
    return { title, x: +x, y: +y, width: +width, height: +height, minimized: minimized === '1' };
  }

  hide(pid) { return this.call('hide', { pid }); }
  show(pid) { return this.call('show', { pid }); }
  /** Position/size; pass null for x/y (and 0 for w/h) to keep the current value. */
  setPos(pid, x, y, w, h) { return this.call('setpos', { pid, x, y, w: w || 0, h: h || 0 }); }
  setTitle(pid, text) { return this.call('title', { pid, text }); }
  setIcon(pid, path) { return this.call('icon', { pid, path }); }
  /** Evaluate offset attribute specs against a running client. Resolves to {values, errors}. */
  mem(pid, module, ptr, specs) { return this.call('mem', { pid, module, ptr, specs }); }
  memForget(pid) { return this.call('memforget', { pid }); }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

module.exports = { WinCtl, keyToVk };
