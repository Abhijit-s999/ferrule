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
  main.className = (view === 'stats' || view === 'analytics') ? 'wide' : '';
  ({
    home: renderHome,
    practice: renderPractice,
    stats: renderStats,
    analytics: renderAnalytics,
    settings: renderSettings,
  }[view])();
}

// ---------------------------------------------------------------- analytics

async function renderAnalytics() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const a = await api('/api/analytics');

  if (!a.overview.attempts) {
    main.innerHTML = `<div class="empty"><p>No attempts yet — analytics need data.</p>
      <button class="primary" onclick="document.querySelector('[data-view=practice]').click()">Start practising</button></div>`;
    return;
  }

  const targets = [
    { secs: 71, label: 'R&W target 71s' },
    { secs: 95, label: 'Math target 95s' },
  ];

  main.innerHTML = `
    <h3>Accuracy by skill and difficulty</h3>
    <div class="card">
      <p class="sub">The finest grain the data allows. A row that is strong on the
        left and weak on the right is a skill you have, but not yet at exam
        difficulty — a different fix from one you are missing everywhere.</p>
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

    <h3>Weakest skills right now</h3>
    <div class="card">
      <ul class="plan">
        ${a.weakest.map((w, i) => `<li>
          <span class="n">${i + 1}</span>
          <span><strong>${esc(w.skill)}</strong>
            <span class="muted">· ${esc(w.reason)} · ${esc(w.test_name)}</span></span>
          <div class="spacer"></div>
          <button class="ghost" data-skill="${esc(w.skill)}">Drill</button>
        </li>`).join('')}
      </ul>
    </div>`;

  main.querySelectorAll('[data-skill]').forEach((b) => {
    b.onclick = () => startSet({ skill: b.dataset.skill, n: 10 });
  });
}

// ---------------------------------------------------------------- home

async function renderHome() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const [ov, plan] = await Promise.all([api('/api/state'), api('/api/plan?minutes=30')]);
  $('#bankinfo').textContent = `${ov.bank_size.toLocaleString()} questions`;

  if (!ov.bank_size) return renderFirstRun();

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

/* First launch: download the question bank from inside the app. */
async function renderFirstRun() {
  const st = await api('/api/fetch/status');
  const running = st.phase === 'running';

  main.innerHTML = `
    <div class="card">
      <h2>Welcome to satprep</h2>
      <p class="sub">
        Before you can practise, satprep needs to download the official SAT
        question bank from College Board. About 3,250 questions, roughly four
        minutes, done once.
      </p>
      ${running || st.phase === 'done' ? `
        <div class="progress" style="margin:16px 0 10px"><div style="width:${st.count ? Math.min(99, (st.count / 3250) * 100) : 4}%"></div></div>
        <p class="sub" style="margin:0">${esc(st.detail || 'Starting…')} — ${st.count.toLocaleString()} stored</p>
      ` : st.phase === 'error' ? `
        <div class="log">${esc(st.error)}</div>
        <button class="primary" id="dl" style="margin-top:12px">Try again</button>
      ` : `
        <label class="srcrow" style="border:0;padding:8px 0">
          <input type="checkbox" id="opensat">
          <span>Also download the OpenSAT community question bank (~2,340 extra
            questions, optional — see Settings for what that means)</span>
        </label>
        <button class="primary" id="dl">Download questions</button>
      `}
      <p class="sub" style="margin:16px 0 0">
        Questions stay on your machine. satprep does not redistribute them —
        see ATTRIBUTION.md for sources and terms.
      </p>
    </div>`;

  const btn = $('#dl');
  if (btn) btn.onclick = async () => {
    await post('/api/fetch/start', { with_opensat: !!($('#opensat') || {}).checked });
    renderFirstRun();
  };
  if (running) setTimeout(() => { if (state.view === 'home') renderFirstRun(); }, 1200);
  if (st.phase === 'done') setTimeout(renderHome, 800);
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
      <button class="ghost" id="ask">Ask the tutor</button>
      ${!res.correct ? '<span class="muted" style="font-size:13px">Queued for review</span>' : ''}
    </div>
    <div id="tutor-out"></div>`;
  $('#next').onclick = next;
  $('#ask').onclick = () => askTutor(q, response, res.correct);
  $('#next').focus();
}

/* Stream a tutor explanation into the feedback panel. The stream is plain
 * text/event-stream, so it renders as it arrives rather than after a long wait
 * — which matters a lot on a local model. */
async function askTutor(q, response, wasCorrect) {
  const out = $('#tutor-out');
  const btn = $('#ask');
  if (!out || !btn) return;
  btn.disabled = true;
  out.innerHTML = '<div class="tutor"><div class="tutor-head">Tutor</div><div class="tutor-body">…</div></div>';
  const body = out.querySelector('.tutor-body');

  let res;
  try {
    res = await fetch('/api/tutor/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_id: q.external_id,
        response,
        mode: wasCorrect ? 'explain' : 'why_wrong',
      }),
    });
  } catch (e) {
    body.textContent = 'Could not reach the tutor.';
    btn.disabled = false;
    return;
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
      let msg;
      try { msg = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (msg.error) {
        body.innerHTML = `${esc(msg.error)}<br><button class="ghost" style="margin-top:10px"
          onclick="document.querySelector('[data-view=settings]').click()">Open Settings</button>`;
        btn.disabled = false;
        return;
      }
      if (msg.delta) { text += msg.delta; body.textContent = text; }
    }
  }
  btn.disabled = false;
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

// ---------------------------------------------------------------- settings

const gb = (n) => `${n.toFixed(n < 1 ? 1 : 1)} GB`;

async function renderSettings() {
  main.innerHTML = '<div class="empty">Loading…</div>';
  const [rt, tc, src] = await Promise.all([
    api('/api/runtime/status'),
    api('/api/tutor/config'),
    api('/api/sources'),
  ]);

  const installed = new Set(rt.installed_models);
  const vram = rt.vram_gb;
  const busy = ['engine', 'model', 'starting'].includes(rt.phase);

  const fitOf = (m) =>
    vram == null ? '' :
    m.vram_gb <= vram - 1 ? '<span class="pill fit">fits your GPU</span>' :
    m.vram_gb <= vram + 0.5 ? '<span class="pill tight">tight fit</span>' :
    '<span class="pill toobig">needs more VRAM</span>';

  const cards = rt.models.map((m) => `
    <div class="model ${m.recommended ? 'rec' : ''}">
      <div class="model-head">
        <div>
          <strong>${esc(m.name)}</strong>
          ${m.recommended ? '<span class="pill rec">recommended</span>' : ''}
          ${installed.has(m.id) ? '<span class="pill ok">downloaded</span>' : ''}
          ${fitOf(m)}
        </div>
        <div class="muted" style="font-size:12.5px">
          ${m.params} · ${gb(m.size_gb)} download · ${esc(m.best_for)} · ${esc(m.licence)}
        </div>
      </div>
      <div class="model-body">
        <ul class="pros">${m.pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <ul class="cons">${m.cons.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>
      <div class="row">
        <button class="primary" data-start="${m.id}" ${busy ? 'disabled' : ''}>
          ${installed.has(m.id) ? 'Use this model' : `Download & use (${gb(m.size_gb)})`}
        </button>
        ${installed.has(m.id) ? `<button class="ghost" data-del="${m.id}" ${busy ? 'disabled' : ''}>Delete</button>` : ''}
      </div>
    </div>`).join('');

  const progress = busy || rt.phase === 'error' || rt.running ? `
    <div class="card ${rt.phase === 'error' ? 'err' : ''}">
      ${rt.phase === 'error'
        ? `<strong>Setup failed</strong><pre class="log">${esc(rt.error)}</pre>`
        : rt.running
          ? `<strong>Tutor is running</strong>
             <p class="sub" style="margin:6px 0 12px">${esc(rt.detail || 'Ready.')}</p>
             <button class="ghost" id="stop-rt">Stop model</button>`
          : `<strong>${esc(rt.detail || 'Working…')}</strong>
             <div class="progress" style="margin:12px 0 0">
               <div style="width:${(rt.progress * 100).toFixed(1)}%"></div>
             </div>
             <p class="sub" style="margin:8px 0 0">${Math.round(rt.progress * 100)}% — you can keep practising while this downloads.</p>`}
    </div>` : '';

  main.innerHTML = `
    <h3>AI tutor</h3>
    <div class="card">
      <p class="sub" style="margin:0 0 6px">
        Optional. Everything else works without it. Pick a model and satprep
        downloads the engine and the model for you — nothing to install, no
        terminal, no accounts.
      </p>
      <p class="sub" style="margin:0">
        Detected: <strong>${esc(rt.accelerator.label)}</strong>${vram ? ` · ${vram} GB VRAM` : ''}
        · files go to <code>${esc(rt.data_dir)}</code>
      </p>
    </div>
    ${progress}
    <div class="models">${cards}</div>

    <h3>Already use Ollama, LM Studio, or a hosted API?</h3>
    <div class="card">
      <p class="sub">Skip the download and point satprep at what you have.</p>
      <div class="row">
        <select id="prov">
          ${tc.providers.map((p) => `<option value="${p.id}" ${tc.config.provider === p.id ? 'selected' : ''}>
            ${esc(p.name)}${p.kind === 'external' ? ' (external — data leaves your machine)' : ''}
          </option>`).join('')}
        </select>
        <input type="text" id="model" placeholder="model name" value="${esc(tc.config.model || '')}">
      </div>
      <div class="row" style="margin-top:10px">
        <input type="text" id="baseurl" placeholder="base URL (blank = provider default)"
               value="${esc(tc.config.base_url || '')}" style="flex:2">
        <input type="text" id="apikey" placeholder="${tc.config.has_key ? 'API key saved — leave blank to keep' : 'API key (external only)'}" style="flex:1">
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="save-tutor">Save</button>
        <button class="ghost" id="test-tutor">Test connection</button>
        <span id="tutor-result" class="muted" style="font-size:13px"></span>
      </div>
      <p class="sub" style="margin:12px 0 0">
        API keys are stored in <code>~/.config/satprep/config.json</code> with
        owner-only permissions, never in the database and never in the repo.
      </p>
    </div>

    <h3>Question sources</h3>
    <div class="card">
      ${src.sources.map((s) => `
        <label class="srcrow">
          <input type="checkbox" data-src="${s.source}" ${s.enabled ? 'checked' : ''}>
          <span>
            <strong>${esc(s.name)}</strong>
            <span class="pill ${s.official ? 'ok' : ''}">${s.official ? 'official' : 'community'}</span>
            <span class="muted"> · ${s.bank.toLocaleString()} questions</span><br>
            <span class="muted" style="font-size:12.5px">${esc((src.catalog.find((c) => c.id === s.source) || {}).why || '')}</span><br>
            <a href="${esc(s.url)}" target="_blank" rel="noreferrer noopener" class="muted" style="font-size:12px">${esc(s.url)}</a>
          </span>
        </label>`).join('')}
      ${src.not_fetched.map((n) => `
        <div class="srcrow off">
          <span style="width:16px"></span>
          <span>
            <strong>${esc(n.name)}</strong> <span class="pill">not fetched, by design</span><br>
            <span class="muted" style="font-size:12.5px">${esc(n.reason)}</span><br>
            <span class="muted" style="font-size:12.5px">${esc(n.status)}</span>
          </span>
        </div>`).join('')}
    </div>`;

  main.querySelectorAll('[data-start]').forEach((b) => {
    b.onclick = async () => {
      await post('/api/runtime/start', { model_id: b.dataset.start });
      pollRuntime();
    };
  });
  main.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => { await post('/api/runtime/delete', { model_id: b.dataset.del }); renderSettings(); };
  });
  const stopBtn = $('#stop-rt');
  if (stopBtn) stopBtn.onclick = async () => { await post('/api/runtime/stop', {}); renderSettings(); };

  $('#save-tutor').onclick = async () => {
    await post('/api/tutor/config', {
      enabled: true,
      provider: $('#prov').value,
      model: $('#model').value.trim(),
      base_url: $('#baseurl').value.trim(),
      api_key: $('#apikey').value.trim(),
    });
    $('#tutor-result').textContent = 'Saved.';
  };
  $('#test-tutor').onclick = async () => {
    $('#tutor-result').textContent = 'Testing…';
    const h = await api('/api/tutor/health');
    $('#tutor-result').textContent = h.ok
      ? `Connected. ${h.models.length} model(s) available.${h.warning ? ' ' + h.warning : ''}`
      : `Failed: ${h.error}`;
  };
  main.querySelectorAll('[data-src]').forEach((cb) => {
    cb.onchange = async () => {
      const enabled = [...main.querySelectorAll('[data-src]')].filter((x) => x.checked).map((x) => x.dataset.src);
      const res = await fetch('/api/sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }).then((r) => r.json());
      if (res.error) { alert(res.error); cb.checked = true; }
    };
  });

  if (busy) pollRuntime();
}

let rtTimer = null;
function pollRuntime() {
  clearTimeout(rtTimer);
  rtTimer = setTimeout(async () => {
    if (state.view !== 'settings') return;
    const rt = await api('/api/runtime/status');
    if (['engine', 'model', 'starting'].includes(rt.phase)) {
      const bar = main.querySelector('.progress > div');
      const label = main.querySelector('.card strong');
      if (bar) bar.style.width = (rt.progress * 100).toFixed(1) + '%';
      if (label && rt.detail) label.textContent = rt.detail;
      pollRuntime();
    } else {
      renderSettings();
    }
  }, 900);
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
