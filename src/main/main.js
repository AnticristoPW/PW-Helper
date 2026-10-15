'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell, screen } = require('electron');
const path = require('node:path');
const store = require('./store');
const roster = require('./roster');
const backupSvc = require('./backup');
const { GameSessions } = require('./game');
const { WinCtl } = require('./winctl');
const { Offsets } = require('./offsets');
const { MemoryWatcher } = require('./memory');
const { ClientWindows, listThemes } = require('./clients');
const { buildCommands, firstCharacterId, Runner } = require('./presets');
const { InputHook } = require('./input');
const { Hotkeys } = require('./hotkeys');
const { MouseTools } = require('./mouse');

const RENDERER = path.join(__dirname, '..', 'renderer');
const wins = { main: null, toolbar: null };
let tray = null;
let quitting = false;

const sessions = new GameSessions();
const ctl = new WinCtl();
let offsets = null;
let memory = null;
const memErrSig = new Map();
const settingsNow = () => store.get('settings').response || {};
const ICONS_DIR = path.join(__dirname, '..', 'renderer', 'assets', 'icons');
const accountById = (id) => (store.get('accounts').response || []).find((a) => a.id === id);
const clients = new ClientWindows({
  ctl, iconsDir: ICONS_DIR, getSettings: settingsNow, getAccount: accountById,
  patchBounds(id, bounds) {
    const list = store.get('accounts').response || [];
    const a = list.find((x) => x.id === id);
    if (a) { a.windowBounds = bounds; store.set('accounts', list); }
  },
});
const serverKeyFor = (accountId) => {
  const acc = (store.get('accounts').response || []).find((a) => a.id === accountId);
  const srv = (store.get('servers').response || []).find((x) => x.id === acc?.server_id);
  return srv?.offsetsKey || '';
};

const broadcast = (channel, payload) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
};
// In-app event log (the original's "sync-log" window): launches, closes, crashes, preset jobs and memory errors.
const syncLog = [];
function logEvent(entry) {
  const e = { ts: Date.now(), ...entry };
  syncLog.push(e);
  if (syncLog.length > 500) syncLog.shift();
  broadcast('sync-log:entry', e);
}
const runner = new Runner(ctl, (channel, payload) => {
  if (channel.startsWith('job-')) logEvent({ event: channel, ...(payload && typeof payload === 'object' ? payload : {}) });
  broadcast(channel, payload);
});

const input = new InputHook();
const mouse = new MouseTools({ input, ctl, store, roster, sessions, broadcast });
const hotkeys = new Hotkeys({
  input, ctl, store, roster, sessions, broadcast, getSettings: settingsNow, executePreset,
  isHelperFocused: () => BrowserWindow.getFocusedWindow() !== null,
  toggleSync: () => mouse.toggleSync(),
});

function makeWindow(file, opts = {}) {
  const win = new BrowserWindow({
    backgroundColor: '#0f1115',
    show: false,
    ...opts,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  // Surface renderer/preload problems in the terminal that launched the app.
  win.webContents.on('console-message', (_e, level, message, line, source) => { if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`); });
  win.webContents.on('preload-error', (_e, file, err) => console.error('[preload-error]', file, err));
  win.loadFile(path.join(RENDERER, file), opts.query ? { query: opts.query } : undefined);
  win.once('ready-to-show', () => win.show());
  // The app never navigates away from its own files; external links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  return win;
}

function createMain() {
  const win = makeWindow('index.html', { width: 1100, height: 700, minWidth: 900, minHeight: 560, title: 'PW Helper', frame: false });
  win.on('close', (e) => {
    if (!quitting && store.get('settings').response?.background) {
      e.preventDefault();
      win.hide();
      buildTray();
    }
  });
  win.on('closed', () => { wins.main = null; });
  win.on('maximize', () => win.webContents.send('fullscreen-changed', { isFullscreen: true }));
  win.on('unmaximize', () => win.webContents.send('fullscreen-changed', { isFullscreen: false }));
  wins.main = win;
}

function buildTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('PW Helper');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar', click: () => { wins.main?.show(); tray?.destroy(); tray = null; } },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { wins.main?.show(); tray?.destroy(); tray = null; });
}

// ---- helpers -------------------------------------------------------------------------------------------------
const ok = (response) => ({ success: true, code: 200, response });
const fail = (code, error) => ({ success: false, code, error });
const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
  try { return await fn(e, ...a); } catch (err) { return fail(500, String(err.message || err)); }
});

function emitPlaying() { broadcast('playing-accounts-changed', sessions.list().map((s) => ({ ...s, isHidden: clients.isHidden(s.id) }))); }

function pruneRoster() {
  const parties = new Set((store.get('parties').response || []).filter((p) => !p.archived).map((p) => p.id));
  const accounts = new Set((store.get('accounts').response || []).filter((a) => !a.archived).map((a) => a.id));
  if (roster.prune(parties, accounts)) broadcast('roster-changed', roster.getAll());
}

// ---- window controls -----------------------------------------------------------------------------------------
ipcMain.on('minimize-main-window', () => wins.main?.minimize());
ipcMain.on('maximize-main-window', () => (wins.main?.isMaximized() ? wins.main.unmaximize() : wins.main?.maximize()));
ipcMain.on('close-main-window', () => wins.main?.close());
ipcMain.on('restart-app', () => { quitting = true; app.relaunch(); app.quit(); });
handle('get-app-version', () => ok(app.getVersion()));

// ---- storage -------------------------------------------------------------------------------------------------
const COLLECTION_CHANNELS = [
  ['accounts', 'get-accounts-storage', 'write-accounts-storage', 'accounts-updated'],
  ['servers', 'get-servers-storage', 'write-servers-storage', null],
  ['groups', 'get-account-group-storage', 'set-account-group-storage', 'account-groups-updated'],
  ['parties', 'get-parties-storage', 'set-parties-storage', 'parties-updated'],
  ['autoforja', 'get-autoforja-storage', 'write-autoforja-storage', null],
  ['map', 'get-interactive-map-storage', 'set-interactive-map-storage', null],
];
for (const [name, getCh, setCh, event] of COLLECTION_CHANNELS) {
  handle(getCh, () => store.get(name));
  handle(setCh, (e, value) => {
    if (name !== 'autoforja' && name !== 'map' && !Array.isArray(value)) return fail(400, 'Esperava uma lista');
    const r = store.set(name, value);
    if (r.success) {
      if (event) for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender && !w.isDestroyed()) w.webContents.send(event);
      if (name === 'accounts' || name === 'parties') pruneRoster();
    }
    return r;
  });
}

handle('get-settings', () => store.get('settings'));
handle('set-settings', (e, value) => {
  const r = store.set('settings', value);
  if (r.success) for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender && !w.isDestroyed()) w.webContents.send('settings-updated', value);
  return r;
});
handle('get-application-storage', () => store.get('application'));
handle('set-application-key', (e, key, value) => {
  const cur = store.get('application');
  return store.set('application', { ...(cur.success ? cur.response : {}), [key]: value });
});
handle('enable-start-with-windows', () => { app.setLoginItemSettings({ openAtLogin: true }); return ok(true); });
handle('disable-start-with-windows', () => { app.setLoginItemSettings({ openAtLogin: false }); return ok(false); });

// The level read from memory is stored on the account (same as the original's "account:level-updated").
const lastLevel = new Map();
function patchLevel(id, level) {
  if (lastLevel.get(id) === level) return;
  lastLevel.set(id, level);
  const list = store.get('accounts').response || [];
  const a = list.find((x) => x.id === id);
  if (!a || a.store || a.level === level) return;
  a.level = level;
  store.set('accounts', list);
  broadcast('account:level-updated', { id, level });
}

// ---- game clients --------------------------------------------------------------------------------------------
ipcMain.on('open-element', (_e, req) => {
  const accounts = store.get('accounts').response || [];
  const servers = store.get('servers').response || [];
  const account = accounts.find((a) => a.id === req?.id);
  const server = servers.find((s) => s.id === (req?.server ?? account?.server_id));
  const reply = (payload) => broadcast('open-element-response', payload);
  if (!account) return reply(fail(404, 'account-not-found'));
  const r = sessions.open({ account, server: server && { ...server, arguments: req?.argument ?? server.arguments } });
  if (!r.ok && r.error !== 'launching') reply(fail(500, r.error));
  else if (r.already) reply(ok({ pid: r.pid, id: account.id }));
});
ipcMain.on('close-element', (_e, id) => { sessions.close(id); });
ipcMain.on('close-crash-window', (_e, id) => { sessions.dismissCrash(id); emitPlaying(); });
handle('get-playing-accounts', () => ok(sessions.list().map((s) => ({ ...s, isHidden: clients.isHidden(s.id) }))));
// Play time: sessions are stamped on the account when the client ends (closed or crashed).
function recordSession(id, startedAt) {
  const list = store.get('accounts').response || [];
  const a = list.find((x) => x.id === id);
  if (!a || !startedAt) return;
  a.totalPlayMs = (a.totalPlayMs || 0) + Math.max(0, Date.now() - startedAt);
  a.sessionCount = (a.sessionCount || 0) + 1;
  a.lastSession = Date.now();
  store.set('accounts', list);
  broadcast('accounts-updated');
}
sessions.on('opened', ({ id, pid }) => { clients.track(id, pid); logEvent({ event: 'started', id, pid }); memory?.add(id, pid, serverKeyFor(id)); broadcast('open-element-response', ok({ pid, id })); emitPlaying(); });
sessions.on('closed', ({ id, pid, startedAt }) => { clients.untrack(id); logEvent({ event: 'closed', id, pid }); memory?.remove(id); recordSession(id, startedAt); runner.cancelForPid(pid); broadcast('close-element', ok(id)); emitPlaying(); });
sessions.on('crashed', ({ id, pid, startedAt }) => { clients.untrack(id); logEvent({ event: 'crashed', id, pid }); memory?.remove(id); recordSession(id, startedAt); runner.cancelForPid(pid); broadcast('crash-window', { success: true, code: 500, response: id }); emitPlaying(); });
sessions.on('error', ({ id, error }) => { logEvent({ event: 'error', id, message: error }); }); 
sessions.on('error', ({ id, error }) => broadcast('open-element-response', fail(500, error)));
handle('select-exe', async () => {
  const r = await dialog.showOpenDialog(wins.main, { properties: ['openFile'], filters: [{ name: 'Executável', extensions: ['exe'] }] });
  return ok(r.canceled ? null : r.filePaths[0]);
});

// ---- client windows ---------------------------------------------------------------------------------------------
clients.on('visibility', ({ id, pid, hidden }) => { broadcast('window-visibility', { id, pid, hidden }); emitPlaying(); });
ipcMain.on('hide-client-window', (_e, id) => { clients.setHidden(id, true).catch(() => {}); });
ipcMain.on('show-client-window', (_e, id) => { clients.setHidden(id, false).catch(() => {}); });
handle('force-window-size', async (_e, { id, width, height } = {}) => (await clients.setSize(id, Number(width), Number(height)) ? ok(true) : fail(404, 'window-not-found')));
handle('get-class-icon-themes', () => ok(listThemes(ICONS_DIR)));
handle('apply-class-icon-theme', async (_e, theme) => {
  const s = settingsNow();
  const r = store.set('settings', { ...s, classIconTheme: Math.max(1, Math.min(6, Number(theme) || 1)) });
  await clients.reapplyIcons();
  broadcast('settings-updated', settingsNow());
  return r;
});

// ---- offsets / memory reading ------------------------------------------------------------------------------------
handle('get-offsets-info', () => ok(offsets.info()));
handle('refresh-offsets', async () => {
  try { return ok(await offsets.refresh()); } catch (e) { return fail(500, String(e.message || e)); }
});
handle('import-offsets', async () => {
  const r = await dialog.showOpenDialog(wins.main, { properties: ['openFile'], filters: [{ name: 'Offsets (JSON)', extensions: ['json'] }] });
  if (r.canceled) return ok(null);
  try { return ok(offsets.importFile(r.filePaths[0])); } catch (e) { return fail(400, String(e.message || e)); }
});
handle('update-sync-server', (_e, { serverId, offsetsKey } = {}) => {
  const accountIds = (store.get('accounts').response || []).filter((a) => a.server_id === serverId).map((a) => a.id);
  let updated = 0;
  for (const id of accountIds) if (sessions.isRunning(id)) { memory.setKey(id, offsetsKey); updated++; }
  return ok({ updated });
});
handle('get-sync-log', () => ok(syncLog));
handle('clear-sync-log', () => { syncLog.length = 0; return ok(true); });
handle('sync-log:push', (_e, entry) => { logEvent(entry && typeof entry === 'object' ? entry : { event: 'log', message: String(entry) }); return ok(true); });
handle('get-memory-values', () => ok([...memory.last.values()]));

// ---- party / presets -----------------------------------------------------------------------------------------
handle('get-roster', () => ok(roster.getAll()));
handle('roster-assign', (_e, partyId, accountId) => { const r = roster.assign(partyId, accountId); broadcast('roster-changed', roster.getAll()); return ok(r); });
handle('roster-set', (_e, partyId, ids) => { const r = roster.setOrder(partyId, ids); broadcast('roster-changed', roster.getAll()); return ok(r); });
handle('roster-remove', (_e, partyId, accountId) => { const r = roster.remove(partyId, accountId); broadcast('roster-changed', roster.getAll()); return ok(r); });

function executePreset({ partyId, presetId, preset, loop, background } = {}) {
  const party = (store.get('parties').response || []).find((p) => p.id === partyId && !p.archived);
  if (!party) return { ...fail(400, 'party-not-found'), response: { ok: false, error: 'party-not-found' } };
  const chosen = preset ?? party.presets?.presets?.find((p) => p.id === presetId);
  if (!chosen?.id) return { ...fail(400, 'preset-not-found'), response: { ok: false, error: 'preset-not-found' } };
  const members = sessions.members(roster.memberIds(partyId));
  const commands = buildCommands(party, chosen, members);
  if (!commands.length) return { ...fail(400, 'no-command-available'), response: { ok: false, error: 'no-command-available' } };
  const isLoop = loop === undefined ? !!chosen.loop : !!loop;
  const bg = background ?? !!party.backgroundExecution;
  runner.start(chosen.id, commands, { loop: isLoop, background: bg });
  return ok({ ok: true, jobId: chosen.id, characterId: firstCharacterId(commands) });
}
handle('execute-preset', (_e, req) => executePreset(req ?? {}));
ipcMain.on('stop-preset-party', (_e, { jobId } = {}) => runner.cancel(jobId));
ipcMain.on('stop-all-preset', () => runner.cancelAll());
ipcMain.on('focus-window', (_e, pid) => {
  if (Number.isInteger(pid)) ctl.focus(pid).then(() => broadcast('change-character', { pid })).catch(() => {});
});
handle('get-window-info', async (_e, pid) => ok(await ctl.info(pid)));
handle('listen-click', async (_e, pid, block) => {
  try { return ok(await mouse.listenClick(Number(pid) || 0, !!block)); } catch (e) { return fail(408, String(e.message || e)); }
});
handle('listen-click-cancel', () => { mouse.cancelListen(); return ok(true); });
ipcMain.on('listen-click-mirror', (_e, allParties) => { mouse.setSync(true, allParties); });
ipcMain.on('stop-listen-click-mirror', () => { mouse.setSync(false); });
handle('get-sync-click', () => ok(mouse.sync));
handle('party:sync-click-target', (_e, { allParties } = {}) => ok(mouse.setSync(mouse.sync.enabled, !!allParties)));

// ---- backup --------------------------------------------------------------------------------------------------
handle('get-backup-default-path', () => ok(backupSvc.defaultPath(app.getPath('documents'))));
handle('backup', (_e, dest) => ok(backupSvc.backup(dest || backupSvc.defaultPath(app.getPath('documents')))));
handle('get-backups-list', (_e, dest) => ok(backupSvc.list(dest || backupSvc.defaultPath(app.getPath('documents')))));
handle('restore', (_e, dir) => {
  const r = backupSvc.restore(dir);
  broadcast('settings-updated', store.readRaw('settings'));
  broadcast('accounts-updated');
  broadcast('parties-updated');
  broadcast('roster-changed', roster.getAll());
  return ok(r);
});
handle('select-image', async () => {
  const r = await dialog.showOpenDialog(wins.main, { properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'ico', 'webp', 'gif'] }] });
  if (r.canceled) return ok(null);
  // Returned as a data URL so the renderer (CSP: img-src data:) can show it and the server keeps it in its own JSON.
  const fs = require('node:fs');
  const f = r.filePaths[0];
  const size = fs.statSync(f).size;
  if (size > 512 * 1024) return fail(413, 'Imagem muito grande (máx. 512 KB)');
  const ext = require('node:path').extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg').replace('ico', 'x-icon');
  return ok({ path: f, dataUrl: `data:image/${ext};base64,${fs.readFileSync(f).toString('base64')}` });
});
handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(wins.main, { properties: ['openDirectory', 'createDirectory'] });
  return ok(r.canceled ? null : r.filePaths[0]);
});

// ---- parties window ------------------------------------------------------------------------------------------
ipcMain.on('open-parties-window', () => {
  if (wins.parties && !wins.parties.isDestroyed()) { if (wins.parties.isMinimized()) wins.parties.restore(); return wins.parties.focus(); }
  wins.parties = makeWindow('parties.html', { width: 960, height: 640, minWidth: 760, minHeight: 480, title: 'PW Helper', frame: false });
  wins.parties.on('closed', () => { wins.parties = null; });
});
// detached ("minimized") party windows, one per party
const detached = new Map();
const detachedIds = () => [...detached.keys()];
const announceDetached = () => broadcast('detached-parties', detachedIds());
handle('get-detached-parties', () => ok(detachedIds()));
ipcMain.on('open-minimized-party', (_e, partyId) => {
  const cur = detached.get(partyId);
  if (cur && !cur.isDestroyed()) { cur.show(); return cur.focus(); }
  const win = makeWindow('party-mini.html', { width: 340, height: 460, minWidth: 300, minHeight: 300, title: 'PW Helper', frame: false, alwaysOnTop: true, query: { partyId } });
  detached.set(partyId, win);
  win.on('closed', () => { detached.delete(partyId); announceDetached(); });
  announceDetached();
});
ipcMain.on('close-minimized-party', (_e, partyId) => { const w = detached.get(partyId); if (w && !w.isDestroyed()) w.close(); });
ipcMain.on('open-main-panel', (_e, id) => { if (!wins.main) return; wins.main.show(); wins.main.focus(); wins.main.webContents.send('open-panel', id); });
const senderWin = (e) => BrowserWindow.fromWebContents(e.sender);
ipcMain.on('window-minimize', (e) => senderWin(e)?.minimize());
ipcMain.on('window-maximize', (e) => { const w = senderWin(e); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()); });
ipcMain.on('window-close', (e) => senderWin(e)?.close());
handle('import-parties', async () => {
  const r = await dialog.showOpenDialog(wins.parties || wins.main, { properties: ['openFile'], filters: [{ name: 'Grupos (JSON)', extensions: ['json'] }] });
  if (r.canceled) return ok(null);
  let j;
  try { j = JSON.parse(require('node:fs').readFileSync(r.filePaths[0], 'utf8')); } catch { return fail(400, 'Arquivo inválido'); }
  const incoming = (Array.isArray(j) ? j : j?.parties || []).filter((p) => p && typeof p === 'object' && typeof p.name === 'string');
  if (!incoming.length) return fail(400, 'Nenhum grupo encontrado no arquivo');
  const list = store.get('parties').response || [];
  const crypto = require('node:crypto');
  for (const p of incoming) list.push({ ...p, id: crypto.randomUUID(), archived: false });
  store.set('parties', list);
  broadcast('parties-updated');
  return ok(incoming.length);
});
handle('export-parties', async (_e, ids) => {
  const list = (store.get('parties').response || []).filter((p) => Array.isArray(ids) && ids.includes(p.id));
  const r = await dialog.showSaveDialog(wins.parties || wins.main, { defaultPath: 'grupos.json', filters: [{ name: 'Grupos (JSON)', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return ok(false);
  require('node:fs').writeFileSync(r.filePath, JSON.stringify({ parties: list }, null, 2));
  return ok(true);
});

// ---- tools bar -----------------------------------------------------------------------------------------------
ipcMain.on('open-toolbar', () => {
  if (wins.toolbar && !wins.toolbar.isDestroyed()) return wins.toolbar.focus();
  wins.toolbar = makeWindow('toolbar.html', { width: 520, height: 64, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true, title: 'Barra' });
  wins.toolbar.on('closed', () => { wins.toolbar = null; });
});
ipcMain.on('close-toolbar', () => wins.toolbar?.close());


// ---- settings helpers ----------------------------------------------------------------------------------------
handle('open-path', async (_e, p) => { if (typeof p === 'string' && p) await shell.openPath(p); return ok(true); });
handle('open-external', async (_e, url) => { if (/^https?:\/\//i.test(url)) await shell.openExternal(url); return ok(true); });
const resetWindow = (w) => {
  if (!w || w.isDestroyed()) return false;
  const wa = screen.getPrimaryDisplay().workArea; const b = w.getBounds();
  w.setBounds({ x: wa.x + Math.round((wa.width - b.width) / 2), y: wa.y + Math.round((wa.height - b.height) / 2), width: b.width, height: b.height });
  return true;
};
handle('reset-party-window', () => { let n = resetWindow(wins.parties); for (const w of detached.values()) n = resetWindow(w) || n; return ok(n); });
handle('reset-tools-bar-window', () => ok(resetWindow(wins.toolbar)));
handle('get-active-preset-engine', () => ok(settingsNow().party?.presetEngine || 'new'));
handle('apply-preset-engine', (_e, engine) => {
  runner.cancelAll();
  const cur = settingsNow(); const r = store.set('settings', { ...cur, party: { ...(cur.party || {}), presetEngine: engine === 'classic' ? 'classic' : 'new' } });
  broadcast('settings-updated', settingsNow());
  return r;
});
handle('export-accounts-code', (_e, ids) => {
  const accs = (store.get('accounts').response || []).filter((a) => ids.includes(a.id));
  const servers = store.get('servers').response || [];
  const rows = accs.map((a) => ({ n: a.characterName, l: a.login, p: a.password, c: a.charClass, e: a.email || '', s: servers.find((x) => x.id === a.server_id)?.name || '' }));
  return ok('PWA1:' + Buffer.from(JSON.stringify(rows), 'utf8').toString('base64'));
});
handle('select-text-file', async (_e, exts) => {
  const r = await dialog.showOpenDialog(wins.main, { properties: ['openFile'], filters: [{ name: 'Arquivo', extensions: exts || ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return ok(null);
  return ok({ path: r.filePaths[0], text: require('node:fs').readFileSync(r.filePaths[0], 'utf8') });
});
handle('select-shortcuts', async () => {
  const r = await dialog.showOpenDialog(wins.main, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Atalhos', extensions: ['lnk'] }] });
  if (r.canceled) return ok([]);
  return ok(r.filePaths.map((p) => { try { const l = shell.readShortcutLink(p); return { path: p, name: path.basename(p, '.lnk'), target: l.target, args: l.args || '' }; } catch { return { path: p, name: path.basename(p, '.lnk'), target: '', args: '' }; } }));
});

// Auto backup scheduler (settings.backup = {active, interval: '1H'|'4H'|'8H'|'12H'|'1D', path})
const BACKUP_MS = { '1H': 3600e3, '4H': 4 * 3600e3, '8H': 8 * 3600e3, '12H': 12 * 3600e3, '1D': 24 * 3600e3 };
let lastAutoBackup = Date.now();
setInterval(() => {
  const b = settingsNow().backup;
  if (!b?.active || Date.now() - lastAutoBackup < (BACKUP_MS[b.interval] || BACKUP_MS['1D'])) return;
  lastAutoBackup = Date.now();
  try { backupSvc.backup(b.path || backupSvc.defaultPath(app.getPath('documents'))); } catch { /* ignore */ }
}, 60e3).unref();


// ---- HUD grid / click-map overlays over a PW window ------------------------------------------------------------
const overlays = new Map(); // key -> BrowserWindow
async function openOverlay(key, pid, query) {
  closeOverlay(key);
  const info = pid ? await ctl.info(pid).catch(() => null) : null;
  if (!info) return false;
  const win = makeWindow('overlay-grid.html', { x: info.x, y: info.y, width: info.width, height: info.height, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, hasShadow: false, query });
  win.setIgnoreMouseEvents(true);
  win.on('closed', () => overlays.delete(key));
  overlays.set(key, win);
  return true;
}
function closeOverlay(key) { const w = overlays.get(key); if (w && !w.isDestroyed()) w.close(); overlays.delete(key); }
handle('open-party-hud-grid-overlay', async (_e, pid) => ok(await openOverlay('grid:' + pid, pid, { mode: 'grid' })));
handle('close-party-hud-grid-overlay', (_e, pid) => { if (pid) closeOverlay('grid:' + pid); else for (const k of [...overlays.keys()]) if (k.startsWith('grid:')) closeOverlay(k); return ok(true); });
handle('open-party-click-map-overlay', async (_e, pid, points = []) => ok(await openOverlay('map:' + pid, pid, { mode: 'clicks', points: points.map((p) => p.x + ',' + p.y).join(';') })));
handle('update-party-click-map-overlay', async (_e, pid, points = []) => ok(await openOverlay('map:' + pid, pid, { mode: 'clicks', points: points.map((p) => p.x + ',' + p.y).join(';') })));
handle('close-party-click-map-overlay', (_e, pid) => { if (pid) closeOverlay('map:' + pid); else for (const k of [...overlays.keys()]) if (k.startsWith('map:')) closeOverlay(k); return ok(true); });

// ---- lifecycle -----------------------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { wins.main?.show(); wins.main?.focus(); });
  app.whenReady().then(() => {
    store.init(path.join(app.getPath('userData'), 'data'));
    app.setAppUserModelId('com.pwhelper.clone');
    ctl.start();
    input.setKeys(true);
    offsets = new Offsets(path.join(app.getPath('userData'), 'data'), { getUrl: () => settingsNow().offsetsUrl || '' });
    offsets.load();
    memory = new MemoryWatcher(ctl, offsets, { enabled: () => settingsNow().party?.enableMemoryRead ?? true });
    memory.on('values', (payload) => {
      broadcast('sync-clients:memory-values', payload);
      const errs = Object.keys(payload.errors);
      const sig = errs.join(',');
      if (memErrSig.get(payload.id) !== sig) { memErrSig.set(payload.id, sig); if (errs.length) logEvent({ event: 'memory_errors', id: payload.id, pid: payload.pid, message: errs.map((k) => k + ': ' + payload.errors[k]).join(' | ') }); }
      const level = payload.values.nivel;
      if (level !== undefined && !payload.errors.nivel) patchLevel(payload.id, level);
    });
    createMain();
    app.on('activate', () => !wins.main && createMain());
  });
  app.on('before-quit', () => { quitting = true; runner.cancelAll(); ctl.stop(); input.stop(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
