'use strict';
// Party "Assistant" wizard (templates): 1) roles + functions, 2) HUD alignment, 3) keys/clicks -> generated presets.
const TT = (k, p) => t('PARTY_MODE.TEMPLATES.' + k, p);
const FF = (k) => TT('FN_FIELDS.' + k);
const MAX_PRESETS = 20;

// who: all | leader | nonLeader | support | nonSupport | pickers (nonLeader & nonSupport) | perCompanion (leader, one click pair per companion)
const FUNCTIONS = {
  BUFF: { tip: 'BUFF', fields: [{ id: 'macro', label: 'BUFF', raw: true, type: 'key', who: 'all' }] },
  FLY: { tip: 'FLY', fields: [{ id: 'macro', label: 'FLY', raw: true, type: 'key', who: 'all' }] },
  MOUNT: { tip: 'MOUNT', fields: [{ id: 'macro', label: 'MOUNT', raw: true, type: 'key', who: 'all' }] },
  GROUP_ATTACK: { fields: [{ id: 'atk', label: 'ATTACK_MACRO', type: 'key', who: 'all' }] },
  FOLLOW: { tutorial: 'FOLLOW', fields: [{ id: 'open', label: 'OPEN_LEADER_OPTIONS', type: 'click', button: 'right', who: 'nonLeader' }, { id: 'follow', label: 'CLICK_FOLLOW', type: 'click', button: 'left', who: 'nonLeader' }] },
  BOSS: { tutorial: 'BOSS', fields: [
    { id: 'pick', label: 'PICK_TARGET', type: 'key', who: 'pickers' }, { id: 'supPick', label: 'SUPPORT_PICK_TG', type: 'key', who: 'support' },
    { id: 'atk', label: 'ATTACK_MACRO', type: 'key', who: 'nonSupport' }, { id: 'heal', label: 'HEAL_MACRO', type: 'key', who: 'support' }] },
  ACCEPT_PT: { tutorial: 'ACCEPT_PT', fields: [{ id: 'notif', label: 'CLICK_NOTIFICATIONS', type: 'click', button: 'left', who: 'nonLeader' }, { id: 'yes', label: 'CLICK_YES', type: 'click', button: 'left', who: 'nonLeader' }] },
  MONTAR_PT: { tutorial: 'MONTAR_PT', fields: [{ id: 'open', label: 'OPEN_MEMBER_OPTIONS', type: 'click', button: 'right', who: 'perCompanion' }, { id: 'invite', label: 'CLICK_INVITE', type: 'click', button: 'left', who: 'perCompanion' }] },
};
const FN_ORDER = Object.keys(FUNCTIONS);

function assistantWizard(party, onSaved) {
  const members = membersOf(party.id);
  const W = { step: 1, leader: members[0] || '', support: '', tank: '', fns: new Set(), merge: true, replace: false, aligned: new Set(), grid: new Set(), cfg: {}, delay: {}, gridPid: 0 };
  const box = h('div', { class: 'wizard' });
  let close;

  const roleOf = (id) => (id === W.leader ? 'leader' : id === W.support ? 'support' : id === W.tank ? 'tank' : 'damage');
  const whoIds = (who) => {
    const others = members.filter((id) => id !== W.leader);
    switch (who) {
      case 'all': return members;
      case 'leader': case 'perCompanion': return [W.leader];
      case 'nonLeader': return others;
      case 'support': return W.support ? [W.support] : [];
      case 'nonSupport': return members.filter((id) => id !== W.support);
      case 'pickers': return others.filter((id) => id !== W.support);
      default: return [];
    }
  };
  const activeFns = () => FN_ORDER.filter((f) => W.fns.has(f));
  const fieldCount = (field) => (field.who === 'perCompanion' ? Math.max(1, members.length - 1) : 1);
  const slot = (fn, field) => ((W.cfg[fn] ??= {})[field.id] ??= { key: '', clicks: [] });
  const labelOf = (field) => (field.raw ? TT('FN.' + field.label) : FF(field.label));
  const captureTarget = (fn, field) => whoIds(field.who).find((id) => id !== W.leader) || (field.who === 'leader' || field.who === 'perCompanion' ? W.leader : '');

  // ---- validation / generation ----
  const step1Error = () => {
    if (!W.leader) return TT('STEP1_REQUIRES_LEADER');
    if (!W.fns.size) return TT('STEP1_REQUIRES_FUNCTION');
    if (W.fns.has('BOSS') && !W.support) return TT('STEP1_REQUIRES_BOSS_SUPPORT');
    if (W.fns.has('BOSS') && !W.tank) return TT('STEP1_REQUIRES_BOSS_TANK');
    const required = presetPlans().length, available = MAX_PRESETS - (W.replace ? 0 : (party.presets?.presets || []).length);
    if (required > available) return TT('STEP1_EXCEEDS_PRESET_LIMIT', { required, available });
    return '';
  };
  const fieldDone = (fn, field) => {
    const c = slot(fn, field);
    return field.type === 'key' ? !!c.key.trim() : c.clicks.length >= fieldCount(field);
  };
  const fnDone = (fn) => FUNCTIONS[fn].fields.every((f) => whoIds(f.who).length === 0 || fieldDone(fn, f));
  const allDone = () => activeFns().every(fnDone);

  const cmd = (characterId, fn, field, index) => {
    const c = slot(fn, field);
    const base = { isPresetCall: false, isGroup: false };
    const delay = W.delay[fn] ?? 150;
    if (field.type === 'key') return { ...base, simpleCommand: { characterId, key: c.key.trim(), delay, clickCoordinates: { x: 0, y: 0 } } };
    const pt = c.clicks[Math.min(index, c.clicks.length - 1)] || { x: 0, y: 0 };
    return { ...base, simpleCommand: { characterId, key: '', delay, clickCoordinates: { x: pt.x, y: pt.y }, clickButton: field.button } };
  };
  /** Commands of one function. Click functions interleave per member (open options, then click). */
  const commandsFor = (fn) => {
    const fields = FUNCTIONS[fn].fields;
    const out = [];
    if (fn === 'MONTAR_PT') {
      for (let i = 0; i < fieldCount(fields[0]); i++) for (const f of fields) out.push(cmd(W.leader, fn, f, i));
    } else if (fields.every((f) => f.type === 'click')) {
      for (const id of whoIds(fields[0].who)) for (const f of fields) out.push(cmd(id, fn, f, 0));
    } else {
      for (const f of fields) for (const id of whoIds(f.who)) out.push(cmd(id, fn, f, 0));
    }
    return out;
  };
  const presetPlans = () => {
    const fns = activeFns();
    const plans = [];
    const merged = W.merge && W.fns.has('MONTAR_PT') && W.fns.has('ACCEPT_PT');
    for (const fn of fns) {
      if (merged && fn === 'ACCEPT_PT') continue;
      plans.push(merged && fn === 'MONTAR_PT' ? { name: TT('FN.PT_FLOW_COMBINED'), fns: ['MONTAR_PT', 'ACCEPT_PT'] } : { name: TT('FN.' + fn), fns: [fn] });
    }
    return plans;
  };

  const save = async () => {
    if (!allDone()) return toast(TT('INVALID_TOAST'), 'err');
    party.presets ??= { presets: [] };
    if (W.replace) party.presets.presets = [];
    for (const plan of presetPlans()) party.presets.presets.push({ id: uid(), name: plan.name, type: 'custom', loop: false, commands: plan.fns.flatMap(commandsFor) });
    await saveParties();
    closeGridAll();
    toast(TT('SAVE_SUCCESS'), 'ok');
    close?.();
    render();
    if (typeof refreshModal === 'function') refreshModal();
    onSaved?.();
  };

  // ---- click capture ----
  let recording = null;
  const record = async (fn, field) => {
    if (recording) return toast(TT('CLICK_RECORDING_BUSY'), 'err');
    const target = captureTarget(fn, field);
    if (!target) return toast(TT('CLICK_NO_FOCUS'), 'err');
    const pe = playingEntry(target);
    if (!pe) return toast(TT('CLICK_FOCUS_NOT_PLAYING', { name: accName(target) }).replace(/<br>/g, ' '), 'err');
    const need = fieldCount(field), c = slot(fn, field);
    c.clicks = [];
    recording = { fn, id: field.id };
    toast(TT('CLICK_RECORDING_STARTED', { name: accName(target), required: need }).replace(/<br>/g, ' '), 'ok');
    renderBody();
    while (recording && c.clicks.length < need) {
      let r;
      try { r = await api.invoke('listen-click', pe.pid, false); } catch { break; }
      if (!recording) break;
      if (!r.success) { toast(r.error || 'Falha', 'err'); break; }
      if (r.response.button !== field.button) { toast(TT('CLICK_WRONG_BUTTON', { expected: TT(field.button === 'left' ? 'CLICK_LEFT' : 'CLICK_RIGHT') }), 'err'); continue; }
      c.clicks.push({ x: r.response.client.x, y: r.response.client.y });
      toast(TT('CLICK_CAPTURED_SEQ', { captured: c.clicks.length, required: need, x: r.response.client.x, y: r.response.client.y }), 'ok');
      renderBody();
    }
    if (recording) toast(c.clicks.length >= need ? TT('CLICK_RECORDING_DONE') : TT('CLICK_RECORDING_STOPPED'), 'ok');
    recording = null;
    renderBody();
  };

  const closeGridAll = () => { api.invoke('close-party-hud-grid-overlay'); W.grid.clear(); };

  // ---- UI ----
  const nav = (backFn, nextFn, nextLabel, disabled) => h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' },
    backFn && h('button', { onclick: backFn }, TT('BACK')),
    h('button', { class: 'primary', disabled: disabled || null, onclick: nextFn }, nextLabel));

  const step1 = () => {
    const roleSel = (key, label, optional) => h('div', { class: 'row' }, h('strong', { style: 'width:80px' }, label),
      select([['', TT('ROLES.PICK_PLACEHOLDER')], ...members.map((id) => [id, accName(id)])], W[key], (v) => { W[key] = v; for (const k of ['leader', 'support', 'tank']) if (k !== key && W[k] === v && v) W[k] = ''; renderBody(); }));
    const err = step1Error();
    return h('div', {},
      h('h4', {}, TT('STEP1_TITLE')),
      !members.length && h('p', { class: 'muted' }, TT('NO_MEMBERS_TOOLTIP')),
      roleSel('leader', TT('ROLES.LEADER')), roleSel('support', TT('ROLES.SUPPORT')), roleSel('tank', TT('ROLES.TANK')),
      h('p', { class: 'muted', style: 'margin:4px 0' }, `${TT('ROLES.DAMAGE')}: ${members.filter((id) => roleOf(id) === 'damage').map(accName).join(', ') || '—'}`),
      h('h4', { style: 'margin-top:12px' }, TT('FUNCTIONS_TITLE')),
      h('div', { class: 'chips' }, ...FN_ORDER.map((fn) => h('label', { class: 'chip' + (W.fns.has(fn) ? ' active' : ''), style: 'cursor:pointer' },
        h('input', { type: 'checkbox', checked: W.fns.has(fn) ? '' : null, hidden: '', onchange: (e) => { e.target.checked ? W.fns.add(fn) : W.fns.delete(fn); renderBody(); } }), TT('FN.' + fn)))),
      W.fns.has('MONTAR_PT') && W.fns.has('ACCEPT_PT') && h('div', { style: 'margin-top:8px' }, sw(TT('PT_FLOW_MERGE'), W.merge, (v) => { W.merge = v; renderBody(); }), h('p', { class: 'muted', style: 'margin:2px 0' }, TT('PT_FLOW_MERGE_DESC'))),
      h('div', { style: 'margin-top:8px' }, sw(TT('REPLACE_ALL_LABEL'), W.replace, (v) => { W.replace = v; renderBody(); }), h('p', { class: 'muted', style: 'margin:2px 0' }, TT(W.replace ? 'REPLACE_ALL_TIP_ON' : 'REPLACE_ALL_TIP_OFF'))),
      err && h('p', { style: 'color:var(--danger,#ff6b6b);margin:8px 0 0' }, err),
      nav(null, () => { W.step = 2; renderBody(); }, TT('NEXT'), !!err));
  };

  const step2 = () => {
    const rows = members.map((id) => {
      const pe = playingEntry(id);
      return h('div', { class: 'row', style: 'margin-top:6px' },
        h('strong', { style: 'width:160px' }, accName(id)), h('span', { class: 'muted', style: 'width:70px' }, TT('ROLES.' + roleOf(id).toUpperCase())),
        !pe && h('span', { class: 'badge' }, TT('STEP2_OFFLINE')), h('span', { class: 'spacer' }),
        h('button', { class: 'ghost', disabled: !pe || null, title: TT('STEP2_FOCUS_TOOLTIP'), onclick: () => api.send('focus-window', pe.pid) }, '⌖'),
        h('button', { class: 'ghost' + (W.grid.has(id) ? ' active' : ''), disabled: !pe || null, title: TT(W.grid.has(id) ? 'STEP2_GRID_HIDE' : 'STEP2_GRID_TOGGLE'), onclick: async () => {
          if (W.grid.has(id)) { await api.invoke('close-party-hud-grid-overlay', pe.pid); W.grid.delete(id); } else { await api.invoke('open-party-hud-grid-overlay', pe.pid); W.grid.add(id); }
          renderBody();
        } }, '▦'),
        sw(TT(W.aligned.has(id) ? 'STEP2_UNMARK_TOOLTIP' : 'STEP2_MARK_TOOLTIP'), W.aligned.has(id), (v) => { v ? W.aligned.add(id) : W.aligned.delete(id); renderBody(); }));
    });
    const adj = members.filter((id) => W.aligned.has(id)).length;
    return h('div', {},
      h('h4', {}, TT('STEP2_TITLE')),
      h('p', { class: 'muted' }, TT('STEP2_INSTRUCTIONS')), h('p', { class: 'muted' }, h('strong', {}, TT('STEP2_TIP_LABEL') + ' '), TT('STEP2_TIP_MESSAGE')),
      ...rows,
      h('p', { class: adj < members.length ? '' : 'muted', style: 'margin:10px 0 0' }, `${TT('STEP2_PROGRESS_LABEL')}: ${adj}/${members.length}` + (adj < members.length ? ' — ' + TT('STEP2_PENDING_WARN', { adjusted: adj, total: members.length }) : '')),
      nav(() => { closeGridAll(); W.step = 1; renderBody(); }, () => { closeGridAll(); W.step = 3; renderBody(); }, TT('NEXT')));
  };

  const tutorialBtn = (fn) => {
    const key = FUNCTIONS[fn].tutorial || FUNCTIONS[fn].tip;
    if (!key) return null;
    const base = FUNCTIONS[fn].tutorial ? 'TUTORIAL.' : 'TIP.';
    return h('button', { class: 'ghost', title: TT(FUNCTIONS[fn].tutorial ? 'HELP_LABEL' : 'TIP_LABEL'), onclick: () => {
      const steps = ['STEP_1', 'STEP_2', 'STEP_3', 'STEP_4'].map((s) => { const v = t('PARTY_MODE.TEMPLATES.' + base + key + '.' + s); return v && !v.endsWith(s) ? v : null; }).filter(Boolean);
      const bodyTxt = t('PARTY_MODE.TEMPLATES.' + base + key + '.BODY');
      openModal({ title: TT(base + key + '.TITLE'), body: h('div', {}, bodyTxt && !bodyTxt.endsWith('.BODY') ? h('p', {}, bodyTxt) : null, steps.length ? h('ol', {}, ...steps.map((s) => h('li', {}, s))) : null), buttons: [{ label: 'OK' }] });
    } }, '?');
  };

  const step3 = () => {
    const fns = activeFns();
    const blocks = fns.map((fn) => {
      const rows = FUNCTIONS[fn].fields.map((field) => {
        const targets = whoIds(field.who);
        const c = slot(fn, field);
        const names = targets.map(accName).join(', ') || '—';
        const input = field.type === 'key'
          ? h('input', { value: c.key, placeholder: 'F1…F12, 1–9, ctrl+a', style: 'width:150px', oninput: (e) => { c.key = e.target.value; }, onchange: () => renderBody() })
          : h('button', { class: recording?.fn === fn && recording.id === field.id ? 'danger' : '', onclick: () => (recording?.fn === fn && recording.id === field.id ? (recording = null, api.invoke('listen-click-cancel').catch(() => {}), renderBody()) : record(fn, field)) },
            recording?.fn === fn && recording.id === field.id ? TT('CLICK_RECORDING_STOP') : TT('CLICK_RECORDING_START'));
        return h('div', { class: 'row', style: 'margin-top:6px;align-items:center' },
          h('span', { title: TT('INTERACTION_' + (field.type === 'key' ? 'KEY' : 'CLICK') + '_TOOLTIP'), class: 'badge' }, field.type === 'key' ? TT('INTERACTION_KEY') : TT('INTERACTION_CLICK')),
          h('strong', { style: 'width:190px' }, labelOf(field)), input,
          field.type === 'click' && h('span', { class: 'muted' }, `${c.clicks.length}/${fieldCount(field)} · ${TT(field.button === 'left' ? 'CLICK_LEFT' : 'CLICK_RIGHT')}`),
          field.type === 'click' && c.clicks.length > 0 && h('button', { class: 'ghost', title: TT('CLICK_CLEAR'), onclick: () => { c.clicks = []; renderBody(); } }, '✕'),
          h('span', { class: 'muted', style: 'font-size:11px' }, `${TT('MEMBERS_LABEL')}: ${names}`));
      });
      const done = fnDone(fn);
      const testing = state.jobs.has('wiz:' + fn);
      return h('div', { class: 'card', style: 'margin-bottom:8px' },
        h('div', { class: 'row' }, h('h4', { style: 'margin:0' }, TT('FN.' + fn)), tutorialBtn(fn), h('span', { class: 'spacer' }),
          h('input', { type: 'number', min: 0, title: TT('DELAY_TOOLTIP'), value: W.delay[fn] ?? 150, style: 'width:80px', onchange: (e) => { W.delay[fn] = Number(e.target.value) || 0; } }),
          h('button', { disabled: !done || null, title: done ? TT('PREVIEW_PLAY') : TT('PREVIEW_PLAY_LOCKED'), onclick: async () => {
            const preset = { id: 'wiz:' + fn, name: TT('FN.' + fn), type: 'custom', loop: false, commands: commandsFor(fn) };
            const r = await api.invoke('execute-preset', { partyId: party.id, preset });
            if (!r.success) toast('Não foi possível executar: ' + (r.response?.error || r.error), 'err');
          } }, '▶ ' + TT('PREVIEW_PLAY'))),
        ...rows);
    });
    return h('div', {},
      h('h4', {}, TT('STEP3_TITLE')), h('p', { style: 'color:var(--warn,#ffc107)' }, TT('STEP3_WARNING')),
      blocks.length ? blocks : h('p', { class: 'muted' }, TT('NO_FUNCTIONS_SELECTED')),
      nav(() => { recording = null; W.step = 2; renderBody(); }, save, TT('SAVE'), false));
  };

  function renderBody() {
    const prog = h('div', { class: 'row', style: 'margin-bottom:10px' }, ...[1, 2, 3].map((n) => h('span', { class: 'chip' + (W.step === n ? ' active' : '') }, `${n}. ${TT(['STEP1_TITLE', 'STEP2_TITLE', 'STEP3_TITLE'][n - 1])}`)));
    box.replaceChildren(prog, W.step === 1 ? step1() : W.step === 2 ? step2() : step3());
  }
  renderBody();
  close = openModal({ title: TT('OPEN_BUTTON') + ' — ' + party.name, body: box, wide: true, onClose: () => { recording = null; closeGridAll(); } });
}
