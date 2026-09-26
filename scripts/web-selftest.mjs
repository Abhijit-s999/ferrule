// Offline check of the web build's in-page backend, run before every deploy.
//
// Builds a tiny question bank by hand (no network), then drives the same
// /api/* routes the page uses: answer, grade, undo, analytics, and the
// save -> reload -> backup -> restore round trip that users' progress
// depends on. Exits non-zero on the first failure.

import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { createApi } from '../web/lib/api.js';
import { correctedKey } from '../web/lib/answerkey.js';
import { fixMathml } from '../web/lib/mathtex.js';
import { memoryKV, Store } from '../web/lib/store.js';

const SQL = await initSqlJs();
const kv = memoryKV();
const store = await new Store(SQL, kv).open();
const api = createApi(store, { storage: null });

const call = async (method, path, body = {}) => {
  const url = new URL(path, 'http://ferrule.local');
  const [status, payload] = await api.handle(method, url.pathname, url.searchParams, body);
  return { status, payload };
};
const ok = async (method, path, body) => {
  const { status, payload } = await call(method, path, body);
  assert.equal(status, 200, `${method} ${path} -> ${status} ${JSON.stringify(payload)}`);
  return payload;
};

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('bank starts empty', async () => {
  assert.equal((await ok('GET', '/api/state')).bank_size, 0);
});

check('questions can be stored and served', async () => {
  const db = store.db;
  const add = (id, skill, diff, type, answer) => db.run(
    `INSERT INTO questions (external_id, test, test_name, domain, skill, difficulty,
       qtype, stem, options, correct_answer, rationale, created_at)
     VALUES (?, 2, 'Math', 'Algebra', ?, ?, ?, ?, ?, ?, 'because', ?)`,
    [id, skill, diff, type, `<p>stem ${id}</p>`,
      JSON.stringify(type === 'mcq' ? ['A', 'B', 'C', 'D'].map((l) => ({ letter: l, content: l })) : []),
      JSON.stringify(answer), Date.UTC(2026, 6, 1)],
  );
  for (let i = 0; i < 12; i++) add(`m${i}`, i % 2 ? 'Linear equations' : 'Systems', 'EMH'[i % 3], 'mcq', ['B']);
  add('g1', 'Linear equations', 'M', 'spr', ['1/2', '.5']);
  await store.saveBank();
  const qs = (await ok('GET', '/api/questions?n=10')).questions;
  assert.equal(qs.length, 10);
  assert.ok(qs.every((q) => !('correct_answer' in q)), 'answers must not reach the page early');
});

check('grading and review scheduling', async () => {
  assert.equal((await ok('POST', '/api/answer', { external_id: 'm0', response: 'A', elapsed_ms: 40000 })).correct, false);
  assert.equal((await ok('POST', '/api/answer', { external_id: 'm1', response: 'b', elapsed_ms: 30000 })).correct, true);
  assert.equal((await ok('POST', '/api/answer', { external_id: 'g1', response: '0.50', elapsed_ms: 1 })).correct, true);
  // A miss is scheduled for review (due again within the sitting, not yet).
  assert.equal(store.db.get("SELECT COUNT(*) AS n FROM reviews WHERE external_id = 'm0'").n, 1);
  assert.equal((await call('POST', '/api/answer', { external_id: 'nope', response: 'A' })).status, 404);
});

check('undo removes a misclick', async () => {
  await ok('POST', '/api/answer', { external_id: 'm2', response: 'C' });
  assert.equal((await ok('POST', '/api/answer/undo', { external_id: 'm2' })).undone, true);
  assert.equal((await ok('GET', '/api/state')).attempts, 3);
});

check('analytics and weakness routes answer', async () => {
  const a = await ok('GET', '/api/analytics');
  assert.ok(Array.isArray(a.matrix) && a.matrix.length === 2);
  assert.ok((await ok('GET', '/api/weakness/plan')).targets.length > 0);
  assert.ok((await ok('GET', '/api/weakness/queue?n=5')).questions.length > 0);
  assert.equal((await ok('GET', '/api/bank?per=5')).total, 13);
});

check('progress survives a reload from storage alone', async () => {
  const again = await new Store(SQL, kv).open();
  assert.equal(again.db.get('SELECT COUNT(*) AS n FROM attempts').n, 3);
  assert.equal(again.db.get('SELECT COUNT(*) AS n FROM questions').n, 13);
});

check('backup and restore round trip', async () => {
  const backup = await ok('GET', '/api/progress/export');
  assert.equal(backup.format, 'ferrule-progress');
  assert.equal(backup.attempts.length, 3);
  await ok('POST', '/api/answer', { external_id: 'm3', response: 'D' });
  assert.equal((await ok('POST', '/api/progress/import', { data: backup })).attempts, 3);
  assert.equal((await ok('GET', '/api/storage')).since_backup, 0);
  // A wrong file must change nothing.
  assert.equal((await call('POST', '/api/progress/import', { data: { format: 'nope' } })).status, 400);
  assert.equal((await ok('GET', '/api/state')).attempts, 3);
});

check('tutor routes say desktop only', async () => {
  assert.equal((await ok('GET', '/api/runtime/status')).web, true);
  const { payload } = await call('POST', '/api/tutor/explain', { external_id: 'm0' });
  assert.match(payload, /desktop app/);
});

check('maths markup and answer-key repair', async () => {
  assert.equal(
    fixMathml('<mfenced><mi>x</mi></mfenced>'),
    '<mrow><mo fence="true" stretchy="true">(</mo><mi>x</mi><mo fence="true" stretchy="true">)</mo></mrow>',
  );
  const opts = ['450', '500', '550', '600'].map((c, i) => ({ letter: 'ABCD'[i], content: c }));
  assert.equal(correctedKey(opts, ['D'], 'The total is $450 + $50 = $500.'), 'B');
  assert.equal(correctedKey(opts, ['B'], 'The total is $450 + $50 = $500.'), null);
  assert.equal(correctedKey(opts, ['D'], 'The answer follows from the table.'), null);
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
console.log(failed ? `\nweb selftest FAILED (${failed})` : '\nweb selftest passed');
process.exit(failed ? 1 : 0);
