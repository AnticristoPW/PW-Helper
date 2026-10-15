'use strict';
// Preset engine: turns a party + preset into a flat command list and runs it.
// Command: { characterId, pid, key, delay, x, y } or a nested call { preset: [...], wait }.
const { keyToVk } = require('./winctl');

const MAX_PRESET_DEPTH = 8;
const AUTO_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];
const DEFAULT_AUTO = { mainIntervalMs: 300, secondaryIntervalMs: 600 };

function alive(members) {
  return members.filter((m) => !m.crashState);
}

function buildAuto(party, members) {
  const auto = { ...DEFAULT_AUTO, ...(party.autoCommands || {}) };
  return AUTO_KEYS.flatMap((key, i) =>
    alive(members).map((m) => ({
      characterId: m.id,
      pid: m.pid,
      key,
      delay: i <= 3 ? auto.mainIntervalMs : auto.secondaryIntervalMs,
    })),
  );
}

function buildCustom(party, preset, members, seen, depth) {
  const live = alive(members);
  const out = [];
  for (const c of preset.commands || []) {
    if (c.isPresetCall) {
      if (c.presetCall) out.push(buildCall(party, c.presetCall, members, seen, depth));
      continue;
    }
    const items = c.isGroup ? c.commandGroup?.commands ?? [] : [c.simpleCommand];
    for (const s of items.filter(Boolean)) {
      const m = live.find((x) => x.id === s.characterId);
      if (!m) continue;
      out.push({
        characterId: m.id,
        pid: m.pid,
        key: s.key,
        delay: Math.max(0, Number(s.delay) || 0),
        x: s.clickCoordinates?.x ?? 0,
        y: s.clickCoordinates?.y ?? 0,
        right: s.clickButton === 'right',
      });
    }
  }
  return out;
}

function buildCall(party, call, members, seen, depth) {
  const node = {
    characterId: '', pid: 0, key: '', delay: Math.max(0, Number(call.delay) || 0), x: 0, y: 0,
    preset: [], wait: call.waitCompletion === true, presetId: call.targetPresetId,
  };
  const target = party.presets?.presets?.find((p) => p.id === call.targetPresetId);
  if (!target || depth >= MAX_PRESET_DEPTH || seen.has(call.targetPresetId)) return node; // cycle / too deep: empty call
  node.preset = buildCommands(party, target, members, new Set([...seen, call.targetPresetId]), depth + 1);
  return node;
}

function buildCommands(party, preset, members, seen = new Set([preset.id]), depth = 0) {
  return preset.type === 'auto' ? buildAuto(party, members) : buildCustom(party, preset, members, seen, depth);
}

function firstCharacterId(commands) {
  for (const c of commands) {
    if (c.characterId) return c.characterId;
    if (c.preset?.length) {
      const id = firstCharacterId(c.preset);
      if (id) return id;
    }
  }
  return '';
}

const sleep = (ms, token) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    token.wake = () => { clearTimeout(t); resolve(); };
  });

class Runner {
  /** @param ctl object with focus/key/click (WinCtl) @param emit (event, payload) => void */
  constructor(ctl, emit = () => {}) {
    this.ctl = ctl;
    this.emit = emit;
    this.jobs = new Map(); // jobId -> { cancelled, background, pids, token }
  }

  isRunning(jobId) { return this.jobs.has(jobId); }

  start(jobId, commands, { loop = false, background = false } = {}) {
    if (!commands.length) return false;
    if (!background) this.cancelForeground(); // one foreground job at a time: it owns the keyboard
    this.cancel(jobId);
    const job = { cancelled: false, background, token: {}, pids: collectPids(commands) };
    this.jobs.set(jobId, job);
    this.emit('job-started', { jobId, background });
    this.run(jobId, job, commands, loop).finally(() => {
      if (this.jobs.get(jobId) === job) this.jobs.delete(jobId);
      this.emit('job-ended', { jobId });
    });
    return true;
  }

  async run(jobId, job, commands, loop) {
    try {
      do {
        await this.runList(job, commands);
      } while (loop && !job.cancelled);
    } catch (err) {
      this.emit('job-error', { jobId, error: String(err.message || err) });
    }
  }

  async runList(job, commands) {
    for (const c of commands) {
      if (job.cancelled) return;
      if (c.preset?.length) {
        const nested = this.runList(job, c.preset);
        if (c.wait) await nested; else nested.catch(() => {});
      } else if (c.pid && (c.key || c.x || c.y)) {
        await this.press(job, c);
      }
      if (job.cancelled) return;
      if (c.delay > 0) await sleep(c.delay, job.token);
    }
  }

  async press(job, c) {
    const vk = c.key ? keyToVk(c.key) : null;
    if (c.key && vk == null) throw new Error(`Tecla inválida: ${c.key}`);
    if (!job.background) await this.ctl.focus(c.pid);
    if (c.x || c.y) await this.ctl.click(c.pid, c.x, c.y, job.background, !!c.right);
    if (vk != null) await this.ctl.key(c.pid, vk, job.background);
  }

  cancel(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.cancelled = true;
    j.token.wake?.();
  }

  cancelForeground() {
    for (const [id, j] of this.jobs) if (!j.background) this.cancel(id);
  }

  cancelAll() {
    for (const id of [...this.jobs.keys()]) this.cancel(id);
  }

  cancelForPid(pid) {
    for (const [id, j] of this.jobs) if (j.pids.has(pid)) this.cancel(id);
  }
}

function collectPids(commands, set = new Set()) {
  for (const c of commands) {
    if (c.pid) set.add(c.pid);
    if (c.preset) collectPids(c.preset, set);
  }
  return set;
}

module.exports = { buildCommands, firstCharacterId, Runner };
