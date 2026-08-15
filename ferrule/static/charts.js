'use strict';

/* Small inline-SVG chart builders. No libraries, no build step.
 *
 * Colour roles come from CSS custom properties defined in style.css, so light
 * and dark are two validated palettes rather than one flipped automatically.
 *
 * Difficulty is an ORDINAL scale (Easy < Medium < Hard), so it gets one hue in
 * three steps rather than three unrelated hues -- the ramp itself carries the
 * ordering.
 */

/* Wrapped in an IIFE so its helpers (esc, svg, DIFFS...) stay private. Two
 * classic scripts declaring the same top-level const is a hard parse error
 * that kills whichever file loads second. */
(function () {

const CH = {};

const DIFFS = ['E', 'M', 'H'];
const DIFF_NAME = { E: 'Easy', M: 'Medium', H: 'Hard' };
const cssVar = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();

CH.diffColor = (d) => cssVar(`--ord-${{ E: 1, M: 2, H: 3 }[d]}`);

/* Diverging scale for the heatmap: below target reads warm, above reads cool,
 * with a neutral middle. Buckets rather than a gradient so every cell colour is
 * one of a validated set. */
CH.accuracyColor = (acc, target) => {
  if (acc === null || acc === undefined) return cssVar('--cell-empty');
  const d = acc - target;
  if (d <= -0.25) return cssVar('--div-neg-2');
  if (d <= -0.10) return cssVar('--div-neg-1');
  if (d < 0.10) return cssVar('--div-mid');
  if (d < 0.20) return cssVar('--div-pos-1');
  return cssVar('--div-pos-2');
};

/* Confidence.
 *
 * Below CONFIDENT a cell's percentage is shown but is not evidence, so the
 * colour is faded towards the background in proportion to how little is behind
 * it. A cell reading 100% off two attempts should not look like mastery. */
/* Per difficulty, matching the weakness mode: a cell is judged against the
   evidence that difficulty actually needs, not one flat number. */
CH.CONFIDENT = { E: 8, M: 15, H: 20 };
CH.confidentFor = (d) => CH.CONFIDENT[d] || 20;
CH.confidence = (n, d) => {
  const need = CH.confidentFor(d);
  if (n === 0 || n >= need) return 1;
  return 0.34 + 0.5 * (n / need);
};

const svg = (w, h, cls) =>
  `<svg viewBox="0 0 ${w} ${h}" class="${cls || ''}" role="img" preserveAspectRatio="xMidYMid meet">`;

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- heatmap

/* Skill x difficulty accuracy. The centrepiece: one row per skill, one column
 * per difficulty, so "fine at Easy, lost at Hard" is visible at a glance. */
CH.heatmap = (rows, target) => {
  if (!rows.length) return '<p class="muted">No questions yet.</p>';

  const byDomain = {};
  rows.forEach((r) => (byDomain[`${r.test_name} — ${r.domain}`] ||= []).push(r));

  let html = `<div class="heat">
    <div class="heat-head">
      <span></span>${DIFFS.map((d) => `<span>${DIFF_NAME[d]}</span>`).join('')}<span>All</span>
    </div>`;

  for (const [domain, skills] of Object.entries(byDomain)) {
    html += `<div class="heat-domain">${esc(domain)}</div>`;
    for (const s of skills) {
      html += `<div class="heat-row">
        <span class="heat-label" title="${esc(s.skill)}">${esc(s.skill)}${s.cliff ? ' <span class="cliff" title="Holds up on Easy, falls apart on Hard">cliff</span>' : ''}</span>`;
      for (const d of DIFFS) {
        const c = s.cells[d];
        const n = c ? c.attempts : 0;
        const acc = c ? c.accuracy : null;
        const bg = CH.accuracyColor(acc, target);
        const op = CH.confidence(n, d);
        const avail = c ? c.available : 0;
        const thin = n > 0 && n < CH.confidentFor(d);
        const tip = n
          ? `${s.skill} · ${DIFF_NAME[d]}: ${c.correct}/${n} correct (${Math.round(acc * 100)}%)`
            + `, ${Math.round(c.avg_ms / 1000)}s avg`
            + (thin ? ` — only ${n} of ${CH.confidentFor(d)} needed at this difficulty` : '')
          : `${s.skill} · ${DIFF_NAME[d]}: not attempted yet · ${avail} available`;
        // NB: the modifier is `blank`, not `empty` -- `.empty` is a global
        // empty-state utility with heavy padding that would inflate the cell.
        html += `<span class="heat-cell${n ? '' : ' blank'}${thin ? ' thin' : ''}"
                   style="background:${bg};opacity:${op}"
                   tabindex="0" title="${esc(tip)}">
                   ${n ? `<b>${Math.round(acc * 100)}</b><i>${n}</i>` : '<b>·</b>'}
                 </span>`;
      }
      const all = s.attempts ? Math.round(s.accuracy * 100) + '%' : '—';
      html += `<span class="heat-total">${all}<i>${s.attempts || 0}</i></span></div>`;
    }
  }
  html += '</div>';

  html += `<div class="legend heat-legend">
      <span class="lg"><i style="background:${cssVar('--div-neg-2')}"></i>far below</span>
      <span class="lg"><i style="background:${cssVar('--div-neg-1')}"></i>below</span>
      <span class="lg"><i style="background:${cssVar('--div-mid')}"></i>on target (${Math.round(target * 100)}%)</span>
      <span class="lg"><i style="background:${cssVar('--div-pos-1')}"></i>above</span>
      <span class="lg"><i style="background:${cssVar('--div-pos-2')}"></i>well above</span>
      <span class="lg muted">big number = % correct, small = attempts</span>
      <span class="lg muted">faded and outlined = not enough answered yet to draw a conclusion
        (${CH.CONFIDENT.E}/${CH.CONFIDENT.M}/${CH.CONFIDENT.H} for easy/medium/hard)</span>
    </div>`;
  return html;
};

// ---------------------------------------------------------------- grouped bars

/* Accuracy at each difficulty, one group per section. */
CH.difficultyBars = (blocks) => {
  const data = [];
  blocks.forEach((b) =>
    DIFFS.forEach((d) => {
      const lv = b.levels[d];
      if (lv && lv.attempts) data.push({ ...lv, section: b.test_name });
    })
  );
  if (!data.length) return '<p class="muted">Not enough attempts yet.</p>';

  const W = 620, H = 226, L = 44, R = 12, T = 14, B = 62;
  const iw = W - L - R, ih = H - T - B;
  const bw = Math.min(52, (iw / data.length) - 10);
  const step = iw / data.length;

  let s = svg(W, H, 'chart');
  [0, 0.25, 0.5, 0.75, 1].forEach((g) => {
    const y = T + ih - g * ih;
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/>
          <text x="${L - 8}" y="${y + 4}" class="tick" text-anchor="end">${g * 100}%</text>`;
  });

  data.forEach((d, i) => {
    const h = Math.max(2, d.accuracy * ih);
    const x = L + i * step + (step - bw) / 2;
    const y = T + ih - h;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4"
            fill="${CH.diffColor(d.difficulty)}">
            <title>${esc(d.section)} ${d.label}: ${d.correct}/${d.attempts} (${Math.round(d.accuracy * 100)}%)</title>
          </rect>
          <text x="${x + bw / 2}" y="${y - 5}" class="vlabel">${Math.round(d.accuracy * 100)}%</text>
          <text x="${x + bw / 2}" y="${H - B + 16}" class="tick">${d.label}</text>
          <text x="${x + bw / 2}" y="${H - B + 29}" class="tick muted">n=${d.attempts}</text>`;
  });

  /* Group the bars under their section name and rule a line between the two
   * groups -- otherwise the axis reads "Easy Medium Easy Medium Hard" and you
   * cannot tell which half is which. */
  const sections = [...new Set(data.map((d) => d.section))];
  let cursor = 0;
  sections.forEach((name, si) => {
    const count = data.filter((d) => d.section === name).length;
    const x0 = L + cursor * step;
    const x1 = L + (cursor + count) * step;
    s += `<text x="${(x0 + x1) / 2}" y="${H - 6}" class="tick group">${esc(name)}</text>`;
    if (si > 0) s += `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${T + ih + 32}" class="sep"/>`;
    cursor += count;
  });
  s += '</svg>';

  return s + `<div class="legend">
    <span class="lg"><i style="background:${CH.diffColor('E')}"></i>Easy</span>
    <span class="lg"><i style="background:${CH.diffColor('M')}"></i>Medium</span>
    <span class="lg"><i style="background:${CH.diffColor('H')}"></i>Hard</span></div>`;
};

// ---------------------------------------------------------------- histogram

/* How long questions actually take, stacked by difficulty. Averages hide the
 * tail; this shows it. */
CH.timeHistogram = (buckets, targets) => {
  const live = buckets.filter((b) => b.total);
  if (!live.length) return '<p class="muted">No timed attempts yet.</p>';

  const W = 620, H = 210, L = 40, R = 12, T = 14, B = 44;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(...live.map((b) => b.total));
  const step = iw / live.length;
  const bw = Math.min(48, step - 8);

  let s = svg(W, H, 'chart');
  [0, 0.5, 1].forEach((g) => {
    const y = T + ih - g * ih;
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/>
          <text x="${L - 8}" y="${y + 4}" class="tick" text-anchor="end">${Math.round(g * max)}</text>`;
  });

  live.forEach((b, i) => {
    const x = L + i * step + (step - bw) / 2;
    let y = T + ih;
    DIFFS.forEach((d) => {
      const n = b.counts[d];
      if (!n) return;
      const h = (n / max) * ih;
      y -= h;
      // 2px surface gap between stacked segments keeps them readable
      s += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(1, h - 2)}" rx="3"
              fill="${CH.diffColor(d)}"><title>${b.label} · ${DIFF_NAME[d]}: ${n}</title></rect>`;
    });
    s += `<text x="${x + bw / 2}" y="${T + ih - (b.total / max) * ih - 5}" class="vlabel">${b.total}</text>
          <text x="${x + bw / 2}" y="${H - B + 16}" class="tick">${b.label}</text>`;
    if (b.accuracy !== null)
      s += `<text x="${x + bw / 2}" y="${H - B + 30}" class="tick muted">${Math.round(b.accuracy * 100)}%</text>`;
  });

  // pace targets as reference lines
  (targets || []).forEach((t) => {
    let idx = live.findIndex((b) => b.hi !== null && t.secs < b.hi);
    if (idx < 0) idx = live.length - 1;
    const b = live[idx];
    const frac = b.hi ? (t.secs - b.lo) / (b.hi - b.lo) : 0.5;
    const x = L + idx * step + frac * step;
    s += `<line x1="${x}" x2="${x}" y1="${T}" y2="${T + ih}" class="target"/>
          <text x="${x + 4}" y="${T + 10}" class="tick target-t">${t.label}</text>`;
  });

  s += '</svg>';
  return s + `<div class="legend">
      <span class="lg"><i style="background:${CH.diffColor('E')}"></i>Easy</span>
      <span class="lg"><i style="background:${CH.diffColor('M')}"></i>Medium</span>
      <span class="lg"><i style="background:${CH.diffColor('H')}"></i>Hard</span>
      <span class="lg muted">% under each bar is accuracy in that time band</span>
    </div>`;
};

// ---------------------------------------------------------------- timeline

/* Daily volume as bars with cumulative total as a line. Two measures, but the
 * line is a running total of the bars -- same unit, one axis. */
CH.timeline = (days) => {
  if (days.length < 1) return '<p class="muted">No sessions recorded yet.</p>';

  const W = 620, H = 200, L = 40, R = 40, T = 16, B = 40;
  const iw = W - L - R, ih = H - T - B;
  const maxBar = Math.max(...days.map((d) => d.attempts), 1);
  const maxCum = Math.max(...days.map((d) => d.cumulative), 1);
  const step = iw / days.length;
  const bw = Math.min(34, step - 6);

  let s = svg(W, H, 'chart');
  [0, 0.5, 1].forEach((g) => {
    const y = T + ih - g * ih;
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/>
          <text x="${L - 8}" y="${y + 4}" class="tick" text-anchor="end">${Math.round(g * maxBar)}</text>`;
  });

  days.forEach((d, i) => {
    const h = (d.attempts / maxBar) * ih;
    const x = L + i * step + (step - bw) / 2;
    s += `<rect x="${x}" y="${T + ih - h}" width="${bw}" height="${Math.max(2, h)}" rx="4"
            fill="${cssVar('--ord-2')}">
            <title>${d.day}: ${d.attempts} questions, ${Math.round((d.accuracy || 0) * 100)}% correct, ${d.minutes} min</title>
          </rect>`;
    if (days.length <= 12 || i % 2 === 0)
      s += `<text x="${x + bw / 2}" y="${H - B + 16}" class="tick">${d.day.slice(5)}</text>`;
  });

  const pts = days.map((d, i) => {
    const x = L + i * step + step / 2;
    const y = T + ih - (d.cumulative / maxCum) * ih;
    return [x, y];
  });
  s += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="cumline"/>`;
  pts.forEach(([x, y], i) =>
    (s += `<circle cx="${x}" cy="${y}" r="3.5" class="cumdot"><title>${days[i].day}: ${days[i].cumulative} total</title></circle>`)
  );
  s += `<text x="${W - R + 6}" y="${pts[pts.length - 1][1] + 4}" class="tick accent">${days[days.length - 1].cumulative}</text>`;
  s += '</svg>';

  return s + `<div class="legend">
      <span class="lg"><i style="background:${cssVar('--ord-2')}"></i>questions that day</span>
      <span class="lg"><i class="line" style="background:${cssVar('--accent')}"></i>running total</span>
    </div>`;
};

// ---------------------------------------------------------------- pace

/* Your pace against the real per-question budget, per difficulty. */
CH.paceBars = (blocks) => {
  const rows = [];
  blocks.forEach((b) =>
    DIFFS.forEach((d) => {
      const lv = b.levels[d];
      if (lv && lv.attempts && lv.avg_ms)
        rows.push({ ...lv, section: b.test_name, ratio: lv.avg_ms / lv.pace_target_ms });
    })
  );
  if (!rows.length) return '<p class="muted">Not enough timed attempts yet.</p>';

  const max = Math.max(1.6, ...rows.map((r) => r.ratio));
  return `<div class="pace">${rows.map((r) => {
    const pctOfMax = (r.ratio / max) * 100;
    const targetAt = (1 / max) * 100;
    const over = r.ratio > 1.15;
    return `<div class="pace-row">
        <span class="pace-label">${esc(r.section.slice(0, 4))} · ${r.label}</span>
        <span class="pace-track">
          <span class="pace-fill" style="width:${pctOfMax}%;background:${over ? cssVar('--div-neg-1') : cssVar('--ord-2')}"></span>
          <span class="pace-target" style="left:${targetAt}%" title="Target ${Math.round(r.pace_target_ms / 1000)}s"></span>
        </span>
        <span class="pace-num">${Math.round(r.avg_ms / 1000)}s</span>
        <span class="pace-num muted">/ ${Math.round(r.pace_target_ms / 1000)}s</span>
      </div>`;
  }).join('')}</div>
  <div class="legend"><span class="lg muted">The marker is the real per-question budget. Bars past it mean you are losing time there.</span></div>`;
};

window.CH = CH;

})();
