'use strict';
// Shell: right-hand rail, panel routing, live events and boot.
const RAIL = [
  { id: 'party', icon: '👥', title: () => t('PARTY_MODE.PARTIES') },
];
const RAIL_BOTTOM = [
  { id: 'offsets', label: 'Offsets', small: true },
  { id: 'logs', label: 'logs', small: true },
];
const PANELS = { settings: settingsPanel, offsets: offsetsPanel, logs: logsPanel };

function openPanel(id) { state.panel = state.panel === id ? null : id; render(); }

function renderRail() {
  const rail = document.getElementById('rail');
  const btn = (b) => h('button', { class: 'rail-btn' + (b.small ? ' small' : '') + (b.pro ? ' unlocked' : '') + (state.panel === b.id ? ' active' : ''), title: b.title ? b.title() : b.label, onclick: () => (b.id === 'party' ? api.send('open-parties-window') : openPanel(b.id)) }, b.icon || b.label);
  rail.replaceChildren(...RAIL.map(btn), h('div', { class: 'rail-sp' }), ...RAIL_BOTTOM.map(btn));
}

function render() {
  closePopover();
  renderSidebar();
  renderRail();
  if (!state.panel) accountsView();
  else if (PANELS[state.panel]) PANELS[state.panel]();
}
// Live events must not rebuild the screen while the user is typing in a field.
function softRender() {
  const el = document.activeElement;
  if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) { renderSidebarList(); return; }
  if (document.querySelector('.overlay')) { renderSidebarList(); return; }
  render();
}

for (const [id, ch] of [['btn-min', 'minimize-main-window'], ['btn-max', 'maximize-main-window'], ['btn-close', 'close-main-window'], ['btn-toolbar', 'open-toolbar']]) {
  document.getElementById(id).addEventListener('click', () => api.send(ch));
}

api.on('open-panel', (id) => { if (PANELS[id]) { state.panel = id; render(); } });
api.on('playing-accounts-changed', (l) => { state.playing = l || []; softRender(); });
api.on('roster-changed', (l) => { state.roster = l || []; softRender(); });
api.on('accounts-updated', async () => { await loadAll(); softRender(); });
api.on('parties-updated', async () => { await loadAll(); softRender(); });
api.on('account-groups-updated', async () => { await loadAll(); softRender(); });
api.on('settings-updated', (s) => { if (s) state.settings = s; });
api.on('open-element-response', (r) => { if (r && !r.success) toast('Falha ao abrir: ' + (r.error || 'erro'), 'err'); });
api.on('crash-window', () => toast(t('CRASH_WINDOW.REOPEN'), 'err'));
api.on('job-started', ({ jobId }) => { state.jobs.add(jobId); softRender(); });
api.on('job-ended', ({ jobId }) => { state.jobs.delete(jobId); softRender(); });
api.on('job-error', ({ error }) => toast('Erro no preset: ' + error, 'err'));

(async () => {
  state.version = unwrap(await api.invoke('get-app-version'));
  await loadAll();
  await loadOffsets();
  await initSettings();
  render();
})();
