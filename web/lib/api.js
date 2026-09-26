/* The web build's backend: the same /api/* routes ferrule/server.py serves,
 * answered inside the page instead of by a local Python process.
 *
 * The frontend (ferrule/static/app.js) is shared with the desktop app and
 * talks to its backend only through fetch('/api/...'). install() wraps
 * window.fetch so those calls land here and never touch the network. Keeping
 * the contract identical is what lets one frontend serve both builds.
 *
 * Differences from the desktop backend:
 *  - the AI tutor routes answer "desktop only": a model cannot run in a page;
 *  - /api/progress/* and /api/storage exist, because the browser's copy of
 *    your progress can be wiped by clearing site data, so it needs a backup. */

import * as fetcher from './fetch.js';
import * as scheduler from './scheduler.js';
import * as sources from './sources.js';
import * as stats from './stats.js';
import * as weakness from './weakness.js';
import {
  exportProgress, getMeta, nowMs, questionCount, replaceProgress, rowToQuestion, setMeta,
} from './store.js';

export const RELEASES_URL = 'https://github.com/Abhijit-s999/ferrule/releases/latest';

const TUTOR_OFF =
  'The AI tutor runs a language model on your own computer, which a web page cannot do. ' +
  'It is part of the free desktop app — see Settings for how to get it.';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApi(store, env = {}) {
  const storage = env.storage || (typeof navigator !== 'undefined' ? navigator.storage : null);
  const fetchState = { phase: 'idle', detail: '', error: '', count: 0 };
  const db = () => store.db;

  async function runFetch(withOpensat) {
    try {
      await fetcher.run(store, { withOpensat, say: (line) => { fetchState.detail = line; } });
      Object.assign(fetchState, { phase: 'done', detail: 'Done.', count: questionCount(db()) });
      // Ask the browser not to evict the bank under storage pressure. Most
      // grant this silently for a site you use; it cannot survive the user
      // clearing site data, which is what the backup is for.
      try { if (storage && storage.persist) await storage.persist(); } catch { /* best effort */ }
    } catch (e) {
      Object.assign(fetchState, { phase: 'error', error: e.message || String(e) });
    }
  }

  function bankWhere(q, where, params) {
    const one = (k) => q.get(k);
    for (const [key, col] of [['test', 'q.test'], ['domain', 'q.domain'], ['skill', 'q.skill'],
      ['difficulty', 'q.difficulty'], ['source', 'q.source']]) {
      const val = one(key);
      if (val) {
        where.push(`${col} = ?`);
        params.push(key === 'test' ? parseInt(val, 10) : val);
      }
    }
    // Only College Board questions carry a date, so an active cutoff excludes
    // the undated community set -- the same rule the scheduler uses.
    const since = one('since');
    if (since && since !== '0') {
      where.push('q.created_at IS NOT NULL AND q.created_at >= ?');
      params.push(parseInt(since, 10));
    }
    const search = (one('q') || '').trim();
    if (search) {
      where.push('(q.stem LIKE ? OR q.stimulus LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
  }

  const skillFacets = () => db().all(
    `SELECT test, test_name, domain, skill, COUNT(*) AS n
     FROM questions WHERE stem IS NOT NULL AND stem != ''
     GROUP BY test, domain, skill ORDER BY test, domain, skill`,
  );

  /* Browse the whole bank: filter, search, page. No timer, no scoring. */
  function bank(q) {
    const int = (k, d) => parseInt(q.get(k) || d, 10) || parseInt(d, 10);
    const page = Math.max(1, int('page', '1'));
    const per = Math.min(50, Math.max(5, int('per', '20')));
    const where = ['q.stem IS NOT NULL', "q.stem != ''"];
    const params = [];
    bankWhere(q, where, params);
    if (q.get('reserved') === 'hide') where.push('q.in_practice_test = 0');
    else if (q.get('reserved') === 'only') where.push('q.in_practice_test = 1');
    if (q.get('unseen') === '1') where.push('a.id IS NULL');
    if (q.get('missed') === '1') where.push('a.correct = 0');
    const clause = where.join(' AND ');

    const total = db().get(
      `SELECT COUNT(DISTINCT q.external_id) AS n FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE ${clause}`,
      params,
    ).n;
    const items = db().all(
      `SELECT q.*,
              COUNT(a.id) AS attempts,
              COALESCE(SUM(a.correct), 0) AS correct
       FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE ${clause}
       GROUP BY q.external_id
       ORDER BY q.test, q.domain, q.skill, q.difficulty
       LIMIT ? OFFSET ?`,
      [...params, per, (page - 1) * per],
    ).map((r) => ({
      ...rowToQuestion(r),
      stem: r.stem,
      stimulus: r.stimulus,
      rationale: r.rationale || '',
      correct_answer: JSON.parse(r.correct_answer || '[]'),
      attempts: r.attempts,
      correct: r.correct,
      in_practice_test: r.in_practice_test,
    }));
    return {
      items, total, page, per,
      pages: Math.max(1, Math.ceil(total / per)),
      facets: {
        skills: skillFacets(),
        sources: db().all(
          `SELECT source, COUNT(*) n FROM questions
           WHERE stem IS NOT NULL AND stem != '' GROUP BY source`,
        ),
      },
    };
  }

  /* A buffered batch for an uninterrupted run through the bank. */
  function bankQueue(q) {
    const n = Math.min(60, Math.max(5, parseInt(q.get('n') || '25', 10) || 25));
    const where = ['q.stem IS NOT NULL', "q.stem != ''", 'q.unusable = 0'];
    const params = [];
    if (!scheduler.allowReserved(db())) where.push('q.in_practice_test = 0');
    bankWhere(q, where, params);
    const exclude = (q.get('exclude') || '').split(',').filter(Boolean);
    if (exclude.length) {
      where.push(`q.external_id NOT IN (${sources.placeholders(exclude)})`);
      params.push(...exclude);
    }
    return db().all(
      `SELECT q.*, COUNT(a.id) AS seen
       FROM questions q
       LEFT JOIN attempts a ON a.external_id = q.external_id
       WHERE ${where.join(' AND ')}
       GROUP BY q.external_id
       ORDER BY seen ASC, RANDOM()
       LIMIT ?`,
      [...params, n],
    ).map(rowToQuestion);
  }

  const weaknessOpts = (q) => ({
    target: q.get('target'),
    min_E: q.get('min_E'), min_M: q.get('min_M'), min_H: q.get('min_H'),
    order: q.get('order'), test: q.get('test'),
    recent_first: q.get('recent_first') !== '0',
  });

  async function storageStatus() {
    let persisted = null, usage = null, quota = null;
    try {
      if (storage && storage.persisted) persisted = await storage.persisted();
      if (storage && storage.estimate) ({ usage = null, quota = null } = await storage.estimate());
    } catch { /* not every browser exposes these */ }
    const last = parseInt(getMeta(db(), 'last_backup') || '0', 10) || 0;
    return {
      persisted, usage, quota,
      last_backup: last || null,
      since_backup: db().get('SELECT COUNT(*) AS n FROM attempts WHERE answered_at > ?', [last]).n,
      attempts: db().get('SELECT COUNT(*) AS n FROM attempts').n,
    };
  }

  const runtimeStatus = () => ({
    web: true, selected: null, running: false, phase: 'idle', progress: 0, detail: '',
    models: [], installed_models: [], vram_gb: null, accelerator: { label: 'web browser' },
    data_dir: '', releases_url: RELEASES_URL,
  });

  const GET = {
    '/api/state': () => stats.overview(db()),
    '/api/questions': (q) => {
      const n = parseInt(q.get('n') || '10', 10) || 10;
      const test = q.get('test');
      return {
        questions: scheduler.selectQuestions(db(), {
          n: Math.max(1, Math.min(n, 60)),
          test: test ? parseInt(test, 10) : null,
          skill: q.get('skill') || null,
        }),
      };
    },
    '/api/stats': () => ({
      overview: stats.overview(db()),
      by_type: stats.byType(db()),
      weakest: stats.weakest(db()),
      trend: stats.recentTrend(db()),
    }),
    '/api/analytics': () => ({
      overview: stats.overview(db()),
      matrix: stats.skillDifficultyMatrix(db()),
      difficulty: stats.difficultyBreakdown(db()),
      timeline: stats.timeline(db()),
      time_distribution: stats.timeDistribution(db()),
      weakest: stats.weakest(db(), 8),
      trends: stats.skillTrends(db()),
      projection: stats.sectionProjection(db()),
      target_accuracy: stats.TARGET_ACCURACY,
    }),
    '/api/plan': (q) => stats.studyPlan(db(), parseInt(q.get('minutes') || '30', 10) || 30),
    '/api/vintages': () => ({
      vintages: stats.vintages(db()),
      min_created: scheduler.minCreated(db()),
      allow_reserved: scheduler.allowReserved(db()),
    }),
    '/api/sources': () => ({
      sources: stats.bySource(db()),
      vintages: stats.vintages(db()),
      min_created: scheduler.minCreated(db()),
      allow_reserved: scheduler.allowReserved(db()),
      reserved_total: db().get('SELECT COUNT(*) AS n FROM questions WHERE in_practice_test = 1').n,
      enabled: sources.enabledIds(db()),
      catalog: Object.values(sources.SOURCES),
      not_fetched: Object.values(sources.NOT_FETCHED),
    }),
    '/api/tutor/config': () => ({ config: {}, providers: [], vram_gb: null, models: [] }),
    '/api/tutor/health': () => ({ ok: false, error: TUTOR_OFF }),
    '/api/runtime/status': runtimeStatus,
    '/api/fetch/status': () => {
      if (fetchState.phase === 'running') fetchState.count = questionCount(db());
      return { ...fetchState };
    },
    '/api/bank': bank,
    '/api/weakness/plan': (q) => weakness.plan(db(), weaknessOpts(q)),
    '/api/weakness/queue': (q) => ({
      questions: weakness.queue(
        db(), weaknessOpts(q),
        Math.min(40, Math.max(5, parseInt(q.get('n') || '20', 10) || 20)),
        (q.get('exclude') || '').split(',').filter(Boolean),
      ),
    }),
    '/api/bank/queue': (q) => ({ questions: bankQueue(q) }),
    '/api/skills': () => ({ skills: skillFacets() }),
    '/api/storage': storageStatus,
    '/api/progress/export': async () => {
      setMeta(db(), 'last_backup', nowMs());
      await store.saveProgress();
      return exportProgress(db());
    },
  };

  // Routes that change progress. Each is saved before it answers, so nothing
  // the page reports as done can be lost to a tab closing a moment later.
  const POST = {
    '/api/session': (b) => {
      db().run('INSERT INTO sessions (started_at, mode) VALUES (?, ?)', [nowMs(), b.mode || 'practice']);
      return { session_id: db().lastId() };
    },
    '/api/answer': (b) => {
      const [correct, detail] = scheduler.grade(db(), b.external_id, b.response);
      scheduler.recordAttempt(db(), b.external_id, b.response, correct, b.elapsed_ms || 0, b.session_id);
      return { correct, ...detail };
    },
    '/api/answer/undo': (b) => ({ undone: scheduler.undoAttempt(db(), b.external_id) }),
    '/api/sources': (b) => {
      try {
        return { enabled: sources.setEnabled(db(), b.enabled || []) };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    },
    '/api/reserved': (b) => ({ allow_reserved: scheduler.setAllowReserved(db(), Boolean(b.allow)) }),
    '/api/vintages': (b) => {
      scheduler.setMinCreated(db(), b.min_created || 0);
      return { min_created: scheduler.minCreated(db()), vintages: stats.vintages(db()) };
    },
    '/api/progress/import': (b) => {
      try {
        replaceProgress(db(), b.data);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
      return {
        attempts: db().get('SELECT COUNT(*) AS n FROM attempts').n,
        sessions: db().get('SELECT COUNT(*) AS n FROM sessions').n,
      };
    },
  };

  // Routes that do not touch progress, or save for themselves.
  const POST_OTHER = {
    '/api/fetch/start': (b) => {
      if (fetchState.phase !== 'running') {
        // Marked running before the download starts, so the first status poll
        // can never read "idle" and give up.
        Object.assign(fetchState, { phase: 'running', detail: 'Starting…', error: '', count: 0 });
        runFetch(Boolean(b.with_opensat));
      }
      return { ...fetchState };
    },
    '/api/tutor/config': () => ({ config: {} }),
    '/api/runtime/start': runtimeStatus,
    '/api/runtime/eject': runtimeStatus,
    '/api/runtime/stop': runtimeStatus,
    '/api/runtime/delete': runtimeStatus,
    '/api/storage/persist': async () => {
      let persisted = false;
      try { if (storage && storage.persist) persisted = await storage.persist(); } catch { /* */ }
      return { persisted };
    },
  };

  const STREAMS = new Set(['/api/tutor/explain', '/api/tutor/chat']);

  /* Answer one request. Returns [status, payload, contentType]. */
  async function handle(method, path, query, body) {
    try {
      if (method === 'GET' && GET[path]) return [200, await GET[path](query)];
      if (method === 'POST' && STREAMS.has(path)) {
        return [200, `data: ${JSON.stringify({ error: TUTOR_OFF })}\n\n`, 'text/event-stream'];
      }
      if (method === 'POST' && POST[path]) {
        const out = POST[path](body);
        await store.saveProgress();
        return [200, out];
      }
      if (method === 'POST' && POST_OTHER[path]) return [200, await POST_OTHER[path](body)];
      return [404, { error: `no route ${method} ${path}` }];
    } catch (e) {
      if (!e.status && typeof console !== 'undefined') console.error(`${method} ${path} failed`, e);
      return [e.status || 500, { error: e.message || String(e) }];
    }
  }

  return { handle, fetchState };
}

/* Route fetch('/api/...') to the in-page backend; everything else is real. */
export function install(api, target = globalThis) {
  const realFetch = target.fetch.bind(target);
  target.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (typeof raw !== 'string' || !raw.startsWith('/api/')) return realFetch(input, init);
    const url = new URL(raw, 'http://ferrule.local');
    const method = (init.method || 'GET').toUpperCase();
    let body = {};
    if (init.body) {
      try { body = JSON.parse(init.body); } catch { body = {}; }
    }
    const [status, payload, type] = await api.handle(method, url.pathname, url.searchParams, body);
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(text, {
      status,
      headers: { 'Content-Type': type || 'application/json; charset=utf-8' },
    });
  };
}
