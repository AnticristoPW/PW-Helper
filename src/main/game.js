'use strict';
// Launches game clients and tracks which account owns which PID.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const LAUNCH_WINDOW_MS = 60000;

function splitArgs(s) {
  return (String(s || '').match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
}

class GameSessions extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // accountId -> { pid, child, startedAt, crashState }
    this.launching = new Map(); // accountId -> timestamp
  }

  list() {
    return [...this.sessions].map(([id, s]) => ({ id, pid: s.pid, crashState: s.crashState }));
  }

  pidFor(accountId) { return this.sessions.get(accountId)?.pid ?? null; }

  isRunning(accountId) {
    const s = this.sessions.get(accountId);
    return !!s && !s.crashState;
  }

  /** Members of a roster as { id, pid, crashState } for the preset engine. */
  members(accountIds) {
    return accountIds.map((id) => this.sessions.get(id) && { id, pid: this.sessions.get(id).pid, crashState: this.sessions.get(id).crashState })
      .filter(Boolean);
  }

  open({ account, server }) {
    const id = account.id;
    if (this.isRunning(id)) return { ok: true, already: true, pid: this.pidFor(id) };
    const t = this.launching.get(id);
    if (t && Date.now() - t < LAUNCH_WINDOW_MS) return { ok: false, error: 'launching' };

    const exe = server?.location;
    if (!exe || !fs.existsSync(exe)) return { ok: false, error: 'exe-not-found' };
    if (!account.login || !account.characterName) return { ok: false, error: 'missing-credentials' };

    this.launching.set(id, Date.now());
    // Arguments are passed as an array (no shell), so credentials cannot inject extra arguments.
    const extra = splitArgs(server.arguments);
    // Same rule as the original: only 64-bit clients accept "area:<name>"; it never overrides an explicit area.
    if (server.forceServer?.enabled && server.forceServer.name && /[\\/]x64[\\/]/i.test(exe) && !extra.some((a) => /^area:/i.test(a))) {
      extra.push(`area:${server.forceServer.name}`);
    }
    const args = ['startbypatcher', `user:${account.login}`, `pwd:${account.password ?? ''}`, `role:${account.characterName}`, ...extra];
    let child;
    try {
      child = spawn(exe, args, { cwd: require('node:path').dirname(exe), stdio: 'ignore', windowsHide: false });
    } catch (err) {
      this.launching.delete(id);
      return { ok: false, error: String(err.message) };
    }
    child.once('error', (err) => {
      this.launching.delete(id);
      this.emit('error', { id, error: String(err.message) });
    });
    child.once('spawn', () => {
      this.launching.delete(id);
      this.sessions.set(id, { pid: child.pid, child, startedAt: Date.now(), crashState: false });
      this.emit('opened', { id, pid: child.pid });
    });
    child.once('exit', (code) => {
      this.launching.delete(id);
      const s = this.sessions.get(id);
      if (!s || s.pid !== child.pid) return;
      // Same rule the original used: any exit code other than 0/1 is treated as a crash.
      const crashed = code !== 0 && code !== 1 && code !== null;
      if (crashed) s.crashState = true; else this.sessions.delete(id);
      this.emit(crashed ? 'crashed' : 'closed', { id, pid: child.pid, exitCode: code, startedAt: s.startedAt });
    });
    return { ok: true, pid: child.pid };
  }

  close(accountId) {
    const s = this.sessions.get(accountId);
    if (!s) return false;
    try { process.kill(s.pid); } catch { /* already gone */ }
    return true;
  }

  dismissCrash(accountId) {
    if (this.sessions.get(accountId)?.crashState) this.sessions.delete(accountId);
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}

module.exports = { GameSessions, splitArgs };
