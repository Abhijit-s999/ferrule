"""SQLite storage for the question bank and the practice record.

The database is a local cache. It is never committed: the questions come from
College Board and belong to College Board (see README, "Licensing"). Every user
runs the fetcher and builds their own copy.
"""

import hashlib
import json
import os
import sqlite3
import time

DEFAULT_DB = os.path.join(os.path.expanduser("~"), ".local", "share", "ferrule", "ferrule.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS questions (
    external_id    TEXT PRIMARY KEY,
    -- Which project this question came from; see sources.py for terms and
    -- attribution. Recorded per row so provenance survives in the data.
    source         TEXT NOT NULL DEFAULT 'collegeboard',
    question_id    TEXT,
    program        TEXT,
    test           INTEGER NOT NULL,      -- 1 = Reading & Writing, 2 = Math
    test_name      TEXT NOT NULL,
    domain_cd      TEXT,
    domain         TEXT NOT NULL,
    skill_cd       TEXT,
    skill          TEXT NOT NULL,
    difficulty     TEXT NOT NULL,         -- E / M / H
    -- 1 if this question also appears in an official full-length practice test.
    -- Held back by default so Bluebook practice scores stay an honest measure.
    in_practice_test INTEGER NOT NULL DEFAULT 0,
    -- 1 if the question references a figure the bank never shipped, making it
    -- unanswerable. Kept in the browsable bank, kept out of practice.
    unusable       INTEGER NOT NULL DEFAULT 0,
    qtype          TEXT,                  -- mcq / spr
    stem           TEXT,
    stimulus       TEXT,
    options        TEXT,                  -- JSON: [{"letter","content"}]
    correct_answer TEXT,                  -- JSON: ["B"] or ["403", "403.0"]
    rationale      TEXT,
    -- When College Board added / last revised the question in its bank. Almost
    -- always identical to each other; kept separate in case that changes.
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

-- One row per question the user has ever missed or struggled with (SM-2 state).
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

CREATE INDEX IF NOT EXISTS idx_q_skill      ON questions(skill);
CREATE INDEX IF NOT EXISTS idx_q_test       ON questions(test);
CREATE INDEX IF NOT EXISTS idx_q_domain     ON questions(domain);
CREATE INDEX IF NOT EXISTS idx_q_diff       ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_a_qid        ON attempts(external_id);
CREATE INDEX IF NOT EXISTS idx_a_when       ON attempts(answered_at);
CREATE INDEX IF NOT EXISTS idx_r_due        ON reviews(due_at);
"""


def connect(path=None):
    """Open the database, creating it and its parent directory if needed."""
    path = path or os.environ.get("FERRULE_DB") or DEFAULT_DB
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn):
    """Additive migrations, so an existing database survives an upgrade."""
    have = {r["name"] for r in conn.execute("PRAGMA table_info(questions)")}
    if "in_practice_test" not in have:
        conn.execute(
            "ALTER TABLE questions ADD COLUMN in_practice_test INTEGER NOT NULL DEFAULT 0"
        )
    if "source" not in have:
        # Everything stored before sources existed came from College Board.
        conn.execute(
            "ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'collegeboard'"
        )
    for col in ("created_at", "updated_at"):
        if col not in have:
            conn.execute(f"ALTER TABLE questions ADD COLUMN {col} INTEGER")
    if "unusable" not in have:
        conn.execute(
            "ALTER TABLE questions ADD COLUMN unusable INTEGER NOT NULL DEFAULT 0"
        )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_q_source ON questions(source)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_q_created ON questions(created_at)")
    conn.commit()


def normalize_skill_names(conn):
    """Merge casing variants of the same skill into one canonical spelling.

    The upstream bank contains e.g. both "Cross-Text Connections" and
    "Cross-text Connections". Left alone they become two rows in every report
    and two independent accuracy estimates, which is exactly the metric this
    tool exists to get right. For each case-insensitive group we keep the most
    common spelling and rewrite the rest.
    """
    # Some upstream skill names carry stray leading/trailing whitespace.
    conn.execute("UPDATE questions SET skill = TRIM(skill) WHERE skill != TRIM(skill)")
    conn.execute("UPDATE questions SET domain = TRIM(domain) WHERE domain != TRIM(domain)")

    groups = {}
    for r in conn.execute(
        "SELECT skill, COUNT(*) AS n FROM questions WHERE skill IS NOT NULL GROUP BY skill"
    ):
        groups.setdefault(r["skill"].strip().lower(), []).append((r["n"], r["skill"]))

    merged = 0
    for variants in groups.values():
        if len(variants) < 2:
            continue
        canonical = max(variants)[1]  # most frequent spelling wins
        for _, name in variants:
            if name != canonical:
                conn.execute(
                    "UPDATE questions SET skill = ? WHERE skill = ?", (canonical, name)
                )
                merged += 1
    conn.commit()
    return merged


def flag_unanswerable(conn):
    """Hide questions that point at a figure the bank never shipped.

    A handful of questions say "in the figure above" or "the graph shown" but
    carry no SVG, table or image — the drawing simply is not in the data, and
    no amount of re-fetching will produce it. They cannot be solved, so serving
    one is worse than serving nothing: it reads as your own failure.

    The wording has to imply a picture is *present*. Phrases like "the graph of
    y = h(x) has an x-intercept" describe a graph conceptually and are perfectly
    answerable, so they must not be caught.
    """
    import re

    # Must imply a picture is actually on the page. "the graph OF y = h(x)"
    # describes one in words and stays answerable, so `of` is excluded
    # explicitly -- it was the single biggest source of false positives.
    noun = r"(?:figure|diagram|scatterplot|graph|chart|table)"
    shown = re.compile(
        rf"\bin\s+the\s+{noun}\b(?!\s+of\b)"
        rf"|\bthe\s+{noun}\s+(?:above|below|shown)\b"
        rf"|\b{noun}\s+(?:above|below)\b"
        rf"|\brefer\s+to\s+the\s+{noun}\b"
        rf"|\baccording\s+to\s+the\s+{noun}\b(?!\s+of\b)"
        r"|\bas\s+shown\s+in\s+the\b"
        r"|\bshown\s+(?:above|below)\b",
        re.I,
    )

    conn.execute("UPDATE questions SET unusable = 0")
    flagged = []
    for r in conn.execute(
        "SELECT external_id, stem, stimulus, options FROM questions "
        "WHERE stem IS NOT NULL AND stem != ''"
    ):
        blob = (r["stem"] or "") + (r["stimulus"] or "") + (r["options"] or "")
        if "<svg" in blob or "<table" in blob or "<img" in blob:
            continue
        if shown.search(re.sub(r"<[^>]+>", " ", blob)):
            flagged.append((r["external_id"],))

    conn.executemany(
        "UPDATE questions SET unusable = 1 WHERE external_id = ?", flagged
    )
    conn.commit()
    return len(flagged)


def mark_practice_test_items(conn, external_ids):
    """Flag the questions that also appear in official full-length practice tests."""
    conn.execute("UPDATE questions SET in_practice_test = 0")
    conn.executemany(
        "UPDATE questions SET in_practice_test = 1 WHERE external_id = ?",
        [(eid,) for eid in external_ids],
    )
    conn.commit()
    return conn.execute(
        "SELECT COUNT(*) AS n FROM questions WHERE in_practice_test = 1"
    ).fetchone()["n"]


def now_ms():
    return int(time.time() * 1000)


def get_meta(conn, key, default=None):
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(conn, key, value):
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )
    conn.commit()


def question_count(conn, only_complete=True):
    sql = "SELECT COUNT(*) AS n FROM questions"
    if only_complete:
        sql += " WHERE stem IS NOT NULL AND stem != ''"
    return conn.execute(sql).fetchone()["n"]


def upsert_question_stub(conn, row, test, test_name):
    """Insert the index-level metadata (tags) for a question, without content."""
    conn.execute(
        """
        INSERT INTO questions
            (external_id, question_id, program, test, test_name, domain_cd, domain,
             skill_cd, skill, difficulty, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_id) DO UPDATE SET
            difficulty = excluded.difficulty,
            skill      = excluded.skill,
            domain     = excluded.domain,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        """,
        (
            row.get("external_id"),
            row.get("questionId"),
            row.get("program"),
            test,
            test_name,
            row.get("primary_class_cd"),
            row.get("primary_class_cd_desc"),
            row.get("skill_cd"),
            row.get("skill_desc"),
            row.get("difficulty"),
            row.get("createDate"),
            row.get("updateDate"),
        ),
    )


def store_question_content(conn, external_id, payload):
    """Fill in stem/options/answer/rationale for a question already stubbed."""
    from . import mathtex

    raw_options = payload.get("answerOptions") or []
    options = [
        {"letter": chr(65 + i), "content": mathtex.fix_mathml(opt.get("content", ""))}
        for i, opt in enumerate(raw_options)
    ]
    answer = payload.get("correct_answer") or payload.get("keys") or []
    if isinstance(answer, str):
        answer = [answer]
    conn.execute(
        """
        UPDATE questions SET
            qtype = ?, stem = ?, stimulus = ?, options = ?,
            correct_answer = ?, rationale = ?, fetched_at = ?
        WHERE external_id = ?
        """,
        (
            payload.get("type"),
            mathtex.fix_mathml(payload.get("stem") or ""),
            mathtex.fix_mathml(payload.get("stimulus") or ""),
            json.dumps(options),
            json.dumps(answer),
            mathtex.fix_mathml(payload.get("rationale") or ""),
            now_ms(),
            external_id,
        ),
    )


DIFFICULTY_CODES = {"easy": "E", "medium": "M", "hard": "H"}


def store_opensat_question(conn, item, section):
    """Store one OpenSAT record, mapped onto the same shape as official ones.

    OpenSAT tags questions by domain only, with no skill breakdown, so the
    domain doubles as the skill. Stats keep sources separate, so this never
    silently mixes with skill-level numbers from the official bank.
    """
    inner = item.get("question") or {}
    choices = inner.get("choices") or {}

    def clean(v):
        """OpenSAT writes the *string* "null" for absent fields, which would
        otherwise be rendered to the reader as the word null."""
        s = (v or "").strip()
        return "" if s.lower() in ("null", "none", "undefined", "n/a") else s
    # Convert LaTeX on the individual strings, before they are serialised.
    # Doing it after json.dumps would see "\\frac" rather than "\frac" and
    # would inject unescaped quotes into the JSON.
    from . import mathtex

    options = [
        {"letter": letter, "content": mathtex.render(content)}
        for letter, content in sorted(choices.items())
        if content is not None
    ]

    # OpenSAT's own `id` field is not unique -- across the bank, 2,474 questions
    # share only 1,200 ids ("random_id_a1" alone repeats 91 times). Keying on it
    # would silently drop half the questions, so key on the content instead:
    # stable across re-fetches, and unique per distinct question.
    # Derived from the RAW upstream fields only. If it were computed from the
    # rendered text, any change to rendering would give every question a new
    # identity and re-import would insert duplicates instead of updating.
    fingerprint = hashlib.sha1(
        "\x1f".join(
            [
                section,
                (inner.get("paragraph") or ""),
                (inner.get("question") or ""),
                "|".join(
                    f"{letter}={content}"
                    for letter, content in sorted(choices.items())
                    if content is not None
                ),
            ]
        ).encode("utf-8")
    ).hexdigest()[:20]
    answer = inner.get("correct_answer")
    answer = [answer] if isinstance(answer, str) else list(answer or [])

    test = 2 if section == "math" else 1
    test_name = "Math" if test == 2 else "Reading and Writing"
    domain = (item.get("domain") or "Unspecified").strip()

    conn.execute(
        """
        INSERT INTO questions
            (external_id, source, question_id, program, test, test_name,
             domain_cd, domain, skill_cd, skill, difficulty, in_practice_test,
             qtype, stem, stimulus, options, correct_answer, rationale, fetched_at)
        VALUES (?, 'opensat', ?, 'SAT', ?, ?, NULL, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_id) DO UPDATE SET
            stem = excluded.stem, options = excluded.options,
            correct_answer = excluded.correct_answer, rationale = excluded.rationale
        """,
        (
            f"opensat:{fingerprint}",
            str(item.get("id")),
            test,
            test_name,
            domain,
            domain,  # no skill tags upstream; domain stands in
            DIFFICULTY_CODES.get(str(item.get("difficulty", "")).lower(), "M"),
            "mcq" if options else "spr",
            mathtex.render(clean(inner.get("question"))),
            mathtex.render(clean(inner.get("paragraph"))),
            json.dumps(options),
            json.dumps(answer),
            mathtex.render(clean(inner.get("explanation"))),
            now_ms(),
        ),
    )


def row_to_question(row):
    """Shape a DB row into the dict the frontend consumes (answer withheld)."""
    return {
        "external_id": row["external_id"],
        "source": row["source"],
        "test": row["test"],
        "test_name": row["test_name"],
        "domain": row["domain"],
        "skill": row["skill"],
        "difficulty": row["difficulty"],
        "qtype": row["qtype"],
        "stem": row["stem"],
        "stimulus": row["stimulus"],
        "options": json.loads(row["options"] or "[]"),
    }
