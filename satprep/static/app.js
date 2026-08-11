'use strict';

/* satprep front end. Vanilla, no build step.
 *
 * Three things here are worth knowing before reading:
 *
 *  - The exam clock is a countdown for the whole set, pinned to the top of the
 *    window and hideable, the way the real test does it. Per-question timing
 *    still drives the pacing analytics underneath.
 *  - The model is loaded lazily. The header chip is the single place that
 *    reports whether it is resident, and the only place you can evict it.
 *  - A download button IS its own progress bar. There is exactly one element
 *    showing download state, so a partial update cannot desynchronise it.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main');

const api = async (path, opts) => {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
};
const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

const pct = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
const secs = (ms) => (ms ? (ms / 1000).toFixed(0) + 's' : '—');
const gb = (n) => `${n.toFixed(1)} GB`;
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const accColor = (a) =>
  a == null ? 'var(--rule)' : a < 0.55 ? 'var(--bad)' : a < 0.75 ? 'var(--warn)' : 'var(--good)';

/* Inline SVG rather than emoji — emoji render differently on every platform
 * and read as decoration. */
const icon = (d, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
     stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  chev: icon('<path d="m9 18 6-6-6-6"/>'),
  eject: icon('<path d="M5 17h14M12 3 5 13h14L12 3Z"/>', 13),
  spark: icon('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M18.4 5.6l-2.9 2.9M8.5 15.5l-2.9 2.9"/>', 13),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 14),
};

const state = {
  view: 'home', session: null, queue: [], idx: 0, answered: null,
  t0: 0, setEndsAt: 0, clockHidden: false, eliminated: new Set(),
  bank: { page: 1, filters: {}, open: null },
};

// ---------------------------------------------------------------- routing

$$('nav button').forEach((b) => (b.onclick = () => show(b.dataset.view)));

const VIEWS = {};
function show(view) {
  state.view = view;
  $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  main.className = ['analytics', 'bank'].includes(view) ? 'wide' : '';
  if (view !== 'practice') stopClock();
  VIEWS[view]();
}

// ---------------------------------------------------------------- tutor chip

/* One place reports model state, and it is also the eject control. */
async function refreshChip() {
  let rt;
  try { rt = await api('/api/runtime/status'); } catch { return; }
  const el = $('#tutorchip');
  if (!rt.selected) { el.innerHTML = ''; return; }

  const loading = ['engine', 'model', 'starting'].includes(rt.phase);
  const cls = rt.running ? 'live' : loading ? 'loading' : '';
  const label = rt.running
    ? `Tutor loaded${rt.idle_seconds != null ? ` · idle ${Math.floor(rt.idle_seconds / 60)}m` : ''}`
    : loading ? 'Loading…' : 'Tutor ready';

  el.innerHTML = `<span class="chip ${cls}" title="${rt.running
    ? 'The model is in memory. It unloads itself after 10 idle minutes.'
    : 'The model loads the first time you ask a question, and not before.'}">
      <span class="dot"></span>${esc(label)}
      ${rt.running ? `<button id="eject" title="Free the GPU now">${I.eject} eject</button>` : ''}
    </span>`;

  const ej = $('#eject');
  if (ej) ej.onclick = async () => { await post('/api/runtime/eject', {}); refreshChip(); };
}
setInterval(() => { if (!document.hidden) refreshChip(); }, 5000);

// ---------------------------------------------------------------- exam clock

/* Countdown for the whole set, budgeted from the real per-question allowance. */
function startClock(totalSeconds, label) {
  state.setEndsAt = Date.now() + totalSeconds * 1000;
  const head = $('#examhead');
  head.innerHTML = `
    <div class="examhead">
      <span class="side">${esc(label)}</span>
      <span class="clock-wrap">
        <span class="clock" id="clock">${clock(totalSeconds)}</span>
        <button class="clock-toggle" id="clocktoggle">Hide</button>
      </span>
      <span class="side right" id="qcount"></span>
    </div>
    <div class="railbar"><i id="rail" style="width:0%"></i></div>`;

  $('#clocktoggle').onclick = () => {
    state.clockHidden = !state.clockHidden;
    $('#clock').classList.toggle('hidden', state.clockHidden);
    $('#clocktoggle').textContent = state.clockHidden ? 'Show' : 'Hide';
  };
  tickClock();
  clearInterval(state._clock);
  state._clock = setInterval(tickClock, 250);
}

function tickClock() {
  const el = $('#clock');
  if (!el) return clearInterval(state._clock);
  const left = Math.max(0, (state.setEndsAt - Date.now()) / 1000);
  el.textContent = clock(left);
  el.classList.toggle('warn', left <= 300 && left > 60);
  el.classList.toggle('danger', left <= 60);
  const q = $('#qcount');
  if (q) q.textContent = `${Math.min(state.idx + 1, state.queue.length)} of ${state.queue.length}`;
  const rail = $('#rail');
  if (rail) rail.style.width = `${(state.idx / Math.max(1, state.queue.length)) * 100}%`;
}

function stopClock() {
  clearInterval(state._clock);
  $('#examhead').innerHTML = '';
}

// ---------------------------------------------------------------- home

VIEWS.home = async function renderHome() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const [ov, plan, vt] = await Promise.all([
    api('/api/state'), api('/api/plan?minutes=30'), api('/api/vintages'),
  ]);
  $('#bankinfo').textContent = `${ov.bank_size.toLocaleString()} questions`;
  refreshChip();

  if (!ov.bank_size) return renderFirstRun();

  const proj = Object.entries(ov.projection || {});
  main.innerHTML = `
    <h1 class="serif">Where are you losing points?</h1>
    <p class="sub">Practice picked by weakness, exam weighting, and what you have already missed.</p>

    <div class="tiles stagger">
      <div class="tile"><div class="k">Answered</div><div class="v">${ov.attempts}</div>
        <div class="n">${ov.correct} correct</div></div>
      <div class="tile"><div class="k">Accuracy</div>
        <div class="v" style="color:${accColor(ov.accuracy)}">${pct(ov.accuracy)}</div>
        <div class="n">${secs(ov.avg_ms)} average</div></div>
      <div class="tile"><div class="k">Due review</div><div class="v">${ov.due_reviews}</div>
        <div class="n">previously missed</div></div>
      ${proj.length ? `<div class="tile"><div class="k">Rough estimate</div>
        <div class="v">${ov.projection.Total || '—'}</div>
        <div class="n">${proj.filter(([k]) => k !== 'Total').map(([k, v]) => k.slice(0, 4) + ' ' + v).join(' · ')}</div></div>` : ''}
    </div>

    <h3>Next 30 minutes</h3>
    <div class="card">
      ${plan.steps.length
        ? `<ul class="plan">${plan.steps.map((s, i) =>
            `<li><span class="n">${i + 1}</span><span>${esc(s.label)}</span></li>`).join('')}</ul>`
        : '<p class="muted" style="margin:0">Answer a few questions and a plan appears here.</p>'}
    </div>

    <h3>Timed set</h3>
    <div class="card">
      <div class="row">
        <select id="pick-test">
          <option value="">Both sections</option>
          <option value="1">Reading &amp; Writing</option>
          <option value="2">Math</option>
        </select>
        <select id="pick-n">
          <option value="10">10 questions</option>
          <option value="20">20 questions</option>
          <option value="30">30 questions</option>
        </select>
        ${vintageSelect(vt)}
        <button class="primary" id="go">Begin</button>
      </div>
      <p class="sub" style="margin:14px 0 0">
        Runs on a countdown at the real pace — 71s a question in Reading &amp; Writing,
        95s in Math. For untimed browsing, use the question bank.
      </p>
    </div>`;

  wireVintage(VIEWS.home);
  // Read the selections now: the tutor gate replaces this markup, so reading
  // them inside the callback would find nothing.
  $('#go').onclick = () => {
    const test = $('#pick-test').value;
    const n = $('#pick-n').value;
    withTutorChoice(() => startSet({ test, n }));
  };
};

async function renderFirstRun() {
  const st = await api('/api/fetch/status');
  const running = st.phase === 'running';
  main.innerHTML = `
    <h1 class="serif">Welcome</h1>
    <p class="sub">satprep needs the official SAT question bank before you can practise.
      About 3,250 questions, roughly four minutes, once.</p>
    <div class="card">
      ${running || st.phase === 'done' ? `
        <div class="progress" style="margin:4px 0 10px"><div style="width:${st.count ? Math.min(99, (st.count / 3250) * 100) : 4}%"></div></div>
        <p class="sub" style="margin:0">${esc(st.detail || 'Starting…')} — ${st.count.toLocaleString()} stored</p>
      ` : st.phase === 'error' ? `
        <div class="log">${esc(st.error)}</div>
        <button class="primary" id="dl" style="margin-top:12px">Try again</button>
      ` : `
        <label class="srcrow" style="border:0;padding:4px 0 14px">
          <input type="checkbox" id="opensat">
          <span>Also fetch the OpenSAT community bank (~2,340 extra questions, optional)</span>
        </label>
        <button class="primary" id="dl">Download questions</button>
      `}
      <p class="sub" style="margin:16px 0 0">Questions stay on your machine. See ATTRIBUTION.md for sources.</p>
    </div>`;
  const btn = $('#dl');
  if (btn) btn.onclick = async () => {
    await post('/api/fetch/start', { with_opensat: !!($('#opensat') || {}).checked });
    renderFirstRun();
  };
  if (running) setTimeout(() => { if (state.view === 'home') renderFirstRun(); }, 1200);
  if (st.phase === 'done') setTimeout(VIEWS.home, 800);
}

// ---------------------------------------------------------------- practice

const PACE = { 1: 71, 2: 95 };

async function startSet({ test, n, skill } = {}) {
  const params = new URLSearchParams();
  if (n) params.set('n', n);
  if (test) params.set('test', test);
  if (skill) params.set('skill', skill);

  main.innerHTML = '<div class="empty">Building your set…</div>';
  show('practice');

  const [{ questions }, sess] = await Promise.all([
    api('/api/questions?' + params),
    post('/api/session', { mode: skill ? 'drill' : 'practice' }),
  ]);
  state.queue = questions;
  state.idx = 0;
  state.session = sess.session_id;

  const budget = questions.reduce((t, q) => t + (PACE[q.test] || 80), 0);
  startClock(budget, skill ? `Drill · ${skill}` : 'Timed set');
  VIEWS.practice();
}

VIEWS.practice = function renderPractice() {
  if (!state.queue.length) {
    main.innerHTML = `<div class="empty"><p>No set loaded.</p>
      <button class="primary" onclick="document.querySelector('[data-view=home]').click()">Go home</button></div>`;
    return;
  }
  if (state.idx >= state.queue.length) return renderSetDone();

  const q = state.queue[state.idx];
  state.answered = null;
  state.t0 = Date.now();
  state.eliminated = new Set();
  chat.history = [];   // the conversation is about *this* question only

  const isSpr = q.qtype === 'spr';
  main.innerHTML = `
    <div class="card">
      <div class="qmeta">
        <span class="tag ${q.difficulty}">${{ E: 'Easy', M: 'Medium', H: 'Hard' }[q.difficulty] || q.difficulty}</span>
        <span>${esc(q.domain)} · <strong>${esc(q.skill)}</strong></span>
      </div>
      ${q.stimulus ? `<div class="stimulus">${q.stimulus}</div>` : ''}
      <div class="stem">${q.stem}</div>
      ${isSpr
        ? `<div class="spr-entry">
             <input type="text" id="spr" placeholder="Your answer" autocomplete="off" autofocus>
             <button class="primary" id="submit">Check</button>
           </div>
           <p class="sub" style="margin:10px 0 0">Grid-in: a number, e.g. <code>7/2</code> or <code>3.5</code></p>`
        : `<div class="choices">
             ${q.options.map((o) => `
               <button class="choice" data-letter="${o.letter}">
                 <span class="letter">${o.letter}</span><span>${o.content}</span>
               </button>`).join('')}
           </div>`}
      <div id="verdict"></div>
      ${chatPanel()}
    </div>
    <div class="row">
      <button class="quiet" id="skip">Skip</button>
      <div class="spacer"></div>
      <span class="muted hide-sm" style="font-size:12px">
        ${isSpr ? '<span class="kbd">Enter</span> check'
                : '<span class="kbd">A</span>–<span class="kbd">D</span> answer · <span class="kbd">Alt</span>+letter to cross out'}
        · <span class="kbd">Enter</span> next
      </span>
    </div>`;

  tickClock();
  wireChat(() => state.queue[state.idx], () => !!state.answered);
  if (isSpr) $('#submit').onclick = () => submit($('#spr').value);
  else $$('.choice').forEach((b) => (b.onclick = (e) => {
    if (e.altKey) return toggleEliminate(b);
    submit(b.dataset.letter);
  }));
  $('#skip').onclick = next;
};

/* Crossing out a choice is how people actually work a multiple-choice test. */
function toggleEliminate(btn) {
  const l = btn.dataset.letter;
  state.eliminated.has(l) ? state.eliminated.delete(l) : state.eliminated.add(l);
  btn.classList.toggle('eliminated', state.eliminated.has(l));
}

async function submit(response) {
  if (state.answered || !response) return;
  const q = state.queue[state.idx];
  const elapsed = Date.now() - state.t0;

  const res = await post('/api/answer', {
    external_id: q.external_id, response, elapsed_ms: elapsed, session_id: state.session,
  });
  state.answered = res;

  const keys = res.correct_answer.map(String);
  $$('.choice').forEach((b) => {
    b.disabled = true;
    if (keys.includes(b.dataset.letter)) b.classList.add('correct');
    else if (b.dataset.letter === response) b.classList.add('wrong');
  });
  const sprInput = $('#spr');
  if (sprInput) { sprInput.disabled = true; $('#submit').disabled = true; }

  $('#verdict').innerHTML = `
    <div class="verdict ${res.correct ? 'good' : 'bad'}">
      <div class="head">${res.correct ? 'Correct' : 'Incorrect — answer: ' + keys.join(' or ')}
        <span class="muted" style="font-weight:400">· ${secs(elapsed)}</span></div>
      ${res.rationale ? `<div class="rationale">${res.rationale}</div>` : ''}
    </div>
    <div class="row" style="margin-top:15px">
      <button class="primary" id="next">${state.idx + 1 >= state.queue.length ? 'Finish' : 'Next question'}</button>
      <button class="ghost" id="ask">${I.spark} Ask the tutor</button>
      ${!res.correct ? '<span class="muted" style="font-size:12.5px">Queued for review</span>' : ''}
    </div>
    <div id="tutor-out"></div>`;
  $('#next').onclick = next;
  $('#ask').onclick = () => askTutor(q, response, res.correct);
  const hint = $('#chathint'); if (hint) hint.textContent = '';
  $('#next').focus();
}

function next() { state.idx++; VIEWS.practice(); }

async function renderSetDone() {
  stopClock();
  const ov = await api('/api/state');
  main.innerHTML = `
    <div class="card" style="text-align:center;padding:40px 24px">
      <h1 class="serif">Set complete</h1>
      <p class="sub">${state.queue.length} questions. Overall accuracy now ${pct(ov.accuracy)}.</p>
      <div class="row" style="justify-content:center">
        <button class="primary" id="again">Another set</button>
        <button class="ghost" id="tostats">See what to fix</button>
      </div>
    </div>`;
  $('#again').onclick = () => startSet({ n: 10 });
  $('#tostats').onclick = () => show('analytics');
}

// ---------------------------------------------------------------- tutor

/* Models leak markdown and LaTeX no matter how firmly you ask them not to.
 * The prompt asks for plain text; this cleans up whatever still gets through,
 * rather than showing the reader raw \( \) and ** markers. */
function tutorText(raw) {
  let s = esc(raw);
  s = s.replace(/\\[()[\]]/g, '');                  // \( \) \[ \]
  s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\(?:times|cdot)\b/g, '×').replace(/\\sqrt/g, 'sqrt');
  s = s.replace(/\\[a-zA-Z]+/g, '');                 // any other stray command
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\n)\s*#{1,6}\s*/g, '$1');        // stray headings
  return s;
}

async function askTutor(q, response, wasCorrect) {
  const out = $('#tutor-out');
  const btn = $('#ask');
  if (!out) return;
  btn.disabled = true;
  out.innerHTML = `<div class="tutor"><div class="tutor-head">Tutor</div>
    <div class="tutor-body" id="tbody"><span class="caret"></span></div></div>`;
  const body = $('#tbody');

  let res;
  try {
    res = await fetch('/api/tutor/explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_id: q.external_id, response,
        mode: wasCorrect ? 'explain' : 'why_wrong',
      }),
    });
  } catch {
    body.textContent = 'Could not reach the tutor.';
    btn.disabled = false; return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith('data:')) continue;
      let msg; try { msg = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (msg.error) {
        body.innerHTML = `${esc(msg.error)}<br>
          <button class="ghost" style="margin-top:10px"
            onclick="document.querySelector('[data-view=settings]').click()">Open Settings</button>`;
        btn.disabled = false; refreshChip(); return;
      }
      // The model loads on first use; say so rather than looking frozen.
      if (msg.status) { body.innerHTML = `<span class="muted">${esc(msg.status)}</span><span class="caret"></span>`; refreshChip(); }
      if (msg.delta) {
        text += msg.delta;
        body.innerHTML = `${tutorText(text)}<span class="caret"></span>`;
      }
      if (msg.done) body.innerHTML = tutorText(text);
    }
  }
  btn.disabled = false;
  refreshChip();
}

// ---------------------------------------------------------------- question bank

VIEWS.bank = async function renderBank() {
  const f = state.bank.filters;
  const params = new URLSearchParams({ page: state.bank.page, per: 20 });
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);

  if (!$('.qlist')) main.innerHTML = '<div class="empty">Loading…</div>';
  const [data, vt] = await Promise.all([api('/api/bank?' + params), api('/api/vintages')]);

  const skills = data.facets.skills;
  const domains = [...new Set(skills.map((s) => s.domain))];

  main.innerHTML = `
    <h1 class="serif">Question bank</h1>
    <p class="sub">Every question, no clock and no scoring. Look things up, read the
      official explanation, work at whatever speed suits you.</p>

    <div class="bankbar">
      <input type="search" id="bq" placeholder="Search question text…" value="${esc(f.q || '')}">
      <select id="bsec">
        <option value="">Both sections</option>
        <option value="1" ${f.test === '1' ? 'selected' : ''}>Reading &amp; Writing</option>
        <option value="2" ${f.test === '2' ? 'selected' : ''}>Math</option>
      </select>
      <select id="bdom">
        <option value="">All domains</option>
        ${domains.map((d) => `<option value="${esc(d)}" ${f.domain === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
      </select>
      <select id="bdiff">
        <option value="">Any difficulty</option>
        ${[['E', 'Easy'], ['M', 'Medium'], ['H', 'Hard']].map(([v, l]) =>
          `<option value="${v}" ${f.difficulty === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select id="bsrc">
        <option value="">All sources</option>
        ${data.facets.sources.map((s) =>
          `<option value="${s.source}" ${f.source === s.source ? 'selected' : ''}>${s.source} (${s.n})</option>`).join('')}
      </select>
      <select id="bseen">
        <option value="">Seen or not</option>
        <option value="unseen" ${f.unseen ? 'selected' : ''}>Not attempted</option>
        <option value="missed" ${f.missed ? 'selected' : ''}>Previously missed</option>
      </select>
      <select id="bsince" title="When College Board added the question. Community questions carry no date and are excluded when this is set.">
        <option value="">Any date added</option>
        ${vt.vintages.map((v) => `<option value="${v.starts_at}" ${String(f.since) === String(v.starts_at) ? 'selected' : ''}>
          Added ${v.batch} or later (${v.total})</option>`).join('')}
      </select>
    </div>

    <div class="row" style="margin-bottom:16px">
      <button class="primary" id="flowgo">Start</button>
      <span class="sub" style="margin:0">
        ${data.total.toLocaleString()} matching · one at a time, no clock, keyboard only
      </span>
      <span class="spacer"></span>
      <span class="sub" style="margin:0">page ${data.page} of ${data.pages}</span>
    </div>

    <div class="qlist stagger">
      ${data.items.map((q, i) => qCard(q, i)).join('') ||
        '<div class="empty">Nothing matches those filters.</div>'}
    </div>

    <div class="pager">
      <button class="ghost" id="prev" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="at">${data.page} / ${data.pages}</span>
      <button class="ghost" id="nextp" ${data.page >= data.pages ? 'disabled' : ''}>Next</button>
    </div>`;

  const setF = (k, v) => { f[k] = v || ''; state.bank.page = 1; VIEWS.bank(); };
  $('#bsec').onchange = (e) => setF('test', e.target.value);
  $('#bdom').onchange = (e) => setF('domain', e.target.value);
  $('#bdiff').onchange = (e) => setF('difficulty', e.target.value);
  $('#bsrc').onchange = (e) => setF('source', e.target.value);
  $('#bseen').onchange = (e) => {
    f.unseen = e.target.value === 'unseen' ? '1' : '';
    f.missed = e.target.value === 'missed' ? '1' : '';
    state.bank.page = 1; VIEWS.bank();
  };
  $('#bsince').onchange = (e) => setF('since', e.target.value);
  $('#flowgo').onclick = () => withTutorChoice(flowStart);

  let deb;
  const search = $('#bq');
  search.oninput = (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => setF('q', e.target.value.trim()), 320);
  };

  $('#prev').onclick = () => { state.bank.page--; VIEWS.bank(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('#nextp').onclick = () => { state.bank.page++; VIEWS.bank(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  $$('.qcard-head').forEach((h) => (h.onclick = () => h.closest('.qcard').classList.toggle('open')));
  $$('[data-reveal]').forEach((b) => (b.onclick = () => {
    $(`#ans-${b.dataset.reveal}`).style.display = 'block';
    b.remove();
  }));
};

function qCard(q, i) {
  const plain = (q.stem || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const id = q.external_id.replace(/[^a-z0-9]/gi, '');
  const status = q.attempts
    ? `<span class="pill ${q.correct === q.attempts ? 'ok' : ''}">${q.correct}/${q.attempts}</span>`
    : '';
  return `
    <div class="qcard">
      <button class="qcard-head">
        <span class="chev">${I.chev}</span>
        <span class="tag ${q.difficulty}">${q.difficulty}</span>
        <span class="txt">${esc(plain).slice(0, 150) || '(figure-based question)'}</span>
        <span class="muted hide-sm" style="font-size:11.5px">${esc(q.skill)}</span>
        ${status}
      </button>
      <div class="qcard-body"><div><div class="qcard-inner">
        ${q.stimulus ? `<div class="stimulus">${q.stimulus}</div>` : ''}
        <div class="stem">${q.stem}</div>
        ${q.options.length ? `<div class="choices">${q.options.map((o) => `
          <div class="choice" style="cursor:default">
            <span class="letter">${o.letter}</span><span>${o.content}</span>
          </div>`).join('')}</div>` : ''}
        <button class="ghost" style="margin-top:14px" data-reveal="${id}">Show answer</button>
        <div id="ans-${id}" style="display:none">
          <div class="verdict good" style="margin-top:14px">
            <div class="head">Answer: ${esc(q.correct_answer.join(' or '))}</div>
            ${q.rationale ? `<div class="rationale">${q.rationale}</div>` : ''}
          </div>
        </div>
      </div></div></div>
    </div>`;
}

// ---------------------------------------------------------------- tutor gate

/* Asked once per app run, before the first session: do you want a tutor, and
 * which one? Loading a 5 GB model is not a decision to make on someone's
 * behalf, and it is a bad surprise on a modest machine. "Not this time" is a
 * first-class answer and is remembered for the run. */
let tutorAsked = false;

async function withTutorChoice(startFn) {
  if (tutorAsked) return startFn();
  const rt = await api('/api/runtime/status');
  if (rt.selected || rt.running) { tutorAsked = true; return startFn(); }

  const installed = new Set(rt.installed_models);
  const fits = (m) => rt.vram_gb == null ? '' :
    m.vram_gb <= rt.vram_gb - 1 ? '<span class="pill fit">fits</span>' :
    m.vram_gb <= rt.vram_gb + 0.5 ? '<span class="pill tight">tight</span>' :
    '<span class="pill toobig">too big</span>';

  const ordered = [...rt.models].sort((a, b) =>
    (installed.has(b.id) - installed.has(a.id)) || (b.recommended - a.recommended));

  main.innerHTML = `
    <h1 class="serif">Study with a tutor?</h1>
    <p class="sub">
      A local model can answer your questions while you work — nothing leaves your
      machine. It loads only when you first ask something and unloads when you stop,
      so it is not sitting on your ${rt.vram_gb ? 'GPU' : 'CPU'} while you read.
      You can skip this and turn it on later in Settings.
    </p>
    <div class="card">
      <button class="primary" id="notutor" style="width:100%;justify-content:center">
        Continue without a tutor
      </button>
    </div>
    <h3>Or pick a model</h3>
    <div class="models stagger">
      ${ordered.map((m) => `
        <div class="model ${m.recommended ? 'rec' : ''}">
          <div class="model-head">
            <div><strong>${esc(m.name)}</strong>
              ${m.recommended ? '<span class="pill rec">recommended</span>' : ''}
              ${installed.has(m.id) ? '<span class="pill ok">downloaded</span>' : ''}
              ${fits(m)}
            </div>
            <div class="muted" style="font-size:12px;margin-top:3px">
              ${m.params} · ${gb(m.size_gb)} · ${esc(m.best_for)}
            </div>
          </div>
          <div class="model-body">
            <ul class="pros">${m.pros.slice(0, 2).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
            <ul class="cons">${m.cons.slice(0, 2).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          </div>
          <button class="primary" data-pick="${m.id}">
            ${installed.has(m.id) ? 'Use this' : `Download &amp; use · ${gb(m.size_gb)}`}
          </button>
        </div>`).join('')}
    </div>`;

  $('#notutor').onclick = () => { tutorAsked = true; startFn(); };
  $$('[data-pick]').forEach((b) => (b.onclick = async () => {
    tutorAsked = true;
    await post('/api/runtime/start', { model_id: b.dataset.pick });
    // Downloading runs in the background; start practising immediately.
    refreshChip();
    startFn();
  }));
}

// ---------------------------------------------------------------- tutor chat

/* A conversation about the question you are looking at. Before you answer the
 * tutor hints only; afterwards it explains fully. The server enforces that
 * split — the client cannot ask it to give the game away early. */
const chat = { history: [], open: false, busy: false };

function chatPanel() {
  return `
    <div class="chat ${chat.open ? 'open' : ''}" id="chat">
      <button class="chat-toggle" id="chattoggle">
        ${I.spark}<span>${chat.open ? 'Hide tutor' : 'Ask the tutor'}</span>
        <span class="muted" id="chathint"></span>
      </button>
      <div class="chat-body">
        <div>
          <div class="chat-log" id="chatlog">${chat.history.map(msgHTML).join('')}</div>
          <form class="chat-form" id="chatform">
            <input type="text" id="chatinput" autocomplete="off"
                   placeholder="Ask about this question…">
            <button class="primary" type="submit" ${chat.busy ? 'disabled' : ''}>Send</button>
          </form>
        </div>
      </div>
    </div>`;
}

const msgHTML = (m) =>
  `<div class="msg ${m.role}"><span class="who">${m.role === 'user' ? 'You' : 'Tutor'}</span>
     <div class="what">${m.role === 'user' ? esc(m.content) : tutorText(m.content)}</div></div>`;

function wireChat(getQuestion, isAnswered) {
  const toggle = $('#chattoggle');
  if (!toggle) return;
  const hint = $('#chathint');
  if (hint) hint.textContent = isAnswered() ? '' : 'hints only until you answer';

  toggle.onclick = () => {
    chat.open = !chat.open;
    $('#chat').classList.toggle('open', chat.open);
    toggle.querySelector('span').textContent = chat.open ? 'Hide tutor' : 'Ask the tutor';
    if (chat.open) setTimeout(() => $('#chatinput')?.focus(), 120);
  };

  $('#chatform').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#chatinput');
    const text = input.value.trim();
    if (!text || chat.busy) return;
    input.value = '';
    chat.busy = true;
    chat.history.push({ role: 'user', content: text });
    chat.history.push({ role: 'assistant', content: '' });
    const log = $('#chatlog');
    log.innerHTML = chat.history.map(msgHTML).join('');
    log.scrollTop = log.scrollHeight;
    const bubble = log.lastElementChild.querySelector('.what');
    bubble.innerHTML = '<span class="caret"></span>';

    let res;
    try {
      res = await fetch('/api/tutor/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_id: getQuestion().external_id,
          answered: isAnswered(),
          history: chat.history.slice(0, -1),
        }),
      });
    } catch {
      bubble.textContent = 'Could not reach the tutor.';
      chat.busy = false; return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text2 = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts) {
        const line = p.trim();
        if (!line.startsWith('data:')) continue;
        let msg; try { msg = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (msg.error) {
          bubble.innerHTML = `${esc(msg.error)} <button class="ghost" style="margin-top:8px"
            onclick="document.querySelector('[data-view=settings]').click()">Settings</button>`;
          chat.busy = false; refreshChip(); return;
        }
        if (msg.status) bubble.innerHTML = `<span class="muted">${esc(msg.status)}</span><span class="caret"></span>`;
        if (msg.delta) {
          text2 += msg.delta;
          bubble.innerHTML = tutorText(text2) + '<span class="caret"></span>';
          log.scrollTop = log.scrollHeight;
        }
      }
    }
    chat.history[chat.history.length - 1].content = text2;
    bubble.innerHTML = tutorText(text2);
    chat.busy = false;
    refreshChip();
    $('#chatinput')?.focus();
  };
}

// ---------------------------------------------------------------- flow

/* An uninterrupted run through the bank.
 *
 * The design goal is concentration, so everything that breaks it is removed:
 * no countdown, no set length, no "well done" screen, no navigation, and above
 * all no waiting — questions are buffered ahead so the next one is already
 * there. Correct answers advance on their own after a short beat to keep the
 * rhythm; a wrong answer stops and waits, because that is the moment worth
 * spending time on.
 */
const flow = {
  on: false, queue: [], current: null, answered: null,
  streak: 0, best: 0, done: 0, correct: 0, seen: [],
  autoAdvance: true, t0: 0, timer: null,
};

async function flowFill() {
  const p = new URLSearchParams({ n: 25 });
  for (const [k, v] of Object.entries(state.bank.filters)) if (v) p.set(k, v);
  // Do not serve back what this run has already shown.
  if (flow.seen.length) p.set('exclude', flow.seen.slice(-120).join(','));
  try {
    const { questions } = await api('/api/bank/queue?' + p);
    const have = new Set(flow.queue.map((q) => q.external_id));
    flow.queue.push(...questions.filter((q) => !have.has(q.external_id)));
  } catch { /* keep whatever is buffered */ }
}

async function flowStart() {
  flow.on = true;
  Object.assign(flow, { queue: [], streak: 0, best: 0, done: 0, correct: 0, seen: [] });
  document.body.classList.add('focus-mode');
  show('flow');
  main.innerHTML = '<div class="empty">…</div>';
  await flowFill();
  if (!flow.queue.length) {
    flowExit();
    return alert('No questions match those filters.');
  }
  const sess = await post('/api/session', { mode: 'flow' });
  state.session = sess.session_id;
  flowNext();
}

function flowExit() {
  flow.on = false;
  clearTimeout(flow.timer);
  document.body.classList.remove('focus-mode');
  show('bank');
}

VIEWS.flow = function () { if (flow.current) flowRender(); };

function flowNext() {
  clearTimeout(flow.timer);
  flow.answered = null;
  chat.history = [];
  flow.current = flow.queue.shift();
  if (!flow.current) { flowFill().then(() => flow.queue.length ? flowNext() : flowExit()); return; }
  flow.seen.push(flow.current.external_id);
  if (flow.queue.length < 6) flowFill();          // refill before it can run dry
  flow.t0 = Date.now();
  flowRender();
}

function flowRender() {
  const q = flow.current;
  const isSpr = q.qtype === 'spr';
  main.innerHTML = `
    <div class="flowwrap">
      <div class="flowmeta">
        <span class="tag ${q.difficulty}">${{ E: 'Easy', M: 'Medium', H: 'Hard' }[q.difficulty] || q.difficulty}</span>
        <span>${esc(q.skill)}</span>
        <span class="spacer"></span>
        <span class="streak ${flow.streak >= 3 ? 'hot' : ''}" id="streak">${flow.streak}</span>
      </div>
      ${q.stimulus ? `<div class="stimulus">${q.stimulus}</div>` : ''}
      <div class="stem">${q.stem}</div>
      ${isSpr
        ? `<div class="spr-entry">
             <input type="text" id="spr" placeholder="Answer" autocomplete="off" autofocus>
           </div>`
        : `<div class="choices">
             ${q.options.map((o) => `
               <button class="choice" data-letter="${o.letter}">
                 <span class="letter">${o.letter}</span><span>${o.content}</span>
               </button>`).join('')}
           </div>`}
      <div id="fv"></div>
      ${chatPanel()}
      <div class="flowfoot">
        <span>${isSpr ? '<span class="kbd">Enter</span> answer' : '<span class="kbd">A</span>–<span class="kbd">D</span>'}
          · <span class="kbd">Space</span> next · <span class="kbd">Esc</span> exit</span>
        <span class="spacer"></span>
        <span>${flow.done ? `${flow.correct}/${flow.done} · best streak ${flow.best}` : ''}</span>
      </div>
    </div>`;

  wireChat(() => flow.current, () => !!flow.answered);
  if (isSpr) $('#spr').focus();
  else $$('.choice').forEach((b) => (b.onclick = () => flowAnswer(b.dataset.letter)));
}

async function flowAnswer(response) {
  if (flow.answered || !response) return;
  const q = flow.current;
  const elapsed = Date.now() - flow.t0;

  const res = await post('/api/answer', {
    external_id: q.external_id, response, elapsed_ms: elapsed, session_id: state.session,
  });
  flow.answered = res;
  flow.done++;
  if (res.correct) {
    flow.correct++; flow.streak++;
    flow.best = Math.max(flow.best, flow.streak);
  } else {
    flow.streak = 0;
  }

  const keys = res.correct_answer.map(String);
  $$('.choice').forEach((b) => {
    b.disabled = true;
    if (keys.includes(b.dataset.letter)) b.classList.add('correct');
    else if (b.dataset.letter === response) b.classList.add('wrong');
  });
  const sp = $('#spr');
  if (sp) { sp.disabled = true; sp.classList.add(res.correct ? 'ok' : 'no'); }

  const st = $('#streak');
  if (st) {
    st.textContent = flow.streak;
    st.classList.toggle('hot', flow.streak >= 3);
    st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
  }

  /* Right: a brief beat, then move — the rhythm is the point.
     Wrong: stop, show the official explanation, wait to be told to continue. */
  if (res.correct) {
    $('#fv').innerHTML = `<div class="flowok">Correct <span class="muted">· ${secs(elapsed)}</span></div>`;
    if (flow.autoAdvance) flow.timer = setTimeout(flowNext, 620);
  } else {
    $('#fv').innerHTML = `
      <div class="verdict bad">
        <div class="head">Answer: ${keys.join(' or ')}</div>
        ${res.rationale ? `<div class="rationale">${res.rationale}</div>` : ''}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="primary" id="fnext">Continue</button>
        <button class="ghost" id="fask">${I.spark} Ask the tutor</button>
      </div>
      <div id="tutor-out"></div>`;
    $('#fnext').onclick = flowNext;
    $('#fnext').focus();
    $('#fask').onclick = () => askTutor(q, response, false);
  }
}

// ---------------------------------------------------------------- analytics

VIEWS.analytics = async function renderAnalytics() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const a = await api('/api/analytics');

  if (!a.overview.attempts) {
    main.innerHTML = `<div class="empty"><p>Analytics need data.</p>
      <button class="primary" onclick="document.querySelector('[data-view=home]').click()">Start practising</button></div>`;
    return;
  }
  const targets = [{ secs: 71, label: 'R&W 71s' }, { secs: 95, label: 'Math 95s' }];

  main.innerHTML = `
    <h1 class="serif">Analytics</h1>
    <p class="sub">Accuracy and pace at the finest grain the data allows.</p>

    <h3>Accuracy by skill and difficulty</h3>
    <div class="card">
      <p class="sub">A row that is strong on the left and weak on the right is a skill you
        have, but not yet at exam difficulty — a different fix from missing it everywhere.</p>
      ${CH.heatmap(a.matrix, a.target_accuracy)}
    </div>

    <h3>Accuracy at each difficulty</h3>
    <div class="card">${CH.difficultyBars(a.difficulty)}</div>

    <h3>Where your time goes</h3>
    <div class="card">${CH.timeHistogram(a.time_distribution, targets)}</div>

    <h3>Pace against the real budget</h3>
    <div class="card">${CH.paceBars(a.difficulty)}</div>

    <h3>Work done</h3>
    <div class="card">${CH.timeline(a.timeline)}</div>

    <h3>Weakest skills</h3>
    <div class="card">
      <ul class="plan">${a.weakest.map((w, i) => `<li>
        <span class="n">${i + 1}</span>
        <span><strong>${esc(w.skill)}</strong>
          <span class="muted">· ${esc(w.reason)} · ${esc(w.test_name)}</span></span>
        <div class="spacer"></div>
        <button class="ghost" data-skill="${esc(w.skill)}">Drill</button>
      </li>`).join('')}</ul>
    </div>`;

  $$('[data-skill]').forEach((b) => (b.onclick = () => startSet({ skill: b.dataset.skill, n: 10 })));
};

// ---------------------------------------------------------------- vintage

function vintageSelect(vt) {
  if (!vt || !vt.vintages || !vt.vintages.length) return '';
  const opts = vt.vintages.filter((v) => v.available > 0).map((v, i) =>
    `<option value="${v.starts_at}" ${vt.min_created === v.starts_at ? 'selected' : ''}>${
      i === 0 ? `Newest (${v.batch}) — ${v.cumulative_available}`
              : `${v.batch} onward — ${v.cumulative_available}`}</option>`);
  return `<select id="pick-vintage" title="Only questions added on or after this date">
      <option value="0" ${!vt.min_created ? 'selected' : ''}>All vintages</option>
      ${opts.join('')}
    </select>`;
}

function wireVintage(after) {
  const sel = $('#pick-vintage');
  if (!sel) return;
  sel.onchange = async () => {
    await post('/api/vintages', { min_created: Number(sel.value) });
    after();
  };
}

// ---------------------------------------------------------------- settings

VIEWS.settings = async function renderSettings() {
  if (!$('.models')) main.innerHTML = '<div class="empty">Loading…</div>';
  const [rt, tc, src] = await Promise.all([
    api('/api/runtime/status'), api('/api/tutor/config'), api('/api/sources'),
  ]);

  const installed = new Set(rt.installed_models);
  const vram = rt.vram_gb;
  const busy = ['engine', 'model', 'starting'].includes(rt.phase);

  const fitOf = (m) =>
    vram == null ? '' :
    m.vram_gb <= vram - 1 ? '<span class="pill fit">fits your GPU</span>' :
    m.vram_gb <= vram + 0.5 ? '<span class="pill tight">tight</span>' :
    '<span class="pill toobig">needs more VRAM</span>';

  main.innerHTML = `
    <h1 class="serif">Settings</h1>

    <h3>AI tutor</h3>
    <div class="card">
      <p class="sub" style="margin:0 0 6px">
        Optional — everything else works without it. Pick a model and satprep fetches
        the engine and the weights itself. Nothing to install, no terminal, no account.
      </p>
      <p class="sub" style="margin:0">
        The model is <strong>not</strong> kept in memory: it loads the first time you ask a
        question and unloads after ten idle minutes, so it is not sitting on your GPU
        while you read. Eject it any time from the header.
      </p>
      <p class="sub" style="margin:10px 0 0">
        Detected <strong>${esc(rt.accelerator.label)}</strong>${vram ? ` · ${vram} GB VRAM` : ''}
        · files in <code>${esc(rt.data_dir)}</code>
      </p>
    </div>

    ${rt.phase === 'error' ? `<div class="card" style="border-color:var(--bad)">
      <strong>Setup failed</strong><div class="log">${esc(rt.error)}</div></div>` : ''}

    <div class="models stagger">
      ${rt.models.map((m) => {
        const has = installed.has(m.id);
        const isSel = rt.selected === m.id;
        const thisBusy = busy && rt.model_id === m.id;
        return `
        <div class="model ${m.recommended ? 'rec' : ''} ${isSel ? 'active' : ''}">
          <div class="model-head">
            <div><strong>${esc(m.name)}</strong>
              ${m.recommended ? '<span class="pill rec">recommended</span>' : ''}
              ${isSel ? '<span class="pill ok">in use</span>' : has ? '<span class="pill">downloaded</span>' : ''}
              ${fitOf(m)}
            </div>
            <div class="muted" style="font-size:12px;margin-top:3px">
              ${m.params} · ${gb(m.size_gb)} · ${esc(m.best_for)} · ${esc(m.licence)}
            </div>
          </div>
          <div class="model-body">
            <ul class="pros">${m.pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
            <ul class="cons">${m.cons.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          </div>
          <div class="row">
            <button class="primary dl" data-start="${m.id}" data-busy="${thisBusy ? 1 : 0}"
              ${busy ? 'disabled' : ''}>
              <span class="fill" style="width:${thisBusy ? (rt.progress * 100).toFixed(1) : 0}%"></span>
              <span class="lbl">${thisBusy
                ? `<span class="spin"></span>${esc(rt.detail || 'Working…')}`
                : has ? 'Use this model' : `Download &amp; use · ${gb(m.size_gb)}`}</span>
            </button>
            ${has && !isSel ? `<button class="ghost" data-del="${m.id}" ${busy ? 'disabled' : ''}>Delete</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>

    <h3>Already run Ollama, LM Studio, or a hosted API?</h3>
    <div class="card">
      <p class="sub">Point satprep at it instead of downloading anything.</p>
      <div class="row">
        <select id="prov">
          ${tc.providers.map((p) => `<option value="${p.id}" ${tc.config.provider === p.id ? 'selected' : ''}>
            ${esc(p.name)}${p.kind === 'external' ? ' — external' : ''}</option>`).join('')}
        </select>
        <input type="text" id="model" placeholder="model name" value="${esc(tc.config.model || '')}">
      </div>
      <div class="row" style="margin-top:9px">
        <input type="text" id="baseurl" placeholder="base URL (blank = default)"
               value="${esc(tc.config.base_url || '')}" style="flex:2">
        <input type="text" id="apikey" placeholder="${tc.config.has_key ? 'key saved — blank keeps it' : 'API key (external only)'}" style="flex:1">
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="save-tutor">Save</button>
        <button class="ghost" id="test-tutor">Test connection</button>
        <span id="tutor-result" class="muted" style="font-size:13px"></span>
      </div>
      <p class="sub" style="margin:12px 0 0">
        Keys live in <code>~/.config/satprep/config.json</code>, owner-only, never in the database or the repo.
      </p>
    </div>

    <h3>Question vintage</h3>
    <div class="card">
      <p class="sub">College Board adds questions in batches. The newest batch is the closest
        thing to what the current exam looks like.</p>
      <div class="row" style="margin-bottom:14px">
        ${vintageSelect({ vintages: src.vintages, min_created: src.min_created })}
      </div>
      <table>
        <thead><tr><th>Added</th><th class="num">Questions</th>
          <th class="num">Available</th><th class="num">Total if cut off here</th></tr></thead>
        <tbody>${src.vintages.map((v) => `<tr>
          <td>${esc(v.batch)}</td><td class="num">${v.total}</td>
          <td class="num">${v.available}${v.available === 0 ? ' <span class="muted">(reserved)</span>' : ''}</td>
          <td class="num">${v.cumulative_available}</td></tr>`).join('')}</tbody>
      </table>
    </div>

    <h3>Question sources</h3>
    <div class="card">
      ${src.sources.map((s) => `
        <label class="srcrow">
          <input type="checkbox" data-src="${s.source}" ${s.enabled ? 'checked' : ''}>
          <span><strong>${esc(s.name)}</strong>
            <span class="pill ${s.official ? 'ok' : ''}">${s.official ? 'official' : 'community'}</span>
            <span class="muted"> · ${s.bank.toLocaleString()} questions</span><br>
            <span class="muted" style="font-size:12px">${esc((src.catalog.find((c) => c.id === s.source) || {}).why || '')}</span><br>
            <a href="${esc(s.url)}" target="_blank" rel="noreferrer noopener" style="font-size:11.5px">${esc(s.url)}</a>
          </span>
        </label>`).join('')}
      ${src.not_fetched.map((n) => `
        <div class="srcrow off"><span style="width:16px"></span>
          <span><strong>${esc(n.name)}</strong> <span class="pill">not fetched, by design</span><br>
            <span class="muted" style="font-size:12px">${esc(n.reason)}</span><br>
            <span class="muted" style="font-size:12px">${esc(n.status)}</span>
          </span></div>`).join('')}
    </div>`;

  wireVintage(VIEWS.settings);
  $$('[data-start]').forEach((b) => (b.onclick = async () => {
    await post('/api/runtime/start', { model_id: b.dataset.start });
    pollRuntime();
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    await post('/api/runtime/delete', { model_id: b.dataset.del });
    VIEWS.settings();
  }));

  $('#save-tutor').onclick = async () => {
    await post('/api/tutor/config', {
      enabled: true, provider: $('#prov').value, model: $('#model').value.trim(),
      base_url: $('#baseurl').value.trim(), api_key: $('#apikey').value.trim(),
    });
    $('#tutor-result').textContent = 'Saved.';
  };
  $('#test-tutor').onclick = async () => {
    $('#tutor-result').textContent = 'Testing…';
    const h = await api('/api/tutor/health');
    $('#tutor-result').textContent = h.ok
      ? `Connected · ${h.models.length} model(s).` : `Failed: ${h.error}`;
  };
  $$('[data-src]').forEach((cb) => (cb.onchange = async () => {
    const enabled = $$('[data-src]').filter((x) => x.checked).map((x) => x.dataset.src);
    const res = await fetch('/api/sources', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then((r) => r.json());
    if (res.error) { alert(res.error); cb.checked = true; }
  }));

  if (busy) pollRuntime();
};

/* Progress lives in exactly one element — the button's own fill and label — so
 * the bar and the number cannot disagree with each other. */
let rtTimer = null;
function pollRuntime() {
  clearTimeout(rtTimer);
  rtTimer = setTimeout(async () => {
    if (state.view !== 'settings') return;
    const rt = await api('/api/runtime/status');
    const busy = ['engine', 'model', 'starting'].includes(rt.phase);
    const btn = $(`[data-start="${rt.model_id}"]`);
    if (busy && btn) {
      btn.dataset.busy = '1';
      btn.querySelector('.fill').style.width = `${(rt.progress * 100).toFixed(1)}%`;
      btn.querySelector('.lbl').innerHTML =
        `<span class="spin"></span>${esc(rt.detail || 'Working…')}`;
      pollRuntime();
    } else {
      VIEWS.settings();
      refreshChip();
    }
  }, 700);
}

// ---------------------------------------------------------------- keyboard

/* Flow keys are handled first and never fall through to the practice bindings. */
document.addEventListener('keydown', (e) => {
  if (!flow.on) return;
  const typing = document.activeElement?.tagName === 'INPUT';

  if (e.key === 'Escape') { e.preventDefault(); return flowExit(); }
  if (e.key === 'Enter' && typing) { e.preventDefault(); return flowAnswer($('#spr').value); }
  if ((e.key === ' ' || e.key === 'Enter') && flow.answered) { e.preventDefault(); return flowNext(); }
  if (typing || flow.answered) return;

  const k = e.key.toUpperCase();
  const letter = 'ABCD'.includes(k) ? k : '1234'.includes(k) ? 'ABCD'['1234'.indexOf(k)] : null;
  if (letter && main.querySelector(`.choice[data-letter="${letter}"]`)) {
    e.preventDefault();
    flowAnswer(letter);
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (state.view !== 'practice') return;
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';

  if (e.key === 'Enter') {
    if (state.answered) { e.preventDefault(); return next(); }
    if (typing) { e.preventDefault(); return submit(document.activeElement.value); }
    return;
  }
  if (typing || state.answered) return;

  const k = e.key.toUpperCase();
  const letter = 'ABCD'.includes(k) ? k : '1234'.includes(k) ? 'ABCD'['1234'.indexOf(k)] : null;
  if (!letter) return;
  const btn = main.querySelector(`.choice[data-letter="${letter}"]`);
  if (!btn) return;
  e.preventDefault();
  if (e.altKey) toggleEliminate(btn);
  else submit(letter);
});

show('home');
refreshChip();
