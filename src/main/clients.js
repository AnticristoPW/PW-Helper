'use strict';
// Client window manager: applies settings.customElement to each game window once it appears
// (size / remembered bounds / title = character name / class icon) and tracks bounds + visibility.
const path = require('node:path');
const { EventEmitter } = require('node:events');

const CLASSES = ['BLADEMASTER', 'WIZARD', 'ARCHER', 'CLERIC', 'BARBARIAN', 'VENOMANCER', 'PSYCHIC', 'ASSASSIN', 'SEEKER', 'MYSTIC', 'DUSKBLADE', 'STORMBRINGER', 'TECHNICIAN', 'EDGERUNNER', 'WILDWALKER', 'BARD', 'BLOOD_SPIRIT', 'AZURE_DRAGON'];
const CLASS_ICON_MAP = ['wr', 'mg', 'ea', 'ep', 'wb', 'wf', 'esp', 'mc', 'sk', 'ms', 'rt', 'tm', 'at', 'pl', 'ad', 'bd', 'cf', 'da'];
const THEMES = [1, 2, 3, 4, 5, 6];

function iconPath(iconsDir, account, theme) {
  if (account.store) return path.join(iconsDir, 'store.ico');
  const i = CLASSES.indexOf(account.charClass);
  const t = Math.max(1, Math.min(THEMES.length, Number(theme) || 1));
  return path.join(iconsDir, 'theme' + t, (CLASS_ICON_MAP[i] ?? 'bd') + '.ico');
}

class ClientWindows extends EventEmitter {
  /** deps: { ctl, iconsDir, getSettings(), getAccount(id), patchBounds(id,b) } */
  constructor(deps) {
    super();
    Object.assign(this, deps);
    this.clients = new Map(); // id -> { pid, timer, last, hidden }
  }

  cfg() { const s = this.getSettings() || {}; return s.customElement?.enable ? s.customElement : null; }

  track(id, pid) {
    this.untrack(id);
    const c = { pid, hidden: false, last: '', applied: false, tries: 0, timer: null };
    this.clients.set(id, c);
    c.timer = setInterval(() => this.tick(id).catch(() => {}), 1500);
    c.timer.unref?.();
  }

  untrack(id) {
    const c = this.clients.get(id);
    if (c) clearInterval(c.timer);
    this.clients.delete(id);
  }

  isHidden(id) { return !!this.clients.get(id)?.hidden; }

  async tick(id) {
    const c = this.clients.get(id);
    if (!c) return;
    const info = await this.ctl.info(c.pid);
    if (!info) { if (++c.tries > 120) this.untrack(id); return; }
    const cfg = this.cfg();
    if (!c.applied) { c.applied = true; await this.apply(id, c); return; }
    // remember bounds (only while visible, not minimized, and no fixed default size)
    if (cfg?.rememberWindowBounds && !cfg.defaultWindowSize?.enable && !info.minimized && !c.hidden && info.width > 0 && info.height > 0) {
      const sig = `${info.x},${info.y},${info.width},${info.height}`;
      if (sig !== c.last) { c.last = sig; this.patchBounds(id, { x: info.x, y: info.y, width: info.width, height: info.height }); }
    }
  }

  async apply(id, c) {
    const account = this.getAccount(id);
    if (!account) return;
    const cfg = this.cfg();
    const s = this.getSettings() || {};
    if (cfg?.changeWindowTitle && account.characterName) await this.ctl.setTitle(c.pid, account.characterName).catch(() => {});
    if (!cfg?.stackClients) await this.ctl.setIcon(c.pid, iconPath(this.iconsDir, account, s.classIconTheme)).catch(() => {});
    if (!cfg) return;
    const size = cfg.defaultWindowSize;
    if (size?.enable && size.width > 0 && size.height > 0) await this.ctl.setPos(c.pid, null, null, size.width, size.height).catch(() => {});
    else if (cfg.rememberWindowBounds && account.windowBounds) {
      const b = account.windowBounds;
      await this.ctl.setPos(c.pid, b.x, b.y, b.width, b.height).catch(() => {});
    }
  }

  async setSize(id, width, height) {
    const c = this.clients.get(id);
    if (!c || !(width > 0) || !(height > 0)) return false;
    return this.ctl.setPos(c.pid, null, null, Math.round(width), Math.round(height));
  }

  async setHidden(id, hidden) {
    const c = this.clients.get(id);
    if (!c) return false;
    const r = hidden ? await this.ctl.hide(c.pid) : await this.ctl.show(c.pid);
    if (r) { c.hidden = hidden; this.emit('visibility', { id, pid: c.pid, hidden }); }
    return r;
  }

  /** Re-applies title/icon for open clients (after the icon theme changes). */
  async reapplyIcons() {
    for (const [id, c] of this.clients) {
      const a = this.getAccount(id);
      if (a && !this.cfg()?.stackClients) await this.ctl.setIcon(c.pid, iconPath(this.iconsDir, a, (this.getSettings() || {}).classIconTheme)).catch(() => {});
    }
  }

  stop() { for (const id of [...this.clients.keys()]) this.untrack(id); }
}

function listThemes(iconsDir) {
  return THEMES.map((n) => ({ id: n, icons: CLASSES.map((c, i) => ({ cls: c, file: CLASS_ICON_MAP[i] + '.ico' })) }));
}

module.exports = { ClientWindows, iconPath, listThemes, CLASSES, CLASS_ICON_MAP, THEMES };
