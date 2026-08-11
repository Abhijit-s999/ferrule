"""Analytics: accuracy and pacing broken down by question type.

Everything here answers one of three questions:
  - Where am I losing points?
  - Am I too slow anywhere?
  - What should I do with the next 30 minutes?
"""

from . import db, scheduler, sources

# Official section timing. 64 min for 54 R&W questions, 70 min for 44 Math.
PACE_TARGET_MS = {1: 71_000, 2: 95_000}

# A skill needs this many attempts before we call a weakness real rather than noise.
MIN_CONFIDENT_ATTEMPTS = 4


def overview(conn):
    row = conn.execute(
        """SELECT COUNT(*) AS attempts,
                  COALESCE(SUM(correct), 0) AS correct,
                  COALESCE(AVG(NULLIF(elapsed_ms, 0)), 0) AS avg_ms
           FROM attempts"""
    ).fetchone()
    attempts, correct = row["attempts"], row["correct"]

    by_test = {}
    for r in conn.execute(
        """SELECT q.test, q.test_name, COUNT(a.id) AS attempts,
                  COALESCE(SUM(a.correct), 0) AS correct,
                  COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms
           FROM attempts a JOIN questions q ON q.external_id = a.external_id
           GROUP BY q.test"""
    ):
        by_test[r["test"]] = {
            "test_name": r["test_name"],
            "attempts": r["attempts"],
            "correct": r["correct"],
            "accuracy": r["correct"] / r["attempts"] if r["attempts"] else None,
            "avg_ms": int(r["avg_ms"] or 0),
            "pace_target_ms": PACE_TARGET_MS.get(r["test"]),
        }

    due = conn.execute(
        "SELECT COUNT(*) AS n FROM reviews WHERE due_at <= ?", (db.now_ms(),)
    ).fetchone()["n"]

    enabled = sources.enabled_ids(conn)
    placeholders = ",".join("?" * len(enabled))
    available = conn.execute(
        f"""SELECT COUNT(*) AS n FROM questions
            WHERE stem IS NOT NULL AND stem != '' AND source IN ({placeholders})""",
        enabled,
    ).fetchone()["n"]

    return {
        "attempts": attempts,
        "correct": correct,
        "accuracy": (correct / attempts) if attempts else None,
        "avg_ms": int(row["avg_ms"] or 0),
        "by_test": by_test,
        "due_reviews": due,
        "bank_size": available,
        "bank_total": db.question_count(conn),
        "enabled_sources": enabled,
        "by_source": by_source(conn),
        # Scored from official questions only. Community questions are not
        # calibrated to real exam difficulty, so folding them in would make the
        # estimate mean nothing.
        "projection": project_score(_by_test(conn, source="collegeboard")),
    }


def _by_test(conn, source=None):
    where, params = "", []
    if source:
        where = "WHERE q.source = ?"
        params.append(source)
    out = {}
    for r in conn.execute(
        f"""SELECT q.test, q.test_name, COUNT(a.id) AS attempts,
                   COALESCE(SUM(a.correct), 0) AS correct
            FROM attempts a JOIN questions q ON q.external_id = a.external_id
            {where} GROUP BY q.test""",
        params,
    ):
        out[r["test"]] = {
            "test_name": r["test_name"],
            "attempts": r["attempts"],
            "accuracy": r["correct"] / r["attempts"] if r["attempts"] else None,
        }
    return out


def vintages(conn):
    """The batches College Board has added, newest first.

    Offered as real options rather than rolling "last 30 days" windows, because
    the bank arrives in lumps: on a bank whose last two drops were 2026-04 and
    2026-07, every window from 30 to 180 days returns the identical set, which
    would make the control look broken.
    """
    enabled = sources.enabled_ids(conn)
    placeholders = ",".join("?" * len(enabled))
    rows = conn.execute(
        f"""
        SELECT STRFTIME('%Y-%m', created_at / 1000, 'unixepoch') AS batch,
               MIN(created_at)                                   AS starts_at,
               COUNT(*)                                          AS total,
               SUM(CASE WHEN in_practice_test = 0 THEN 1 ELSE 0 END) AS available
        FROM questions
        WHERE created_at IS NOT NULL AND stem IS NOT NULL AND stem != ''
          AND source IN ({placeholders})
        GROUP BY batch ORDER BY starts_at DESC
        """,
        enabled,
    ).fetchall()

    out, running = [], 0
    for r in rows:
        running += r["available"]
        out.append(
            {
                "batch": r["batch"],
                "starts_at": r["starts_at"],
                "total": r["total"],
                "available": r["available"],
                # How many questions you'd have if you cut off at this batch.
                "cumulative_available": running,
            }
        )
    return out


def by_source(conn):
    """Accuracy per source, so official numbers never blend with community ones."""
    rows = conn.execute(
        """
        SELECT q.source,
               COUNT(a.id)                               AS attempts,
               COALESCE(SUM(a.correct), 0)               AS correct,
               COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms
        FROM questions q
        LEFT JOIN attempts a ON a.external_id = q.external_id
        GROUP BY q.source
        """
    ).fetchall()

    enabled = set(sources.enabled_ids(conn))
    out = []
    for r in rows:
        meta = sources.get(r["source"]) or {}
        bank = conn.execute(
            "SELECT COUNT(*) AS n FROM questions "
            "WHERE source = ? AND stem IS NOT NULL AND stem != ''",
            (r["source"],),
        ).fetchone()["n"]
        out.append(
            {
                "source": r["source"],
                "name": meta.get("name", r["source"]),
                "short": meta.get("short", r["source"]),
                "url": meta.get("url"),
                "official": meta.get("official", False),
                "enabled": r["source"] in enabled,
                "bank": bank,
                "attempts": r["attempts"],
                "correct": r["correct"],
                "accuracy": (r["correct"] / r["attempts"]) if r["attempts"] else None,
                "avg_ms": int(r["avg_ms"] or 0),
            }
        )
    return sorted(out, key=lambda s: (not s["official"], s["source"]))


def by_type(conn):
    """The per-question-type table: one row per skill, grouped under its domain."""
    stats = scheduler.skill_stats(conn)
    domains = {}
    for s in stats:
        target = PACE_TARGET_MS.get(s["test"], 80_000)
        entry = dict(s)
        entry["pace_target_ms"] = target
        entry["pace_ratio"] = (s["avg_ms"] / target) if s["avg_ms"] else None
        entry["confident"] = s["attempts"] >= MIN_CONFIDENT_ATTEMPTS
        entry["priority"] = scheduler._priority(s)
        domains.setdefault((s["test"], s["test_name"], s["domain"]), []).append(entry)

    out = []
    for (test, test_name, domain), skills in domains.items():
        attempts = sum(s["attempts"] for s in skills)
        correct = sum(s["correct"] for s in skills)
        timed = [s for s in skills if s["avg_ms"]]
        out.append(
            {
                "test": test,
                "test_name": test_name,
                "domain": domain,
                "attempts": attempts,
                "correct": correct,
                "accuracy": (correct / attempts) if attempts else None,
                "avg_ms": int(sum(s["avg_ms"] for s in timed) / len(timed)) if timed else 0,
                "exam_share": scheduler.BLUEPRINT.get(domain),
                "skills": sorted(skills, key=lambda s: -s["priority"]),
            }
        )
    return sorted(out, key=lambda d: (d["test"], -d["attempts"]))


DIFFICULTY_ORDER = ["E", "M", "H"]
DIFFICULTY_NAMES = {"E": "Easy", "M": "Medium", "H": "Hard"}

# Accuracy the heatmap treats as "on target"; cells diverge above and below it.
TARGET_ACCURACY = 0.75


def skill_difficulty_matrix(conn):
    """Accuracy per skill per difficulty -- the finest grain the data supports.

    A skill you handle at Easy but lose at Hard is a different problem from one
    you miss everywhere: the first needs practice at the top of the range, the
    second needs the underlying concept. One number per skill hides that; this
    matrix is what separates them.
    """
    enabled = sources.enabled_ids(conn)
    placeholders = ",".join("?" * len(enabled))
    rows = conn.execute(
        f"""
        SELECT q.test, q.test_name, q.domain, q.skill, q.difficulty,
               COUNT(a.id)                               AS attempts,
               COALESCE(SUM(a.correct), 0)               AS correct,
               COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms,
               SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END) AS unseen
        FROM questions q
        LEFT JOIN attempts a ON a.external_id = q.external_id
        WHERE q.stem IS NOT NULL AND q.stem != '' AND q.source IN ({placeholders})
        GROUP BY q.test, q.domain, q.skill, q.difficulty
        """,
        enabled,
    ).fetchall()

    skills = {}
    for r in rows:
        key = (r["test"], r["test_name"], r["domain"], r["skill"])
        entry = skills.setdefault(
            key,
            {
                "test": r["test"],
                "test_name": r["test_name"],
                "domain": r["domain"],
                "skill": r["skill"],
                "cells": {d: None for d in DIFFICULTY_ORDER},
                "attempts": 0,
                "correct": 0,
            },
        )
        if r["difficulty"] not in DIFFICULTY_ORDER:
            continue
        entry["cells"][r["difficulty"]] = {
            "difficulty": r["difficulty"],
            "attempts": r["attempts"],
            "correct": r["correct"],
            "accuracy": (r["correct"] / r["attempts"]) if r["attempts"] else None,
            "avg_ms": int(r["avg_ms"] or 0),
            "available": r["unseen"],
        }
        entry["attempts"] += r["attempts"]
        entry["correct"] += r["correct"]

    out = list(skills.values())
    for e in out:
        e["accuracy"] = (e["correct"] / e["attempts"]) if e["attempts"] else None
        # A skill that holds up on Easy but collapses on Hard: worth naming.
        easy, hard = e["cells"].get("E"), e["cells"].get("H")
        e["cliff"] = bool(
            easy and hard and easy["attempts"] >= 2 and hard["attempts"] >= 2
            and easy["accuracy"] is not None and hard["accuracy"] is not None
            and easy["accuracy"] - hard["accuracy"] >= 0.34
        )
    return sorted(out, key=lambda e: (e["test"], e["domain"], e["skill"]))


def difficulty_breakdown(conn):
    """Overall accuracy and pace at each difficulty, per section."""
    enabled = sources.enabled_ids(conn)
    placeholders = ",".join("?" * len(enabled))
    rows = conn.execute(
        f"""
        SELECT q.test, q.test_name, q.difficulty,
               COUNT(a.id)                               AS attempts,
               COALESCE(SUM(a.correct), 0)               AS correct,
               COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0) AS avg_ms
        FROM attempts a JOIN questions q ON q.external_id = a.external_id
        WHERE q.source IN ({placeholders})
        GROUP BY q.test, q.difficulty
        """,
        enabled,
    ).fetchall()

    out = {}
    for r in rows:
        bucket = out.setdefault(
            r["test"], {"test": r["test"], "test_name": r["test_name"], "levels": {}}
        )
        bucket["levels"][r["difficulty"]] = {
            "difficulty": r["difficulty"],
            "label": DIFFICULTY_NAMES.get(r["difficulty"], r["difficulty"]),
            "attempts": r["attempts"],
            "correct": r["correct"],
            "accuracy": (r["correct"] / r["attempts"]) if r["attempts"] else None,
            "avg_ms": int(r["avg_ms"] or 0),
            "pace_target_ms": PACE_TARGET_MS.get(r["test"]),
        }
    return sorted(out.values(), key=lambda b: b["test"])


def timeline(conn, days=21):
    """Per-day volume, accuracy and time spent -- the effort record."""
    rows = conn.execute(
        """
        SELECT DATE(a.answered_at / 1000, 'unixepoch', 'localtime') AS day,
               COUNT(*)                     AS attempts,
               SUM(a.correct)               AS correct,
               SUM(a.elapsed_ms)            AS total_ms
        FROM attempts a
        GROUP BY day ORDER BY day
        """
    ).fetchall()
    out = []
    running = 0
    for r in rows[-days:]:
        running += r["attempts"]
        out.append(
            {
                "day": r["day"],
                "attempts": r["attempts"],
                "correct": r["correct"],
                "accuracy": r["correct"] / r["attempts"] if r["attempts"] else None,
                "minutes": round((r["total_ms"] or 0) / 60000, 1),
                "cumulative": running,
            }
        )
    return out


def time_distribution(conn):
    """How long questions take, bucketed, split by difficulty.

    Averages hide the tail. A 40-second average with a handful of four-minute
    questions is a pacing problem an average will never show you.
    """
    enabled = sources.enabled_ids(conn)
    placeholders = ",".join("?" * len(enabled))
    rows = conn.execute(
        f"""
        SELECT q.difficulty, q.test, a.elapsed_ms, a.correct
        FROM attempts a JOIN questions q ON q.external_id = a.external_id
        WHERE a.elapsed_ms > 0 AND q.source IN ({placeholders})
        """,
        enabled,
    ).fetchall()

    edges = [0, 15, 30, 45, 60, 90, 120, 180, 300]
    buckets = []
    for i, lo in enumerate(edges):
        hi = edges[i + 1] if i + 1 < len(edges) else None
        buckets.append(
            {
                "lo": lo,
                "hi": hi,
                "label": f"{lo}-{hi}s" if hi else f"{lo}s+",
                "counts": {d: 0 for d in DIFFICULTY_ORDER},
                "correct": 0,
                "total": 0,
            }
        )

    for r in rows:
        secs = r["elapsed_ms"] / 1000
        idx = 0
        for i, b in enumerate(buckets):
            if b["hi"] is None or secs < b["hi"]:
                idx = i
                break
        b = buckets[idx]
        if r["difficulty"] in b["counts"]:
            b["counts"][r["difficulty"]] += 1
        b["total"] += 1
        b["correct"] += r["correct"]

    for b in buckets:
        b["accuracy"] = (b["correct"] / b["total"]) if b["total"] else None
    return buckets


def weakest(conn, limit=6):
    """Skills to drill next, with a plain-language reason for each."""
    ranked = sorted(scheduler.skill_stats(conn), key=lambda s: -scheduler._priority(s))
    out = []
    for s in ranked:
        if len(out) >= limit:
            break
        target = PACE_TARGET_MS.get(s["test"], 80_000)
        slow = s["avg_ms"] > target * 1.25 if s["avg_ms"] else False

        if s["attempts"] == 0:
            reason = "not tested yet"
        elif s["attempts"] < MIN_CONFIDENT_ATTEMPTS:
            reason = f"only {s['attempts']} seen so far"
        elif s["accuracy"] is not None and s["accuracy"] < 0.6:
            reason = f"{s['accuracy']:.0%} accurate"
        elif slow:
            reason = f"slow: {s['avg_ms']/1000:.0f}s vs {target/1000:.0f}s target"
        else:
            reason = f"{s['accuracy']:.0%} accurate"

        out.append(
            {
                "test_name": s["test_name"],
                "domain": s["domain"],
                "skill": s["skill"],
                "attempts": s["attempts"],
                "accuracy": s["accuracy"],
                "avg_ms": s["avg_ms"],
                "slow": slow,
                "reason": reason,
            }
        )
    return out


def recent_trend(conn, buckets=10, per_bucket=15):
    """Rolling accuracy over the most recent attempts, oldest bucket first."""
    rows = conn.execute(
        "SELECT correct FROM attempts ORDER BY answered_at DESC LIMIT ?",
        (buckets * per_bucket,),
    ).fetchall()
    rows = list(reversed([r["correct"] for r in rows]))
    out = []
    for i in range(0, len(rows), per_bucket):
        chunk = rows[i : i + per_bucket]
        if len(chunk) >= max(3, per_bucket // 3):
            out.append({"n": len(chunk), "accuracy": sum(chunk) / len(chunk)})
    return out


# Accuracy -> section score anchors. Curved rather than linear: 25% is chance
# on a four-option question, and the top of the scale is compressed because the
# last few points come from the hardest items in an adaptive second module.
SCORE_ANCHORS = [
    (0.25, 250), (0.40, 380), (0.55, 480), (0.70, 570),
    (0.80, 640), (0.90, 710), (0.97, 780), (1.00, 800),
]

MIN_ATTEMPTS_FOR_PROJECTION = 20


def project_score(by_test):
    """A rough section-score estimate. Deliberately coarse -- see README.

    This reads accuracy on a self-paced, self-selected mix of questions. The
    real thing is proctored, timed, and adaptive, and it draws harder items in
    the second module when you do well in the first. Treat this as a direction
    of travel, not a predicted score -- it will usually read high.
    """
    out = {}
    for data in by_test.values():
        if data["attempts"] < MIN_ATTEMPTS_FOR_PROJECTION or data["accuracy"] is None:
            continue
        out[data["test_name"]] = _interpolate(data["accuracy"])
    if len(out) == 2:
        out["Total"] = sum(out.values())
    return out


def _interpolate(acc):
    """Piecewise-linear lookup through SCORE_ANCHORS, rounded to 10 points."""
    lo_a, lo_s = SCORE_ANCHORS[0]
    if acc <= lo_a:
        return 200
    for hi_a, hi_s in SCORE_ANCHORS[1:]:
        if acc <= hi_a:
            frac = (acc - lo_a) / (hi_a - lo_a)
            return int(round((lo_s + frac * (hi_s - lo_s)) / 10.0) * 10)
        lo_a, lo_s = hi_a, hi_s
    return 800


def study_plan(conn, minutes=30):
    """Turn the metrics into a concrete 'do this now' recommendation."""
    ov = overview(conn)
    weak = weakest(conn, limit=3)
    per_q_min = 1.4
    budget = max(5, int(minutes / per_q_min))

    steps = []
    if ov["due_reviews"]:
        n = min(ov["due_reviews"], max(3, budget // 3))
        steps.append(
            {
                "action": "review",
                "count": n,
                "label": f"Clear {n} due review{'s' if n != 1 else ''} "
                         "(questions you previously missed)",
            }
        )
    remaining = budget - sum(s["count"] for s in steps)
    for w in weak:
        if remaining <= 0:
            break
        n = min(remaining, max(4, budget // 3))
        steps.append(
            {
                "action": "drill",
                "skill": w["skill"],
                "count": n,
                "label": f"Drill {n} on {w['skill']} — {w['reason']}",
            }
        )
        remaining -= n
    return {"minutes": minutes, "steps": steps}
