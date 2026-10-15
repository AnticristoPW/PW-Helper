'use strict';
// Preset configuration window (left: command list of the selected preset; right: party settings, preset strip, tabs).
const PW_KEYS = [...Array.from({ length: 12 }, (_, i) => 'F' + (i + 1)), ...'1234567890'.split(''), 'Space', 'Enter', 'Tab', 'Esc'];
let pwClip = [];

function presetWindow(party) {
  const draft = {
    name: party.name,
    presets: JSON.parse(JSON.stringify(party.presets?.presets || [])),
    auto: { mainIntervalMs: 300, secondaryIntervalMs: 600, ...(party.autoCommands || {}) },
  };
  let selId = draft.presets[0]?.id || null;
  let selectMode = false;
  const picked = new Set();
  let mapOn = false;
  const members = () => membersOf(party.id);
  const cur = () => draft.presets.find((p) => p.id === selId);
  const left = h('div', { class: 'pw-left' });
  const right = h('div', { class: 'pw-right' });
  const box = h('div', { class: 'pw-win' }, left, right);
  let close;

  const rerender = () => { renderLeft(); renderRight(); };
  const newSimple = (click) => ({ isPresetCall: false, isGroup: false, simpleCommand: { characterId: members()[0] || '', key: click ? '' : 'F1', delay: 100, clickCoordinates: { x: 0, y: 0 }, ...(click ? { clickButton: 'left' } : {}) } });
  const clone = (c) => JSON.parse(JSON.stringify(c));
  const isClick = (s) => !s.key && !!s.clickButton;

  // ---- left: commands ----
  function simpleRow(s, ops) {
    s.clickCoordinates ??= { x: 0, y: 0 };
    const click = isClick(s);
    const charSel = select([['', 'Personagem'], ...members().map((id) => [id, accName(id)])], s.characterId, (v) => { s.characterId = v; });
    const mid = click
      ? [h('span', { class: 'muted' }, 'Clicar com'), select([['left', 'Esquerdo'], ['right', 'Direito']], s.clickButton, (v) => { s.clickButton = v; }),
        h('input', { type: 'number', value: s.clickCoordinates.x, title: 'X', class: 'pw-num', onchange: (e) => { s.clickCoordinates.x = Number(e.target.value) || 0; } }),
        h('input', { type: 'number', value: s.clickCoordinates.y, title: 'Y', class: 'pw-num', onchange: (e) => { s.clickCoordinates.y = Number(e.target.value) || 0; } }),
        h('button', { class: 'ghost', title: 'Capturar clique', onclick: () => captureClick(s, () => rerender()) }, '⌖')]
      : [h('span', { class: 'muted' }, 'Pressionar tecla:'), select((PW_KEYS.includes(s.key) ? PW_KEYS : [s.key, ...PW_KEYS]).filter(Boolean).map((k) => [k, k]), s.key, (v) => { s.key = v; }),
        h('input', { class: 'pw-num', style: 'display:none' })];
    const row = h('div', { class: 'pw-row' + (picked.has(s) ? ' picked' : '') },
      selectMode ? h('input', { type: 'checkbox', checked: picked.has(s) ? '' : null, onchange: (e) => { e.target.checked ? picked.add(s) : picked.delete(s); } }) : h('span', { class: 'pw-handle', title: 'Arrastar' }, '⋮⋮'),
      h('button', { class: 'ghost', title: 'Focar janela do personagem', onclick: () => { const pe = playingEntry(s.characterId); if (pe) api.send('focus-window', pe.pid); } }, '↗'),
      charSel, ...mid,
      h('input', { type: 'number', min: 0, value: s.delay, class: 'pw-num', title: 'Delay (ms)', onchange: (e) => { s.delay = Number(e.target.value) || 0; } }),
      h('button', { class: 'ghost', title: 'Copiar', onclick: ops.copy }, '⧉'),
      h('button', { class: 'ghost', title: 'Colar abaixo', disabled: pwClip.length ? null : '', onclick: ops.paste }, '📋'),
      h('button', { class: 'ghost danger-txt', title: 'Remover', onclick: ops.del }, '🗑'));
    return row;
  }

  function renderCommands(list, depth = 0) {
    const others = draft.presets.filter((p) => p.id !== selId);
    return list.map((c, i) => {
      let row;
      if (c.isPresetCall) {
        const call = (c.presetCall ??= { targetPresetId: '', delay: 0, waitCompletion: false });
        row = h('div', { class: 'pw-row' }, h('span', { class: 'pw-handle' }, '⋮⋮'), h('span', { class: 'badge' }, 'Preset'),
          select([['', '— preset —'], ...others.map((p) => [p.id, p.name])], call.targetPresetId, (v) => { call.targetPresetId = v; }),
          sw('Aguardar', call.waitCompletion, (v) => { call.waitCompletion = v; }), h('span', { class: 'spacer' }),
          h('input', { type: 'number', min: 0, value: call.delay, class: 'pw-num', title: 'Delay (ms)', onchange: (e) => { call.delay = Number(e.target.value) || 0; } }),
          h('button', { class: 'ghost danger-txt', onclick: () => { list.splice(i, 1); rerender(); } }, '🗑'));
      } else if (c.isGroup) {
        c.commandGroup ??= { commands: [] };
        const inner = c.commandGroup.commands;
        row = h('div', { class: 'pw-group' },
          h('div', { class: 'row' }, h('span', { class: 'pw-handle' }, '⋮⋮'), h('strong', {}, '📁 Grupo'), h('span', { class: 'muted' }, 'executado junto, em sequência'), h('span', { class: 'spacer' }),
            h('button', { onclick: () => { inner.push(newSimple(false).simpleCommand); rerender(); } }, '＋ Comando'),
            h('button', { class: 'ghost danger-txt', onclick: () => { list.splice(i, 1); rerender(); } }, '🗑')),
          ...inner.map((s, j) => simpleRow(s, {
            copy: () => { pwClip = [{ isPresetCall: false, isGroup: false, simpleCommand: clone(s) }]; toast('Copiado', 'ok'); renderLeft(); },
            paste: () => { inner.splice(j + 1, 0, ...pwClip.filter((x) => x.simpleCommand).map((x) => clone(x.simpleCommand))); rerender(); },
            del: () => { inner.splice(j, 1); rerender(); } })));
      } else {
        const s = (c.simpleCommand ??= newSimple(false).simpleCommand);
        row = simpleRow(s, {
          copy: () => { pwClip = [clone(c)]; toast('Copiado', 'ok'); renderLeft(); },
          paste: () => { list.splice(i + 1, 0, ...pwClip.map(clone)); rerender(); },
          del: () => { list.splice(i, 1); rerender(); } });
      }
      attachDnD(row, list, i);
      return row;
    });
  }
  function attachDnD(row, list, i) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(from) || from === i) return;
      const [m] = list.splice(from, 1); list.splice(i, 0, m); rerender();
    });
  }

  function renderLeft() {
    const p = cur();
    const list = h('div', { class: 'pw-list' });
    if (!p) list.append(h('p', { class: 'muted', style: 'padding:16px' }, t('MOBILE.PARTY.NO_PRESETS')));
    else if (p.type === 'auto') list.append(h('p', { class: 'muted', style: 'padding:16px' }, 'Preset automático: pressiona F1–F8 em cada membro aberto, com os intervalos definidos em “Configuração automática”.'));
    else { p.commands ??= []; list.append(...renderCommands(p.commands)); if (!p.commands.length) list.append(h('p', { class: 'muted', style: 'padding:16px' }, 'Nenhum comando. Use os botões abaixo para adicionar.')); }
    const can = p && p.type !== 'auto';
    left.replaceChildren(
      h('div', { class: 'pw-head' }, h('span', {}, 'Ação'), h('span', { class: 'spacer' }), h('span', {}, 'Delay', h('i', {}, '(ms)'))),
      list,
      h('div', { class: 'pw-foot' },
        h('button', { class: 'ok-btn', disabled: can ? null : '', onclick: () => { p.commands.push(newSimple(false)); rerender(); } }, '⊕ Comando'),
        h('button', { class: 'blue-btn', disabled: can ? null : '', onclick: () => { p.commands.push(newSimple(true)); rerender(); } }, h('span', { class: 'pro-mark' }, 'PRO'), '➤ Clique'),
        h('button', { class: 'gold-btn', disabled: can ? null : '', onclick: () => { p.commands.push({ isPresetCall: true, presetCall: { targetPresetId: '', delay: 0, waitCompletion: false } }); rerender(); } }, h('span', { class: 'pro-mark' }, 'PRO'), '▣ Preset'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'cyan-btn', disabled: can ? null : '', onclick: () => { p.commands.push({ isPresetCall: false, isGroup: true, commandGroup: { commands: [newSimple(false).simpleCommand] } }); rerender(); } }, '📁 Grupo')));
  }

  // ---- right: configuration ----
  function clickPoints() {
    const p = cur(); const pts = [];
    const walk = (cmds) => { for (const c of cmds || []) { if (c.isGroup) walk(c.commandGroup?.commands?.map((s) => ({ simpleCommand: s }))); else if (c.simpleCommand && isClick(c.simpleCommand)) pts.push({ id: c.simpleCommand.characterId, x: c.simpleCommand.clickCoordinates.x, y: c.simpleCommand.clickCoordinates.y }); } };
    if (p?.type !== 'auto') walk(p?.commands);
    return pts;
  }
  async function syncMap() {
    const pts = clickPoints();
    const id = pts[0]?.id; const pe = id && playingEntry(id);
    if (!mapOn || !pe) { await api.invoke('close-party-click-map-overlay'); return; }
    await api.invoke('update-party-click-map-overlay', pe.pid, pts.filter((x) => x.id === id));
  }

  function renderRight() {
    const p = cur();
    const strip = h('div', { class: 'pw-strip' },
      h('div', { class: 'pw-chips' }, ...draft.presets.map((x) => h('button', { class: 'cyan-btn' + (x.id === selId ? '' : ' dim'), onclick: () => { selId = x.id; picked.clear(); rerender(); } }, x.name || 'Preset'))),
      h('button', { class: 'ok-btn sq', title: 'Novo preset', onclick: () => { const n = { id: uid(), name: 'Preset ' + (draft.presets.length + 1), type: 'custom', loop: false, commands: [] }; draft.presets.push(n); selId = n.id; rerender(); } }, '⊕'));
    const sections = [
      h('h2', { class: 'pw-title' }, 'Configurações'),
      h('input', { class: 'pw-name', value: draft.name, oninput: (e) => { draft.name = e.target.value; } }),
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('button', { class: 'cyan-btn' + (selectMode ? '' : ''), onclick: () => { selectMode = !selectMode; picked.clear(); renderLeft(); renderRight(); } }, '☑ Selecionar'),
        h('button', { class: 'blue-btn', title: 'Copia os comandos selecionados (ou todos)', onclick: () => {
          const pr = cur(); if (!pr || pr.type === 'auto') return;
          const src = selectMode && picked.size ? pr.commands.filter((c) => (c.simpleCommand && picked.has(c.simpleCommand))) : pr.commands;
          pwClip = src.map(clone); toast(`${pwClip.length} comando(s) copiado(s)`, 'ok'); renderLeft();
        } }, '⧉ Copiar')),
      strip];
    if (p) {
      sections.push(h('div', { class: 'pw-pname' },
        h('input', { value: p.name, oninput: (e) => { p.name = e.target.value; renderChipsOnly(); } }),
        h('button', { class: 'red-btn', title: 'Excluir preset', onclick: async () => { if (!(await confirmModal({ title: 'Excluir preset', text: p.name, confirm: t('COMMON.DELETE') || 'Excluir' }))) return; draft.presets = draft.presets.filter((x) => x.id !== p.id); selId = draft.presets[0]?.id || null; rerender(); } }, '🗑'),
        h('div', { class: 'pw-short' }, '⌨ ', shortcutInput(p.shortcut, (v) => { p.shortcut = v || undefined; }, { modifiers: true }))));
      const tab = p.type === 'auto' ? 'auto' : 'custom';
      sections.push(h('div', { class: 'pw-tabs' },
        h('button', { class: tab === 'custom' ? 'on' : '', onclick: () => { p.type = 'custom'; rerender(); } }, 'Configuração customizada'),
        h('button', { class: tab === 'auto' ? 'on' : '', onclick: () => { p.type = 'auto'; rerender(); } }, 'Configuração automática')));
      const pts = clickPoints();
      sections.push(tab === 'custom'
        ? h('div', { class: 'pw-panel' },
          !members().length && h('div', { class: 'pw-warn' }, '⚠ Nenhum personagem atribuído ao grupo.'),
          h('p', { class: 'muted', style: 'font-style:italic' }, 'Configuração customizada permite que indique qual tecla apertar e o intervalo entre elas em cada personagem.'),
          sw('Loop', !!p.loop, (v) => { p.loop = v; }),
          h('div', { class: 'pw-map' }, h('span', {}, 'Mapa de clicks'), sw('', mapOn, (v) => { mapOn = v; syncMap(); })),
          h('p', { class: 'muted', style: 'font-style:italic' }, pts.length ? `${pts.length} clique(s) configurado(s) neste preset.` : 'Nenhum click válido configurado neste preset.'))
        : h('div', { class: 'pw-panel' },
          h('p', { class: 'muted', style: 'font-style:italic' }, 'Pressiona F1–F8 em cada membro aberto. F1–F4 usam o intervalo principal, F5–F8 o secundário.'),
          field('Intervalo principal (ms)', h('input', { type: 'number', min: 0, value: draft.auto.mainIntervalMs, onchange: (e) => { draft.auto.mainIntervalMs = Number(e.target.value) || 0; } })),
          field('Intervalo secundário (ms)', h('input', { type: 'number', min: 0, value: draft.auto.secondaryIntervalMs, onchange: (e) => { draft.auto.secondaryIntervalMs = Number(e.target.value) || 0; } })),
          sw('Loop', !!p.loop, (v) => { p.loop = v; })));
    }
    right.replaceChildren(...sections,
      h('button', { class: 'pw-assist', onclick: () => assistantWizard(party, () => { draft.presets = JSON.parse(JSON.stringify(party.presets.presets)); selId = draft.presets[0]?.id || null; rerender(); }) }, '✦ PW ', h('b', {}, 'ASSISTENTE')),
      h('div', { class: 'pw-actions' },
        h('button', { class: 'ok-btn big', onclick: apply }, 'Aplicar'),
        h('button', { class: 'gray-btn big', onclick: () => close() }, 'Fechar')));
  }
  function renderChipsOnly() { const chips = right.querySelector('.pw-chips'); if (chips) [...chips.children].forEach((b, i) => { b.textContent = draft.presets[i]?.name || 'Preset'; }); }

  async function apply() {
    party.name = draft.name.trim() || party.name;
    party.presets = { ...(party.presets || {}), presets: JSON.parse(JSON.stringify(draft.presets)) };
    party.autoCommands = { ...draft.auto };
    await saveParties(); render();
    toast(t('COMMON.SAVED') || 'Salvo', 'ok');
  }

  rerender();
  close = openModal({ title: '', body: box, wide: true, onClose: () => { api.invoke('close-party-click-map-overlay'); } });
  document.querySelector('.overlay:last-child .modal')?.classList.add('pw-modal');
}
