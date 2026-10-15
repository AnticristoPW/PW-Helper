'use strict';
// Global keyboard/mouse events from the PowerShell hook worker (inputhook.ps1).
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const readline = require('node:readline');

class InputHook extends EventEmitter {
  constructor(script = path.join(__dirname, 'inputhook.ps1')) {
    super();
    this.script = script;
    this.proc = null;
    this.state = { keys: false, mouse: 'off' };
  }

  start() {
    if (this.proc) return;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.t === 'key') this.emit('key', ev);
      else if (ev.t === 'click') this.emit('click', ev);
    });
    this.proc.stderr.on('data', () => {});
    this.proc.stdin.on('error', () => {});
    this.proc.on('exit', () => { this.proc = null; });
    this.send(this.state);
  }

  send(msg) { if (this.proc) this.proc.stdin.write(JSON.stringify(msg) + '\n'); }
  setKeys(on) { this.state.keys = !!on; this.start(); this.send({ keys: !!on }); }
  setMouse(mode) { this.state.mouse = mode; this.start(); this.send({ mouse: mode }); }
  stop() { if (this.proc) { this.proc.kill(); this.proc = null; } }
}

/** Does the key event match a stored shortcut `{id, shift, ctrl, alt}` (preset shortcuts)? */
function matchesShortcut(shortcut, ev) {
  return !!shortcut && (shortcut.shift ?? false) === ev.shift && (shortcut.ctrl ?? false) === ev.ctrl && (shortcut.alt ?? false) === ev.alt && ev.vk === shortcut.id;
}

/** Presets (in order) whose shortcut matches the event. */
function presetsForEvent(parties, ev) {
  const out = [];
  for (const party of parties || []) {
    if (party.archived) continue;
    for (const preset of party.presets?.presets || []) if (matchesShortcut(preset.shortcut, ev)) out.push({ party, preset });
  }
  return out;
}

const NUMPAD_VKS = [97, 98, 99, 100, 101, 102, 103, 104, 105, 96]; // NUM1..NUM9, NUM0 -> positions 0..9

module.exports = { InputHook, matchesShortcut, presetsForEvent, NUMPAD_VKS };
