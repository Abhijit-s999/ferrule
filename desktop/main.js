'use strict';

/* The desktop shell.
 *
 * Starts the satprep backend as a child process on a free port, waits for it to
 * answer, and opens a window on it. The user never sees a terminal, a port, or
 * a URL. Closing the window stops the backend and any model server it started.
 */

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let backend = null;
let port = 0;
let win = null;

/* NVIDIA + Wayland makes Chromium's GPU process crash-loop
 * (eglCreateImage fails, OzoneImageBacking cannot produce a Skia
 * representation, the GPU process exits and restarts forever). This app draws
 * text, tables and small SVG charts, so hardware acceleration buys it nothing
 * and costs it stability. Disable it on that combination.
 *
 * Set SATPREP_GPU=1 to force acceleration back on. */
function shouldDisableGpu() {
  if (process.env.SATPREP_GPU === '1') return false;
  if (process.env.SATPREP_GPU === '0') return true;
  if (process.platform !== 'linux') return false;
  const wayland =
    !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
  const nvidia = spawnSync('sh', ['-c', 'command -v nvidia-smi'], { encoding: 'utf8' })
    .status === 0;
  return wayland && nvidia;
}

if (shouldDisableGpu()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

/** First python on PATH that is version 3.9+. */
function findPython() {
  const candidates =
    process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python'];
  for (const cmd of candidates) {
    const args = cmd === 'py' ? ['-3', '-c', 'import sys;print(sys.version_info[:2])']
                              : ['-c', 'import sys;print(sys.version_info[:2])'];
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status === 0) {
      const m = /\((\d+),\s*(\d+)\)/.exec(r.stdout || '');
      if (m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 9))) return cmd;
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForServer(p, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port: p, path: '/api/state', timeout: 2000 },
        (res) => { res.resume(); resolve(); }
      );
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('backend did not start in time'));
        else setTimeout(tick, 350);
      });
      req.on('timeout', () => req.destroy());
    };
    tick();
  });
}

async function startBackend() {
  const python = findPython();
  if (!python) {
    dialog.showErrorBox(
      'Python not found',
      'satprep needs Python 3.9 or newer.\n\n' +
      (process.platform === 'win32'
        ? 'Install it from python.org or the Microsoft Store, then reopen satprep.'
        : 'Install python3 with your package manager, then reopen satprep.')
    );
    app.quit();
    return;
  }

  port = await freePort();
  const args = [path.join(ROOT, 'satprep.py'), 'serve', '--port', String(port)];
  backend = spawn(python === 'py' ? 'py' : python, python === 'py' ? ['-3', ...args] : args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  backend.stdout.on('data', (d) => { log += d; });
  backend.stderr.on('data', (d) => { log += d; });
  backend.on('exit', (code) => {
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox('satprep backend stopped', log.slice(-1500) || `exit code ${code}`);
      app.quit();
    }
  });

  await waitForServer(port);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 380,
    backgroundColor: '#16171a',
    title: 'satprep',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(`http://127.0.0.1:${port}/`);

  // Anything that is not the app itself opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'satprep',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ])
);

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow();
  } catch (e) {
    dialog.showErrorBox('satprep could not start', String(e));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

/* Shut the backend down synchronously.
 *
 * The previous version asked the backend over HTTP to stop its model server
 * and killed it in the callback -- but Electron exits without waiting for that
 * callback, so both the backend and its llama-server were routinely orphaned,
 * leaving the model resident on the GPU. SIGTERM is enough: the backend
 * installs handlers that stop the model server on the way out, and the model
 * additionally carries PR_SET_PDEATHSIG on Linux. */
function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  try {
    backend.kill('SIGTERM');
  } catch { /* already gone */ }

  // Escalate if it has not exited shortly. Synchronous so it completes before
  // the event loop stops.
  const deadline = Date.now() + 4000;
  while (backend.exitCode === null && Date.now() < deadline) {
    try { spawnSync('sh', ['-c', 'sleep 0.1']); } catch { break; }
  }
  if (backend.exitCode === null) {
    try { backend.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

app.on('before-quit', () => {
  app.isQuitting = true;
  stopBackend();
});

// Covers the cases before-quit does not: a crash, or a signal from the shell.
process.on('exit', stopBackend);
process.on('SIGINT', () => { stopBackend(); process.exit(0); });
process.on('SIGTERM', () => { stopBackend(); process.exit(0); });
