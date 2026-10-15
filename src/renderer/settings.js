'use strict';
// Settings panel — tabs mirror the original: Geral, Importar, Exportar, Backup/tags, Sobre.
const backupUi = { path: '', list: [], lastBackup: 0 };
const setUi = { tab: 'general', exportSel: new Set(), importServer: '' };

async function refreshBackups() {
  backupUi.list = unwrap(await api.invoke('get-backups-list', backupUi.path)) || [];
}

const sg = (key, params) => t('SETTINGS.GENERAL.' + key, params);
const card = (title, desc, ...kids) => h('div', { class: 'card' },
  h('h3', { style: 'margin-bottom:4px' }, title), desc ? h('p', { class: 'muted', style: 'margin:0 0 10px' }, desc) : null,
  h('div', { class: 'row', style: 'flex-direction:column;align-items:flex-start;gap:8px' }, ...kids));

async function settingsPanel() {
  const st = state.settings;
  st.party ??= {}; st.toolsBar ??= {}; st.backup ??= {}; st.assistant ??= {};
  const main = document.getElementById('main');
  const body = h('div', { class: 'm-body' });
  const tabs = [['general', t('SETTINGS.GENERAL.TAB_TITLE')], ['import', t('SETTINGS.IMPORT.TAB_TITLE')], ['export', t('SETTINGS.EXPORT.TAB_TITLE')], ['backup', t('SETTINGS.BACKUP.TITLE') || 'Backup'], ['versions', t('SETTINGS.VERSIONS.TAB_TITLE')], ['about', t('SETTINGS.ABOUT.TITLE') || 'Sobre']];
  main.replaceChildren(h('div', { class: 'm-head' }, h('h2', {}, t('SETTINGS.TITLE')), h('div', { class: 'tabs' },
    ...tabs.map(([id, label]) => h('button', { class: setUi.tab === id ? 'active' : '', onclick: () => { setUi.tab = id; render(); } }, label)))), body);
  const builders = { general: generalTab, import: importTab, export: exportTab, backup: backupTab, versions: versionsTab, about: aboutTab };
  await builders[setUi.tab](body, st);
}

function generalTab(body, st) {
  const commit = async () => { const r = await api.invoke('set-settings', st); if (!r.success) toast(r.error || 'Falha ao salvar', 'err'); };
  const p = st.party;
  const num = (v, fb, fn) => h('input', { type: 'number', min: 0, value: v ?? fb, style: 'width:110px', onchange: (e) => { fn(Number(e.target.value) || 0); commit(); } });
  const sc = (key, label) => field(label, shortcutInput(p[key], (v) => { p[key] = v || undefined; commit(); }));
  const swp = (key, label, def = false) => sw(label, p[key] ?? def, (v) => { p[key] = v; commit(); });

  body.append(card(sg('STREAMER_MODE.TEXT'), sg('STREAMER_MODE.DESCRIPTION'),
    sw(sg('STREAMER_MODE.TEXT'), !!st.streamer, (v) => { st.streamer = v; commit(); })));

  // auto backup
  const bk = st.backup;
  body.append(card(sg('AUTO_BACKUP.TEXT'), sg('AUTO_BACKUP.DESCRIPTION'),
    sw(sg('AUTO_BACKUP.TEXT'), !!bk.active, (v) => { bk.active = v; commit(); }),
    field(sg('AUTO_BACKUP.INTERVAL'), select(['1H', '4H', '8H', '12H', '1D'].map((k) => [k, sg('AUTO_BACKUP.BACKUP_TIME.' + k)]), bk.interval || '1D', (v) => { bk.interval = v; commit(); })),
    field(sg('AUTO_BACKUP.BACKUP_PATH'), h('div', { class: 'inline' },
      h('input', { value: bk.path || backupUi.path, style: 'width:340px', onchange: (e) => { bk.path = e.target.value; commit(); } }),
      h('button', { onclick: async () => { const d = unwrap(await api.invoke('select-folder')); if (d) { bk.path = d; commit(); render(); } } }, '…'))),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: async () => {
        const left = Math.ceil((backupUi.lastBackup + 30000 - Date.now()) / 1000);
        if (left > 0) return toast(sg('AUTO_BACKUP.WAIT_TO_BACKUP', { seconds: left }), 'err');
        const r = await api.invoke('backup', bk.path || backupUi.path);
        if (r.success) backupUi.lastBackup = Date.now();
        toast(r.success ? 'Backup criado' : r.error, r.success ? 'ok' : 'err');
      } }, sg('AUTO_BACKUP.BACKUP_NOW_ACTION')),
      h('button', { onclick: () => api.invoke('open-path', bk.path || backupUi.path) }, sg('AUTO_BACKUP.OPEN_BACKUP_PATH')))));

  // party mode
  body.append(card(sg('PARTY_MODE.TITLE'), sg('PARTY_MODE.SHORTCUTS.DESCRIPTION'),
    sc('previousCharacterShortcut', sg('PARTY_MODE.PREVIOUS_CHARACTER')), sc('nextCharacterShortcut', sg('PARTY_MODE.NEXT_CHARACTER')),
    sc('alternateCharacterShortcut', sg('PARTY_MODE.ALTERNATE_CHARACTERS')),
    sc('previousPartyShortcut', sg('PARTY_MODE.PREVIOUS_PARTY')), sc('nextPartyShortcut', sg('PARTY_MODE.NEXT_PARTY')),
    sc('activeClickMirror', sg('PARTY_MODE.ACTIVE_CLICK_MIRROR')),
    swp('numPadEnable', sg('PARTY_MODE.ENABLE_KEYBOARD_NUMBERS')), h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.ENABLE_KEYBOARD_NUMBERS_DESCRIPTION'))));

  body.append(card(sg('PARTY_MODE.PARTY_WINDOW_SETTINGS'), sg('PARTY_MODE.PARTY_WINDOW_SETTINGS_DESCRIPTION'),
    swp('showCharacterClass', sg('PARTY_MODE.SHOW_CHARACTER_CLASS'), true), swp('showPositionNumber', sg('PARTY_MODE.SHOW_CHARACTER_POSITION'), true),
    field(sg('PARTY_MODE.CHARACTER_CHANGE_WITH'), select([['simple', sg('PARTY_MODE.CLICK_SIMPLE')], ['double', sg('PARTY_MODE.CLICK_DOUBLE')]], p.characterChangeClickType || 'simple', (v) => { p.characterChangeClickType = v; commit(); })),
    swp('enableMemoryRead', sg('PARTY_MODE.ENABLE_MEMORY_READ'), true), h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.ENABLE_MEMORY_READ_DESCRIPTION')),
    swp('hideMemberList', sg('PARTY_MODE.HIDE_MEMBER_LIST')), h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.HIDE_MEMBER_LIST_DESCRIPTION')),
    swp('showMainPresetButton', sg('PARTY_MODE.SHOW_MAIN_PRESET_BUTTON'), true), h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.SHOW_MAIN_PRESET_BUTTON_DESCRIPTION')),
    swp('presetsRequireFocus', sg('PARTY_MODE.PRESETS_REQUIRE_FOCUS')), h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.PRESETS_REQUIRE_FOCUS_DESCRIPTION')),
    h('div', { class: 'row' }, h('strong', {}, sg('PARTY_MODE.RESET_WINDOW_POSITION')), h('button', { onclick: async () => { await api.invoke('reset-party-window'); toast(sg('PARTY_MODE.RESET_WINDOW_SUCCESS'), 'ok'); } }, sg('PARTY_MODE.RESET_WINDOW_POSITION_ACTION'))),
    h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.RESET_WINDOW_POSITION_DESCRIPTION'))));

  // preset engine
  let engine = p.presetEngine || 'new';
  body.append(card(sg('PARTY_MODE.PRESET_ENGINE.TITLE'), sg('PARTY_MODE.PRESET_ENGINE.DESCRIPTION'),
    h('div', { class: 'row' },
      select([['new', sg('PARTY_MODE.PRESET_ENGINE.NEW')], ['classic', sg('PARTY_MODE.PRESET_ENGINE.CLASSIC')]], engine, (v) => { engine = v; }),
      h('button', { class: 'primary', onclick: async () => {
        const r = await api.invoke('apply-preset-engine', engine);
        if (r.success) { p.presetEngine = engine; toast(sg('PARTY_MODE.ENGINE_APPLIED'), 'ok'); } else toast(sg('PARTY_MODE.ENGINE_APPLY_FAILED'), 'err');
      } }, sg('PARTY_MODE.APPLY_ENGINE'))),
    h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.PRESET_ENGINE.SWITCH_WARNING')),
    swp('performanceMode', sg('PARTY_MODE.PERFORMANCE_MODE.TITLE')), h('p', { class: 'muted', style: 'margin:0' }, sg('PARTY_MODE.PERFORMANCE_MODE.DESCRIPTION') + ' ' + sg('PARTY_MODE.PERFORMANCE_MODE.WARNING')),
    field(t('MOBILE.PARTY.DEFAULT_KEY_DELAY') || 'Delay padrão entre teclas (ms)', num(p.defaultKeyDelayMs, 50, (v) => { p.defaultKeyDelayMs = v; }))));

  // tools bar
  const tb = st.toolsBar;
  body.append(card(sg('TOOLS_BAR.TITLE'), sg('TOOLS_BAR.DESCRIPTION'),
    sw(sg('TOOLS_BAR.TITLE'), !!tb.enable, (v) => { tb.enable = v; commit(); }),
    sw(sg('TOOLS_BAR.AUTO_OPEN'), !!tb.autoOpen, (v) => { tb.autoOpen = v; commit(); }),
    field(sg('TOOLS_BAR.OPACITY'), h('input', { type: 'range', min: 30, max: 100, value: Math.round((tb.opacity ?? 1) * 100), onchange: (e) => { tb.opacity = Number(e.target.value) / 100; commit(); } })),
    sw(sg('TOOLS_BAR.SHOW_CHARACTER_NAME'), tb.showWindowName ?? true, (v) => { tb.showWindowName = v; commit(); }),
    sw(sg('TOOLS_BAR.ENABLE_KEYBOARD_SHORTCUTS'), !!tb.allowShortcuts, (v) => { tb.allowShortcuts = v; commit(); }),
    h('div', { class: 'row' }, h('button', { onclick: async () => { await api.invoke('reset-tools-bar-window'); toast(sg('TOOLS_BAR.RESET_WINDOW_SUCCESS'), 'ok'); } }, sg('TOOLS_BAR.RESET_WINDOW_POSITION_ACTION')),
      h('button', { onclick: () => api.send('open-toolbar') }, sg('TOOLS_BAR.TITLE')))));

  // background / startup / assistant
  body.append(card(sg('SECOND_PLAN.TITLE'), sg('SECOND_PLAN.DESCRIPTION'), sw(sg('SECOND_PLAN.TITLE'), !!st.background, (v) => { st.background = v; commit(); })));
  body.append(card(sg('WINDOWS_INITIALIZATION.TITLE'), sg('WINDOWS_INITIALIZATION.DESCRIPTION'),
    sw(sg('WINDOWS_INITIALIZATION.TITLE'), !!st.windowsInitialization, (v) => { st.windowsInitialization = v; api.invoke(v ? 'enable-start-with-windows' : 'disable-start-with-windows'); commit(); })));
  body.append(card(sg('ASSISTANT_PANEL.TITLE'), sg('ASSISTANT_PANEL.DESCRIPTION'),
    sw(sg('ASSISTANT_PANEL.TITLE'), st.assistant.enabled ?? true, (v) => { st.assistant.enabled = v; commit(); })));

  body.append(elementCustomCard());
  classIconsCard().then((c) => body.append(c));
  body.append(memorySettingsCard());
}

// ---- Importar ----------------------------------------------------------------------------------------------------
function importTab(body) {
  const si = (k) => t('SETTINGS.IMPORT.' + k);
  const servers = state.servers;
  if (!setUi.importServer || !servers.some((s) => s.id === setUi.importServer)) setUi.importServer = state.serverId || servers[0]?.id || '';
  const sub = setUi.importSub || 'copy';
  const subTabs = h('div', { class: 'tabs' }, ...[['copy', si('TABS.COPY_PASTE')], ['shortcuts', si('TABS.SHORTCUTS')], ['pwl', si('TABS.PWLAUNCHER')]]
    .map(([id, l]) => h('button', { class: sub === id ? 'active' : '', onclick: () => { setUi.importSub = id; render(); } }, l)));
  const dest = field(si('DESTINATION_TITLE'), select(servers.map((s) => [s.id, s.name]), setUi.importServer, (v) => { setUi.importServer = v; }), si('DESTINATION_SUBTITLE'));
  const baseAcc = (o) => ({ id: uid(), server_id: setUi.importServer, login: '', password: '', characterName: '', charClass: '', group: '', description: '', store: false, favorite: false, archived: false, totalPlayMs: 0, sessionCount: 0, lastSession: 0, createdAt: Date.now(), ...o });
  const addAll = async (list) => {
    let added = 0, skipped = 0;
    for (const a of list) {
      if (!a.characterName || state.accounts.some((x) => x.server_id === setUi.importServer && x.characterName.toLowerCase() === a.characterName.toLowerCase())) { skipped++; continue; }
      state.accounts.push(baseAcc(a)); added++;
    }
    await saveAccounts();
    toast(`${added} importada(s)${skipped ? `, ${skipped} ignorada(s)` : ''}`, added ? 'ok' : 'err');
    render();
  };
  let content;
  if (sub === 'copy') {
    let code = '';
    content = [h('p', { class: 'muted', style: 'margin:0' }, si('COPY_PASTE.DESCRIPTION')), h('textarea', { style: 'min-height:140px;width:100%', oninput: (e) => { code = e.target.value; } }),
      h('button', { class: 'primary', onclick: () => {
        try {
          const rows = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.trim().replace(/^PWA1:/, '')), (c) => c.charCodeAt(0))));
          addAll(rows.map((r) => ({ characterName: r.n, login: r.l, password: r.p, charClass: r.c || '', email: r.e || '' })));
        } catch { toast('Código inválido', 'err'); }
      } }, t('COMMON.IMPORT'))];
  } else if (sub === 'shortcuts') {
    content = [h('p', { class: 'muted', style: 'margin:0' }, si('SHORTCUTS.DESCRIPTION')),
      h('button', { class: 'primary', onclick: async () => {
        const list = unwrap(await api.invoke('select-shortcuts')) || [];
        const rows = list.map((l) => {
          const m = /(?:^|\s)(?:user:|-user:)(\S+)\s+(?:pwd:|-pwd:)(\S+)(?:.*?(?:role:|-role:)(\S+))?/i.exec(l.args) || [];
          return { characterName: m[3] || l.name, login: m[1] || '', password: m[2] || '' };
        }).filter((r) => r.login && r.password);
        if (!rows.length) return toast('Nenhuma conta encontrada nos atalhos', 'err');
        addAll(rows);
      } }, si('SHORTCUTS.SELECT_BUTTON'))];
  } else {
    content = [h('p', { class: 'muted', style: 'margin:0' }, si('PWLAUNCHER.DESCRIPTION')),
      h('button', { class: 'primary', onclick: async () => {
        const f = unwrap(await api.invoke('select-text-file', ['plContas', 'json', 'txt']));
        if (!f) return;
        let rows = [];
        try {
          const j = JSON.parse(f.text);
          rows = (Array.isArray(j) ? j : j.contas || j.accounts || []).map((x) => ({ characterName: x.personagem || x.nome || x.character || x.name || '', login: x.login || x.usuario || x.user || '', password: x.senha || x.password || x.pass || '' }));
        } catch {
          rows = f.text.split(/\r?\n/).map((l) => l.split(/[;,\t]/).map((x) => x.trim())).filter((c) => c.length >= 3).map((c) => ({ characterName: c[2], login: c[0], password: c[1] }));
        }
        rows = rows.filter((r) => r.login && r.password && r.characterName);
        if (!rows.length) return toast('Formato do arquivo não reconhecido', 'err');
        addAll(rows);
      } }, si('PWLAUNCHER.SELECT_BUTTON'))];
  }
  body.append(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:8px' }, si('TITLE')), subTabs, h('div', { style: 'margin:10px 0' }, dest), h('div', { class: 'row', style: 'flex-direction:column;align-items:flex-start;gap:8px' }, ...content)));
}

// ---- Exportar ----------------------------------------------------------------------------------------------------
function exportTab(body) {
  const se = (k) => t('SETTINGS.EXPORT.' + k);
  const sel = setUi.exportSel;
  const list = state.accounts.filter((a) => !a.archived);
  const code = setUi.exportCode;
  if (code) {
    body.append(h('div', { class: 'card' }, h('h3', {}, se('TITLE_STEP_2')), h('p', { class: 'muted' }, se('DESCRIPTION_STEP_2')),
      h('textarea', { readonly: '', style: 'min-height:140px;width:100%', onclick: (e) => e.target.select() }, code),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => { setUi.exportCode = ''; render(); } }, se('BACK')),
        h('button', { class: 'primary', onclick: () => { navigator.clipboard?.writeText(code); toast(t('COMMON.COPIED') || 'Copiado', 'ok'); } }, t('COMMON.COPY') || 'Copiar'))));
    return;
  }
  const rows = list.map((a) => h('label', { class: 'row' },
    h('input', { type: 'checkbox', checked: sel.has(a.id) ? '' : null, onchange: (e) => { e.target.checked ? sel.add(a.id) : sel.delete(a.id); } }),
    h('span', {}, a.characterName), h('span', { class: 'muted' }, `${a.login} · ${state.servers.find((s) => s.id === a.server_id)?.name || ''}`)));
  body.append(h('div', { class: 'card' }, h('h3', {}, se('TITLE')), h('p', { class: 'muted' }, se('DESCRIPTION')),
    h('div', { class: 'row' }, h('button', { onclick: () => { for (const a of list) sel.add(a.id); render(); } }, se('SELECT_ALL')), h('button', { onclick: () => { sel.clear(); render(); } }, se('CLEAR_ALL') || 'Limpar')),
    h('div', { style: 'max-height:340px;overflow:auto;margin:8px 0;display:flex;flex-direction:column;gap:6px' }, ...rows),
    h('p', { class: 'muted' }, se('HELP_TEXT')),
    h('button', { class: 'primary', disabled: !sel.size, onclick: async () => { setUi.exportCode = unwrap(await api.invoke('export-accounts-code', [...sel])); render(); } }, se('SUBMIT_BTN_STEP_1'))));
}

// ---- Backup + tags -----------------------------------------------------------------------------------------------
function backupTab(body) {
  const tags = h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', {}, t('ACCOUNT_LIST.FILTER.ACCOUNT_GROUP') + 's'), h('span', { class: 'spacer' }),
    h('button', { onclick: async () => { const name = await promptModal('Nova tag', 'Nome da tag'); if (!name) return; state.groups.push({ id: uid(), name, color: '' }); await saveGroups(); render(); } }, '＋ ' + t('COMMON.ADD'))));
  if (!state.groups.length) tags.append(h('p', { class: 'muted', style: 'margin:8px 0 0' }, t('ERRORS.GROUP_NOT_FOUND')));
  for (const g of state.groups) {
    tags.append(h('div', { class: 'row', style: 'margin-top:8px' },
      h('input', { value: g.name, style: 'width:220px', oninput: (e) => { g.name = e.target.value; }, onchange: saveGroups }),
      h('input', { type: 'color', value: g.color || '#adb5bd', style: 'width:44px;padding:2px', onchange: (e) => { g.color = e.target.value; saveGroups(); } }),
      h('span', { class: 'muted' }, `${state.accounts.filter((a) => a.group === g.id).length} ${t('COMMON.ACCOUNTS').toLowerCase()}`),
      h('button', { class: 'ghost', onclick: async () => { state.groups = state.groups.filter((x) => x.id !== g.id); for (const a of state.accounts) if (a.group === g.id) a.group = ''; await saveGroups(); await saveAccounts(); render(); } }, '🗑')));
  }
  body.append(tags);

  const pathInput = h('input', { value: backupUi.path, style: 'flex:1', onchange: async (e) => { backupUi.path = e.target.value; await refreshBackups(); render(); } });
  const bk = h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:10px' }, t('SETTINGS.BACKUP.TITLE') || 'Backup'),
    h('div', { class: 'inline' }, pathInput, h('button', { onclick: async () => { const p = unwrap(await api.invoke('select-folder')); if (p) { backupUi.path = p; await refreshBackups(); render(); } } }, '…')),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: async () => { const r = await api.invoke('backup', backupUi.path); toast(r.success ? 'Backup criado' : r.error, r.success ? 'ok' : 'err'); await refreshBackups(); render(); } }, 'Criar backup agora')));
  if (!backupUi.list.length) bk.append(h('p', { class: 'muted', style: 'margin:8px 0 0' }, t('ERRORS.NO_BACKUP_FOUND')));
  for (const b of backupUi.list) {
    bk.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('span', {}, b.name), h('span', { class: 'spacer' }),
      h('button', { onclick: async () => {
        if (!(await confirmModal({ title: 'Restaurar backup', text: 'Restaurar este backup substitui os dados atuais.', confirm: 'Restaurar' }))) return;
        const r = await api.invoke('restore', b.path);
        toast(r.success ? 'Backup restaurado' : r.error, r.success ? 'ok' : 'err');
        await loadAll(); render();
      } }, 'Restaurar')));
  }
  body.append(bk);
}

function versionsTab(body) {
  const sv = (k, p) => t('SETTINGS.VERSIONS.' + k, p);
  body.append(h('div', { class: 'card' }, h('h3', {}, sv('TITLE')), h('p', { class: 'muted' }, sv('DESCRIPTION')),
    h('div', {}, sv('CURRENT_CHANNEL', { channel: 'estável' })), h('div', { class: 'muted' }, `v${state.version || ''}`)));
}

function aboutTab(body) {
  body.append(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:6px' }, t('SETTINGS.ABOUT.TITLE') || 'Sobre'),
    h('div', { class: 'muted' }, `PW Helper ${state.version || ''} — recriação independente. Sem login, licença ou telemetria.`),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => api.invoke('open-path', backupUi.path) }, 'Abrir pasta de backups'))));
}

async function initSettings() {
  backupUi.path = unwrap(await api.invoke('get-backup-default-path')) || '';
  await refreshBackups();
}
