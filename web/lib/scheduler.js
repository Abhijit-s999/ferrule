/* Question selection: what should you practise next, and why.
 * Ported from ferrule/scheduler.py -- weakness-weighted sampling plus spaced
 * repetition on misses. The SQL is unchanged; see the Python for the reasoning
 * behind each weight and interval. */

import { getMeta, nowMs, rowToQuestion, setMeta } from './store.js';
import { enabledIds, placeholders } from './sources.js';

export function allowReserved(db) {
  return getMeta(db, 'allow_reserved') === '1';
}

export function setAllowReserved(db, on) {
  setMeta(db, 'allow_reserved', on ? '1' : '0');
  return allowReserved(db);
}

export function minCreated(db) {
  const raw = getMeta(db, 'min_created');
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function setMinCreated(db, cutoffMs) {
  setMeta(db, 'min_created', Math.trunc(Number(cutoffMs) || 0));
  return minCreated(db);
}

/* Restrict to enabled sources, usable questions, the reservation rule, and the
 * chosen vintage. Undated questions drop out whenever a cutoff is active. */
export function sourceFilter(db, alias = 'q') {
  const ids = enabledIds(db);
  let clause = `AND ${alias}.source IN (${placeholders(ids)}) AND ${alias}.unusable = 0`;
  const params = [...ids];
  if (!allowReserved(db)) clause += ` AND ${alias}.in_practice_test = 0`;
  const cutoff = minCreated(db);
  if (cutoff) {
    clause += ` AND ${alias}.created_at IS NOT NULL AND ${alias}.created_at >= ?`;
    params.push(cutoff);
  }
  return [clause, params];
}

// Share of the real digital SAT each domain occupies.
export const BLUEPRINT = {
  'Information and Ideas': 0.26,
  'Craft and Structure': 0.28,
  'Expression of Ideas': 0.20,
  'Standard English Conventions': 0.26,
  Algebra: 0.35,
  'Advanced Math': 0.35,
  'Problem-Solving and Data Analysis': 0.15,
  'Geometry and Trigonometry': 0.15,
};

const PRIOR_CORRECT = 1.6;
const PRIOR_TOTAL = 2.8;
const INTERVALS = [0.01, 0.05, 0.5, 1.5, 3.0, 6.0];

export function skillStats(db, test = null, source = null) {
  let where = 'WHERE 1=1';
  const params = [];
  if (test) { where += ' AND q.test = ?'; params.push(test); }
  if (source) {
    where += ' AND q.source = ?';
    params.push(source);
  } else {
    const [clause, sparams] = sourceFilter(db);
    where += ' ' + clause;
    params.push(...sparams);
  }
  return db.all(
    `SELECT q.test, q.test_name, q.domain, q.skill,
            COUNT(a.id)                                   AS attempts,
            COALESCE(SUM(a.correct), 0)                   AS correct,
            COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0)     AS avg_ms,
            MAX(a.answered_at)                            AS last_at
     FROM questions q
     LEFT JOIN attempts a ON a.external_id = q.external_id
     ${where}
     GROUP BY q.test, q.domain, q.skill
     ORDER BY q.test, q.domain, q.skill`,
    params,
  ).map((r) => ({
    test: r.test,
    test_name: r.test_name,
    domain: r.domain,
    skill: r.skill,
    attempts: r.attempts,
    correct: r.correct,
    accuracy: r.attempts ? r.correct / r.attempts : null,
    estimated: (r.correct + PRIOR_CORRECT) / (r.attempts + PRIOR_TOTAL),
    avg_ms: Math.trunc(r.avg_ms || 0),
    last_at: r.last_at,
  }));
}

/* How much this skill deserves the next question. Higher wins. */
export function priority(stat) {
  const weakness = (1.0 - stat.estimated) ** 1.6;
  const share = BLUEPRINT[stat.domain] ?? 0.2;
  const uncertainty = 1.0 + 1.2 / Math.sqrt(stat.attempts + 1.0);
  return Math.max(weakness * share * uncertainty, 1e-6);
}

function targetDifficulty(estimated) {
  if (estimated < 0.55) return ['E', 'E', 'M'];
  if (estimated < 0.78) return ['M', 'M', 'E', 'H'];
  return ['H', 'H', 'M'];
}

function dueReviews(db, limit, test = null) {
  let where = '';
  const params = [];
  if (test) { where = 'AND q.test = ?'; params.push(test); }
  const [clause, sparams] = sourceFilter(db);
  where += ' ' + clause;
  params.push(...sparams, nowMs(), limit);
  return db.all(
    `SELECT q.* FROM reviews r
     JOIN questions q ON q.external_id = r.external_id
     WHERE q.stem IS NOT NULL AND q.stem != '' ${where}
       AND r.due_at <= ?
     ORDER BY r.due_at ASC
     LIMIT ?`,
    params,
  );
}

function unseenForSkill(db, skill, difficulties, exclude) {
  const ex = exclude.size ? placeholders([...exclude]) : "''";
  const [sclause, sparams] = sourceFilter(db);
  for (const diff of [...difficulties, null]) {
    const row = db.get(
      `SELECT q.* FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE q.skill = ? AND q.stem IS NOT NULL AND q.stem != ''
         AND a.id IS NULL ${sclause}
         AND q.external_id NOT IN (${ex})
         ${diff ? 'AND q.difficulty = ?' : ''}
       ORDER BY RANDOM() LIMIT 1`,
      [skill, ...sparams, ...exclude, ...(diff ? [diff] : [])],
    );
    if (row) return row;
  }
  return null;
}

function weightedIndex(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/* Build the next practice set. */
export function selectQuestions(db, { n = 10, test = null, skill = null, reviewShare = 0.35 } = {}) {
  const picked = [];
  const seen = new Set();
  const [sclause, sparams] = sourceFilter(db);

  if (skill) { // explicit drill: one skill, nothing else
    return db.all(
      `SELECT q.* FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE q.skill = ? AND q.stem IS NOT NULL AND q.stem != ''
         AND a.id IS NULL ${sclause}
       ORDER BY RANDOM() LIMIT ?`,
      [skill, ...sparams, n],
    ).map(rowToQuestion);
  }

  // Overdue misses first -- the highest-value questions in the bank.
  for (const row of dueReviews(db, Math.max(1, Math.trunc(n * reviewShare)), test)) {
    picked.push(row);
    seen.add(row.external_id);
  }

  const stats = skillStats(db, test).filter((s) => s.skill);
  if (!stats.length) return picked.map(rowToQuestion);

  const pool = [...stats];
  const weights = pool.map(priority);
  while (picked.length < n && pool.length) {
    const idx = weightedIndex(weights);
    const stat = pool[idx];
    const row = unseenForSkill(db, stat.skill, targetDifficulty(stat.estimated), seen);
    if (row) {
      picked.push(row);
      seen.add(row.external_id);
    } else {
      // Skill exhausted (or not downloaded yet): drop it so a partial bank
      // still yields a full set.
      pool.splice(idx, 1);
      weights.splice(idx, 1);
    }
  }

  if (picked.length < n) {
    const ex = seen.size ? placeholders([...seen]) : "''";
    picked.push(...db.all(
      `SELECT q.* FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE q.stem IS NOT NULL AND q.stem != '' AND a.id IS NULL
         ${sclause}
         AND q.external_id NOT IN (${ex})
         ${test ? 'AND q.test = ?' : ''}
       ORDER BY RANDOM() LIMIT ?`,
      [...sparams, ...seen, ...(test ? [test] : []), n - picked.length],
    ));
  }
  return shuffle(picked).map(rowToQuestion);
}

function toFloat(s) {
  s = s.replace(/[ ,]/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(\/[+-]?(\d+\.?\d*|\.\d+))?$/i.test(s)) {
    throw new Error('not a number');
  }
  if (s.includes('/')) {
    const [num, den] = s.split('/');
    if (Number(den) === 0) throw new Error('division by zero');
    return Number(num) / Number(den);
  }
  return Number(s);
}

/* Grid-in answers: accept equivalent numeric forms (0.5 == .5 == 1/2). */
function numericMatch(given, key) {
  const a = String(given).trim();
  const b = String(key).trim();
  if (!a) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  try {
    const x = toFloat(a), y = toFloat(b);
    // math.isclose(rel_tol=1e-4, abs_tol=1e-6)
    return Math.abs(x - y) <= Math.max(1e-4 * Math.max(Math.abs(x), Math.abs(y)), 1e-6);
  } catch {
    return false;
  }
}

export function grade(db, externalId, response) {
  const row = db.get(
    'SELECT correct_answer, rationale, options, qtype FROM questions WHERE external_id = ?',
    [externalId],
  );
  if (!row) throw Object.assign(new Error(`unknown question '${externalId}'`), { status: 404 });
  const keys = JSON.parse(row.correct_answer || '[]');
  const given = (response || '').trim();
  const correct = row.qtype === 'spr'
    ? keys.some((k) => numericMatch(given, k))
    : keys.map((k) => String(k).trim().toUpperCase()).includes(given.toUpperCase());
  return [correct, { correct_answer: keys, rationale: row.rationale || '', qtype: row.qtype }];
}

/* Erase the most recent attempt at a question, for a misclick. */
export function undoAttempt(db, externalId) {
  const row = db.get(
    `SELECT id, correct FROM attempts WHERE external_id = ?
     ORDER BY answered_at DESC, id DESC LIMIT 1`,
    [externalId],
  );
  if (!row) return false;
  db.run('DELETE FROM attempts WHERE id = ?', [row.id]);
  const remaining = db.get('SELECT COUNT(*) AS n FROM attempts WHERE external_id = ?', [externalId]).n;
  if (remaining === 0) {
    db.run('DELETE FROM reviews WHERE external_id = ?', [externalId]);
  } else if (!row.correct) {
    db.run('UPDATE reviews SET lapses = MAX(0, lapses - 1) WHERE external_id = ?', [externalId]);
  }
  return true;
}

/* Log the attempt and advance this question's spaced-repetition state. */
export function recordAttempt(db, externalId, response, correct, elapsedMs, sessionId = null) {
  const now = nowMs();
  db.run(
    `INSERT INTO attempts
       (external_id, session_id, answered_at, elapsed_ms, response, correct)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [externalId, sessionId ?? null, now, Math.trunc(Number(elapsedMs) || 0), response ?? null, correct ? 1 : 0],
  );
  const row = db.get('SELECT * FROM reviews WHERE external_id = ?', [externalId]);

  let lapses, ease, interval, reps;
  if (!correct) {
    // A miss always re-enters the queue, and repeat misses come back sooner.
    lapses = (row ? row.lapses : 0) + 1;
    ease = Math.max(1.3, (row ? row.ease : 2.4) - 0.22);
    interval = INTERVALS[0];
    reps = 0;
  } else if (row) {
    reps = row.reps + 1;
    ease = Math.min(2.9, row.ease + 0.1);
    interval = INTERVALS[Math.min(reps, INTERVALS.length - 1)] * (ease / 2.4);
    lapses = row.lapses;
  } else {
    return; // first-time correct: nothing to schedule
  }
  db.run(
    `INSERT INTO reviews (external_id, due_at, interval_days, ease, reps, lapses, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_id) DO UPDATE SET
         due_at = excluded.due_at, interval_days = excluded.interval_days,
         ease = excluded.ease, reps = excluded.reps,
         lapses = excluded.lapses, last_at = excluded.last_at`,
    [externalId, now + Math.trunc(interval * 86400000), interval, ease, reps, lapses, now],
  );
}
