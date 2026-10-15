'use strict';
// Offsets + memory reading UI: server offsets key, refresh button, Offsets panel and the live stat boxes.
const memUi = { values: new Map(), boxes: new Map(), refresh: 'idle' };

async function loadOffsets() {
  state.offsets = unwrap(await api.invoke('get-offsets-info'));
}

const REFRESH_ICON = { idle: '⟳', updating: '…', updated: '✔', 'no-update': '✔', error: '⚠' };
const REFRESH_TEXT = { idle: 'OFFSETS.REFRESH_IDLE', updating: 'OFFSETS.REFRESH_UPDATING', updated: 'OFFSETS.REFRESH_UPDATED', 'no-update': 'OFFSETS.REFRESH_NO_UPDATE', error: 'OFFSETS.REFRESH_ERROR' };

/** Refresh button shared by the server modal and the Offsets panel. onDone runs after the info reloads. */
function refreshOffsetsButton(onDone) {
  const btn = h('button', { class: 'ghost icon-btn', title: t(REFRESH_TEXT[memUi.refresh]) }, REFRESH_ICON[memUi.refresh]);
  const set = (st) => { memUi.refresh = st; btn.textContent = REFRESH_ICON[st]; btn.title = t(REFRESH_TEXT[st]); btn.disabled = st === 'updating'; };
  btn.addEventListener('click', async () => {
    set('updating');
    const r = await api.invoke('refresh-offsets');
    if (!r.success) { set('error'); toast(t('OFFSETS.REFRESH_ERROR') + ' ' + (r.error || ''), 'err'); return; }
    await loadOffsets();
    set(r.response.updated ? 'updated' : 'no-update');
    toast(t(REFRESH_TEXT[memUi.refresh]), 'ok');
    onDone?.();
  });
  return btn;
}

/** "Servidor de offsets" select used in the server modal (stores the key on the server object). */
function offsetsKeyField(server) {
  const servers = Object.entries(state.offsets?.servers || {});
  const sel = h('select', { onchange: (e) => { server.offsetsKey = e.target.value; } },
    h('option', { value: '' }, '—'),
    servers.map(([k, s]) => h('option', { value: k, selected: k === (server.offsetsKey || '') }, s.label)));
  const row = h('div', { class: 'inline' }, sel, refreshOffsetsButton(() => {
    // rebuild options in place after a refresh
    sel.replaceChildren(h('option', { value: '' }, '—'), ...Object.entries(state.offsets?.servers || {}).map(([k, s]) => h('option', { value: k, selected: k === (server.offsetsKey || '') }, s.label)));
  }));
  return field('Servidor de offsets (' + t('COMMON.OPTIONAL').toLowerCase() + ')', row, t('SETTINGS.MEMORY_READING.TAB_TITLE'));
}

// ---- Offsets panel -----------------------------------------------------------------------------------------------
function offsetsPanel() {
  const info = state.offsets;
  const main = document.getElementById('main');
  const body = h('div', { class: 'm-body' });
  main.replaceChildren(h('div', { class: 'm-head' }, h('h2', {}, 'Offsets'), h('span', { class: 'spacer' }), refreshOffsetsButton(() => offsetsPanel()),
    h('button', { onclick: async () => {
      const r = await api.invoke('import-offsets');
      if (r.success && r.response) { await loadOffsets(); toast(t('OFFSETS.REFRESH_UPDATED'), 'ok'); offsetsPanel(); } else if (!r.success) toast(r.error, 'err');
    } }, 'Importar arquivo…')), body);

  const st = state.settings;
  body.append(h('div', { class: 'card' },
    h('div', { class: 'kv' },
      h('div', {}, 'Versão'), h('div', {}, info ? info.version : '—'),
      h('div', {}, 'Servidores'), h('div', {}, info ? String(Object.keys(info.servers).length) : '0')),
    field('Fonte online dos offsets (HTTPS, opcional)', h('input', { value: st.offsetsUrl || '', placeholder: 'https://…/offsets.json', onchange: async (e) => { st.offsetsUrl = e.target.value.trim(); await api.invoke('set-settings', st); } }),
      'Se vazio, "Atualizar offsets" apenas recarrega o arquivo local.')));

  const list = h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:8px' }, 'Servidores'));
  if (!info || !Object.keys(info.servers).length) list.append(h('p', { class: 'muted' }, t('ERRORS.NOT_INFORMED')));
  else for (const [key, s] of Object.entries(info.servers)) {
    const using = state.servers.filter((x) => x.offsetsKey === key);
    list.append(h('div', { class: 'row', style: 'margin-top:6px' }, h('strong', {}, s.label), h('span', { class: 'muted' }, key), h('span', { class: 'spacer' }),
      h('span', { class: 'muted' }, using.length ? using.map((x) => x.name).join(', ') : '')));
  }
  body.append(list);
  body.append(memorySettingsCard());
}

const MEM_TOGGLES = [
  ['showHp', 'SHOW_HP'], ['showMp', 'SHOW_MP'], ['showXp', 'SHOW_XP'], ['showLevel', 'SHOW_LEVEL'], ['showChi', 'SHOW_CHI'],
  ['showAmuleto', 'SHOW_AMULET_CD'], ['warnAmuletLow', 'WARN_AMULET_LOW'], ['showHierograma', 'SHOW_HIEROGRAM_CD'], ['warnHierogramaLow', 'WARN_HIEROGRAM_LOW'],
];

function memorySettingsCard() {
  const p = (state.settings.party ??= {});
  const commit = () => api.invoke('set-settings', state.settings);
  return h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:8px' }, t('SETTINGS.MEMORY_READING.TAB_TITLE')),
    h('div', { class: 'row', style: 'flex-direction:column;align-items:flex-start' },
      sw(t('SETTINGS.MEMORY_READING.TAB_TITLE'), p.enableMemoryRead ?? true, (v) => { p.enableMemoryRead = v; commit(); }),
      MEM_TOGGLES.map(([k, key]) => sw(t('SETTINGS.MEMORY_READING.' + key), p[k] ?? true, (v) => { p[k] = v; commit(); paintAllMem(); }))));
}

// ---- live stat boxes -------------------------------------------------------------------------------------------
const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);
const flag = (k) => state.settings.party?.[k] ?? true;

function meter(label, v, max, cls, low) {
  return h('div', { class: 'meter' + (low ? ' low' : '') },
    h('span', { class: 'meter-l' }, label),
    h('div', { class: 'bar' }, h('i', { class: cls, style: `width:${pct(v, max).toFixed(1)}%` })),
    h('span', { class: 'meter-v' }, max > 0 ? `${v}/${max}` : String(v)));
}

function paintMem(id) {
  const box = memUi.boxes.get(id);
  if (!box || !box.isConnected) { memUi.boxes.delete(id); return; }
  const m = memUi.values.get(id);
  if (!m || (state.settings.party?.enableMemoryRead ?? true) === false) { box.replaceChildren(); return; }
  const v = m.values, kids = [];
  const has = (k) => v[k] !== undefined && !m.errors?.[k];
  if (flag('showLevel') && has('nivel')) kids.push(h('span', { class: 'lvl' }, 'Lv ' + v.nivel));
  if (flag('showHp') && has('hp') && has('hp_max')) kids.push(meter('HP', v.hp, v.hp_max, 'hp'));
  if (flag('showMp') && has('mp') && has('mp_max')) kids.push(meter('MP', v.mp, v.mp_max, 'mp'));
  if (flag('showXp') && has('xp') && has('xp_alvo') && v.xp_alvo > 0) kids.push(meter('XP', v.xp, v.xp_alvo, 'xp'));
  if (flag('showChi') && has('chi')) kids.push(h('span', { class: 'lvl' }, 'Chi ' + v.chi));
  if (flag('showAmuleto') && has('amuleto_hp') && has('amuleto_hp_max') && v.amuleto_hp_max > 0) {
    kids.push(meter('Amuleto', v.amuleto_hp, v.amuleto_hp_max, 'amu', flag('warnAmuletLow') && pct(v.amuleto_hp, v.amuleto_hp_max) <= 20));
  }
  if (flag('showHierograma') && has('hierograma_mp') && has('hierograma_mp_max') && v.hierograma_mp_max > 0) {
    kids.push(meter('Hierograma', v.hierograma_mp, v.hierograma_mp_max, 'hie', flag('warnHierogramaLow') && pct(v.hierograma_mp, v.hierograma_mp_max) <= 20));
  }
  box.replaceChildren(...kids);
}
function paintAllMem() { for (const id of [...memUi.boxes.keys()]) paintMem(id); }

/** Container that live-updates with the memory values of one account (re-created on each render). */
function memBox(id) {
  const box = h('div', { class: 'membox' });
  memUi.boxes.set(id, box);
  queueMicrotask(() => paintMem(id));
  return box;
}

api.on('sync-clients:memory-values', (p) => { memUi.values.set(p.id, p); paintMem(p.id); });
api.on('account:level-updated', ({ id, level }) => { const a = state.accounts.find((x) => x.id === id); if (a) a.level = level; });
api.on('close-element', (r) => { const id = r?.response; if (id) { memUi.values.delete(id); paintMem(id); } });

// ---- Logs panel (the original's sync-log window) ---------------------------------------------------------------
const logUi = { entries: [], filter: '' };
function logLine(e) {
  const { ts, event, ...rest } = e;
  const detail = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ');
  const bad = /error|crash/.test(event);
  return h('div', { class: 'logline' + (bad ? ' bad' : '') }, h('span', { class: 'muted' }, new Date(ts).toLocaleTimeString('pt-BR')), h('b', {}, event), h('span', {}, detail));
}
function logsPanel() {
  const main = document.getElementById('main');
  const list = h('div', { class: 'logbox' });
  const paint = () => {
    const q = logUi.filter.toLowerCase();
    list.replaceChildren(...logUi.entries.filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q)).slice(-300).map(logLine));
    list.scrollTop = list.scrollHeight;
  };
  main.replaceChildren(h('div', { class: 'm-head' }, h('h2', {}, 'Logs'),
    h('input', { placeholder: 'Pesquisar...', style: 'width:220px', oninput: (e) => { logUi.filter = e.target.value; paint(); } }), h('span', { class: 'spacer' }),
    h('button', { onclick: async () => { await api.invoke('clear-sync-log'); logUi.entries = []; paint(); } }, 'Limpar')),
    h('div', { class: 'm-body' }, list));
  api.invoke('get-sync-log').then((r) => { logUi.entries = unwrap(r) || []; paint(); });
  logUi.paint = paint;
}
api.on('sync-log:entry', (e) => { logUi.entries.push(e); if (logUi.entries.length > 500) logUi.entries.shift(); if (state.panel === 'logs') logUi.paint?.(); });
