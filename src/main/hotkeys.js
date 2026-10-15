'use strict';
// Reacts to global key events: preset shortcuts and the Party Mode shortcuts (next/previous character,
// alternate, next/previous party, numpad positions, sync-click toggle).
const { presetsForEvent, NUMPAD_VKS } = require('./input');

class Hotkeys {
  /**
   * deps: { input, ctl, store, roster, sessions, getSettings, executePreset, isHelperFocused, broadcast, toggleSync }
   */
  constructor(deps) {
    this.d = deps;
    this.lastPid = null;       // last focused PW pid (for "alternate")
    this.prevPid = null;       // the one before it
    this.activePartyId = null;
    this.lastByParty = new Map();
    deps.input.on('key', (ev) => { if (ev.state === 'down') this.onKey(ev).catch(() => {}); });
  }

  parties() { return (this.d.store.get('parties').response || []).filter((p) => !p.archived); }

  /** Running (non-crashed) members of a party, in roster order: [{id, pid}]. */
  runningMembers(partyId) {
    return this.d.sessions.members(this.d.roster.memberIds(partyId)).filter((m) => !m.crashState);
  }

  async allowed() {
    const s = this.d.getSettings();
    if (!s.party?.presetsRequireFocus) return true;
    if (this.d.isHelperFocused()) return true;
    const pid = await this.d.ctl.foregroundPid().catch(() => 0);
    return this.d.sessions.list().some((x) => x.pid === pid);
  }

  /** The party that owns the focused PW window, else the last used one, else the first with running members. */
  async activeParty() {
    const pid = await this.d.ctl.foregroundPid().catch(() => 0);
    const owner = this.d.sessions.list().find((x) => x.pid === pid);
    if (owner) {
      this.noteFocus(pid);
      const p = this.parties().find((party) => this.d.roster.memberIds(party.id).includes(owner.id));
      if (p) { this.activePartyId = p.id; this.lastByParty.set(p.id, pid); }
    }
    let party = this.parties().find((p) => p.id === this.activePartyId);
    if (!party) party = this.parties().find((p) => this.runningMembers(p.id).length);
    return party || null;
  }

  noteFocus(pid) {
    if (pid && pid !== this.lastPid) { this.prevPid = this.lastPid; this.lastPid = pid; }
  }

  async focusPid(pid, partyId) {
    if (!pid) return;
    this.noteFocus(pid);
    if (partyId) { this.activePartyId = partyId; this.lastByParty.set(partyId, pid); }
    await this.d.ctl.focus(pid).catch(() => {});
    this.d.broadcast('change-character', { pid });
  }

  async step(delta) {
    const party = await this.activeParty();
    if (!party) return;
    const list = this.runningMembers(party.id);
    if (!list.length) return;
    const fg = await this.d.ctl.foregroundPid().catch(() => 0);
    const i = list.findIndex((m) => m.pid === fg);
    const next = list[(i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length)];
    await this.focusPid(next.pid, party.id);
  }

  async byPosition(pos) {
    const party = await this.activeParty();
    if (!party) return;
    const m = this.runningMembers(party.id)[pos];
    if (m) await this.focusPid(m.pid, party.id);
  }

  async alternateCharacters() {
    const fg = await this.d.ctl.foregroundPid().catch(() => 0);
    const mine = this.d.sessions.list().some((x) => x.pid === fg);
    if (mine) this.noteFocus(fg);
    const target = mine ? this.prevPid : this.lastPid;
    if (target && this.d.sessions.list().some((x) => x.pid === target)) await this.focusPid(target, this.activePartyId);
  }

  async stepParty(delta) {
    const withMembers = this.parties().filter((p) => this.runningMembers(p.id).length);
    if (!withMembers.length) return;
    const cur = await this.activeParty();
    const i = withMembers.findIndex((p) => p.id === cur?.id);
    const next = withMembers[(i < 0 ? 0 : (i + delta + withMembers.length) % withMembers.length)];
    const members = this.runningMembers(next.id);
    const remembered = this.lastByParty.get(next.id);
    const target = members.find((m) => m.pid === remembered) || members[0];
    await this.focusPid(target.pid, next.id);
  }

  async onKey(ev) {
    const settings = this.d.getSettings();
    const party = settings.party;
    // 1) preset shortcuts
    const hits = presetsForEvent(this.d.store.get('parties').response, ev);
    if (hits.length) {
      if (await this.allowed()) for (const { party: p, preset } of hits) this.d.executePreset({ partyId: p.id, presetId: preset.id });
      return;
    }
    if (!party) return;
    // 2) party-mode shortcuts
    if (party.numPadEnable && NUMPAD_VKS.includes(ev.vk)) { if (await this.allowed()) await this.byPosition(NUMPAD_VKS.indexOf(ev.vk)); return; }
    const is = (k) => party[k]?.code && party[k].code === ev.vk;
    if (!(await this.allowed())) return;
    if (is('alternateCharacterShortcut')) await this.alternateCharacters();
    else if (is('nextPartyShortcut')) await this.stepParty(1);
    else if (is('previousPartyShortcut')) await this.stepParty(-1);
    else if (is('alternatePartyShortcut')) await this.stepParty(1);
    else if (is('previousCharacterShortcut')) await this.step(-1);
    else if (is('nextCharacterShortcut')) await this.step(1);
    else if (is('activeClickMirror')) this.d.toggleSync();
  }
}

module.exports = { Hotkeys };
