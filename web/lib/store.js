/* Storage for the web build: SQLite in memory, persisted to IndexedDB.
 *
 * The desktop app keeps one SQLite file on disk. A browser has no such file,
 * so the same database runs in memory (sql.js) and is saved in two parts,
 * because the two parts change at very different rates:
 *
 *  - the question bank: ~25 MB, written only while downloading. Saved as a
 *    whole database image after each stretch of the download.
 *  - the progress record: answers, reviews, sessions and settings. A few
 *    hundred KB at most, and it changes on every answer, so it is saved after
 *    every change -- an answer must never depend on a later save to survive.
 *
 * On load the bank image is opened and the progress record replaces whatever
 * progress rows the image happened to carry. The progress record is also,
 * byte for byte, what the backup file contains, so saving, backing up and
 * restoring cannot drift apart.
 *
 * All of it lives in the browser's site storage. Clearing site data for the
 * page deletes it, which is why the UI offers a backup file.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
    external_id    TEXT PRIMARY KEY,
    source         TEXT NOT NULL DEFAULT 'collegeboard',
    question_id    TEXT,
    program        TEXT,
    test           INTEGER NOT NULL,
    test_name      TEXT NOT NULL,
    domain_cd      TEXT,
    domain         TEXT NOT NULL,
    skill_cd       TEXT,
    skill          TEXT NOT NULL,
    difficulty     TEXT NOT NULL,
    in_practice_test INTEGER NOT NULL DEFAULT 0,
    unusable       INTEGER NOT NULL DEFAULT 0,
    qtype          TEXT,
    stem           TEXT,
    stimulus       TEXT,
    options        TEXT,
    correct_answer TEXT,
    rationale      TEXT,
    created_at     INTEGER,
    updated_at     INTEGER,
    fetched_at     INTEGER
);
CREATE TABLE IF NOT EXISTS attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL REFERENCES questions(external_id),
    session_id  INTEGER REFERENCES sessions(id),
    answered_at INTEGER NOT NULL,
    elapsed_ms  INTEGER NOT NULL,
    response    TEXT,
    correct     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
    external_id   TEXT PRIMARY KEY REFERENCES questions(external_id),
    due_at        INTEGER NOT NULL,
    interval_days REAL NOT NULL,
    ease          REAL NOT NULL,
    reps          INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    last_at       INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER,
    mode       TEXT
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE INDEX IF NOT EXISTS idx_q_skill   ON questions(skill);
CREATE INDEX IF NOT EXISTS idx_q_test    ON questions(test);
CREATE INDEX IF NOT EXISTS idx_q_domain  ON questions(domain);
CREATE INDEX IF NOT EXISTS idx_q_diff    ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_q_source  ON questions(source);
CREATE INDEX IF NOT EXISTS idx_q_created ON questions(created_at);
CREATE INDEX IF NOT EXISTS idx_a_qid     ON attempts(external_id);
CREATE INDEX IF NOT EXISTS idx_a_when    ON attempts(answered_at);
CREATE INDEX IF NOT EXISTS idx_r_due     ON reviews(due_at);
`;

// The tables that make up "your progress", with the columns a backup carries.
const PROGRESS_TABLES = {
  attempts: ['id', 'external_id', 'session_id', 'answered_at', 'elapsed_ms', 'response', 'correct'],
  reviews: ['external_id', 'due_at', 'interval_days', 'ease', 'reps', 'lapses', 'last_at'],
  sessions: ['id', 'started_at', 'ended_at', 'mode'],
  meta: ['key', 'value'],
};
export const PROGRESS_FORMAT = 'ferrule-progress';
export const PROGRESS_VERSION = 1;

export const nowMs = () => Date.now();

/* A thin query layer with the same shape everywhere the Python used
 * conn.execute(...).fetchall() / .fetchone(). */
export class DB {
  constructor(sqldb) {
    this.sql = sqldb;
  }

  static _param(v) {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }

  all(sql, params = []) {
    const st = this.sql.prepare(sql);
    try {
      st.bind(params.map(DB._param));
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally {
      st.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  run(sql, params = []) {
    this.sql.run(sql, params.map(DB._param));
  }

  lastId() {
    return this.get('SELECT last_insert_rowid() AS id').id;
  }

  transaction(fn) {
    this.sql.run('BEGIN');
    try {
      const out = fn();
      this.sql.run('COMMIT');
      return out;
    } catch (e) {
      this.sql.run('ROLLBACK');
      throw e;
    }
  }
}

export function getMeta(db, key, fallback = null) {
  const row = db.get('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  db.run(
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)],
  );
}

export function questionCount(db, onlyComplete = true) {
  let sql = 'SELECT COUNT(*) AS n FROM questions';
  if (onlyComplete) sql += " WHERE stem IS NOT NULL AND stem != ''";
  return db.get(sql).n;
}

/* Shape a row into the dict the frontend consumes (answer withheld). */
export function rowToQuestion(row) {
  return {
    external_id: row.external_id,
    source: row.source,
    test: row.test,
    test_name: row.test_name,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    qtype: row.qtype,
    stem: row.stem,
    stimulus: row.stimulus,
    options: JSON.parse(row.options || '[]'),
  };
}

// ---------------------------------------------------------------- progress

export function exportProgress(db) {
  const out = {
    format: PROGRESS_FORMAT,
    version: PROGRESS_VERSION,
    saved_at: nowMs(),
  };
  for (const [table, cols] of Object.entries(PROGRESS_TABLES)) {
    out[table] = db.all(`SELECT ${cols.join(', ')} FROM ${table}`);
  }
  return out;
}

/* Check a backup before touching anything, so a wrong file changes nothing. */
export function validateProgress(data) {
  if (!data || typeof data !== 'object' || data.format !== PROGRESS_FORMAT) {
    throw new Error('That file is not a ferrule progress backup.');
  }
  if (data.version > PROGRESS_VERSION) {
    throw new Error('That backup was made by a newer version of ferrule. Reload the page and try again.');
  }
  for (const table of Object.keys(PROGRESS_TABLES)) {
    if (!Array.isArray(data[table])) {
      throw new Error(`The backup is incomplete: it has no ${table}.`);
    }
  }
}

/* Replace every progress row with the ones in `data`. All or nothing. */
export function replaceProgress(db, data) {
  validateProgress(data);
  db.transaction(() => {
    for (const [table, cols] of Object.entries(PROGRESS_TABLES)) {
      db.run(`DELETE FROM ${table}`);
      const sql = `INSERT INTO ${table} (${cols.join(', ')})
                   VALUES (${cols.map(() => '?').join(', ')})`;
      for (const row of data[table]) {
        db.run(sql, cols.map((c) => (row[c] === undefined ? null : row[c])));
      }
    }
  });
}

// ---------------------------------------------------------------- persistence

/* Key-value storage backed by IndexedDB. Node tests pass a Map-backed one. */
export function indexedDbKV(name = 'ferrule') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  let handle = null;
  const store = async (mode) => {
    handle = handle || await open();
    return handle.transaction('kv', mode).objectStore('kv');
  };
  const wrap = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    async get(key) { return wrap((await store('readonly')).get(key)); },
    async put(key, value) {
      const s = await store('readwrite');
      // Resolve on transaction commit, not on the request: only then is the
      // write actually durable.
      await new Promise((resolve, reject) => {
        s.put(value, key);
        s.transaction.oncomplete = resolve;
        s.transaction.onerror = () => reject(s.transaction.error);
        s.transaction.onabort = () => reject(s.transaction.error || new Error('storage write aborted'));
      });
    },
    async del(key) { return wrap((await store('readwrite')).delete(key)); },
  };
}

export function memoryKV() {
  const m = new Map();
  return {
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
  };
}

export class Store {
  constructor(SQL, kv) {
    this.SQL = SQL;
    this.kv = kv;
    this.db = null;
    // Writes are chained so two saves can never land out of order.
    this._chain = Promise.resolve();
  }

  async open() {
    const image = await this.kv.get('bank');
    this.db = new DB(image ? new this.SQL.Database(image) : new this.SQL.Database());
    this.db.sql.exec(SCHEMA);
    const progress = await this.kv.get('progress');
    if (progress) replaceProgress(this.db, progress);
    return this;
  }

  _queue(fn) {
    this._chain = this._chain.then(fn, fn);
    return this._chain;
  }

  saveProgress() {
    return this._queue(() => this.kv.put('progress', exportProgress(this.db)));
  }

  /* The whole database image. Carries progress too, harmlessly: on load the
   * progress record, which is always at least as new, replaces it. */
  saveBank() {
    return this._queue(() => this.kv.put('bank', this.db.sql.export()));
  }
}
