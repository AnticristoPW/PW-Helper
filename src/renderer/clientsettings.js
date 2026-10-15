'use strict';
// Settings cards for the game client window: "Customizações no element" and "Ícones de classe".
const EC = 'SETTINGS.GENERAL.ELEMENT_CUSTOMIZATION.';
const FORCE_SIZES = [['1024x768', 1024, 768], ['1280x720', 1280, 720], ['1366x768', 1366, 768], ['1600x900', 1600, 900], ['1920x1080', 1920, 1080]];
const proMark = () => h('span', { class: 'pro-mark', title: 'PRO' }, 'PRO');

function elementCustomCard() {
  const st = state.settings;
  const ce = (st.customElement ??= { enable: false, changeWindowTitle: false, stackClients: false, rememberWindowBounds: false, defaultWindowSize: { enable: false, width: 1024, height: 768 } });
  ce.defaultWindowSize ??= { enable: false, width: 1024, height: 768 };
  const commit = () => api.invoke('set-settings', st);
  const sub = h('div', { class: 'col' });
  const num = (key) => h('input', { type: 'number', min: 200, max: 7680, value: ce.defaultWindowSize[key], style: 'width:110px', onchange: (e) => { ce.defaultWindowSize[key] = Number(e.target.value) || 0; commit(); } });
  const paint = () => {
    sub.hidden = !ce.enable;
    sub.replaceChildren(
      sw(t(EC + 'CHANGE_WINDOW_NAME'), !!ce.changeWindowTitle, (v) => { ce.changeWindowTitle = v; commit(); }),
      h('span', { class: 'hint' }, t(EC + 'CHANGE_WINDOW_NAME_DESCRIPTION')),
      sw(t(EC + 'STACK_CLIENTS'), !!ce.stackClients, (v) => { ce.stackClients = v; commit(); }),
      h('span', { class: 'hint' }, t(EC + 'STACK_CLIENTS_DESCRIPTION')),
      sw(t(EC + 'REMEMBER_WINDOW_BOUNDS'), !!ce.rememberWindowBounds, (v) => { ce.rememberWindowBounds = v; commit(); }),
      h('span', { class: 'hint' }, t(EC + 'REMEMBER_WINDOW_BOUNDS_DESCRIPTION')),
      sw(t(EC + 'DEFAULT_WINDOW_SIZE.TITLE'), !!ce.defaultWindowSize.enable, (v) => { ce.defaultWindowSize.enable = v; commit(); }),
      h('span', { class: 'hint' }, t(EC + 'DEFAULT_WINDOW_SIZE.DESCRIPTION')),
      h('div', { class: 'inline' }, field(t(EC + 'WIDTH'), num('width')), field(t(EC + 'HEIGHT'), num('height'))),
      forceSizeBlock());
  };
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', {}, t(EC + 'TITLE')), proMark()), h('p', { class: 'muted', style: 'margin:4px 0 8px' }, t(EC + 'DESCRIPTION')),
    sw('Ativar', !!ce.enable, (v) => { ce.enable = v; commit(); paint(); }), (paint(), sub));
}

/** "Forçar tamanho de uma conta aberta": applies a size to a running client right now. */
function forceSizeBlock() {
  const F = EC + 'FORCE_SIZE.';
  const playing = state.playing.map((p) => state.accounts.find((a) => a.id === p.id)).filter(Boolean);
  const acc = select([['', '—'], ...playing.map((a) => [a.id, a.characterName || a.login])], '', () => {});
  const size = select([...FORCE_SIZES.map(([k]) => [k, k]), ['custom', t(F + 'CUSTOM')]], FORCE_SIZES[0][0], () => {});
  const w = h('input', { type: 'number', min: 200, value: 1024, style: 'width:100px' });
  const hh = h('input', { type: 'number', min: 200, value: 768, style: 'width:100px' });
  const custom = h('div', { class: 'inline', hidden: true }, w, h('span', {}, '×'), hh);
  size.addEventListener('change', () => { custom.hidden = size.value !== 'custom'; });
  const apply = h('button', { onclick: async () => {
    const preset = FORCE_SIZES.find(([k]) => k === size.value);
    const width = preset ? preset[1] : Number(w.value), height = preset ? preset[2] : Number(hh.value);
    if (!acc.value || !(width > 0) || !(height > 0)) return toast(t(F + 'INVALID'), 'err');
    const r = await api.invoke('force-window-size', { id: acc.value, width, height });
    toast(r.success ? t(F + 'APPLIED') : r.error || t(F + 'INVALID'), r.success ? 'ok' : 'err');
  } }, t(F + 'APPLY'));
  return h('div', { class: 'col', style: 'margin-top:10px' }, h('h4', {}, t(F + 'TITLE')), h('span', { class: 'hint' }, t(F + 'DESCRIPTION')),
    h('div', { class: 'inline' }, field(t(F + 'SELECT_ACCOUNT'), acc), field(t(F + 'SIZE'), size), apply), custom);
}

async function classIconsCard() {
  const C = 'SETTINGS.GENERAL.CLASS_ICONS.';
  const themes = unwrap(await api.invoke('get-class-icon-themes')) || [];
  let chosen = Number(state.settings.classIconTheme) || 1;
  const preview = h('div', { class: 'icon-strip' });
  const paint = () => {
    const th = themes.find((x) => x.id === chosen);
    preview.replaceChildren(...(th ? th.icons.map((i) => h('img', { src: 'assets/icons/theme' + chosen + '/' + i.file.split(/[\/]/).pop(), alt: i.cls, title: t('CHARACTER_CLASS.' + i.cls) })) : []));
  };
  const sel = select(themes.map((x) => [String(x.id), t(C + 'THEME') + ' ' + x.id]), String(chosen), (v) => { chosen = Number(v); paint(); });
  paint();
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', {}, t(C + 'TITLE')), proMark()), h('p', { class: 'muted', style: 'margin:4px 0 8px' }, t(C + 'DESCRIPTION')),
    h('div', { class: 'inline' }, field(t(C + 'THEME'), sel), h('button', { class: 'primary', onclick: async () => {
      const r = await api.invoke('apply-class-icon-theme', chosen);
      if (r.success) { state.settings.classIconTheme = chosen; toast(t(C + 'APPLIED_SUCCESS'), 'ok'); } else toast(r.error, 'err');
    } }, t(C + 'APPLY'))), preview);
}
