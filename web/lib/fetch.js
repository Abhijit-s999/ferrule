/* Download the question bank, from the browser, into this browser's storage.
 * Ported from ferrule/fetch.py.
 *
 * College Board's educator question bank is a public API that its own site
 * calls from the browser, and it allows cross-origin requests. So each
 * visitor's browser fetches its own copy straight from College Board: the
 * site hosting ferrule never holds, relays or serves a question.
 *
 * Bodies are sent as text/plain. The API parses them the same, and a
 * text/plain POST needs no CORS preflight, which halves the request count --
 * kinder to College Board and a faster first run. */

import {
  flagUnanswerable, markPracticeTestItems, normalizeSkillNames,
  prepareOpensatQuestion, storeOpensatRow, storeQuestionContent, upsertQuestionStub,
} from './ingest.js';
import { nowMs, questionCount, setMeta } from './store.js';

const BASE = 'https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank';
const LOOKUP_URL = `${BASE}/lookup`;
const LIST_URL = `${BASE}/digital/get-questions`;
const DETAIL_URL = `${BASE}/digital/get-question`;
const OPENSAT_URL = 'https://api.jsonsilo.com/public/942c3c3b-3a0c-4be3-81c2-12029def19f5';

const SAT = 99; // assessment id from /lookup: 99 = SAT
const TEST_IDS = { 'R&W': 1, Math: 2 };
const TEST_NAMES = { 1: 'Reading and Writing', 2: 'Math' };

// Save the database image this often while content downloads, so closing the
// tab midway loses at most this many questions, not the whole download.
const CHECKPOINT_EVERY = 400;

export class FetchError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, payload = null, { timeout = 45000, retries = 4 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, payload === null
        ? { signal: ctl.signal }
        : {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
          signal: ctl.signal,
        });
      if (res.ok) return await res.json();
      last = new FetchError(`${url} -> HTTP ${res.status}`);
      // Client errors other than rate-limiting will not fix themselves.
      if (res.status < 500 && res.status !== 429) throw last;
    } catch (e) {
      if (e instanceof FetchError) throw e;
      last = e;
    } finally {
      clearTimeout(timer);
    }
    await sleep(1500 * 2 ** attempt);
  }
  // A browser reports a blocked or offline request only as "Failed to fetch",
  // which tells nobody anything. Say what it usually means.
  const why = last && last.name === 'AbortError' ? 'it timed out' : (last && last.message) || 'no response';
  throw new FetchError(
    `Could not reach the question bank (${why}). Check your internet connection. ` +
    'Some school networks block College Board’s question API; a phone hotspot ' +
    'or home network usually works. Everything already downloaded is kept.',
  );
}

function taxonomyFrom(lookup) {
  const domains = (lookup.lookupData || {}).domain || {};
  const out = {};
  for (const [label, entries] of Object.entries(domains)) {
    const id = TEST_IDS[label];
    if (id) out[id] = entries.map((d) => d.primaryClassCd);
  }
  if (!Object.keys(out).length) {
    throw new FetchError('lookup returned no domains; the API shape may have changed');
  }
  return out;
}

async function fetchIndex(db, say) {
  const lookup = await request(LOOKUP_URL);
  const taxonomy = taxonomyFrom(lookup);
  let total = 0;
  for (const test of Object.keys(taxonomy).map(Number).sort()) {
    const rows = await request(LIST_URL, {
      asmtEventId: SAT, test, domain: taxonomy[test].join(','),
    });
    db.transaction(() => {
      for (const row of rows) {
        // Questions with only an `ibn` point at printed books; the API does
        // not serve their content.
        if (!row.external_id) continue;
        upsertQuestionStub(db, row, test, TEST_NAMES[test]);
        total++;
      }
    });
    say(`indexed ${rows.length} rows for ${TEST_NAMES[test]}`);
  }
  db.transaction(() => {
    normalizeSkillNames(db);
    flagUnanswerable(db);
    markPracticeTestItems(db, [...(lookup.readingLiveItems || []), ...(lookup.mathLiveItems || [])]);
  });
  return total;
}

async function fetchContent(store, say, workers = 6) {
  const db = store.db;
  const pending = db.all(
    `SELECT external_id FROM questions
     WHERE stem IS NULL OR stem = '' ORDER BY test, domain, skill`,
  ).map((r) => r.external_id);
  if (!pending.length) { say('all question content already downloaded'); return 0; }

  let next = 0, done = 0, failed = 0, sinceSave = 0, lastError = null;
  const started = Date.now();
  say(`downloading ${pending.length} questions`);

  const worker = async () => {
    while (next < pending.length) {
      const eid = pending[next++];
      try {
        storeQuestionContent(db, eid, await request(DETAIL_URL, { external_id: eid }));
        done++;
        sinceSave++;
      } catch (e) {
        failed++;
        lastError = e;
      }
      if (sinceSave >= CHECKPOINT_EVERY) {
        sinceSave = 0;
        await store.saveBank();
      }
      if (done && done % 50 === 0) {
        const rate = done / Math.max((Date.now() - started) / 1000, 0.01);
        const left = Math.round((pending.length - done - failed) / Math.max(rate, 0.01));
        say(`${done}/${pending.length} (${rate.toFixed(0)}/s, ~${left}s left)`);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  await store.saveBank();
  // Every request failing is not a partial download, it is no connection.
  if (!done && failed) throw lastError;
  say(`stored ${done} questions (${failed} failed)`);
  return done;
}

async function fetchOpensat(store, say) {
  const data = await request(OPENSAT_URL, null, { timeout: 90000 });
  let stored = 0;
  for (const section of ['english', 'math']) {
    const items = (data[section] || []).filter((it) => it.id && (it.question || {}).question);
    const rows = [];
    for (const item of items) rows.push(await prepareOpensatQuestion(item, section));
    store.db.transaction(() => rows.forEach((r) => storeOpensatRow(store.db, r)));
    stored += rows.length;
    say(`stored ${rows.length} ${section} questions`);
  }
  await store.saveBank();
  return stored;
}

/* Fetch enabled sources into the database. `say` receives progress lines. */
export async function run(store, { withOpensat = false, say = () => {} } = {}) {
  say('College Board -- indexing question tags');
  const indexed = await fetchIndex(store.db, say);
  say(`${indexed} questions indexed`);
  await fetchContent(store, say);

  if (withOpensat) {
    say('OpenSAT -- downloading community question database');
    try {
      await fetchOpensat(store, say);
    } catch (e) {
      say(`OpenSAT fetch failed (continuing): ${e.message}`);
    }
  }
  setMeta(store.db, 'last_fetch', nowMs());
  await store.saveProgress();
  const complete = questionCount(store.db);
  say(`Ready: ${complete} questions available.`);
  return complete;
}
