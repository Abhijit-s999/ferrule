/* Analytics: accuracy and pacing broken down by question type.
 * Ported from ferrule/stats.py; the SQL is unchanged. */

import { BLUEPRINT, priority, skillStats } from './scheduler.js';
import { enabledIds, get as sourceMeta, placeholders } from './sources.js';
import { nowMs, questionCount } from './store.js';
import { fixed0, pct0, roundHalfEven, sortByKey } from './util.js';

export const PACE_TARGET_MS = { 1: 71000, 2: 95000 };
const MIN_CONFIDENT_ATTEMPTS = 20;
export const TARGET_ACCURACY = 0.75;
const DIFFICULTY_ORDER = ['E', 'M', 'H'];
const DIFFICULTY_NAMES = { E: 'Easy', M: 'Medium', H: 'Hard' };

const acc = (correct, attempts) => (attempts ? correct / attempts : null);

export function overview(db) {
  const row = db.get(
    `SELECT COUNT(*) AS attempts,
            COALESCE(SUM(correct), 0) AS correct,
            COALESCE(AVG(NULLIF(elapsed_ms, 0)), 0) AS avg_ms
     FROM attempts`,
  );
  const byTest = {};
  for (const r of db.all(
    `SELECT q.test, q.test_name, COUNT(a.id) AS attempts,
            COALESCE(SUM(a.correct), 0) AS correct,
            COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms
     FROM attempts a JOIN questions q ON q.external_id = a.external_id
     GROUP BY q.test`,
  )) {
    byTest[r.test] = {
      test_name: r.test_name,
      attempts: r.attempts,
      correct: r.correct,
      accuracy: acc(r.correct, r.attempts),
      avg_ms: Math.trunc(r.avg_ms || 0),
      pace_target_ms: PACE_TARGET_MS[r.test] ?? null,
    };
  }
  const enabled = enabledIds(db);
  return {
    attempts: row.attempts,
    correct: row.correct,
    accuracy: acc(row.correct, row.attempts),
    avg_ms: Math.trunc(row.avg_ms || 0),
    by_test: byTest,
    due_reviews: db.get('SELECT COUNT(*) AS n FROM reviews WHERE due_at <= ?', [nowMs()]).n,
    bank_size: db.get(
      `SELECT COUNT(*) AS n FROM questions
       WHERE stem IS NOT NULL AND stem != '' AND source IN (${placeholders(enabled)})`,
      enabled,
    ).n,
    bank_total: questionCount(db),
    bank_pending: db.get("SELECT COUNT(*) AS n FROM questions WHERE stem IS NULL OR stem = ''").n,
    enabled_sources: enabled,
    by_source: bySource(db),
    // Official questions only: community ones are not calibrated.
    projection: projectScore(byTestFor(db, 'collegeboard')),
  };
}

function byTestFor(db, source = null) {
  const out = {};
  for (const r of db.all(
    `SELECT q.test, q.test_name, COUNT(a.id) AS attempts,
            COALESCE(SUM(a.correct), 0) AS correct
     FROM attempts a JOIN questions q ON q.external_id = a.external_id
     ${source ? 'WHERE q.source = ?' : ''} GROUP BY q.test`,
    source ? [source] : [],
  )) {
    out[r.test] = { test_name: r.test_name, attempts: r.attempts, accuracy: acc(r.correct, r.attempts) };
  }
  return out;
}

/* The batches College Board has added, newest first. */
export function vintages(db) {
  const enabled = enabledIds(db);
  let running = 0;
  return db.all(
    `SELECT STRFTIME('%Y-%m', created_at / 1000, 'unixepoch') AS batch,
            MIN(created_at)                                   AS starts_at,
            COUNT(*)                                          AS total,
            SUM(CASE WHEN in_practice_test = 0 THEN 1 ELSE 0 END) AS available
     FROM questions
     WHERE created_at IS NOT NULL AND stem IS NOT NULL AND stem != ''
       AND source IN (${placeholders(enabled)})
     GROUP BY batch ORDER BY starts_at DESC`,
    enabled,
  ).map((r) => {
    running += r.available;
    return {
      batch: r.batch, starts_at: r.starts_at, total: r.total,
      available: r.available, cumulative_available: running,
    };
  });
}

export function bySource(db) {
  const enabled = new Set(enabledIds(db));
  const out = db.all(
    `SELECT q.source,
            COUNT(a.id)                               AS attempts,
            COALESCE(SUM(a.correct), 0)               AS correct,
            COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms
     FROM questions q
     LEFT JOIN attempts a ON a.external_id = q.external_id
     GROUP BY q.source`,
  ).map((r) => {
    const meta = sourceMeta(r.source) || {};
    return {
      source: r.source,
      name: meta.name ?? r.source,
      short: meta.short ?? r.source,
      url: meta.url ?? null,
      official: meta.official ?? false,
      enabled: enabled.has(r.source),
      bank: db.get(
        "SELECT COUNT(*) AS n FROM questions WHERE source = ? AND stem IS NOT NULL AND stem != ''",
        [r.source],
      ).n,
      attempts: r.attempts,
      correct: r.correct,
      accuracy: acc(r.correct, r.attempts),
      avg_ms: Math.trunc(r.avg_ms || 0),
    };
  });
  return sortByKey(out, (s) => [!s.official, s.source]);
}

export function byType(db) {
  const domains = new Map();
  for (const s of skillStats(db)) {
    const target = PACE_TARGET_MS[s.test] ?? 80000;
    const entry = {
      ...s,
      pace_target_ms: target,
      pace_ratio: s.avg_ms ? s.avg_ms / target : null,
      confident: s.attempts >= MIN_CONFIDENT_ATTEMPTS,
      priority: priority(s),
    };
    const key = JSON.stringify([s.test, s.test_name, s.domain]);
    if (!domains.has(key)) domains.set(key, []);
    domains.get(key).push(entry);
  }
  const out = [];
  for (const [key, skills] of domains) {
    const [test, testName, domain] = JSON.parse(key);
    const attempts = skills.reduce((a, s) => a + s.attempts, 0);
    const correct = skills.reduce((a, s) => a + s.correct, 0);
    const timed = skills.filter((s) => s.avg_ms);
    out.push({
      test,
      test_name: testName,
      domain,
      attempts,
      correct,
      accuracy: acc(correct, attempts),
      avg_ms: timed.length ? Math.trunc(timed.reduce((a, s) => a + s.avg_ms, 0) / timed.length) : 0,
      exam_share: BLUEPRINT[domain] ?? null,
      skills: sortByKey(skills, (s) => [-s.priority]),
    });
  }
  return sortByKey(out, (d) => [d.test, -d.attempts]);
}

/* Accuracy per skill per difficulty -- the finest grain the data supports. */
export function skillDifficultyMatrix(db) {
  const enabled = enabledIds(db);
  const skills = new Map();
  for (const r of db.all(
    `SELECT q.test, q.test_name, q.domain, q.skill, q.difficulty,
            COUNT(a.id)                               AS attempts,
            COALESCE(SUM(a.correct), 0)               AS correct,
            COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms,
            SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END) AS unseen
     FROM questions q
     LEFT JOIN attempts a ON a.external_id = q.external_id
     WHERE q.stem IS NOT NULL AND q.stem != '' AND q.source IN (${placeholders(enabled)})
     GROUP BY q.test, q.domain, q.skill, q.difficulty`,
    enabled,
  )) {
    const key = JSON.stringify([r.test, r.test_name, r.domain, r.skill]);
    if (!skills.has(key)) {
      skills.set(key, {
        test: r.test, test_name: r.test_name, domain: r.domain, skill: r.skill,
        cells: { E: null, M: null, H: null }, attempts: 0, correct: 0,
      });
    }
    const entry = skills.get(key);
    if (!DIFFICULTY_ORDER.includes(r.difficulty)) continue;
    entry.cells[r.difficulty] = {
      difficulty: r.difficulty,
      attempts: r.attempts,
      correct: r.correct,
      accuracy: acc(r.correct, r.attempts),
      avg_ms: Math.trunc(r.avg_ms || 0),
      available: r.unseen,
    };
    entry.attempts += r.attempts;
    entry.correct += r.correct;
  }
  const out = [...skills.values()];
  for (const e of out) {
    e.accuracy = acc(e.correct, e.attempts);
    const easy = e.cells.E, hard = e.cells.H;
    e.cliff = Boolean(
      easy && hard && easy.attempts >= 2 && hard.attempts >= 2
      && easy.accuracy !== null && hard.accuracy !== null
      && easy.accuracy - hard.accuracy >= 0.34,
    );
  }
  return sortByKey(out, (e) => [e.test, e.domain, e.skill]);
}

export function difficultyBreakdown(db) {
  const enabled = enabledIds(db);
  const out = new Map();
  for (const r of db.all(
    `SELECT q.test, q.test_name, q.difficulty,
            COUNT(a.id)                               AS attempts,
            COALESCE(SUM(a.correct), 0)               AS correct,
            COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms
     FROM attempts a JOIN questions q ON q.external_id = a.external_id
     WHERE q.source IN (${placeholders(enabled)})
     GROUP BY q.test, q.difficulty`,
    enabled,
  )) {
    if (!out.has(r.test)) out.set(r.test, { test: r.test, test_name: r.test_name, levels: {} });
    out.get(r.test).levels[r.difficulty] = {
      difficulty: r.difficulty,
      label: DIFFICULTY_NAMES[r.difficulty] ?? r.difficulty,
      attempts: r.attempts,
      correct: r.correct,
      accuracy: acc(r.correct, r.attempts),
      avg_ms: Math.trunc(r.avg_ms || 0),
      pace_target_ms: PACE_TARGET_MS[r.test] ?? null,
    };
  }
  return sortByKey([...out.values()], (b) => [b.test]);
}

/* Per-day volume, accuracy and time spent. */
export function timeline(db, days = 21) {
  const rows = db.all(
    `SELECT DATE(a.answered_at / 1000, 'unixepoch', 'localtime') AS day,
            COUNT(*)                     AS attempts,
            SUM(a.correct)               AS correct,
            SUM(a.elapsed_ms)            AS total_ms
     FROM attempts a
     GROUP BY day ORDER BY day`,
  );
  let running = 0;
  return rows.slice(-days).map((r) => {
    running += r.attempts;
    return {
      day: r.day,
      attempts: r.attempts,
      correct: r.correct,
      accuracy: acc(r.correct, r.attempts),
      minutes: roundHalfEven((r.total_ms || 0) / 60000, 1),
      cumulative: running,
    };
  });
}

/* How long questions take, bucketed, split by difficulty. */
export function timeDistribution(db) {
  const enabled = enabledIds(db);
  const rows = db.all(
    `SELECT q.difficulty, q.test, a.elapsed_ms, a.correct
     FROM attempts a JOIN questions q ON q.external_id = a.external_id
     WHERE a.elapsed_ms > 0 AND q.source IN (${placeholders(enabled)})`,
    enabled,
  );
  const edges = [0, 15, 30, 45, 60, 90, 120, 180, 300];
  const buckets = edges.map((lo, i) => {
    const hi = i + 1 < edges.length ? edges[i + 1] : null;
    return {
      lo, hi,
      label: hi ? `${lo}-${hi}s` : `${lo}s+`,
      counts: { E: 0, M: 0, H: 0 },
      correct: 0,
      total: 0,
    };
  });
  for (const r of rows) {
    const secs = r.elapsed_ms / 1000;
    let idx = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].hi === null || secs < buckets[i].hi) { idx = i; break; }
    }
    const b = buckets[idx];
    if (r.difficulty in b.counts) b.counts[r.difficulty]++;
    b.total++;
    b.correct += r.correct;
  }
  for (const b of buckets) b.accuracy = acc(b.correct, b.total);
  return buckets;
}

/* Skills to drill next, with a plain-language reason for each. */
export function weakest(db, limit = 6) {
  const ranked = sortByKey(skillStats(db), (s) => [s.attempts >= MIN_CONFIDENT_ATTEMPTS, -priority(s)]);
  const out = [];
  for (const s of ranked) {
    if (out.length >= limit) break;
    const target = PACE_TARGET_MS[s.test] ?? 80000;
    const slow = s.avg_ms ? s.avg_ms > target * 1.25 : false;
    let reason;
    if (s.attempts === 0) reason = 'not tested yet';
    else if (s.attempts < MIN_CONFIDENT_ATTEMPTS) {
      reason = s.accuracy !== null
        ? `${pct0(s.accuracy)} of only ${s.attempts} — not enough to judge`
        : `only ${s.attempts} seen so far`;
    } else if (s.accuracy !== null && s.accuracy < 0.6) reason = `${pct0(s.accuracy)} accurate`;
    else if (slow) reason = `slow: ${fixed0(s.avg_ms / 1000)}s vs ${fixed0(target / 1000)}s target`;
    else reason = `${pct0(s.accuracy)} accurate`;
    out.push({
      test_name: s.test_name, domain: s.domain, skill: s.skill,
      attempts: s.attempts, accuracy: s.accuracy, avg_ms: s.avg_ms, slow, reason,
    });
  }
  return out;
}

/* Rolling accuracy over the most recent attempts, oldest bucket first. */
export function recentTrend(db, buckets = 10, perBucket = 15) {
  const rows = db.all('SELECT correct FROM attempts ORDER BY answered_at DESC LIMIT ?', [buckets * perBucket])
    .map((r) => r.correct).reverse();
  const out = [];
  for (let i = 0; i < rows.length; i += perBucket) {
    const chunk = rows.slice(i, i + perBucket);
    if (chunk.length >= Math.max(3, Math.floor(perBucket / 3))) {
      out.push({ n: chunk.length, accuracy: chunk.reduce((a, b) => a + b, 0) / chunk.length });
    }
  }
  return out;
}

const SCORE_ANCHORS = [
  [0.25, 250], [0.40, 380], [0.55, 480], [0.70, 570],
  [0.80, 640], [0.90, 710], [0.97, 780], [1.00, 800],
];
const MIN_ATTEMPTS_FOR_PROJECTION = 20;

function interpolate(a) {
  let [loA, loS] = SCORE_ANCHORS[0];
  if (a <= loA) return 200;
  for (const [hiA, hiS] of SCORE_ANCHORS.slice(1)) {
    if (a <= hiA) {
      const frac = (a - loA) / (hiA - loA);
      return Math.trunc(roundHalfEven((loS + frac * (hiS - loS)) / 10.0) * 10);
    }
    [loA, loS] = [hiA, hiS];
  }
  return 800;
}

/* A rough section-score estimate. Deliberately coarse -- see README. */
export function projectScore(byTest) {
  const out = {};
  for (const data of Object.values(byTest)) {
    if (data.attempts < MIN_ATTEMPTS_FOR_PROJECTION || data.accuracy === null) continue;
    out[data.test_name] = interpolate(data.accuracy);
  }
  if (Object.keys(out).length === 2) out.Total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

const TREND_WINDOW = 10;
const TREND_MIN = 6;

/* Per-skill direction: is recent work better than earlier work? */
export function skillTrends(db) {
  const enabled = enabledIds(db);
  const bySkill = new Map();
  for (const r of db.all(
    `SELECT q.skill, q.test_name, a.correct, a.answered_at
     FROM attempts a JOIN questions q ON q.external_id = a.external_id
     WHERE q.source IN (${placeholders(enabled)})
     ORDER BY q.skill, a.answered_at`,
    enabled,
  )) {
    if (!bySkill.has(r.skill)) bySkill.set(r.skill, { test_name: r.test_name, seq: [] });
    bySkill.get(r.skill).seq.push(r.correct);
  }
  const out = [];
  for (const [skill, data] of bySkill) {
    const seq = data.seq;
    if (seq.length < TREND_MIN) {
      out.push({
        skill, test_name: data.test_name, attempts: seq.length, direction: 'unknown',
        recent: null, earlier: null, delta: null, note: `only ${seq.length} answered`,
      });
      continue;
    }
    const half = Math.min(TREND_WINDOW, Math.floor(seq.length / 2));
    const recent = seq.slice(-half);
    const earlier = seq.slice(-2 * half, -half);
    const rAcc = recent.reduce((a, b) => a + b, 0) / recent.length;
    const eAcc = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const delta = rAcc - eAcc;
    const direction = delta >= 0.10 ? 'up' : delta <= -0.10 ? 'down' : 'flat';
    out.push({
      skill, test_name: data.test_name, attempts: seq.length, direction,
      recent: rAcc, earlier: eAcc, delta, window: half,
      note: `last ${half} vs previous ${half}`,
    });
  }
  const order = { down: 0, flat: 1, unknown: 2, up: 3 };
  return sortByKey(out, (t) => [order[t.direction], t.delta || 0]);
}

export function sectionProjection(db) {
  const byTest = byTestFor(db, 'collegeboard');
  const scores = projectScore(byTest);
  const sections = sortByKey(Object.entries(byTest), ([id]) => [Number(id)]).map(([id, data]) => ({
    test: Number(id),
    test_name: data.test_name,
    attempts: data.attempts,
    accuracy: data.accuracy,
    score: scores[data.test_name] ?? null,
    enough: data.attempts >= MIN_ATTEMPTS_FOR_PROJECTION,
    needed: Math.max(0, MIN_ATTEMPTS_FOR_PROJECTION - data.attempts),
  }));
  return { sections, total: scores.Total ?? null };
}

/* Turn the metrics into a concrete 'do this now' recommendation. */
export function studyPlan(db, minutes = 30) {
  const ov = overview(db);
  const weak = weakest(db, 3);
  const budget = Math.max(5, Math.trunc(minutes / 1.4));
  const steps = [];
  if (ov.due_reviews) {
    const n = Math.min(ov.due_reviews, Math.max(3, Math.floor(budget / 3)));
    steps.push({
      action: 'review',
      count: n,
      label: `Clear ${n} due review${n !== 1 ? 's' : ''} (questions you previously missed)`,
    });
  }
  let remaining = budget - steps.reduce((a, s) => a + s.count, 0);
  for (const w of weak) {
    if (remaining <= 0) break;
    const n = Math.min(remaining, Math.max(4, Math.floor(budget / 3)));
    steps.push({ action: 'drill', skill: w.skill, count: n, label: `Drill ${n} on ${w.skill} — ${w.reason}` });
    remaining -= n;
  }
  return { minutes, steps };
}
