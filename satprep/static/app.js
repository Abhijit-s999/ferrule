'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
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

const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');
const secs = (ms) => (ms ? (ms / 1000).toFixed(0) + 's' : '—');
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Accuracy -> colour, red through amber to green.
const accColor = (a) =>
  a === null || a === undefined ? 'var(--border)'
    : a < 0.55 ? 'var(--bad)'
    : a < 0.75 ? 'var(--warn)'
    : 'var(--good)';

const state = { view: 'home', session: null, queue: [], idx: 0, answered: null, t0: 0, picked: null };

// ---------------------------------------------------------------- navigation

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => show(b.dataset.view);
});

function show(view) {
  state.view = view;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  main.className = view === 'stats' ? 'wide' : '';
  ({ home: renderHome, practice: renderPractice, stats: renderStats }[view])();
}

// ---------------------------------------------------------------- home

async function renderHome() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const [ov, plan] = await Promise.all([api('/api/state'), api('/api/plan?minutes=30')]);
  $('#bankinfo').textContent = `${ov.bank_size.toLocaleString()} questions`;

  if (!ov.bank_size) {
    main.innerHTML = `<div class="card"><h2>No questions yet</h2>
      <p class="sub">Download the official question bank first:</p>
      <pre class="card" style="font-family:var(--mono);font-size:13px">./satprep.py fetch</pre></div>`;
    return;
  }

  const proj = Object.entries(ov.projection || {});
  main.innerHTML = `
    <div class="tiles">
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
        ? `<ul class="plan">${plan.steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${esc(s.label)}</span></li>`).join('')}</ul>`
        : '<p class="muted" style="margin:0">Answer a few questions and a plan will appear here.</p>'}
    </div>

    <h3>Start a set</h3>
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
        <button class="primary" id="go">Start</button>
      </div>
      <p class="sub" style="margin:14px 0 0">
        Questions are chosen by weakness, exam weighting, and anything you previously missed that is due for review.
      </p>
    </div>`;

  $('#go').onclick = () => startSet({ test: $('#pick-test').value, n: $('#pick-n').value });
}

// ---------------------------------------------------------------- practice

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
  renderPractice();
}

function renderPractice() {
  if (!state.queue.length) {
    main.innerHTML = `<div class="empty"><p>No set loaded.</p>
      <button class="primary" onclick="location.reload()">Go home</button></div>`;
    return;
  }
  if (state.idx >= state.queue.length) return renderSetDone();

  const q = state.queue[state.idx];
  state.answered = null;
  state.picked = null;
  state.t0 = Date.now();

  const isSpr = q.qtype === 'spr';
  main.innerHTML = `
    <div class="progress"><div style="width:${(state.idx / state.queue.length) * 100}%"></div></div>
    <div class="card">
      <div class="qmeta">
        <span class="tag ${q.difficulty}">${{ E: 'Easy', M: 'Medium', H: 'Hard' }[q.difficulty] || q.difficulty}</span>
        <span>${esc(q.domain)} · <strong>${esc(q.skill)}</strong></span>
        <span class="timer" id="timer">0:00</span>
      </div>
      ${q.stimulus ? `<div class="stimulus">${q.stimulus}</div>` : ''}
      <div class="stem">${q.stem}</div>
      ${isSpr
        ? `<div class="spr-entry">
             <input type="text" id="spr" placeholder="Your answer" autocomplete="off" autofocus>
             <button class="primary" id="submit">Check</button>
           </div>
           <p class="sub" style="margin:10px 0 0">Grid-in: type a number, e.g. <code>7/2</code> or <code>3.5</code></p>`
        : `<div class="choices">
             ${q.options.map((o, i) => `
               <button class="choice" data-letter="${o.letter}">
                 <span class="letter">${o.letter}</span>
                 <span>${o.content}</span>
               </button>`).join('')}
           </div>`}
      <div id="verdict"></div>
    </div>
    <div class="row">
      <span class="muted" style="font-size:13px">Question ${state.idx + 1} of ${state.queue.length}</span>
      <div class="spacer"></div>
      <span class="muted" style="font-size:12.5px" class="hide-sm">
        ${isSpr ? '<span class="kbd">Enter</span> check' : '<span class="kbd">A</span>–<span class="kbd">D</span> answer'}
        · <span class="kbd">Enter</span> next
      </span>
    </div>`;

  const target = q.test === 2 ? 95 : 71;
  clearInterval(state._tick);
  state._tick = setInterval(() => {
    const el = $('#timer');
    if (!el) return clearInterval(state._tick);
    const s = Math.floor((Date.now() - state.t0) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('over', s > target);
  }, 250);

  if (isSpr) $('#submit').onclick = () => submit($('#spr').value);
  else main.querySelectorAll('.choice').forEach((b) => (b.onclick = () => submit(b.dataset.letter)));
}

async function submit(response) {
  if (state.answered || !response) return;
  clearInterval(state._tick);
  const q = state.queue[state.idx];
  const elapsed = Date.now() - state.t0;
  state.picked = response;

  const res = await post('/api/answer', {
    external_id: q.external_id,
    response,
    elapsed_ms: elapsed,
    session_id: state.session,
  });
  state.answered = res;

  const keys = res.correct_answer.map(String);
  main.querySelectorAll('.choice').forEach((b) => {
    b.disabled = true;
    const l = b.dataset.letter;
    if (keys.includes(l)) b.classList.add('correct');
    else if (l === response) b.classList.add('wrong');
  });
  const sprInput = $('#spr');
  if (sprInput) {
    sprInput.disabled = true;
    const btn = $('#submit');
    if (btn) btn.disabled = true;
  }

  $('#verdict').innerHTML = `
    <div class="verdict ${res.correct ? 'good' : 'bad'}">
      <div class="head">${res.correct ? '✓ Correct' : '✗ Incorrect — answer: ' + keys.join(' or ')}
        <span class="muted" style="font-weight:400;font-size:13px">· ${secs(elapsed)}</span></div>
      ${res.rationale ? `<div class="rationale">${res.rationale}</div>` : ''}
    </div>
    <div class="row" style="margin-top:16px">
      <button class="primary" id="next">${state.idx + 1 >= state.queue.length ? 'Finish' : 'Next question'}</button>
      ${!res.correct ? '<span class="muted" style="font-size:13px">Queued for review</span>' : ''}
    </div>`;
  $('#next').onclick = next;
  $('#next').focus();
}

function next() {
  state.idx++;
  renderPractice();
}

async function renderSetDone() {
  clearInterval(state._tick);
  const ov = await api('/api/state');
  main.innerHTML = `
    <div class="card" style="text-align:center;padding:38px">
      <h2>Set complete</h2>
      <p class="sub">${state.queue.length} questions done. Overall accuracy now ${pct(ov.accuracy)}.</p>
      <div class="row" style="justify-content:center">
        <button class="primary" id="again">Another set</button>
        <button class="ghost" id="tostats">See what to fix</button>
      </div>
    </div>`;
  $('#again').onclick = () => startSet({ n: 10 });
  $('#tostats').onclick = () => show('stats');
}

// ---------------------------------------------------------------- stats

async function renderStats() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const s = await api('/api/stats');

  if (!s.overview.attempts) {
    main.innerHTML = `<div class="empty"><p>No attempts yet.</p>
      <button class="primary" onclick="document.querySelector('[data-view=practice]').click()">Start practising</button></div>`;
    return;
  }

  const rows = s.by_type.map((d) => {
    const skills = d.skills.map((k) => {
      const paceBad = k.pace_ratio && k.pace_ratio > 1.25;
      return `<tr>
        <td class="skillname">${esc(k.skill)}
          ${k.attempts === 0 ? '<span class="pill untested">untested</span>' : ''}
          ${paceBad ? '<span class="pill slow">slow</span>' : ''}</td>
        <td class="num">${k.attempts ? k.correct + '/' + k.attempts : '—'}</td>
        <td class="num" style="color:${accColor(k.accuracy)}">${pct(k.accuracy)}</td>
        <td style="width:90px">${k.attempts
          ? `<div class="bar"><div style="width:${(k.accuracy * 100).toFixed(0)}%;background:${accColor(k.accuracy)}"></div></div>`
          : ''}</td>
        <td class="num">${secs(k.avg_ms)}</td>
        <td class="num muted hide-sm">${secs(k.pace_target_ms)}</td>
      </tr>`;
    }).join('');

    return `<tr class="domain">
        <td>${esc(d.domain)} <span class="muted" style="font-weight:400">· ${esc(d.test_name)}${d.exam_share ? ' · ' + Math.round(d.exam_share * 100) + '% of section' : ''}</span></td>
        <td class="num">${d.correct}/${d.attempts}</td>
        <td class="num" style="color:${accColor(d.accuracy)}">${pct(d.accuracy)}</td>
        <td></td><td class="num">${secs(d.avg_ms)}</td><td class="hide-sm"></td>
      </tr>${skills}`;
  }).join('');

  const trend = s.trend.length > 1
    ? `<h3>Recent trend</h3><div class="card">
         <div class="spark">${s.trend.map((t) => `<div style="height:${Math.max(4, t.accuracy * 100)}%" title="${pct(t.accuracy)} of ${t.n}"></div>`).join('')}</div>
         <p class="sub" style="margin:12px 0 0">Accuracy in blocks of recent questions, oldest on the left.</p>
       </div>` : '';

  main.innerHTML = `
    <h3>Drill these next</h3>
    <div class="card">
      <ul class="plan">
        ${s.weakest.map((w, i) => `<li>
          <span class="n">${i + 1}</span>
          <span><strong>${esc(w.skill)}</strong>
            <span class="muted">· ${esc(w.reason)} · ${esc(w.test_name)}</span></span>
          <div class="spacer"></div>
          <button class="ghost" data-skill="${esc(w.skill)}">Drill</button>
        </li>`).join('')}
      </ul>
    </div>
    ${trend}
    <h3>By question type</h3>
    <div class="card" style="padding:6px 10px">
      <table>
        <thead><tr>
          <th>Domain / skill</th><th style="text-align:right">Score</th>
          <th style="text-align:right">Accuracy</th><th></th>
          <th style="text-align:right">Your pace</th><th style="text-align:right" class="hide-sm">Target</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  main.querySelectorAll('[data-skill]').forEach((b) => {
    b.onclick = () => startSet({ skill: b.dataset.skill, n: 10 });
  });
}

// ---------------------------------------------------------------- keyboard

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
  if (letter && main.querySelector(`.choice[data-letter="${letter}"]`)) {
    e.preventDefault();
    submit(letter);
  }
});

show('home');
