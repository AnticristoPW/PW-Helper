'use strict';
// Servers sidebar + accounts list (the app's home screen).
const state = {
  servers: [], accounts: [], groups: [], parties: [], roster: [], playing: [], settings: {}, jobs: new Set(),
  serverId: null, serverSearch: '', panel: null, // panel: null = accounts, otherwise 'party' | 'settings' | ...
  accTab: 'all', accSearch: '', filter: { group: '', cls: '', store: false, fav: false, played: false, playing: false, sort: 'asc' },
  selectMode: false, selected: new Set(),
};

const CLASSES = ['BLADEMASTER', 'WIZARD', 'ARCHER', 'CLERIC', 'BARBARIAN', 'VENOMANCER', 'PSYCHIC', 'ASSASSIN', 'SEEKER', 'MYSTIC', 'DUSKBLADE', 'STORMBRINGER', 'TECHNICIAN', 'EDGERUNNER', 'WILDWALKER', 'BARD', 'BLOOD_SPIRIT', 'AZURE_DRAGON'];
const className = (c) => (c ? t('CHARACTER_CLASS.' + c) : '—');
const classBadge = (a) => (a.store ? '🏪' : a.charClass ? className(a.charClass).slice(0, 2).toUpperCase() : '?');

// ---- persistence -----------------------------------------------------------------------------------------------
async function saveList(channel, key) {
  const r = await api.invoke(channel, state[key]);
  if (!r.success) toast(r.error || 'Falha ao salvar', 'err');
  return r.success;
}
const saveAccounts = () => saveList('write-accounts-storage', 'accounts');
const saveServers = () => saveList('write-servers-storage', 'servers');
const saveGroups = () => saveList('set-account-group-storage', 'groups');
const saveParties = () => saveList('set-parties-storage', 'parties');

async function loadAll() {
  const names = ['get-accounts-storage', 'get-servers-storage', 'get-account-group-storage', 'get-parties-storage', 'get-roster', 'get-playing-accounts', 'get-settings'];
  const [a, s, g, p, r, pl, st] = await Promise.all(names.map((c) => api.invoke(c)));
  Object.assign(state, { accounts: unwrap(a) || [], servers: unwrap(s) || [], groups: unwrap(g) || [], parties: unwrap(p) || [], roster: unwrap(r) || [], playing: unwrap(pl) || [], settings: unwrap(st) || {} });
  if (!state.servers.some((x) => x.id === state.serverId)) state.serverId = null;
}

const playingEntry = (id) => state.playing.find((p) => p.id === id);
const serverAccounts = (sid) => state.accounts.filter((a) => a.server_id === sid);

// ---- sidebar ---------------------------------------------------------------------------------------------------
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const q = state.serverSearch.trim().toLowerCase();
  const list = state.servers.filter((s) => !q || (s.name || '').toLowerCase().includes(q));
  const search = h('input', { placeholder: t('SERVERS.SERVER_NAME_PLACEHOLDER'), value: state.serverSearch, oninput: (e) => { state.serverSearch = e.target.value; renderSidebarList(); } });
  sb.replaceChildren(
    h('div', { class: 'sb-head' }, h('h2', {}, t('SERVERS.TITLE')), h('button', { class: 'primary icon-btn', title: t('SERVERS.ADD_SERVER'), onclick: () => serverModal() }, '＋')),
    h('div', { class: 'sb-search' }, h('div', { class: 'search-box', style: 'flex:1' }, h('span', {}, '🔍'), search)),
    h('div', { class: 'sb-list', id: 'sb-list' }),
    h('div', { class: 'sb-foot' },
      h('button', { class: 'gear icon-btn', title: t('COMMON.SETTINGS'), onclick: () => openPanel('settings') }, '⚙'),
      h('div', {}, h('div', {}, `${t('COMMON.VERSION')}: ${state.version || ''}`))));
  void list;
  renderSidebarList();
}

function renderSidebarList() {
  const box = document.getElementById('sb-list');
  if (!box) return;
  const q = state.serverSearch.trim().toLowerCase();
  const list = state.servers.filter((s) => !q || (s.name || '').toLowerCase().includes(q));
  box.replaceChildren();
  if (!state.servers.length) {
    box.append(h('div', { class: 'sb-empty muted' }, t('SERVERS.SERVERS_NOT_FOUND') + '!', h('div', {}, h('button', { class: 'primary', onclick: () => serverModal() }, t('SERVERS.ADD_SERVER')))));
    return;
  }
  for (const s of list) {
    const accs = serverAccounts(s.id).filter((a) => !a.archived);
    const live = accs.filter((a) => playingEntry(a.id) && !playingEntry(a.id).crashState).length;
    const more = h('button', { class: 'ghost icon-btn more', onclick: (e) => { e.stopPropagation(); menu(more, [{ label: t('COMMON.EDIT'), onclick: () => serverModal(s) }, { label: t('SERVERS.DETAILS.GENERAL_SECTION'), onclick: () => serverInfoModal(s) }, '-', { label: t('ACCOUNT_LIST.DROP_MENU.DELETE'), danger: true, onclick: () => deleteServer(s) }]); } }, '⋮');
    box.append(h('div', { class: 'server' + (state.serverId === s.id && !state.panel ? ' active' : ''), onclick: () => { state.serverId = s.id; state.panel = null; state.selected.clear(); render(); } },
      s.icon ? h('img', { src: s.icon, alt: '' }) : h('div', { class: 'sv-ph' }, (s.name || '?').slice(0, 2).toUpperCase()),
      h('div', { style: 'min-width:0' }, h('div', { class: 'sv-name' }, s.name || '—'), h('div', { class: 'sv-sub' }, `${accs.length} ${t('COMMON.ACCOUNTS').toLowerCase()}${live ? ' · ' + live + ' ' + t('ACCOUNT_LIST.FILTER.PLAYING').toLowerCase() : ''}`)),
      more));
  }
}

// ---- server modals ---------------------------------------------------------------------------------------------
function serverModal(existing) {
  const s = existing ? { ...existing, forceServer: { enabled: false, name: '', ...(existing.forceServer || {}) } } : { id: uid(), name: '', location: '', icon: '', iconLocation: '', arguments: '', description: '', forceServer: { enabled: false, name: '' } };
  const exe = h('input', { value: s.location, placeholder: 'C:\\...\\elementclient.exe', oninput: (e) => { s.location = e.target.value; } });
  const iconPrev = h('img', { src: s.icon || '', alt: '', style: 'width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--s1)' + (s.icon ? '' : ';visibility:hidden') });
  const forceName = h('input', { value: s.forceServer.name, placeholder: t('SERVERS.ADD_EDIT_SERVER.FORCE_SERVER_NAME'), disabled: !s.forceServer.enabled, oninput: (e) => { s.forceServer.name = e.target.value; } });
  openModal({
    title: existing ? t('SERVERS.ADD_EDIT_SERVER.EDIT') : t('SERVERS.ADD_EDIT_SERVER.ADD'),
    body: [
      field(t('SERVERS.ADD_EDIT_SERVER.NAME') + ' *', h('input', { value: s.name, oninput: (e) => { s.name = e.target.value; } })),
      field(t('SERVERS.ADD_EDIT_SERVER.ELEMENT_CLIENT_PATH') + ' *', h('div', { class: 'inline' }, exe, h('button', { onclick: async () => { const p = unwrap(await api.invoke('select-exe')); if (p) { s.location = p; exe.value = p; } } }, '…'))),
      field(t('SERVERS.ADD_EDIT_SERVER.ICON_PATH') + ' (' + t('COMMON.OPTIONAL').toLowerCase() + ')', h('div', { class: 'inline' }, iconPrev, h('button', { onclick: async () => {
        const r = await api.invoke('select-image');
        if (r && !r.success) return toast(r.error, 'err');
        if (r?.response) { s.icon = r.response.dataUrl; s.iconLocation = r.response.path; iconPrev.src = s.icon; iconPrev.style.visibility = 'visible'; }
      } }, t('AUTO_FORJA.SELECT_FILE')), h('button', { class: 'ghost', onclick: () => { s.icon = ''; s.iconLocation = ''; iconPrev.style.visibility = 'hidden'; } }, t('COMMON.REMOVE')))),
      field(t('SERVERS.ADD_EDIT_SERVER.ARGUMENTS'), h('input', { value: s.arguments, oninput: (e) => { s.arguments = e.target.value; } })),
      offsetsKeyField(s),
      field(t('SERVERS.ADD_EDIT_SERVER.DESCRIPTION'), h('textarea', { oninput: (e) => { s.description = e.target.value; } }, s.description || '')),
      h('div', { class: 'field' }, sw(t('SERVERS.ADD_EDIT_SERVER.FORCE_SERVER'), s.forceServer.enabled, (v) => { s.forceServer.enabled = v; forceName.disabled = !v; }), forceName, h('span', { class: 'hint' }, t('SERVERS.ADD_EDIT_SERVER.FORCE_SERVER_WARNING'))),
    ],
    buttons: [{ label: t('COMMON.CANCEL') }, {
      label: t('COMMON.SAVE'), kind: 'primary', onclick: async () => {
        if (!s.name.trim() || !s.location.trim()) { toast(t('COMMON.MANDATORY_FIELDS'), 'err'); return false; }
        const i = state.servers.findIndex((x) => x.id === s.id);
        if (i >= 0) state.servers[i] = s; else state.servers.push(s);
        await saveServers();
        api.invoke('update-sync-server', { serverId: s.id, offsetsKey: s.offsetsKey || '' });
        if (!state.serverId) state.serverId = s.id;
        render();
      },
    }],
  });
}

function serverInfoModal(s) {
  const accs = serverAccounts(s.id);
  const byClass = {};
  for (const a of accs) byClass[a.store ? 'STORE' : a.charClass || ''] = (byClass[a.store ? 'STORE' : a.charClass || ''] || 0) + 1;
  openModal({
    title: s.name, body: [
      h('div', { class: 'kv' },
        h('div', {}, t('SERVERS.ADD_EDIT_SERVER.ELEMENT_CLIENT_PATH')), h('div', {}, s.location),
        h('div', {}, t('SERVERS.DETAILS.ARGUMENTS')), h('div', {}, s.arguments || t('ERRORS.ARGUMENTS_NOT_FOUND')),
        h('div', {}, t('COMMON.PLAYING_HOURS')), h('div', {}, fmtDuration(accs.reduce((n, a) => n + (a.totalPlayMs || 0), 0))),
        h('div', {}, t('SERVERS.DETAILS.TOTAL_ACCOUNTS')), h('div', {}, String(accs.length)),
        h('div', {}, t('SERVERS.DETAILS.TOTAL_ACTIVE_ACCOUNTS')), h('div', {}, String(accs.filter((a) => playingEntry(a.id)).length)),
        h('div', {}, t('SERVERS.DETAILS.FORCE_SERVER')), h('div', {}, s.forceServer?.enabled ? s.forceServer.name : t('COMMON.DISABLED'))),
      h('div', { class: 'lbl' }, t('SERVERS.DETAILS.CLASS_STATISTIC')),
      Object.entries(byClass).map(([c, n]) => h('div', { class: 'inline' }, h('span', { style: 'width:130px' }, c ? t('CHARACTER_CLASS.' + c) : t('ERRORS.NOT_INFORMED')), h('div', { class: 'bar', style: 'flex:1' }, h('i', { style: `width:${(n / accs.length) * 100}%` })), h('span', {}, String(n)))),
    ], buttons: [{ label: t('COMMON.CLOSE') }],
  });
}

async function deleteServer(s) {
  const n = serverAccounts(s.id).length;
  if (!(await confirmModal({ title: t('ACCOUNT_LIST.DELETE_MODAL.TITLE'), text: `${t('ACCOUNT_LIST.DELETE_MODAL.DESCRIPTION')} (${s.name}${n ? ` — ${n} ${t('COMMON.ACCOUNTS').toLowerCase()}` : ''})`, help: t('ACCOUNT_LIST.DELETE_MODAL.HELP_TEXT'), confirm: t('ACCOUNT_LIST.DELETE_MODAL.CONFIRM_BUTTON') }))) return;
  for (const a of serverAccounts(s.id)) api.send('close-element', a.id);
  state.accounts = state.accounts.filter((a) => a.server_id !== s.id);
  state.servers = state.servers.filter((x) => x.id !== s.id);
  await saveAccounts(); await saveServers();
  if (state.serverId === s.id) state.serverId = null;
  render();
}

// ---- accounts view ---------------------------------------------------------------------------------------------
function filteredAccounts() {
  const f = state.filter, q = state.accSearch.trim().toLowerCase();
  let list = serverAccounts(state.serverId).filter((a) => !!a.archived === (state.accTab === 'archived'));
  if (q) list = list.filter((a) => [a.characterName, a.login, a.description].some((v) => (v || '').toLowerCase().includes(q)));
  if (f.group) list = list.filter((a) => a.group === f.group);
  if (f.cls) list = list.filter((a) => a.charClass === f.cls);
  if (f.store) list = list.filter((a) => a.store);
  if (f.fav) list = list.filter((a) => a.favorite);
  if (f.played) list = list.filter((a) => a.lastSession);
  if (f.playing) list = list.filter((a) => playingEntry(a.id));
  const byName = (a, b) => (a.login || '').localeCompare(b.login || '');
  const sorters = { asc: byName, desc: (a, b) => byName(b, a), last: (a, b) => (b.lastSession || 0) - (a.lastSession || 0), fav: (a, b) => Number(!!b.favorite) - Number(!!a.favorite) || byName(a, b), most: (a, b) => (b.totalPlayMs || 0) - (a.totalPlayMs || 0) };
  return list.sort(sorters[f.sort] || byName);
}
const hasFilter = () => { const f = state.filter; return !!(f.group || f.cls || f.store || f.fav || f.played || f.playing); };

function accountsView() {
  const server = state.servers.find((s) => s.id === state.serverId);
  const main = document.getElementById('main');
  if (!server) {
    main.replaceChildren(h('div', { class: 'center-msg' }, h('h1', {}, t('ACCOUNT_LIST.MESSAGES.WITHOUT_SERVER.TITLE')), h('p', { class: 'muted' }, t('ACCOUNT_LIST.MESSAGES.WITHOUT_SERVER.HELP_TEXT'))));
    return;
  }
  const all = serverAccounts(server.id);
  const list = filteredAccounts();
  const filterBtn = h('button', { class: hasFilter() ? 'primary' : '', onclick: () => filterPopover(filterBtn) }, '⛃ Filtros');
  const head = h('div', { class: 'm-head' },
    h('h2', {}, server.name),
    h('div', { class: 'tabs' }, ['all', 'archived'].map((k) => h('button', { class: state.accTab === k ? 'active' : '', onclick: () => { state.accTab = k; state.selected.clear(); render(); } }, t('ACCOUNT_LIST.TABS.' + k.toUpperCase())))),
    h('div', { class: 'search-box', style: 'width:210px;flex:none' }, h('span', {}, '🔍'), h('input', { placeholder: t('ACCOUNT_LIST.FILTER.SEARCH_PLACEHOLDER'), value: state.accSearch, oninput: (e) => { state.accSearch = e.target.value; renderAccountGrid(); } })),
    filterBtn,
    h('span', { class: 'spacer' }),
    h('button', { class: state.selectMode ? 'primary' : '', onclick: () => { state.selectMode = !state.selectMode; state.selected.clear(); render(); } }, t('ACCOUNT_LIST.SELECT_ACCOUNT')),
    h('button', { onclick: () => importModal(server) }, t('COMMON.IMPORT')),
    h('button', { class: 'primary', onclick: () => accountModal(null, server) }, '＋ ' + t('ACCOUNT_LIST.ADD_ACCOUNT')));
  const bulk = state.selectMode ? bulkBar(list) : null;
  main.replaceChildren(...[head, bulk, h('div', { class: 'm-body', id: 'acc-body' })].filter(Boolean));
  renderAccountGrid();
  void all;
}

function bulkBar(list) {
  const n = state.selected.size;
  return h('div', { class: 'm-head', style: 'background:var(--s2)' },
    h('button', { onclick: () => { if (n === list.length) state.selected.clear(); else list.forEach((a) => state.selected.add(a.id)); render(); } }, t('ACCOUNT_LIST.SELECT_ALL')),
    h('span', { class: 'muted' }, `${n} / ${list.length}`), h('span', { class: 'spacer' }),
    h('button', { class: 'success', disabled: !n, onclick: () => playMany([...state.selected]) }, `▶ ${t('COMMON.PLAY')} (${n})`),
    h('button', { disabled: !n, onclick: () => changeGroupModal([...state.selected]) }, t('ACCOUNT_LIST.CHANGE_GROUP')),
    h('button', { disabled: !n, onclick: () => { for (const id of state.selected) if (playingEntry(id)) api.send('close-element', id); } }, t('COMMON.CLOSE')));
}

function playMany(ids) {
  // Staggered so the launcher is not flooded with simultaneous clients.
  ids.forEach((id, i) => setTimeout(() => { if (!playingEntry(id)) api.send('open-element', { id }); }, i * 1500));
}

function renderAccountGrid() {
  const body = document.getElementById('acc-body');
  if (!body) return;
  const list = filteredAccounts();
  if (!list.length) {
    const none = !serverAccounts(state.serverId).length;
    body.replaceChildren(h('div', { class: 'center-msg' },
      state.accTab === 'archived' ? h('p', { class: 'muted' }, t('ACCOUNT_LIST.MESSAGES.NO_ARCHIVED'))
        : none ? [h('h1', {}, t('ACCOUNT_LIST.MESSAGES.EMPTY.TITLE')), h('p', { class: 'muted' }, t('ACCOUNT_LIST.MESSAGES.EMPTY.HELP_TEXT')),
          h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => accountModal(null, state.servers.find((s) => s.id === state.serverId)) }, t('ACCOUNT_LIST.MESSAGES.EMPTY.BUTTONS.ADD')), h('span', { class: 'muted' }, t('ACCOUNT_LIST.MESSAGES.EMPTY.CONNECTION')), h('button', { onclick: () => importModal(state.servers.find((s) => s.id === state.serverId)) }, t('ACCOUNT_LIST.MESSAGES.EMPTY.BUTTONS.IMPORT')))]
          : h('p', { class: 'muted' }, t('ERRORS.EMPTY_ACCOUNTS'))));
    return;
  }
  body.replaceChildren(h('div', { class: 'row muted', style: 'margin-bottom:8px' }, `${t('ACCOUNT_LIST.TOTAL')}: ${list.length}`), h('div', { class: 'acc-grid' }, list.map(accountCard)));
}

function accountCard(a) {
  const p = playingEntry(a.id);
  const crashed = p?.crashState;
  const group = state.groups.find((g) => g.id === a.group);
  const more = h('button', { class: 'ghost icon-btn', onclick: () => menu(more, [
    { label: t('ACCOUNT_LIST.DROP_MENU.INFORMATION'), onclick: () => accountInfoModal(a) },
    { label: t('ACCOUNT_LIST.DROP_MENU.EDIT'), onclick: () => accountModal(a) },
    { label: t('ACCOUNT_LIST.DROP_MENU.CHANGE_GROUP'), onclick: () => changeGroupModal([a.id]) },
    { label: a.archived ? t('ACCOUNT_LIST.DROP_MENU.UNARCHIVE') : t('ACCOUNT_LIST.DROP_MENU.ARCHIVE'), onclick: async () => { a.archived = !a.archived; if (a.archived) api.send('close-element', a.id); await saveAccounts(); render(); } },
    '-', { label: t('ACCOUNT_LIST.DROP_MENU.DELETE'), danger: true, onclick: () => deleteAccount(a) },
  ]) }, '⋮');
  const card = h('div', { class: 'acc' + (p ? (crashed ? ' crashed' : ' playing') : '') + (state.selected.has(a.id) ? ' selected' : ''), onclick: (e) => {
    if (!state.selectMode || e.target.closest('button')) return;
    if (state.selected.has(a.id)) state.selected.delete(a.id); else state.selected.add(a.id);
    render();
  } },
  h('div', { class: 'acc-top' },
    h('div', { class: 'cls' }, classBadge(a)),
    h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'acc-name' }, a.characterName || '—'), h('div', { class: 'acc-sub' }, `${state.settings.streamer ? '••••••' : (a.login || '')}${a.charClass ? ' · ' + className(a.charClass) : ''}`)),
    h('button', { class: 'star' + (a.favorite ? ' on' : ''), title: t('ACCOUNT_LIST.DETAILS.FAVORITE'), onclick: async () => { a.favorite = !a.favorite; await saveAccounts(); render(); } }, a.favorite ? '★' : '☆'),
    more),
  h('div', { class: 'row' }, group && h('span', { class: 'tag', style: group.color ? `border-color:${group.color};color:${group.color}` : '' }, group.name), p && h('span', { class: 'pill' + (crashed ? ' red' : '') }, crashed ? 'crash' : t('ACCOUNT_LIST.FILTER.PLAYING')), a.totalPlayMs ? h('span', { class: 'muted', style: 'font-size:12px' }, fmtDuration(a.totalPlayMs)) : null),
  h('div', { class: 'acc-actions' },
    crashed ? h('button', { class: 'grow primary', onclick: () => { api.send('close-crash-window', a.id); setTimeout(() => api.send('open-element', { id: a.id }), 200); } }, t('CRASH_WINDOW.OK_BUTTON'))
      : p ? [h('button', { class: 'grow', onclick: () => api.send('focus-window', p.pid) }, '◎ Focar'), h('button', { class: 'danger', onclick: () => api.send('close-element', a.id) }, t('COMMON.CLOSE'))]
        : h('button', { class: 'grow success', onclick: () => api.send('open-element', { id: a.id }) }, '▶ ' + t('COMMON.PLAY'))));
  return card;
}

async function deleteAccount(a) {
  if (!(await confirmModal({ title: t('ACCOUNT_LIST.DELETE_MODAL.TITLE'), text: `${t('ACCOUNT_LIST.DELETE_MODAL.DESCRIPTION')} (${a.characterName || a.login})`, help: t('ACCOUNT_LIST.DELETE_MODAL.HELP_TEXT'), confirm: t('ACCOUNT_LIST.DELETE_MODAL.CONFIRM_BUTTON') }))) return;
  api.send('close-element', a.id);
  state.accounts = state.accounts.filter((x) => x.id !== a.id);
  await saveAccounts(); render();
}

function filterPopover(anchor) {
  const f = state.filter;
  const apply = () => { closePopover(); render(); };
  const groupOpts = [['', t('COMMON.NO_GROUP')], ...state.groups.map((g) => [g.id, g.name])];
  const clsOpts = [['', '—'], ...CLASSES.map((c) => [c, t('CHARACTER_CLASS.' + c)])];
  const sortOpts = [['asc', t('ACCOUNT_LIST.FILTER.SORT.ASC')], ['desc', t('ACCOUNT_LIST.FILTER.SORT.DESC')], ['last', t('ACCOUNT_LIST.FILTER.SORT.LAST_PLAYED')], ['fav', t('ACCOUNT_LIST.FILTER.SORT.FAVORITES')], ['most', t('ACCOUNT_LIST.FILTER.SORT.MOST_PLAYED')]];
  openPopover(anchor, h('div', { class: 'filter-pop' },
    field(t('ACCOUNT_LIST.FILTER.ACCOUNT_GROUP'), select(groupOpts, f.group, (v) => { f.group = v; })),
    field(t('ACCOUNT_LIST.FILTER.CHARACTER_CLASS'), select(clsOpts, f.cls, (v) => { f.cls = v; })),
    sw(t('ACCOUNT_LIST.FILTER.ONLY_STORE'), f.store, (v) => { f.store = v; }),
    sw(t('ACCOUNT_LIST.FILTER.ONLY_FAVORITES'), f.fav, (v) => { f.fav = v; }),
    sw(t('ACCOUNT_LIST.FILTER.HAS_ANY_PLAYED_SESSION'), f.played, (v) => { f.played = v; }),
    sw(t('ACCOUNT_LIST.FILTER.PLAYING'), f.playing, (v) => { f.playing = v; }),
    field('Ordenar', select(sortOpts, f.sort, (v) => { f.sort = v; })),
    h('div', { class: 'row' }, h('button', { class: 'primary', style: 'flex:1', onclick: apply }, t('ACCOUNT_LIST.FILTER.APPLY')),
      h('button', { onclick: () => { Object.assign(f, { group: '', cls: '', store: false, fav: false, played: false, playing: false, sort: 'asc' }); apply(); } }, t('ACCOUNT_LIST.FILTER.CLEAN')))));
}

// ---- account modals --------------------------------------------------------------------------------------------
function accountModal(existing, server) {
  const sid = existing?.server_id ?? server?.id ?? state.serverId;
  const a = existing ? { ...existing } : { id: uid(), server_id: sid, login: '', password: '', characterName: '', charClass: '', group: '', description: '', store: false, favorite: false, archived: false, totalPlayMs: 0, sessionCount: 0, lastSession: 0, createdAt: Date.now() };
  const nameInput = h('input', { value: a.characterName, oninput: (e) => { a.characterName = e.target.value; } });
  const clsSel = select([['', '—'], ...CLASSES.map((c) => [c, t('CHARACTER_CLASS.' + c)])], a.charClass, (v) => { a.charClass = v; });
  const login = h('input', { type: state.settings.streamer ? 'password' : 'text', value: a.login, oninput: (e) => { a.login = e.target.value; } });
  const same = h('label', { class: 'switch' }, h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) { nameInput.value = login.value; a.characterName = login.value; } } }), h('span', {}, t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.SAME_CHARACTER_NAME')));
  openModal({
    title: existing ? t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.TITLE_EDIT') : t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.TITLE_ADD'),
    body: [
      field(t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.NAME') + ' *', login),
      field(t('COMMON.PASSWORD') + ' *', h('input', { type: 'password', value: a.password, oninput: (e) => { a.password = e.target.value; } })),
      field(t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.CHARACTER_NAME') + ' *', nameInput), same,
      field(t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.CHARACTER_CLASS'), clsSel),
      field(t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.ACCOUNT_GROUP'), h('div', { class: 'inline' }, select([['', t('COMMON.NO_GROUP')], ...state.groups.map((g) => [g.id, g.name])], a.group, (v) => { a.group = v; }),
        h('button', { title: 'Nova tag', onclick: async () => { const name = await promptModal('Nova tag', 'Nome da tag'); if (!name) return; const g = { id: uid(), name, color: '' }; state.groups.push(g); await saveGroups(); a.group = g.id; toast(`Tag "${g.name}" criada — selecione-a na lista`, 'ok'); } }, '＋'))),
      field(t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.DESCRIPTION'), h('textarea', { oninput: (e) => { a.description = e.target.value; } }, a.description || '')),
      sw(t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.ITS_STORE'), a.store, (v) => { a.store = v; }),
    ],
    buttons: [{ label: t('COMMON.CANCEL') }, {
      label: existing ? t('COMMON.SAVE') : t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.SUBMIT_BUTTON'), kind: 'primary', onclick: async () => {
        if (!a.login.trim() || !a.password || !a.characterName.trim()) { toast(t('COMMON.MANDATORY_FIELDS'), 'err'); return false; }
        const dup = state.accounts.some((x) => x.id !== a.id && x.server_id === a.server_id && x.characterName.toLowerCase() === a.characterName.trim().toLowerCase());
        if (dup) { toast(t('COMMON.CHARACTER_DUPLICATED'), 'err'); return false; }
        a.characterName = a.characterName.trim(); a.login = a.login.trim();
        const i = state.accounts.findIndex((x) => x.id === a.id);
        if (i >= 0) state.accounts[i] = a; else state.accounts.push(a);
        await saveAccounts(); render();
      },
    }],
  });
}

function accountInfoModal(a) {
  const g = state.groups.find((x) => x.id === a.group);
  openModal({
    title: a.characterName, body: [
      h('div', { class: 'lbl' }, t('ACCOUNT_LIST.DETAILS.GENERAL_SECTION')),
      h('div', { class: 'kv' },
        h('div', {}, t('ACCOUNT_LIST.DETAILS.CHARACTER_NAME')), h('div', {}, a.characterName),
        h('div', {}, t('COMMON.ACCOUNT_NAME')), h('div', {}, state.settings.streamer ? '••••••' : a.login),
        h('div', {}, t('ACCOUNT_LIST.FILTER.CHARACTER_CLASS')), h('div', {}, className(a.charClass)),
        h('div', {}, t('ACCOUNT_LIST.FILTER.ACCOUNT_GROUP')), h('div', {}, g?.name || t('ERRORS.NO_ONE')),
        h('div', {}, t('ACCOUNT_LIST.DETAILS.STORE')), h('div', {}, a.store ? t('COMMON.YES') : t('COMMON.NO')),
        h('div', {}, t('COMMON.CREATED_AT')), h('div', {}, fmtDate(a.createdAt)),
        h('div', {}, t('ACCOUNT_LIST.ADD_ACCOUNT_MODAL.DESCRIPTION')), h('div', {}, a.description || t('ERRORS.NO_DESCRIPTION'))),
      h('div', { class: 'lbl' }, t('ACCOUNT_LIST.DETAILS.ACCOUNT_STATISTIC')),
      h('div', { class: 'kv' },
        h('div', {}, t('COMMON.PLAYING_HOURS')), h('div', {}, fmtDuration(a.totalPlayMs)),
        h('div', {}, 'Sessões'), h('div', {}, String(a.sessionCount || 0)),
        h('div', {}, t('COMMON.LAST_SESSION')), h('div', {}, fmtDate(a.lastSession))),
    ], buttons: [{ label: t('COMMON.CLOSE') }],
  });
}

function changeGroupModal(ids) {
  let chosen = '';
  openModal({
    title: t('ACCOUNT_LIST.CHANGE_GROUP_MODAL.TITLE'),
    body: [h('p', { style: 'margin:0' }, t('ACCOUNT_LIST.CHANGE_GROUP_MODAL.DESCRIPTION')), select([['', t('COMMON.NO_GROUP')], ...state.groups.map((g) => [g.id, g.name])], '', (v) => { chosen = v; })],
    buttons: [{ label: t('COMMON.CANCEL') }, { label: t('ACCOUNT_LIST.CHANGE_GROUP_MODAL.SUBMIT_BUTTON'), kind: 'primary', onclick: async () => { for (const a of state.accounts) if (ids.includes(a.id)) a.group = chosen; await saveAccounts(); render(); } }],
  });
}

/** Import: one account per line — login;senha;personagem[;classe] (also accepts , or : as separator). */
function importModal(server) {
  let text = '';
  openModal({
    title: t('COMMON.IMPORT') + ' ' + t('COMMON.ACCOUNTS').toLowerCase(),
    body: [h('p', { class: 'muted', style: 'margin:0' }, 'Uma conta por linha: login;senha;personagem (separador ; , ou :). A classe é opcional e usa o nome em inglês, ex.: WIZARD.'), h('textarea', { style: 'min-height:180px', oninput: (e) => { text = e.target.value; } })],
    buttons: [{ label: t('COMMON.CANCEL') }, {
      label: t('COMMON.IMPORT'), kind: 'primary', onclick: async () => {
        let added = 0, skipped = 0;
        for (const line of text.split(/\r?\n/)) {
          const [login, password, characterName, cls] = line.split(/[;,:]/).map((x) => x.trim());
          if (!login || !password || !characterName) { if (line.trim()) skipped++; continue; }
          if (state.accounts.some((x) => x.server_id === server.id && x.characterName.toLowerCase() === characterName.toLowerCase())) { skipped++; continue; }
          state.accounts.push({ id: uid(), server_id: server.id, login, password, characterName, charClass: CLASSES.includes((cls || '').toUpperCase()) ? cls.toUpperCase() : '', group: '', description: '', store: false, favorite: false, archived: false, totalPlayMs: 0, sessionCount: 0, lastSession: 0, createdAt: Date.now() });
          added++;
        }
        await saveAccounts(); render();
        toast(`${added} importada(s)${skipped ? `, ${skipped} ignorada(s)` : ''}`, added ? 'ok' : 'err');
      },
    }],
  });
}
