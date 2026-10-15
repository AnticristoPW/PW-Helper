'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only channels listed here are reachable from the renderer.
const INVOKE = new Set([
  'get-offsets-info', 'refresh-offsets', 'import-offsets', 'update-sync-server', 'get-memory-values', 'get-sync-log', 'clear-sync-log', 'sync-log:push',
  'import-parties', 'export-parties', 'force-window-size', 'get-class-icon-themes', 'apply-class-icon-theme',
  'get-app-version', 'get-accounts-storage', 'write-accounts-storage', 'get-servers-storage', 'write-servers-storage',
  'get-account-group-storage', 'set-account-group-storage', 'get-parties-storage', 'set-parties-storage',
  'get-autoforja-storage', 'write-autoforja-storage', 'get-interactive-map-storage', 'set-interactive-map-storage',
  'get-settings', 'set-settings', 'get-application-storage', 'set-application-key',
  'enable-start-with-windows', 'disable-start-with-windows', 'get-playing-accounts', 'select-exe', 'select-folder', 'select-image',
  'get-roster', 'get-detached-parties', 'listen-click', 'get-sync-click', 'party:sync-click-target', 'roster-assign', 'roster-set', 'roster-remove', 'execute-preset', 'get-window-info',
  'open-party-hud-grid-overlay', 'close-party-hud-grid-overlay', 'open-party-click-map-overlay', 'update-party-click-map-overlay', 'close-party-click-map-overlay', 'listen-click-cancel', 'open-path', 'open-external', 'reset-party-window', 'reset-tools-bar-window', 'get-active-preset-engine', 'apply-preset-engine', 'export-accounts-code', 'select-text-file', 'select-shortcuts',
  'get-backup-default-path', 'backup', 'get-backups-list', 'restore',
]);
const SEND = new Set([
  'minimize-main-window', 'maximize-main-window', 'close-main-window', 'restart-app', 'open-element', 'close-element',
  'listen-click-mirror', 'stop-listen-click-mirror', 'open-parties-window', 'open-minimized-party', 'close-minimized-party', 'open-main-panel', 'window-minimize', 'window-maximize', 'window-close', 'hide-client-window', 'show-client-window', 'close-crash-window', 'stop-preset-party', 'stop-all-preset', 'focus-window', 'open-toolbar', 'close-toolbar',
]);
const EVENTS = new Set([
  'sync-clients:memory-values', 'sync-log:entry', 'account:level-updated',
  'open-element-response', 'close-element', 'crash-window', 'playing-accounts-changed', 'settings-updated', 'accounts-updated',
  'account-groups-updated', 'parties-updated', 'roster-changed', 'job-started', 'job-ended', 'job-error', 'change-character',
  'fullscreen-changed', 'window-visibility', 'open-panel', 'detached-parties', 'sync-click-changed',
]);

contextBridge.exposeInMainWorld('pw', {
  invoke: (ch, ...a) => (INVOKE.has(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('canal bloqueado: ' + ch))),
  send: (ch, ...a) => { if (SEND.has(ch)) ipcRenderer.send(ch, ...a); },
  on: (ch, fn) => {
    if (!EVENTS.has(ch)) return () => {};
    const h = (_e, p) => fn(p);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
});
