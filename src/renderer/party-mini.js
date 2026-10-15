'use strict';
// Detached party window: compact view of one party with its main preset button.
const partyId = new URLSearchParams(location.search).get('partyId');
const mini = { mode: 'list', loop: false, syncAll: false };
try { mini.mode = localStorage.getItem('mini.mode') || 'list'; } catch { /* storage unavailable */ }
const party = () => state.parties.find((p) => p.id === partyId);

function mainPreset(p) {
  const list = p?.presets?.presets || [];
  return list.find((x) => x.isMain) || list[0];
}

function miniMember(id) {
  const pe = playingEntry(id);
  const a = state.accounts.find((x) => x.id === id);
  if (mini.mode === 'compact') return h('span', { class: 'chip' + (pe ? ' on' : ''), title: accName(id), onclick: () => pe && api.send('focus-window', id) }, a ? classBadge(a) : '?');
  return h('div', { class: 'mrow' + (pe ? ' on' : '') },
    h('div', { class: 'row' }, h('span', { class: 'sv-ph sm' }, a ? classBadge(a) : '?'), h('strong', { class: 'grow' }, accName(id)),
      mini.mode === 'cards' && h('span', { class: 'badge' + (pe ? ' on' : '') }, pe ? t('MOBILE.MEMBERS.STATE_PLAYING') : t('MOBILE.MEMBERS.STATE_IDLE'))),
    mini.mode === 'cards' && pe ? memBox(id) : null);
}

function render() {
  closePopover();
  const root = document.getElementById('mini');
  const p = party();
  if (!p) { root.replaceChildren(h('p', { class: 'muted', style: 'padding:16px' }, t('MOBILE.PARTIES.EMPTY'))); return; }
  const members = membersOf(p.id);
  const mp = mainPreset(p);
  const running = mp && state.jobs.has(mp.id);
  const modeBtn = (m, icon) => h('button', { class: 'ghost' + (mini.mode === m ? ' active' : ''), onclick: () => { mini.mode = m; try { localStorage.setItem('mini.mode', m); } catch { /* ignore */ } render(); } }, icon);
  const kebab = h('button', { class: 'ghost icon-btn', onclick: () => menu(kebab, [
    { label: '⤢ Fixar de volta na janela principal', onclick: () => api.send('close-minimized-party', p.id) },
    { label: '✕ ' + t('PARTY_MODE.CLOSE_WINDOW'), onclick: () => api.send('close-minimized-party', p.id) },
  ]) }, '⋮');
  root.replaceChildren(
    h('div', { class: 'mini-top' },
      h('span', { class: 'pro-mark' }, 'PRO'), sw('Sync click', mini.syncClick ?? false, (v) => { mini.syncClick = v; api.send(v ? 'listen-click-mirror' : 'stop-listen-click-mirror', mini.syncAll); }),
      h('span', { class: 'spacer' }), h('button', { class: 'chip' + (mini.syncAll ? ' active' : ''), title: t('PARTY_MODE.SYNC_CLICK.ALL_PARTIES'), onclick: async () => { mini.syncAll = !mini.syncAll; await api.invoke('party:sync-click-target', { allParties: mini.syncAll }); render(); } }, t('PARTY_MODE.SYNC_CLICK.ALL_PARTIES')), kebab),
    h('div', { class: 'mini-name' }, h('strong', { class: 'grow' }, p.name), h('div', { class: 'tabs' }, modeBtn('list', '☰'), modeBtn('cards', '▦'), modeBtn('compact', '▪'))),
    h('div', { class: 'mini-body' + (mini.mode === 'compact' ? ' compact' : '') }, members.length ? members.map(miniMember) : h('em', { class: 'muted' }, t('PARTY_MODE.EMPTY_DROP_HINT'))),
    h('div', { class: 'mini-foot' },
      sw(t('PARTY_MODE.BACKGROUND_EXECUTION'), !!p.backgroundExecution, (v) => { p.backgroundExecution = v; saveParties(); }),
      h('div', { class: 'row' },
        h('button', { class: 'primary grow big' + (running ? ' danger' : ''), disabled: !mp, onclick: async () => {
          if (running) { api.send('stop-preset-party', { jobId: mp.id }); return; }
          const r = await api.invoke('execute-preset', { partyId: p.id, presetId: mp.id, loop: mini.loop });
          const resp = r.response || {};
          if (resp.ok === false) toast(resp.error || 'Erro', 'err');
        } }, running ? '■ Parar' : (mp ? mp.name || 'Combar' : 'Combar')),
        sw('Loop', mini.loop, (v) => { mini.loop = v; }))));
}

for (const [id, ch] of [['btn-min', 'minimize'], ['btn-close', 'close']]) document.getElementById(id).addEventListener('click', () => api.send('window-' + ch));
const soft = () => { const e = document.activeElement; if (!(e && ['INPUT', 'SELECT'].includes(e.tagName))) render(); };
api.on('playing-accounts-changed', (l) => { state.playing = l || []; soft(); });
api.on('roster-changed', (l) => { state.roster = l || []; soft(); });
for (const ev of ['accounts-updated', 'parties-updated']) api.on(ev, async () => { await loadAll(); soft(); });
api.on('settings-updated', (s) => { if (s) state.settings = s; });
api.on('job-started', ({ jobId }) => { state.jobs.add(jobId); soft(); });
api.on('job-ended', ({ jobId }) => { state.jobs.delete(jobId); soft(); });
api.on('job-error', ({ error }) => toast('Erro no preset: ' + error, 'err'));

api.on('sync-click-changed', (st) => { mini.syncClick = !!st.enabled; mini.syncAll = !!st.allParties; soft(); });
(async () => { await loadAll(); await loadOffsets(); render(); })();
