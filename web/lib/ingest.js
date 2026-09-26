/* Writing downloaded questions into the database.
 * Ported from the storage half of ferrule/db.py; the docstrings there say
 * why each step exists. */

import { correctedKey } from './answerkey.js';
import { fixMathml, render } from './mathtex.js';
import { nowMs } from './store.js';

export function upsertQuestionStub(db, row, test, testName) {
  db.run(
    `INSERT INTO questions
         (external_id, question_id, program, test, test_name, domain_cd, domain,
          skill_cd, skill, difficulty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_id) DO UPDATE SET
         difficulty = excluded.difficulty,
         skill      = excluded.skill,
         domain     = excluded.domain,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
    [
      row.external_id, row.questionId, row.program, test, testName,
      row.primary_class_cd, row.primary_class_cd_desc, row.skill_cd,
      row.skill_desc, row.difficulty, row.createDate, row.updateDate,
    ],
  );
}

/* Merge casing variants of one skill ("Cross-Text Connections" and
 * "Cross-text Connections") into its most common spelling. */
export function normalizeSkillNames(db) {
  db.run('UPDATE questions SET skill = TRIM(skill) WHERE skill != TRIM(skill)');
  db.run('UPDATE questions SET domain = TRIM(domain) WHERE domain != TRIM(domain)');
  const groups = new Map();
  for (const r of db.all(
    'SELECT skill, COUNT(*) AS n FROM questions WHERE skill IS NOT NULL GROUP BY skill',
  )) {
    const k = r.skill.trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([r.n, r.skill]);
  }
  let merged = 0;
  for (const variants of groups.values()) {
    if (variants.length < 2) continue;
    // Most frequent spelling wins; ties break the same way Python's max() does.
    const canonical = variants.reduce((a, b) =>
      (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a))[1];
    for (const [, name] of variants) {
      if (name !== canonical) {
        db.run('UPDATE questions SET skill = ? WHERE skill = ?', [canonical, name]);
        merged++;
      }
    }
  }
  return merged;
}

/* Hide questions that point at a figure the bank never shipped. The wording
 * has to imply a picture is present: "the graph OF y = h(x)" is answerable. */
const NOUN = '(?:figure|diagram|scatterplot|graph|chart|table)';
const SHOWN = new RegExp(
  [
    `\\bin\\s+the\\s+${NOUN}\\b(?!\\s+of\\b)`,
    `\\bthe\\s+${NOUN}\\s+(?:above|below|shown)\\b`,
    `\\b${NOUN}\\s+(?:above|below)\\b`,
    `\\brefer\\s+to\\s+the\\s+${NOUN}\\b`,
    `\\baccording\\s+to\\s+the\\s+${NOUN}\\b(?!\\s+of\\b)`,
    '\\bas\\s+shown\\s+in\\s+the\\b',
    '\\bshown\\s+(?:above|below)\\b',
  ].join('|'),
  'i',
);

export function flagUnanswerable(db) {
  db.run('UPDATE questions SET unusable = 0');
  const flagged = [];
  for (const r of db.all(
    `SELECT external_id, stem, stimulus, options FROM questions
     WHERE stem IS NOT NULL AND stem != ''`,
  )) {
    const blob = (r.stem || '') + (r.stimulus || '') + (r.options || '');
    if (blob.includes('<svg') || blob.includes('<table') || blob.includes('<img')) continue;
    if (SHOWN.test(blob.replace(/<[^>]+>/g, ' '))) flagged.push(r.external_id);
  }
  for (const id of flagged) db.run('UPDATE questions SET unusable = 1 WHERE external_id = ?', [id]);
  return flagged.length;
}

export function markPracticeTestItems(db, externalIds) {
  db.run('UPDATE questions SET in_practice_test = 0');
  for (const id of externalIds) {
    db.run('UPDATE questions SET in_practice_test = 1 WHERE external_id = ?', [id]);
  }
  return db.get('SELECT COUNT(*) AS n FROM questions WHERE in_practice_test = 1').n;
}

export function storeQuestionContent(db, externalId, payload) {
  const options = (payload.answerOptions || []).map((opt, i) => ({
    letter: String.fromCharCode(65 + i),
    content: fixMathml(opt.content || ''),
  }));
  let answer = payload.correct_answer || payload.keys || [];
  if (typeof answer === 'string') answer = [answer];
  db.run(
    `UPDATE questions SET
         qtype = ?, stem = ?, stimulus = ?, options = ?,
         correct_answer = ?, rationale = ?, fetched_at = ?
     WHERE external_id = ?`,
    [
      payload.type,
      fixMathml(payload.stem || ''),
      fixMathml(payload.stimulus || ''),
      JSON.stringify(options),
      JSON.stringify(answer),
      fixMathml(payload.rationale || ''),
      nowMs(),
      externalId,
    ],
  );
}

const DIFFICULTY_CODES = { easy: 'E', medium: 'M', hard: 'H' };

async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* One OpenSAT record, prepared for storage. Async only for the hash, so a
 * whole download can be prepared first and then written in one transaction. */
export async function prepareOpensatQuestion(item, section) {
  const inner = item.question || {};
  const choices = inner.choices || {};
  // OpenSAT writes the *string* "null" for absent fields.
  const clean = (v) => {
    const s = (v == null ? '' : String(v)).trim();
    return ['null', 'none', 'undefined', 'n/a'].includes(s.toLowerCase()) ? '' : s;
  };
  const entries = Object.entries(choices)
    .filter(([, content]) => content != null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const options = entries.map(([letter, content]) => ({ letter, content: render(content) }));

  // OpenSAT's own ids are not unique, so key on the RAW content instead:
  // stable across re-fetches and across changes to rendering.
  const fingerprint = (await sha1Hex([
    section,
    inner.paragraph || '',
    inner.question || '',
    entries.map(([letter, content]) => `${letter}=${content}`).join('|'),
  ].join('\x1f'))).slice(0, 20);

  let answer = inner.correct_answer;
  answer = typeof answer === 'string' ? [answer] : [...(answer || [])];
  const rationale = render(clean(inner.explanation));
  // A few percent of OpenSAT keys name the wrong letter; trust the worked
  // solution over the key when it unambiguously lands on another choice.
  const fixed = correctedKey(options, answer, rationale);
  if (fixed) answer = [fixed];

  const test = section === 'math' ? 2 : 1;
  const domain = String(item.domain || 'Unspecified').trim() || 'Unspecified';
  return [
    `opensat:${fingerprint}`,
    String(item.id),
    test,
    test === 2 ? 'Math' : 'Reading and Writing',
    domain,
    domain, // no skill tags upstream; domain stands in
    DIFFICULTY_CODES[String(item.difficulty ?? '').toLowerCase()] || 'M',
    options.length ? 'mcq' : 'spr',
    render(clean(inner.question)),
    render(clean(inner.paragraph)),
    JSON.stringify(options),
    JSON.stringify(answer),
    rationale,
    nowMs(),
  ];
}

export function storeOpensatRow(db, params) {
  db.run(
    `INSERT INTO questions
         (external_id, source, question_id, program, test, test_name,
          domain_cd, domain, skill_cd, skill, difficulty, in_practice_test,
          qtype, stem, stimulus, options, correct_answer, rationale, fetched_at)
     VALUES (?, 'opensat', ?, 'SAT', ?, ?, NULL, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_id) DO UPDATE SET
         stem = excluded.stem, options = excluded.options,
         correct_answer = excluded.correct_answer, rationale = excluded.rationale`,
    params,
  );
}
