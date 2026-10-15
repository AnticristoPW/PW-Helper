'use strict';
// Shared UI helpers. Everything is built with DOM nodes / textContent — never innerHTML.
const api = window.pw;

/** t('ACCOUNT_LIST.FILTER.SORT.ASC', {count: 2}) — looks up the original's pt-BR strings. */
function t(key, params) {
  let v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), window.I18N);
  if (typeof v !== 'string') return key;
  if (params) v = v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (params[k] ?? ''));
  return v.replace(/<br\s*\/?>/g, '\n');
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v; // CSSOM is allowed under the CSP; a style="" attribute is not
    else if (k === 'value') el.value = v ?? '';
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'selected') el.selected = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat(2)) if (k != null && k !== false) el.append(k);
  return el;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const unwrap = (r) => (r && r.success ? r.response : null);

let toastTimer;
function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' okk' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function field(label, input, hint) {
  return h('div', { class: 'field' }, label && h('label', {}, label), input, hint && h('span', { class: 'hint' }, hint));
}
function sw(label, checked, onchange) {
  return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span', {}, label));
}
function select(options, value, onchange) {
  return h('select', { onchange: (e) => onchange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

// ---- modal -----------------------------------------------------------------------------------------------------
const modalStack = [];
function openModal({ title, body, buttons = [], wide = false, onClose }) {
  const overlay = document.getElementById('overlay');
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog' },
    h('div', { class: 'modal-h' }, h('h3', {}, title), h('button', { class: 'ghost icon-btn', onclick: () => close() }, '✕')),
    h('div', { class: 'modal-b' }, body),
    buttons.length ? h('div', { class: 'modal-f' }, buttons.map((b) => h('button', {
      class: b.kind || '',
      onclick: async () => { if ((await b.onclick?.()) !== false) close(); },
    }, b.label))) : null);
  const layer = h('div', { class: 'overlay' }, box);
  layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
  function close() { layer.remove(); modalStack.splice(modalStack.indexOf(close), 1); onClose?.(); }
  modalStack.push(close);
  document.body.append(layer);
  const first = box.querySelector('input,select,textarea');
  first?.focus();
  return close;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!closePopover()) modalStack.at(-1)?.(); } });

function confirmModal({ title, text, help, confirm, kind = 'danger' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title, onClose: () => finish(false),
      body: [h('p', { style: 'margin:0' }, text), help && h('p', { class: 'muted', style: 'margin:0' }, help)],
      buttons: [{ label: t('COMMON.CANCEL'), onclick: () => finish(false) }, { label: confirm, kind, onclick: () => finish(true) }],
    });
  });
}

/** Electron has no window.prompt(), so single-line input goes through a modal. Resolves to trimmed text or null. */
function promptModal(title, label, initial = '') {
  return new Promise((resolve) => {
    let value = initial, done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const input = h('input', { value: initial, oninput: (e) => { value = e.target.value; } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.querySelector('.modal-f .primary')?.click(); });
    openModal({
      title, onClose: () => finish(null), body: field(label, input),
      buttons: [{ label: t('COMMON.CANCEL') }, { label: t('COMMON.SAVE'), kind: 'primary', onclick: () => { finish(value.trim() || null); } }],
    });
  });
}

// ---- popover ---------------------------------------------------------------------------------------------------
let pop = null;
function closePopover() { if (!pop) return false; pop.remove(); pop = null; return true; }
function openPopover(anchor, content, { align = 'left' } = {}) {
  closePopover();
  pop = h('div', { class: 'pop' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = align === 'right' ? r.right - w : r.left;
  pop.style.left = Math.max(6, Math.min(left, innerWidth - w - 6)) + 'px';
  pop.style.top = Math.min(r.bottom + 4, innerHeight - pop.offsetHeight - 6) + 'px';
  return pop;
}
document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target)) closePopover(); }, true);
function menu(anchor, items) {
  openPopover(anchor, items.map((i) => (i === '-' ? h('hr') : h('button', { class: i.danger ? 'dng' : '', onclick: () => { closePopover(); i.onclick(); } }, i.label))), { align: 'right' });
}

// ---- formatting ------------------------------------------------------------------------------------------------
function fmtDuration(ms) {
  if (!ms) return t('ERRORS.NO_PLAY_TIME');
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}min` : `${m}min`;
}
function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : t('ERRORS.NO_SESSION');
}

// ---- keyboard shortcut capture ---------------------------------------------------------------------------------
/** Windows virtual-key code for a DOM keydown (left/right variants for modifier keys, like the key hook reports). */
function vkFromEvent(e) {
  const right = e.location === 2;
  if (e.key === 'Shift') return right ? 161 : 160;
  if (e.key === 'Control') return right ? 163 : 162;
  if (e.key === 'Alt') return right ? 165 : 164;
  return e.keyCode;
}
const VK_NAMES = { 160: 'Shift', 161: 'Shift (dir.)', 162: 'Ctrl', 163: 'Ctrl (dir.)', 164: 'Alt', 165: 'Alt (dir.)', 192: "'", 38: '↑', 40: '↓', 37: '←', 39: '→', 32: 'Space', 13: 'Enter', 9: 'Tab', 27: 'Esc' };
function vkName(code, fallback) {
  if (VK_NAMES[code]) return VK_NAMES[code];
  if (code >= 96 && code <= 105) return 'Num' + (code - 96);
  if (code >= 112 && code <= 135) return 'F' + (code - 111);
  if (/^[A-Za-z0-9]$/.test(fallback || '')) return fallback.toUpperCase();
  return fallback || String(code);
}

/**
 * Click-to-record shortcut field. `value` is {key, code} (party shortcuts) or, with `modifiers`, {id, shift, ctrl, alt, name} (presets).
 * Delete/Backspace clears; Esc cancels.
 */
function shortcutInput(value, onChange, { modifiers = false, placeholder = '—' } = {}) {
  const label = () => {
    if (!value) return '';
    if (modifiers) return [value.ctrl && 'Ctrl', value.alt && 'Alt', value.shift && 'Shift', value.name || vkName(value.id)].filter(Boolean).join(' + ');
    return value.key ? vkName(value.code, value.key) : '';
  };
  const el = h('input', { class: 'shortcut', readonly: true, placeholder, value: label(), title: 'Clique e pressione a tecla (Delete limpa)' });
  el.addEventListener('keydown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { el.blur(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { value = null; el.value = ''; onChange(null); return; }
    const code = vkFromEvent(e);
    const isMod = [160, 161, 162, 163, 164, 165].includes(code);
    if (modifiers) {
      if (isMod) return;
      value = { id: code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, name: vkName(code, e.key) };
    } else value = { key: e.key, code };
    el.value = label();
    onChange(value);
  });
  return el;
}
