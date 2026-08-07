"""Analytics: accuracy and pacing broken down by question type.

Everything here answers one of three questions:
  - Where am I losing points?
  - Am I too slow anywhere?
  - What should I do with the next 30 minutes?
"""

from . import db, scheduler

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

    return {
        "attempts": attempts,
        "correct": correct,
        "accuracy": (correct / attempts) if attempts else None,
        "avg_ms": int(row["avg_ms"] or 0),
        "by_test": by_test,
        "due_reviews": due,
        "bank_size": db.question_count(conn),
        "projection": project_score(by_test),
    }


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
