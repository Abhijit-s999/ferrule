"""Question selection: what should you practice next, and why.

Two ideas drive every choice.

1. Weakness-weighted sampling. Each skill gets a score combining how badly you
   perform on it, how much of the real exam it represents, and how little we
   know about you yet. Early sessions therefore behave like a diagnostic; later
   ones concentrate on whatever is actually costing you points.

2. Spaced repetition on misses. A question you got wrong comes back, first
   within the same sitting, then at widening gaps. Intervals are deliberately
   compressed relative to textbook SM-2 because people use this with a test
   weeks away, not months.
"""

import json
import math
import random

from . import db, sources


def _source_filter(conn, alias="q"):
    """Restrict a query to the sources the user practises from, and to the
    question vintage they asked for.

    Vintage matters because the bank keeps growing, and it grows in discrete
    batches rather than continuously -- College Board drops a few hundred
    questions at a time. The newest batch is the closest thing available to
    what the current exam looks like, which is worth practising on when your
    test is weeks away.

    Undated questions (the community source carries no dates) are excluded
    whenever a cutoff is active: "only questions added since July" cannot
    honestly include a question whose date nobody knows.
    """
    ids = sources.enabled_ids(conn)
    placeholders = ",".join("?" * len(ids))
    # `unusable` questions reference a figure the bank never shipped; they stay
    # browsable but must never be served as practice.
    clause = f"AND {alias}.source IN ({placeholders}) AND {alias}.unusable = 0"
    params = list(ids)

    cutoff = min_created(conn)
    if cutoff:
        clause += f" AND {alias}.created_at IS NOT NULL AND {alias}.created_at >= ?"
        params.append(cutoff)
    return clause, params


def min_created(conn):
    """Epoch-ms cutoff: only serve questions added at or after this instant."""
    raw = db.get_meta(conn, "min_created")
    try:
        return int(raw) if raw else 0
    except ValueError:
        return 0


def set_min_created(conn, cutoff_ms):
    db.set_meta(conn, "min_created", int(cutoff_ms or 0))
    return min_created(conn)

# Share of the real digital SAT each domain occupies. Used so that a weak but
# rare skill cannot crowd out a slightly-less-weak skill worth triple the points.
BLUEPRINT = {
    "Information and Ideas": 0.26,
    "Craft and Structure": 0.28,
    "Expression of Ideas": 0.20,
    "Standard English Conventions": 0.26,
    "Algebra": 0.35,
    "Advanced Math": 0.35,
    "Problem-Solving and Data Analysis": 0.15,
    "Geometry and Trigonometry": 0.15,
}

# Beta prior on per-skill accuracy. Centred slightly below average so an
# untested skill looks mildly risky and gets sampled early.
PRIOR_CORRECT = 1.6
PRIOR_TOTAL = 2.8

# Review intervals in days: same sitting, an hour, then spreading out.
INTERVALS = [0.01, 0.05, 0.5, 1.5, 3.0, 6.0]

MINUTE_MS = 60_000


def skill_stats(conn, test=None, source=None):
    """Per-skill accuracy, volume and pacing, blended with the prior."""
    where, params = "WHERE 1=1", []
    if test:
        where += " AND q.test = ?"
        params.append(test)
    if source:
        where += " AND q.source = ?"
        params.append(source)
    else:
        clause, sparams = _source_filter(conn)
        where += " " + clause
        params.extend(sparams)
    rows = conn.execute(
        f"""
        SELECT q.test, q.test_name, q.domain, q.skill,
               COUNT(a.id)                                   AS attempts,
               COALESCE(SUM(a.correct), 0)                   AS correct,
               COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0)     AS avg_ms,
               MAX(a.answered_at)                            AS last_at
        FROM questions q
        LEFT JOIN attempts a ON a.external_id = q.external_id
        {where}
        GROUP BY q.test, q.domain, q.skill
        ORDER BY q.test, q.domain, q.skill
        """,
        params,
    ).fetchall()

    out = []
    for r in rows:
        attempts, correct = r["attempts"], r["correct"]
        est = (correct + PRIOR_CORRECT) / (attempts + PRIOR_TOTAL)
        out.append(
            {
                "test": r["test"],
                "test_name": r["test_name"],
                "domain": r["domain"],
                "skill": r["skill"],
                "attempts": attempts,
                "correct": correct,
                "accuracy": (correct / attempts) if attempts else None,
                "estimated": est,
                "avg_ms": int(r["avg_ms"] or 0),
                "last_at": r["last_at"],
            }
        )
    return out


def _priority(stat):
    """How much this skill deserves the next question. Higher wins."""
    weakness = (1.0 - stat["estimated"]) ** 1.6
    share = BLUEPRINT.get(stat["domain"], 0.2)
    # Uncertainty bonus decays as evidence accumulates -> explore, then exploit.
    uncertainty = 1.0 + 1.2 / math.sqrt(stat["attempts"] + 1.0)
    return max(weakness * share * uncertainty, 1e-6)


def target_difficulty(estimated):
    """Aim just above current ability: hard enough to teach, not to demoralise."""
    if estimated < 0.55:
        return ["E", "E", "M"]
    if estimated < 0.78:
        return ["M", "M", "E", "H"]
    return ["H", "H", "M"]


def due_reviews(conn, limit, test=None):
    where, params = "", []
    if test:
        where = "AND q.test = ?"
        params.append(test)
    clause, sparams = _source_filter(conn)
    where += " " + clause
    params.extend(sparams)
    params.append(db.now_ms())
    params.append(limit)
    return conn.execute(
        f"""
        SELECT q.* FROM reviews r
        JOIN questions q ON q.external_id = r.external_id
        WHERE q.stem IS NOT NULL AND q.stem != '' {where}
          AND r.due_at <= ?
        ORDER BY r.due_at ASC
        LIMIT ?
        """,
        params,
    ).fetchall()


def _unseen_for_skill(conn, skill, difficulties, exclude, allow_practice_test=False):
    """One unattempted question in this skill, preferring the target difficulty."""
    placeholders = ",".join("?" * len(exclude)) if exclude else "''"
    reserve = "" if allow_practice_test else "AND q.in_practice_test = 0"
    sclause, sparams = _source_filter(conn)
    for diff in difficulties + [None]:
        sql = f"""
            SELECT q.* FROM questions q
            LEFT JOIN attempts a ON a.external_id = q.external_id
            WHERE q.skill = ? AND q.stem IS NOT NULL AND q.stem != ''
              AND a.id IS NULL {reserve} {sclause}
              AND q.external_id NOT IN ({placeholders})
              {"AND q.difficulty = ?" if diff else ""}
            ORDER BY RANDOM() LIMIT 1
        """
        params = [skill] + sparams + list(exclude) + ([diff] if diff else [])
        row = conn.execute(sql, params).fetchone()
        if row:
            return row
    return None


def select_questions(
    conn, n=10, test=None, skill=None, review_share=0.35, allow_practice_test=False
):
    """Build the next practice set.

    By default this never serves a question that also appears in an official
    full-length practice test, so those stay unseen and your Bluebook scores
    remain a real measurement rather than a memory check.
    """
    picked, seen = [], set()
    reserve = "" if allow_practice_test else "AND q.in_practice_test = 0"
    sclause, sparams = _source_filter(conn)

    if skill:  # explicit drill: one skill, nothing else
        rows = conn.execute(
            f"""
            SELECT q.* FROM questions q
            LEFT JOIN attempts a ON a.external_id = q.external_id
            WHERE q.skill = ? AND q.stem IS NOT NULL AND q.stem != ''
              AND a.id IS NULL {reserve} {sclause}
            ORDER BY RANDOM() LIMIT ?
            """,
            [skill] + sparams + [n],
        ).fetchall()
        return [db.row_to_question(r) for r in rows]

    # Overdue misses first -- these are the highest-value questions in the bank.
    for row in due_reviews(conn, max(1, int(n * review_share)), test):
        picked.append(row)
        seen.add(row["external_id"])

    stats = [s for s in skill_stats(conn, test) if s["skill"]]
    if not stats:
        return [db.row_to_question(r) for r in picked]

    pool = list(stats)
    weights = [_priority(s) for s in pool]
    while len(picked) < n and pool:
        idx = random.choices(range(len(pool)), weights=weights, k=1)[0]
        stat = pool[idx]
        row = _unseen_for_skill(
            conn,
            stat["skill"],
            target_difficulty(stat["estimated"]),
            seen,
            allow_practice_test,
        )
        if row:
            picked.append(row)
            seen.add(row["external_id"])
        else:
            # This skill is exhausted (or not downloaded yet). Drop it, so a
            # partial question bank still yields a full set.
            pool.pop(idx)
            weights.pop(idx)

    if len(picked) < n:
        # Last resort: anything unseen at all, so the user is never handed a
        # short set just because their bank is incomplete.
        placeholders = ",".join("?" * len(seen)) if seen else "''"
        extra = conn.execute(
            f"""
            SELECT q.* FROM questions q
            LEFT JOIN attempts a ON a.external_id = q.external_id
            WHERE q.stem IS NOT NULL AND q.stem != '' AND a.id IS NULL
              {reserve} {sclause}
              AND q.external_id NOT IN ({placeholders})
              {"AND q.test = ?" if test else ""}
            ORDER BY RANDOM() LIMIT ?
            """,
            sparams + list(seen) + ([test] if test else []) + [n - len(picked)],
        ).fetchall()
        picked.extend(extra)

    random.shuffle(picked)
    return [db.row_to_question(r) for r in picked]


def grade(conn, external_id, response):
    """Compare a response against the stored key. Returns (correct, detail)."""
    row = conn.execute(
        "SELECT correct_answer, rationale, options, qtype FROM questions WHERE external_id = ?",
        (external_id,),
    ).fetchone()
    if not row:
        raise KeyError(external_id)

    keys = json.loads(row["correct_answer"] or "[]")
    given = (response or "").strip()

    if row["qtype"] == "spr":
        correct = any(_numeric_match(given, k) for k in keys)
    else:
        correct = given.upper() in {str(k).strip().upper() for k in keys}

    return correct, {
        "correct_answer": keys,
        "rationale": row["rationale"] or "",
        "qtype": row["qtype"],
    }


def _numeric_match(given, key):
    """Grid-in answers: accept equivalent numeric forms (0.5 == .5 == 1/2)."""
    a, b = str(given).strip(), str(key).strip()
    if not a:
        return False
    if a.lower() == b.lower():
        return True
    try:
        return math.isclose(_to_float(a), _to_float(b), rel_tol=1e-4, abs_tol=1e-6)
    except (ValueError, ZeroDivisionError):
        return False


def _to_float(s):
    s = s.replace(" ", "").replace(",", "")
    if "/" in s:
        num, _, den = s.partition("/")
        return float(num) / float(den)
    return float(s)


def record_attempt(conn, external_id, response, correct, elapsed_ms, session_id=None):
    """Log the attempt and advance this question's spaced-repetition state."""
    now = db.now_ms()
    conn.execute(
        """INSERT INTO attempts
           (external_id, session_id, answered_at, elapsed_ms, response, correct)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (external_id, session_id, now, int(elapsed_ms or 0), response, 1 if correct else 0),
    )

    row = conn.execute(
        "SELECT * FROM reviews WHERE external_id = ?", (external_id,)
    ).fetchone()

    if not correct:
        # A miss always re-enters the queue, and repeat misses come back sooner.
        lapses = (row["lapses"] if row else 0) + 1
        ease = max(1.3, (row["ease"] if row else 2.4) - 0.22)
        interval = INTERVALS[0]
        reps = 0
    elif row:
        # A correct answer on a question you previously missed: step it along.
        reps = row["reps"] + 1
        ease = min(2.9, row["ease"] + 0.1)
        interval = INTERVALS[min(reps, len(INTERVALS) - 1)] * (ease / 2.4)
        lapses = row["lapses"]
    else:
        conn.commit()  # first-time correct: nothing to schedule
        return

    conn.execute(
        """
        INSERT INTO reviews (external_id, due_at, interval_days, ease, reps, lapses, last_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_id) DO UPDATE SET
            due_at = excluded.due_at, interval_days = excluded.interval_days,
            ease = excluded.ease, reps = excluded.reps,
            lapses = excluded.lapses, last_at = excluded.last_at
        """,
        (
            external_id,
            now + int(interval * 86_400_000),
            interval,
            ease,
            reps,
            lapses,
            now,
        ),
    )
    conn.commit()
