/* Weakness targeting: drill one (skill, difficulty) cell until it is fixed.
 * Ported from ferrule/weakness.py -- see that file for why unproven cells
 * rank as the weakest thing you have, and why cells retire rather than
 * questions. */

import { allowReserved } from './scheduler.js';
import { enabledIds, placeholders } from './sources.js';
import { rowToQuestion } from './store.js';
import { pct0, roundHalfEven, sortByKey } from './util.js';

const CONFIDENT_BY_DIFFICULTY = { E: 8, M: 15, H: 20 };
const CONFIDENT_ATTEMPTS = 20;
const DIFFICULTY_ORDER = { E: 0, M: 1, H: 2 };
const DIFFICULTY_NAME = { E: 'Easy', M: 'Medium', H: 'Hard' };

const DEFAULTS = {
  target: 0.8,
  min_attempts: { ...CONFIDENT_BY_DIFFICULTY },
  order: 'easiest-first',
  test: null,
  recent_first: true,
};

function opts(raw = {}) {
  const o = { ...DEFAULTS, min_attempts: { ...DEFAULTS.min_attempts } };
  for (const [k, v] of Object.entries(raw || {})) {
    if (k in o && v !== null && v !== undefined && v !== '') o[k] = v;
  }
  o.target = Math.max(0.4, Math.min(1.0, parseFloat(o.target)));

  const base = o.min_attempts;
  const table = {};
  if (typeof base === 'object') {
    for (const [k, v] of Object.entries(base)) table[k] = parseInt(v, 10);
  } else {
    for (const d of ['E', 'M', 'H']) table[d] = parseInt(base, 10);
  }
  for (const d of ['E', 'M', 'H']) {
    const override = (raw || {})[`min_${d}`];
    if (override !== null && override !== undefined && override !== '') table[d] = parseInt(override, 10);
    table[d] = Math.max(1, Math.min(60, table[d] ?? CONFIDENT_ATTEMPTS));
  }
  o.min_attempts = table;
  if (o.test) o.test = parseInt(o.test, 10);
  return o;
}

const confidentFor = (o, difficulty) => o.min_attempts[difficulty] ?? CONFIDENT_ATTEMPTS;

/* Every (skill, difficulty) cell with its record and its standing. */
export function cells(db, rawOpts) {
  const o = opts(rawOpts);
  const enabled = enabledIds(db);
  const params = [...enabled];
  const reserve = allowReserved(db) ? '' : 'AND q.in_practice_test = 0';
  let where = '';
  if (o.test) { where = 'AND q.test = ?'; params.push(o.test); }

  const out = db.all(
    `SELECT q.test, q.test_name, q.domain, q.skill, q.difficulty,
            COUNT(a.id)                                   AS attempts,
            COALESCE(SUM(a.correct), 0)                   AS correct,
            COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0)     AS avg_ms,
            SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END) AS available
     FROM questions q
     LEFT JOIN attempts a ON a.external_id = q.external_id
     WHERE q.stem IS NOT NULL AND q.stem != '' AND q.unusable = 0
       ${reserve} AND q.source IN (${placeholders(enabled)}) ${where}
     GROUP BY q.test, q.domain, q.skill, q.difficulty`,
    params,
  ).map((r) => {
    const { attempts, correct } = r;
    const acc = attempts ? correct / attempts : null;
    // A cell cannot be proven past the number of questions it contains.
    const total = attempts + r.available;
    const needed = total ? Math.min(confidentFor(o, r.difficulty), total) : 0;
    const proven = Boolean(needed) && attempts >= needed;
    const mastered = Boolean(proven && acc !== null && acc >= o.target);
    const exhausted = r.available === 0 && !mastered;
    const gap = !proven
      ? (needed ? 1.0 + (1.0 - attempts / needed) : 0.0)
      : Math.max(0.0, o.target - acc);
    return {
      test: r.test,
      test_name: r.test_name,
      domain: r.domain,
      skill: r.skill,
      difficulty: r.difficulty,
      difficulty_name: DIFFICULTY_NAME[r.difficulty] ?? r.difficulty,
      attempts,
      correct,
      accuracy: acc,
      avg_ms: Math.trunc(r.avg_ms || 0),
      available: r.available,
      proven,
      mastered,
      exhausted,
      total,
      gap: roundHalfEven(gap, 4),
      needs: Math.max(0, needed - attempts),
    };
  });
  return sortByKey(out, (c) => rank(c, o));
}

/* Sort key. Lower sorts earlier. */
function rank(cell, o) {
  if (cell.mastered || !cell.available) return [9, 0, 0, 0];
  const d = DIFFICULTY_ORDER[cell.difficulty] ?? 1;
  const diffKey = o.order === 'easiest-first' ? d : o.order === 'hardest-first' ? -d : 0;
  return [cell.proven ? 1 : 0, diffKey, -cell.gap, cell.skill];
}

export function plan(db, rawOpts) {
  const o = opts(rawOpts);
  const ranked = cells(db, rawOpts);
  const active = ranked.filter((c) => !c.mastered && c.available);
  const done = ranked.filter((c) => c.mastered);
  const dry = ranked.filter((c) => c.exhausted);
  for (const c of active) {
    c.reason = !c.proven
      ? (c.attempts ? `only ${c.attempts} answered — not enough to judge` : 'never attempted')
      : `${pct0(c.accuracy)}, target ${pct0(o.target)}`;
  }
  for (const c of dry) {
    c.reason = c.accuracy !== null
      ? `${pct0(c.accuracy)} — no unseen questions left in this cell`
      : 'no questions available';
  }
  return {
    options: o,
    targets: active,
    mastered: done,
    exhausted: dry,
    remaining: active.length,
    confident_attempts: o.min_attempts,
    confident_by_difficulty: o.min_attempts,
  };
}

/* Questions from the cells that need work, weakest cell first. */
export function queue(db, rawOpts, n = 20, exclude = []) {
  const o = opts(rawOpts);
  const enabled = enabledIds(db);
  const reserve = allowReserved(db) ? '' : 'AND q.in_practice_test = 0';
  const picked = [];
  const seen = new Set(exclude.filter(Boolean));
  for (const cell of cells(db, rawOpts)) {
    if (picked.length >= n) break;
    if (cell.mastered || !cell.available) continue;
    const ex = seen.size ? placeholders([...seen]) : "''";
    const rows = db.all(
      `SELECT q.* FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE q.skill = ? AND q.difficulty = ?
         AND q.stem IS NOT NULL AND q.stem != '' AND q.unusable = 0
         ${reserve} AND q.source IN (${placeholders(enabled)})
         AND a.id IS NULL
         AND q.external_id NOT IN (${ex})
       GROUP BY q.external_id
       ORDER BY ${o.recent_first ? 'q.created_at DESC,' : ''} RANDOM()
       LIMIT ?`,
      [cell.skill, cell.difficulty, ...enabled, ...seen, n - picked.length],
    );
    for (const r of rows) {
      picked.push([r, cell]);
      seen.add(r.external_id);
    }
  }
  return picked.map(([row, cell]) => ({
    ...rowToQuestion(row),
    cell: {
      skill: cell.skill,
      difficulty: cell.difficulty,
      difficulty_name: cell.difficulty_name,
      attempts: cell.attempts,
      accuracy: cell.accuracy,
      proven: cell.proven,
      needs: cell.needs,
    },
  }));
}
