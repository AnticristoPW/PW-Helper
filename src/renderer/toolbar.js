'use strict';
const bar = document.getElementById('bar');
let accounts = [];

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'onclick') el.addEventListener('click', v); else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

async function render(playing) {
  bar.replaceChildren();
  for (const p of playing) {
    const a = accounts.find((x) => x.id === p.id);
    bar.append(h('button', { class: p.crashState ? 'danger' : '', onclick: () => window.pw.send('focus-window', p.pid) }, a?.characterName || p.id));
  }
  if (!playing.length) bar.append(h('span', { class: 'muted' }, 'Nenhum personagem aberto'));
  bar.append(h('span', { style: 'flex:1' }), h('button', { onclick: () => window.pw.send('close-toolbar') }, '✕'));
}

async function refresh() {
  const [acc, pl] = await Promise.all([window.pw.invoke('get-accounts-storage'), window.pw.invoke('get-playing-accounts')]);
  accounts = acc.response || [];
  render(pl.response || []);
}
window.pw.on('playing-accounts-changed', refresh);
window.pw.on('accounts-updated', refresh);
refresh();
