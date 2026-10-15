'use strict';
// Parties window ("Grupos"): available characters on the left, one column per party on the right.
// Column header: drag handle, name, member count, detach button (opens the minimized party window) and the ⋮ menu.
const pwin = { tab: 'all', mode: 'list', select: false, selected: new Set(), search: '', detached: new Set(), modal: null };
const P = 'PARTY_MODE.';

const inAnyParty = () => new Set(state.roster.flatMap((r) => (state.parties.find((p) => p.id === r.partyId && !p.archived) ? r.accountIds : [])));
const serverName = (a) => state.servers.find((s) => s.id === a.server_id)?.name || '';
const partyById = (id) => state.parties.find((p) => p.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));

function render() {
  closePopover();
  renderAvailable();
  renderPartiesList();
  refreshModal();
}
function softRender() {
  const el = document.activeElement;
  if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) { renderAvailable(); return; }
  if (document.querySelector('.overlay')) { renderAvailable(); refreshModal(); return; }
  render();
}

// ---- left: available characters --------------------------------------------------------------------------------
function renderAvailable() {
  const sb = document.getElementById('sidebar');
  const used = inAnyParty();
  const q = pwin.search.trim().toLowerCase();
  const list = state.accounts.filter((a) => !a.archived && !used.has(a.id) && (!q || [a.characterName, a.login].some((v) => (v || '').toLowerCase().includes(q))));
  const box = h('div', { class: 'sb-list' });
  if (!list.length) box.append(h('div', { class: 'sb-empty muted' }, t(P + 'EMPTY_DROP_HINT')));
  for (const a of list) {
    box.append(h('div', { class: 'server avail', draggable: 'true', ondragstart: (e) => { e.dataTransfer.setData('text/plain', 'acc:' + a.id); e.dataTransfer.effectAllowed = 'move'; } },
      h('div', { class: 'sv-ph' }, classBadge(a)),
      h('div', { style: 'min-width:0' }, h('div', { class: 'sv-name' }, a.characterName || a.login || '—'), h('div', { class: 'sv-sub' }, serverName(a)))));
  }
  sb.replaceChildren(
    h('div', { class: 'sb-head', style: 'justify-content:center' }, h('h2', { style: 'flex:none' }, t(P + 'AVAILABLES'))),
    h('div', { class: 'sb-search' }, h('div', { class: 'search-box', style: 'flex:1' }, h('span', {}, '🔍'), h('input', { placeholder: 'Pesquisar...', value: pwin.search, oninput: (e) => { pwin.search = e.target.value; renderAvailable(); } }))),
    box,
    h('div', { class: 'sb-foot' }, h('button', { style: 'flex:1', onclick: () => api.send('open-main-panel', 'settings') }, '⚙ ' + t('COMMON.SETTINGS'))));
}

// ---- member list helpers ---------------------------------------------------------------------------------------
async function setMembers(party, ids) { await api.invoke('roster-set', party.id, ids); }
async function dropMember(party, accountId, beforeId) {
  const ids = membersOf(party.id).filter((x) => x !== accountId);
  const at = beforeId ? ids.indexOf(beforeId) : -1;
  if (at < 0) ids.push(accountId); else ids.splice(at, 0, accountId);
  await setMembers(party, ids);
}

function memberRow(party, id) {
  const pe = playingEntry(id);
  const a = state.accounts.find((x) => x.id === id);
  return h('div', { class: 'mrow' + (pe ? ' on' : ''), draggable: 'true',
    ondragstart: (e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', 'acc:' + id); e.dataTransfer.effectAllowed = 'move'; },
    ondragover: (e) => { e.preventDefault(); e.stopPropagation(); },
    ondrop: (e) => { e.preventDefault(); e.stopPropagation(); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('acc:') && d.slice(4) !== id) dropMember(party, d.slice(4), id); } },
    h('div', { class: 'row' }, h('span', { class: 'sv-ph sm' }, a ? classBadge(a) : '?'), h('strong', { class: 'grow' }, accName(id)),
      h('span', { class: 'badge' + (pe ? ' on' : '') }, pe ? t('MOBILE.MEMBERS.STATE_PLAYING') : t('MOBILE.MEMBERS.STATE_IDLE')),
      h('button', { class: 'ghost icon-btn', title: t('COMMON.REMOVE'), onclick: () => api.invoke('roster-remove', party.id, id) }, '✕')),
    pe ? memBox(id) : null);
}

// ---- party column ----------------------------------------------------------------------------------------------
function partyMenu(anchor, p) {
  const D = P + 'DROP_MENU.';
  menu(anchor, [
    { label: '⚙ ' + t(D + 'SETTINGS'), onclick: () => partySettingsModal(p) },
    { label: '⧉ ' + t(D + 'DUPLICATE'), onclick: () => duplicateParty(p) },
    { label: '💾 ' + t(D + 'SAVE_FORMATION'), onclick: () => saveFormationModal(p) },
    { label: '⤓ ' + t(D + 'LOAD_FORMATION'), onclick: () => loadFormationModal(p) },
    { label: '← ' + t(D + 'REMOVE_ALL'), onclick: () => setMembers(p, []) },
    { label: '⤴ ' + t(D + 'EXPORT_PARTY'), onclick: () => exportPartyModal(p) },
    '-',
    { label: '🗄 ' + t(p.archived ? D + 'UNARCHIVE' : D + 'ARCHIVE'), onclick: () => bulk('archive', [p.id]) },
    { label: '🗑 ' + t(D + 'REMOVE'), danger: true, onclick: () => bulk('delete', [p.id]) },
  ]);
}

function partyColumn(p) {
  const members = membersOf(p.id);
  const running = (p.presets?.presets || []).filter((x) => state.jobs.has(x.id)).length;
  const col = h('div', { class: 'pcol' + (pwin.selected.has(p.id) ? ' sel' : '') + (p.archived ? ' arch' : ''),
    ondragover: (e) => { e.preventDefault(); col.classList.add('drop'); },
    ondragleave: (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); },
    ondrop: async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const d = e.dataTransfer.getData('text/plain');
      if (d.startsWith('acc:') && !p.archived) await dropMember(p, d.slice(4), null);
      else if (d.startsWith('party:') && d.slice(6) !== p.id) await reorderParty(d.slice(6), p.id);
    } });
  const kebab = h('button', { class: 'ghost icon-btn', title: t('COMMON.SETTINGS'), onclick: (e) => { e.stopPropagation(); partyMenu(kebab, p); } }, '⋮');
  col.append(
    h('div', { class: 'pcol-h' },
      pwin.select ? h('input', { type: 'checkbox', checked: pwin.selected.has(p.id), onchange: () => toggleSel(p.id) })
        : h('span', { class: 'grip', title: 'Arrastar para reordenar', draggable: 'true', ondragstart: (e) => { e.dataTransfer.setData('text/plain', 'party:' + p.id); e.dataTransfer.effectAllowed = 'move'; } }, '⋮⋮'),
      h('strong', { class: 'grow' }, p.name || p.id), h('span', { class: 'muted' }, `(${members.length})`),
      h('button', { class: 'ghost icon-btn', title: t(P + 'DETACH_PARTY'), disabled: p.archived, onclick: () => api.send('open-minimized-party', p.id) }, '⤡'), kebab),
    members.length
      ? h('div', { class: 'pcol-b' }, members.map((id) => memberRow(p, id)))
      : h('div', { class: 'pcol-b empty' }, h('div', { class: 'big' }, '👥'), h('em', {}, t(P + 'EMPTY_DROP_HINT'))),
    h('div', { class: 'pcol-f' },
      sw(t(P + 'BACKGROUND_EXECUTION'), !!p.backgroundExecution, (v) => { p.backgroundExecution = v; saveParties(); }),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => presetsModal(p) }, '☰ Presets' + (running ? ` (${running}▶)` : ''))));
  return col;
}

function toggleSel(id) { pwin.selected.has(id) ? pwin.selected.delete(id) : pwin.selected.add(id); render(); }

function partyCard(p) {
  const members = membersOf(p.id);
  const card = h('div', { class: 'card party-card' + (pwin.selected.has(p.id) ? ' sel' : ''),
    ondragover: (e) => { e.preventDefault(); card.classList.add('drop'); }, ondragleave: () => card.classList.remove('drop'),
    ondrop: async (e) => { e.preventDefault(); card.classList.remove('drop'); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('acc:') && !p.archived) await dropMember(p, d.slice(4), null); },
    onclick: () => (pwin.select ? toggleSel(p.id) : presetsModal(p)) },
    h('div', { class: 'row' }, pwin.select && h('input', { type: 'checkbox', checked: pwin.selected.has(p.id), onclick: (e) => e.stopPropagation(), onchange: () => toggleSel(p.id) }),
      h('strong', {}, p.name || p.id), h('span', { class: 'spacer' }), h('span', { class: 'muted' }, String(members.length))),
    h('div', { class: 'row', style: 'margin-top:8px' }, members.length ? members.map((id) => h('span', { class: 'chip', style: 'padding-right:10px' }, accName(id), playingEntry(id) && h('span', { class: 'badge on' }, '●'))) : h('span', { class: 'muted' }, t(P + 'EMPTY_DROP_HINT'))));
  return card;
}

async function reorderParty(draggedId, beforeId) {
  const i = state.parties.findIndex((x) => x.id === draggedId);
  if (i < 0) return;
  const [item] = state.parties.splice(i, 1);
  const j = state.parties.findIndex((x) => x.id === beforeId);
  state.parties.splice(j < 0 ? state.parties.length : j, 0, item);
  await saveParties(); render();
}

function renderPartiesList() {
  const main = document.getElementById('main');
  const shown = state.parties.filter((p) => (pwin.tab === 'archived' ? p.archived : !p.archived) && !pwin.detached.has(p.id));
  const sel = [...pwin.selected].filter((id) => partyById(id));
  const modeBtn = (m, icon, title) => h('button', { class: pwin.mode === m ? 'active' : '', title, onclick: () => { pwin.mode = m; render(); } }, icon);
  const tabBtn = (k, label) => h('button', { class: pwin.tab === k ? 'active' : '', onclick: () => { pwin.tab = k; pwin.selected.clear(); render(); } }, label);

  const head = h('div', { class: 'm-head' }, h('span', { class: 'rail-btn', style: 'width:34px;height:34px;font-size:16px' }, '👥'), h('h2', {}, t(P + 'PARTIES')), h('span', { class: 'spacer' }),
    h('button', { class: pwin.select ? 'primary' : '', onclick: () => { pwin.select = !pwin.select; pwin.selected.clear(); render(); } }, '☑ ' + t(P + 'SELECT')),
    h('button', { class: 'primary', onclick: importPartyModal }, t(P + 'IMPORT') + ' ⤓'),
    h('button', { class: 'success', onclick: addParty }, t(P + 'ADD') + ' ＋'));

  const bar = h('div', { class: 'row', style: 'padding:10px 16px 0' },
    h('div', { class: 'tabs' }, modeBtn('list', '☰', t(P + 'VIEW_MODE.LIST')), modeBtn('cards', '▦', t(P + 'VIEW_MODE.CARDS'))), h('span', { class: 'spacer' }),
    pwin.select && h('span', { class: 'muted' }, sel.length + ' selecionado(s)'),
    pwin.select && h('button', { disabled: !sel.length, onclick: () => bulk('archive', sel) }, pwin.tab === 'archived' ? t(P + 'DROP_MENU.UNARCHIVE') : t(P + 'DROP_MENU.ARCHIVE')),
    pwin.select && h('button', { class: 'danger', disabled: !sel.length, onclick: () => bulk('delete', sel) }, t(P + 'DROP_MENU.REMOVE')),
    h('div', { class: 'tabs' }, tabBtn('all', t(P + 'TABS.ALL')), tabBtn('archived', t(P + 'TABS.ARCHIVED'))));

  const body = h('div', { class: 'm-body' + (pwin.mode === 'list' ? ' cols' : '') });
  if (!shown.length) body.append(h('div', { class: 'center-msg' }, h('p', { class: 'muted' }, t('MOBILE.PARTIES.EMPTY'))));
  else body.append(h('div', { class: pwin.mode === 'cards' ? 'party-grid' : 'pcols' }, shown.map(pwin.mode === 'cards' ? partyCard : partyColumn)));
  main.replaceChildren(head, bar, body, h('div', { class: 'row', style: 'padding:8px 12px;border-top:1px solid var(--s2)' }, h('span', { class: 'spacer' }), h('button', { onclick: openHelp }, 'ⓘ ' + t(P + 'HELP'))));
}

function openHelp() {
  openModal({
    title: t(P + 'HELP'),
    body: h('div', {}, h('p', {}, 'Arraste personagens da lista "Disponíveis" para um grupo.'), h('p', {}, 'Use ⤡ para abrir o grupo em uma janela separada e ⋮ para as demais opções.'), h('p', {}, '"Selecionar" permite arquivar ou excluir vários grupos.')),
    buttons: [{ label: 'Fechar' }],
  });
}

// ---- actions ---------------------------------------------------------------------------------------------------
async function addParty() {
  const n = state.parties.filter((p) => !p.archived).length + 1;
  state.parties.push({ id: uid(), name: `${t(P + 'NEW_GROUP_NAME')} ${n}`, archived: false, backgroundExecution: false, autoCommands: { mainIntervalMs: 300, secondaryIntervalMs: 600 }, presets: { presets: [] }, formations: [] });
  await saveParties(); render();
}

async function bulk(action, ids) {
  if (action === 'delete') {
    if (!(await confirmModal({ title: t('ACCOUNT_LIST.DELETE_MODAL.TITLE'), text: ids.map((id) => partyById(id)?.name).join(', '), help: t('ACCOUNT_LIST.DELETE_MODAL.HELP_TEXT'), confirm: t('ACCOUNT_LIST.DELETE_MODAL.CONFIRM_BUTTON') }))) return;
    state.parties = state.parties.filter((p) => !ids.includes(p.id));
  } else for (const p of state.parties) if (ids.includes(p.id)) p.archived = !p.archived;
  pwin.selected.clear();
  await saveParties(); render();
}

/** Copies presets with fresh ids, keeping nested preset calls pointing at the copies. */
function cloneRepresets(presets) {
  const copy = clone(presets || []);
  const map = new Map();
  for (const p of copy) { map.set(p.id, uid()); }
  for (const p of copy) {
    p.id = map.get(p.id);
    for (const c of p.commands || []) if (c.isPresetCall && c.presetCall) c.presetCall.targetPresetId = map.get(c.presetCall.targetPresetId) || '';
  }
  return copy;
}

async function duplicateParty(p) {
  const c = clone(p);
  Object.assign(c, { id: uid(), name: `${p.name} (cópia)`, archived: false, formations: [], presets: { ...(p.presets || {}), presets: cloneRepresets(p.presets?.presets) } });
  state.parties.splice(state.parties.indexOf(p) + 1, 0, c);
  await saveParties(); render();
}

// ---- modals ----------------------------------------------------------------------------------------------------
function refreshModal() {
  const m = pwin.modal;
  if (!m) return;
  if (!m.body.isConnected) { pwin.modal = null; return; }
  const party = partyById(m.partyId);
  if (!party) return;
  m.body.replaceChildren(presetsEditor(party));
}
function presetsModal(p) { presetWindow(p); }

function partySettingsModal(p) {
  const S = P + 'SETTINGS_PARTY.';
  p.autoCommands ??= { mainIntervalMs: 300, secondaryIntervalMs: 600 };
  const draft = { name: p.name, a: p.autoCommands.mainIntervalMs, b: p.autoCommands.secondaryIntervalMs };
  const num = (k) => h('input', { type: 'number', min: 0, value: draft[k], style: 'width:120px', oninput: (e) => { draft[k] = Number(e.target.value) || 0; } });
  openModal({
    title: t(S + 'TITLE'),
    body: [
      field(t(S + 'PARTY_NAME'), h('input', { value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
      h('div', { class: 'row' }, field(t(S + 'FIRST_INTERVAL') + ' (' + t(S + 'FIRST_INTERVAL_METRIC') + ')', num('a')), field(t(S + 'SECOND_INTERVAL') + ' (' + t(S + 'SECOND_INTERVAL_METRIC') + ')', num('b'))),
      h('p', { class: 'muted' }, t(S + 'AUTO_SETTINGS_DESCRIPTION')),
    ],
    buttons: [{ label: t('COMMON.CANCEL') }, { label: t(S + 'APPLY_CHANGES'), kind: 'primary', onclick: async () => {
      p.name = draft.name.trim() || p.name; p.autoCommands.mainIntervalMs = draft.a; p.autoCommands.secondaryIntervalMs = draft.b;
      await saveParties(); render();
    } }],
  });
}

// formations: a saved member order that can be re-applied later
function saveFormationModal(p) {
  const F = P + 'FORMATION.';
  p.formations ??= [];
  let name = '';
  const ids = membersOf(p.id);
  openModal({
    title: t(F + 'SAVE_FORMATION_TITLE'),
    body: [h('p', { class: 'muted' }, t(F + 'SAVE_DESCRIPTION')),
      field(null, h('input', { placeholder: t(F + 'FORMATION_NAME_PLACEHOLDER'), oninput: (e) => { name = e.target.value; } })),
      h('div', { class: 'lbl' }, t(F + 'CURRENT_ORDER')),
      h('ol', { class: 'flist' }, ids.map((id) => h('li', {}, accName(id))))],
    buttons: [{ label: t('COMMON.CANCEL') }, { label: t(F + 'SAVE_BUTTON'), kind: 'primary', onclick: async () => {
      const n = name.trim();
      if (!n) return false;
      const exist = p.formations.find((f) => f.name.toLowerCase() === n.toLowerCase());
      if (exist) {
        if (!(await confirmModal({ title: t(F + 'SAVE_FORMATION_TITLE'), text: t(F + 'OVERWRITE_CONFIRM', { name: exist.name }), confirm: t(F + 'SAVE_BUTTON'), kind: 'primary' }))) return false;
        exist.accountIds = ids;
      } else p.formations.push({ id: uid(), name: n, accountIds: ids });
      await saveParties(); toast(t(F + 'SAVE_BUTTON') + '!', 'ok');
    } }],
  });
}

function loadFormationModal(p) {
  const F = P + 'FORMATION.';
  p.formations ??= [];
  const st = { id: p.formations[0]?.id || '', auto: false, force: false };
  const body = h('div', {});
  const paint = () => {
    const f = p.formations.find((x) => x.id === st.id);
    body.replaceChildren(
      p.formations.length ? [h('p', { class: 'muted' }, t(F + 'LOAD_DESCRIPTION')),
        field(t(F + 'SAVED_FORMATIONS'), select(p.formations.map((x) => [x.id, x.name]), st.id, (v) => { st.id = v; paint(); })),
        f && h('div', {}, h('div', { class: 'lbl' }, t(F + 'MEMBERS_LIST')),
          h('ol', { class: 'flist' }, f.accountIds.map((id) => h('li', {}, state.accounts.some((a) => a.id === id) ? accName(id) : '—', ' ', playingEntry(id) ? h('span', { class: 'badge on' }, t(F + 'AVAILABLE_CHARACTER')) : h('span', { class: 'badge' }, t(F + 'OFFLINE_CHARACTER')))))),
        sw(t(F + 'AUTO_LOGIN'), st.auto, (v) => { st.auto = v; }),
        sw(t(F + 'FORCE_ASSIGN'), st.force, (v) => { st.force = v; }), h('span', { class: 'hint' }, t(F + 'FORCE_ASSIGN_DESCRIPTION')),
        f && h('div', { style: 'margin-top:8px' }, h('button', { class: 'ghost', onclick: async () => { p.formations = p.formations.filter((x) => x.id !== f.id); st.id = p.formations[0]?.id || ''; await saveParties(); paint(); } }, '🗑 ' + t(F + 'REMOVE_FORMATION')))]
        : h('p', { class: 'muted' }, t(F + 'NO_FORMATIONS')));
  };
  paint();
  openModal({
    title: t(F + 'LOAD_FORMATION_TITLE'), body,
    buttons: [{ label: t('COMMON.CANCEL') }, { label: t(F + 'LOAD_BUTTON'), kind: 'primary', onclick: async () => {
      const f = p.formations.find((x) => x.id === st.id);
      if (!f) return false;
      const others = inAnyParty();
      for (const id of membersOf(p.id)) others.delete(id);
      const ids = f.accountIds.filter((id) => state.accounts.some((a) => a.id === id && !a.archived) && (st.force || !others.has(id)));
      await setMembers(p, ids);
      if (st.auto) playMany(ids.filter((id) => !playingEntry(id)));
    } }],
  });
}

// sharing: a text code with the party's settings and presets; characters are replaced by slots on import
const encodeCode = (o) => 'PWH1:' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
function decodeCode(text) {
  const m = /^PWH1:([A-Za-z0-9+/=]+)$/.exec(text.trim());
  if (!m) throw new Error('Código inválido');
  const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
  if (!o || typeof o.name !== 'string' || !Array.isArray(o.members) || !o.presets) throw new Error('Código inválido');
  return o;
}

function exportPartyModal(p) {
  const E = P + 'EXPORT_PARTY.';
  const members = membersOf(p.id);
  const slot = (id) => { const i = members.indexOf(id); return i < 0 ? '' : '#' + i; };
  const presets = clone(p.presets?.presets || []);
  for (const pr of presets) for (const c of pr.commands || []) if (c.simpleCommand) c.simpleCommand.characterId = slot(c.simpleCommand.characterId);
  const code = encodeCode({ v: 1, exportedAt: Date.now(), name: p.name, backgroundExecution: !!p.backgroundExecution, autoCommands: p.autoCommands, members: members.map((id) => ({ name: accName(id), cls: state.accounts.find((a) => a.id === id)?.charClass || '' })), presets });
  const area = h('textarea', { readonly: true, rows: 6, style: 'width:100%;font-family:Consolas,monospace' }, code);
  openModal({
    title: t(E + 'TITLE'), body: [h('p', { class: 'muted' }, t(E + 'DESCRIPTION')), area],
    buttons: [{ label: 'Fechar' }, { label: 'Copiar', kind: 'primary', onclick: async () => {
      try { await navigator.clipboard.writeText(code); toast('Código copiado', 'ok'); } catch { area.select(); toast('Selecione e copie (Ctrl+C)', 'ok'); }
      return false;
    } }],
  });
}

function importPartyModal() {
  const I = P + 'IMPORT_PARTY.';
  const st = { text: '', data: null, name: '', map: [] };
  const body = h('div', {});
  const paint = () => {
    if (!st.data) {
      body.replaceChildren(h('p', { class: 'muted' }, t(I + 'DESCRIPTION')),
        h('textarea', { rows: 6, style: 'width:100%;font-family:Consolas,monospace', placeholder: 'PWH1:…', oninput: (e) => { st.text = e.target.value; } }));
      return;
    }
    const used = inAnyParty();
    const free = state.accounts.filter((a) => !a.archived && !used.has(a.id));
    const date = new Date(st.data.exportedAt || Date.now());
    body.replaceChildren(
      h('p', { class: 'muted' }, t(I + 'PARTY_INFO', { date: date.toLocaleDateString('pt-BR'), time: date.toLocaleTimeString('pt-BR') })),
      field(t(I + 'PARTY_NAME'), h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } })),
      h('p', { class: 'muted' }, t(I + 'HELP_TEXT')),
      free.length ? st.data.members.map((m, i) => h('div', { class: 'row', style: 'margin-bottom:6px' }, h('strong', { style: 'min-width:140px' }, m.name || '#' + (i + 1)),
        select([['', '—'], ...free.map((a) => [a.id, a.characterName || a.login])], st.map[i] || '', (v) => { st.map[i] = v; })))
        : h('p', { class: 'muted' }, t(I + 'NO_CHARACTERS_WARNING')),
      h('p', { class: 'muted' }, t(I + 'WARNING_TEXT')));
  };
  paint();
  openModal({
    title: t(I + 'TITLE'), body, wide: true,
    buttons: [{ label: t('COMMON.CANCEL') }, { label: t(I + 'IMPORT_BUTTON'), kind: 'primary', onclick: async () => {
      if (!st.data) {
        try { st.data = decodeCode(st.text); } catch (e) { toast(e.message, 'err'); return false; }
        st.name = st.data.name; st.map = []; paint();
        return false;
      }
      const picked = st.map.filter(Boolean);
      const presets = cloneRepresets(st.data.presets);
      for (const pr of presets) pr.commands = (pr.commands || []).filter((c) => {
        if (!c.simpleCommand) return true;
        const m = /^#(\d+)$/.exec(c.simpleCommand.characterId || '');
        const acc = m && st.map[Number(m[1])];
        if (!acc) return false;
        c.simpleCommand.characterId = acc;
        return true;
      });
      const party = { id: uid(), name: st.name.trim() || st.data.name, archived: false, backgroundExecution: !!st.data.backgroundExecution, autoCommands: st.data.autoCommands || { mainIntervalMs: 300, secondaryIntervalMs: 600 }, presets: { presets }, formations: [] };
      state.parties.push(party);
      await saveParties();
      if (picked.length) await setMembers(party, picked);
      render(); toast(t(I + 'IMPORT_BUTTON') + '!', 'ok');
    } }],
  });
}

// ---- window controls + live events -----------------------------------------------------------------------------
for (const [id, ch] of [['btn-min', 'minimize'], ['btn-max', 'maximize'], ['btn-close', 'close']]) document.getElementById(id).addEventListener('click', () => api.send('window-' + ch));
api.on('playing-accounts-changed', (l) => { state.playing = l || []; softRender(); });
api.on('roster-changed', (l) => { state.roster = l || []; softRender(); });
for (const ev of ['accounts-updated', 'parties-updated', 'account-groups-updated']) api.on(ev, async () => { await loadAll(); softRender(); });
api.on('settings-updated', (s) => { if (s) state.settings = s; });
api.on('job-started', ({ jobId }) => { state.jobs.add(jobId); softRender(); });
api.on('job-ended', ({ jobId }) => { state.jobs.delete(jobId); softRender(); });
api.on('job-error', ({ error }) => toast('Erro no preset: ' + error, 'err'));
api.on('detached-parties', (ids) => { pwin.detached = new Set(ids || []); softRender(); });

(async () => {
  await loadAll(); await loadOffsets();
  pwin.detached = new Set(unwrap(await api.invoke('get-detached-parties')) || []);
  render();
})();
