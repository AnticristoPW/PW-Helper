'use strict';
// Party mode: parties, roster and presets (manual command lists, auto F1–F8, nested preset calls).
const partyUi = { partyId: null };

const membersOf = (partyId) => state.roster.find((r) => r.partyId === partyId)?.accountIds ?? [];
const accName = (id) => state.accounts.find((a) => a.id === id)?.characterName || id;

/** Presets editor (manual / automatic presets of one party), used inside the "Presets" modal. */
function presetsEditor(party) {
  party.presets ??= { presets: [] };
  party.autoCommands ??= { mainIntervalMs: 300, secondaryIntervalMs: 600 };
  const members = membersOf(party.id);
  const box = h('div', {});
  box.append(h('div', { class: 'row', style: 'margin-bottom:8px' }, h('h3', {}, 'Presets'),
    h('button', { class: 'primary', onclick: () => assistantWizard(party) }, '✨ ' + t('PARTY_MODE.TEMPLATES.OPEN_BUTTON')),
    h('button', { onclick: async () => { party.presets.presets.push({ id: uid(), name: 'Preset ' + (party.presets.presets.length + 1), type: 'custom', loop: false, commands: [] }); await saveParties(); render(); } }, '＋ Manual'),
    h('button', { onclick: async () => { party.presets.presets.push({ id: uid(), name: 'Auto F1–F8', type: 'auto', loop: true, commands: [] }); await saveParties(); render(); } }, '＋ Automático')));
  if (!party.presets.presets.length) box.append(h('p', { class: 'muted' }, t('MOBILE.PARTY.NO_PRESETS')));
  for (const preset of party.presets.presets) box.append(presetCard(party, preset, members));
  return box;
}

function presetCard(party, preset, members) {
  const running = state.jobs.has(preset.id);
  const commit = () => saveParties();
  const card = h('div', { class: 'card' });
  card.append(h('div', { class: 'row' },
    h('input', { value: preset.name, style: 'width:220px', oninput: (e) => { preset.name = e.target.value; }, onchange: commit }),
    h('span', { class: 'badge' }, preset.type === 'auto' ? 'automático' : 'manual'),
    running && h('span', { class: 'badge on' }, 'rodando'),
    sw(t('MOBILE.PARTY.LOOP'), preset.loop, (v) => { preset.loop = v; commit(); }),
    h('span', { class: 'muted' }, 'Atalho'), shortcutInput(preset.shortcut, (v) => { preset.shortcut = v || undefined; commit(); }, { modifiers: true }),
    h('span', { class: 'spacer' }),
    running ? h('button', { class: 'danger', onclick: () => api.send('stop-preset-party', { jobId: preset.id }) }, t('COMMON.STOP'))
      : h('button', { class: 'primary', onclick: async () => {
        const r = await api.invoke('execute-preset', { partyId: party.id, presetId: preset.id });
        if (!r.success) toast(r.response?.error === 'no-command-available' ? t('MOBILE.PARTY.ERROR_NO_COMMAND') : 'Não foi possível executar: ' + (r.response?.error || r.error), 'err');
      } }, '▶ ' + t('COMMON.PLAY')),
    h('button', { class: 'ghost', onclick: async () => { party.presets.presets = party.presets.presets.filter((p) => p.id !== preset.id); await commit(); render(); } }, '🗑')));
  if (preset.type === 'auto') { card.append(h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'Pressiona F1–F8 em cada membro aberto, com os intervalos do grupo.')); return card; }

  preset.commands ??= [];
  const others = party.presets.presets.filter((p) => p.id !== preset.id);
  const mkSimple = () => ({ isPresetCall: false, isGroup: false, simpleCommand: { characterId: members[0] ?? '', key: '', delay: 50, clickCoordinates: { x: 0, y: 0 } } });
  preset.commands.forEach((c, i) => {
    const del = h('button', { class: 'ghost', onclick: async () => { preset.commands.splice(i, 1); await commit(); render(); } }, '✕');
    if (c.isPresetCall) {
      const call = (c.presetCall ??= { targetPresetId: '', delay: 0, waitCompletion: false });
      card.append(h('div', { class: 'cmd' },
        select([['', '— preset —'], ...others.map((p) => [p.id, p.name])], call.targetPresetId, (v) => { call.targetPresetId = v; commit(); }),
        h('span', { class: 'muted' }, 'chama preset'),
        h('input', { type: 'number', min: 0, value: call.delay, title: 'Delay (ms)', onchange: (e) => { call.delay = Number(e.target.value) || 0; commit(); } }),
        sw('aguardar', call.waitCompletion, (v) => { call.waitCompletion = v; commit(); }), h('span'), del));
      return;
    }
    const s = (c.simpleCommand ??= mkSimple().simpleCommand);
    s.clickCoordinates ??= { x: 0, y: 0 };
    card.append(h('div', { class: 'cmd' },
      select([['', '— personagem —'], ...members.map((id) => [id, accName(id)])], s.characterId, (v) => { s.characterId = v; commit(); }),
      h('input', { value: s.key, placeholder: 'Tecla (F1, 1, ctrl+a…)', onchange: (e) => { s.key = e.target.value; commit(); } }),
      h('input', { type: 'number', min: 0, value: s.delay, title: 'Delay (ms)', onchange: (e) => { s.delay = Number(e.target.value) || 0; commit(); } }),
      h('input', { type: 'number', value: s.clickCoordinates.x, title: 'Clique X', onchange: (e) => { s.clickCoordinates.x = Number(e.target.value) || 0; commit(); } }),
      h('input', { type: 'number', value: s.clickCoordinates.y, title: 'Clique Y', onchange: (e) => { s.clickCoordinates.y = Number(e.target.value) || 0; commit(); } }),
      h('button', { class: 'ghost', title: 'Capturar clique na janela do personagem', onclick: () => captureClick(s, commit) }, '⌖'), del));
  });
  card.append(h('div', { class: 'row', style: 'margin-top:6px' },
    h('button', { onclick: async () => { preset.commands.push(mkSimple()); await commit(); render(); } }, '＋ ' + t('PARTY_MODE.TEMPLATES.ADD_ACTION')),
    others.length ? h('button', { onclick: async () => { preset.commands.push({ isPresetCall: true, presetCall: { targetPresetId: others[0].id, delay: 0, waitCompletion: false } }); await commit(); render(); } }, '＋ Chamar preset') : null));
  return card;
}

/** Focuses the character's window and records the next click as the command's click coordinates. */
async function captureClick(simple, commit) {
  const pe = playingEntry(simple.characterId);
  if (!pe) { toast(t('PARTY_MODE.TEMPLATES.CLICK_FOCUS_NOT_PLAYING', { name: accName(simple.characterId) }).replace(/<br>/g, ' '), 'err'); return; }
  toast(t('PARTY_MODE.TEMPLATES.CLICK_CAPTURE_HINT', { name: accName(simple.characterId) }).replace(/<br>/g, ' '), 'ok');
  const r = await api.invoke('listen-click', pe.pid, false);
  if (!r.success) { toast(r.error || 'Falha ao capturar', 'err'); return; }
  simple.clickCoordinates = { x: r.response.client.x, y: r.response.client.y };
  simple.clickButton = r.response.button;
  await commit(); render();
}
