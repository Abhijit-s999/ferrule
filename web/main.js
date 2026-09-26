/* Start the web version: open the database, answer /api/* in the page, then
 * load the same frontend the desktop app uses. */

import { createApi, install } from './lib/api.js';
import { indexedDbKV, memoryKV, Store } from './lib/store.js';

const main = document.getElementById('main');
const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function stop(title, body) {
  main.innerHTML = `<h1 class="serif">${title}</h1><div class="card">${body}
    <button class="primary" style="margin-top:14px" onclick="location.reload()">Reload</button></div>`;
}

/* One tab at a time. Each tab holds its own copy of the database in memory,
 * and each saves its whole progress record, so two open tabs would quietly
 * overwrite each other's answers. The lock is held until the tab closes. */
function claimTab() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request('ferrule-tab', { ifAvailable: true }, (lock) => {
      resolve(Boolean(lock));
      return lock ? new Promise(() => {}) : undefined;
    });
  });
}

/* IndexedDB, or memory when the browser refuses storage (some private
 * windows). The UI warns loudly in the second case. */
async function openKV() {
  try {
    const kv = indexedDbKV();
    await kv.get('probe');
    return kv;
  } catch {
    window.FERRULE_EPHEMERAL = true;
    return memoryKV();
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.body.appendChild(s);
  });
}

try {
  if (!(await claimTab())) {
    stop('ferrule is open in another tab',
      `<p class="sub" style="margin:0">Use that tab, or close it and reload this one. Only one
        tab can have ferrule open at a time, so answers in one cannot overwrite the other's.</p>`);
  } else {
    window.FERRULE_WEB = true;
    if (typeof window.initSqlJs !== 'function') throw new Error('the database engine did not load');
    const SQL = await window.initSqlJs({ locateFile: (f) => `vendor/${f}` });
    const store = await new Store(SQL, await openKV()).open();
    install(createApi(store), window);
    await loadScript('charts.js');
    await loadScript('app.js');
  }
} catch (e) {
  stop('ferrule could not start',
    `<div class="log">${esc(e && e.message ? e.message : e)}</div>
     <p class="sub" style="margin:12px 0 0">ferrule needs a current browser: Chrome, Edge,
       Firefox or Safari from the last few years.</p>`);
}
