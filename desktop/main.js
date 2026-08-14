'use strict';

/* The desktop shell.
 *
 * Starts the ferrule backend as a child process on a free port, waits for it to
 * answer, and opens a window on it. The user never sees a terminal, a port, or
 * a URL. Closing the window stops the backend and any model server it started.
 */

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
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
 * Set FERRULE_GPU=1 to force acceleration back on. */
function shouldDisableGpu() {
  if (process.env.FERRULE_GPU === '1') return false;
  if (process.env.FERRULE_GPU === '0') return true;
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

/* Released builds ship the backend frozen into a single executable, so an
 * installed copy needs no Python at all.
 *
 * A source checkout must NEVER use that executable, even when one is lying
 * around in dist/ from a local `npm run dist`. The frozen binary embeds a
 * snapshot of the frontend taken at build time, so running it in a checkout
 * silently serves stale HTML/CSS/JS: you edit the source, reload, and see no
 * change, with nothing to indicate why. A checkout runs live source; only a
 * packaged app runs the bundle. */
function isSourceCheckout() {
  // app.isPackaged is the only reliable signal. ROOT inside a packaged build
  // points at app.asar, and Electron's asar shim makes paths *inside* the
  // archive answer existsSync() truthfully — so a bare file check would call a
  // shipped app a checkout and try to run Python against a path inside the
  // archive.
  return !app.isPackaged && fs.existsSync(path.join(ROOT, 'ferrule.py'));
}

/* A working directory that is a real directory on disk.
 *
 * ROOT is …/Contents/Resources/app.asar in a packaged build, and that is an
 * archive FILE. Passing it as spawn's cwd makes the child's chdir fail with
 * ENOTDIR before the backend ever runs — which is what a released macOS build
 * did: the backend binary was found and correct, and the spawn still failed.
 * Nothing in the backend depends on cwd; its data paths are absolute. */
function spawnCwd() {
  if (!app.isPackaged) return ROOT;
  for (const dir of [process.resourcesPath, app.getPath('userData'), os.tmpdir()]) {
    try {
      if (dir && fs.statSync(dir).isDirectory()) return dir;
    } catch { /* try the next one */ }
  }
  return undefined;                    // let the child inherit ours
}

function findBundledBackend() {
  if (isSourceCheckout()) return null;
  const exe = process.platform === 'win32' ? 'ferrule-backend.exe' : 'ferrule-backend';
  const candidates = [
    path.join(process.resourcesPath || '', 'backend', exe),
    path.join(ROOT, 'backend', exe),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

async function startBackend() {
  port = await freePort();
  const bundled = findBundledBackend();

  let cmd, args;
  if (bundled) {
    cmd = bundled;
    args = ['serve', '--port', String(port)];
  } else if (app.isPackaged) {
    dialog.showErrorBox(
      'ferrule is incomplete',
      'The bundled backend is missing from this build, so there is nothing to '
      + 'run. Please re-download the installer from the releases page.'
    );
    app.quit();
    return;
  } else {
    const python = findPython();
    if (!python) {
      dialog.showErrorBox(
        'Python not found',
        'This is a source checkout, which needs Python 3.9 or newer to run.\n\n' +
        (process.platform === 'win32'
          ? 'Install it from python.org or the Microsoft Store, then reopen ferrule.\n\n'
          : 'Install python3 with your package manager, then reopen ferrule.\n\n') +
        'The released installers bundle everything and need no Python.'
      );
      app.quit();
      return;
    }
    const script = [path.join(ROOT, 'ferrule.py'), 'serve', '--port', String(port)];
    cmd = python;
    args = python === 'py' ? ['-3', ...script] : script;
  }

  backend = spawn(cmd, args, { cwd: spawnCwd(), stdio: ['ignore', 'pipe', 'pipe'] });

  let log = '';
  backend.stdout.on('data', (d) => { log += d; });
  backend.stderr.on('data', (d) => { log += d; });
  backend.on('exit', (code) => {
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox('ferrule backend stopped', log.slice(-1500) || `exit code ${code}`);
      app.quit();
    }
  });

  await waitForServer(port);
}

/* Zoom.
 *
 * Menu roles alone are not enough here: the menu bar is auto-hidden, and long
 * reading passages are the whole point of the app, so making the text bigger
 * has to be a first-class, always-available action. Bound directly on the
 * webContents so it works regardless of the menu, and remembered between runs
 * — nobody wants to re-zoom every launch. */
const ZOOM_FILE = path.join(app.getPath('userData'), 'zoom.json');
const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

function readZoom() {
  try {
    const v = JSON.parse(fs.readFileSync(ZOOM_FILE, 'utf8')).factor;
    return typeof v === 'number' && v > 0.3 && v < 4 ? v : 1;
  } catch { return 1; }
}

function writeZoom(factor) {
  try {
    fs.mkdirSync(path.dirname(ZOOM_FILE), { recursive: true });
    fs.writeFileSync(ZOOM_FILE, JSON.stringify({ factor }));
  } catch { /* zoom is not worth failing over */ }
}

function installZoom(win) {
  const wc = win.webContents;
  const apply = (factor) => {
    const f = Math.min(2.5, Math.max(0.67, factor));
    wc.setZoomFactor(f);
    writeZoom(f);
    // A brief readout, so it is obvious the key did something.
    wc.executeJavaScript(
      `(() => { let e = document.getElementById('zoomtoast');
         if (!e) { e = document.createElement('div'); e.id = 'zoomtoast';
                   e.className = 'zoomtoast'; document.body.appendChild(e); }
         e.textContent = '${Math.round(f * 100)}%';
         e.classList.add('on');
         clearTimeout(window.__zt);
         window.__zt = setTimeout(() => e.classList.remove('on'), 900); })()`
    ).catch(() => {});
  };

  const step = (dir) => {
    const cur = wc.getZoomFactor();
    const i = ZOOM_STEPS.reduce(
      (best, v, idx) => (Math.abs(v - cur) < Math.abs(ZOOM_STEPS[best] - cur) ? idx : best), 0);
    apply(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]);
  };

  wc.on('did-finish-load', () => wc.setZoomFactor(readZoom()));

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod) return;
    const k = input.key;
    if (k === '=' || k === '+' || k === 'Add') { event.preventDefault(); step(+1); }
    else if (k === '-' || k === '_' || k === 'Subtract') { event.preventDefault(); step(-1); }
    else if (k === '0') { event.preventDefault(); apply(1); }
  });

  wc.on('zoom-changed', (event, direction) => {   // ctrl + mouse wheel
    event.preventDefault();
    step(direction === 'in' ? +1 : -1);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 380,
    backgroundColor: '#16171a',
    title: 'ferrule',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
  installZoom(win);

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
      label: 'ferrule',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+Plus' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
        { role: 'zoomOut', accelerator: 'CommandOrControl+-' },
        { role: 'resetZoom', accelerator: 'CommandOrControl+0' },
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
    dialog.showErrorBox('ferrule could not start', String(e));
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
