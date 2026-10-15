'use strict';
// Launches Electron with ELECTRON_RUN_AS_NODE cleared (if it is set, Electron behaves as plain Node).
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, '..')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
