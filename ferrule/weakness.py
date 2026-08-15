"""Weakness targeting: drill one (skill, difficulty) cell until it is fixed.

The rest of the app spreads practice across the exam. This does the opposite.
It finds the cells you are worst at, serves questions from them until each one
reaches an accuracy you set, retires it, and moves to the next. It does not end
on its own — you stop when you have had enough.

Two decisions shape everything here.

**An unproven cell counts as the weakest thing you have.** A cell with three
attempts at 100% is not a strength, it is an unknown, and unknowns are exactly
what you cannot afford days before an exam. So cells below the confidence
threshold sort ahead of cells that are merely bad, and their reported accuracy
is labelled as provisional rather than trusted.

**Cells are retired, not questions.** A cell stops appearing once it has both
enough attempts to believe and an accuracy at or above your target. That is
what makes the queue finite in practice while being unbounded in principle.
"""

from . import db, scheduler, sources

# How many attempts before a cell's accuracy is believable — per difficulty.
#
# It is not one number. Easy questions are cheap to prove: if you get eight of
# them right you can do them, and spending thirty more is time you do not have.
# Hard questions are where the variance lives — a run of four can flatter or
# libel you — so they need more evidence before the mode stops asking.
CONFIDENT_BY_DIFFICULTY = {"E": 8, "M": 15, "H": 20}
CONFIDENT_ATTEMPTS = 20        # fallback for anything unlabelled

DIFFICULTY_ORDER = {"E": 0, "M": 1, "H": 2}
DIFFICULTY_NAME = {"E": "Easy", "M": "Medium", "H": "Hard"}

DEFAULTS = {
    "target": 0.8,            # retire a cell at this accuracy
    "min_attempts": dict(CONFIDENT_BY_DIFFICULTY),
    "order": "easiest-first",  # easiest-first | hardest-first | weakest-first
    "test": None,              # 1 = R&W, 2 = Math, None = both
    "recent_first": True,      # prefer the newest questions College Board added
}


def _opts(raw=None):
    o = dict(DEFAULTS)
    for k, v in (raw or {}).items():
        if k in o and v not in (None, ""):
            o[k] = v
    o["target"] = max(0.4, min(1.0, float(o["target"])))

    # min_attempts accepts either one number for every difficulty or a mapping
    # of difficulty -> number; per-difficulty keys (min_E/min_M/min_H) override.
    base = o["min_attempts"]
    if isinstance(base, dict):
        table = {k: int(v) for k, v in base.items()}
    else:
        table = {d: int(base) for d in ("E", "M", "H")}
    for d in ("E", "M", "H"):
        override = (raw or {}).get(f"min_{d}")
        if override not in (None, ""):
            table[d] = int(override)
        table[d] = max(1, min(60, table.get(d, CONFIDENT_ATTEMPTS)))
    o["min_attempts"] = table

    if o["test"]:
        o["test"] = int(o["test"])
    return o


def confident_for(o, difficulty):
    """Attempts needed before this difficulty's accuracy counts as evidence."""
    return o["min_attempts"].get(difficulty, CONFIDENT_ATTEMPTS)


def cells(conn, opts=None):
    """Every (skill, difficulty) cell with its record and its standing.

    Returned newest-weakness-first: unproven cells before weak ones, and within
    each group the ones furthest from target first.
    """
    o = _opts(opts)
    enabled = sources.enabled_ids(conn)
    ph = ",".join("?" * len(enabled))
    params = list(enabled)
    reserve = "" if scheduler.allow_reserved(conn) else "AND q.in_practice_test = 0"
    where = ""
    if o["test"]:
        where = "AND q.test = ?"
        params.append(o["test"])

    rows = conn.execute(
        f"""
        SELECT q.test, q.test_name, q.domain, q.skill, q.difficulty,
               COUNT(a.id)                                   AS attempts,
               COALESCE(SUM(a.correct), 0)                   AS correct,
               COALESCE(AVG(NULLIF(a.elapsed_ms, 0)), 0)     AS avg_ms,
               SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END) AS available
        FROM questions q
        LEFT JOIN attempts a ON a.external_id = q.external_id
        WHERE q.stem IS NOT NULL AND q.stem != '' AND q.unusable = 0
          {reserve} AND q.source IN ({ph}) {where}
        GROUP BY q.test, q.domain, q.skill, q.difficulty
        """,
        params,
    ).fetchall()

    out = []
    for r in rows:
        attempts, correct = r["attempts"], r["correct"]
        acc = (correct / attempts) if attempts else None

        # A cell cannot be proven past the number of questions it contains.
        # Several hold fewer than twenty, so a flat threshold would leave them
        # permanently "unproven" and permanently top of the queue even after
        # every question in them had been answered.
        total = attempts + r["available"]
        needed = min(confident_for(o, r["difficulty"]), total) if total else 0
        proven = bool(needed) and attempts >= needed
        mastered = bool(proven and acc is not None and acc >= o["target"])
        exhausted = r["available"] == 0 and not mastered

        # Distance from the goal. An unproven cell is treated as maximally far,
        # so it outranks anything merely low-scoring.
        if not proven:
            gap = 1.0 + (1.0 - (attempts / needed)) if needed else 0.0
        else:
            gap = max(0.0, o["target"] - acc)

        out.append(
            {
                "test": r["test"],
                "test_name": r["test_name"],
                "domain": r["domain"],
                "skill": r["skill"],
                "difficulty": r["difficulty"],
                "difficulty_name": DIFFICULTY_NAME.get(r["difficulty"], r["difficulty"]),
                "attempts": attempts,
                "correct": correct,
                "accuracy": acc,
                "avg_ms": int(r["avg_ms"] or 0),
                "available": r["available"],
                "proven": proven,
                "mastered": mastered,
                "exhausted": exhausted,
                "total": total,
                "gap": round(gap, 4),
                "needs": max(0, needed - attempts),
            }
        )

    return sorted(out, key=lambda c: _rank(c, o))


def _rank(cell, o):
    """Sort key. Lower sorts earlier."""
    if cell["mastered"] or not cell["available"]:
        return (9, 0, 0, 0)

    # Ordering preference applies *within* the weakness ranking, not above it:
    # you still fix your worst areas, you just meet them at the difficulty you
    # asked to start from.
    d = DIFFICULTY_ORDER.get(cell["difficulty"], 1)
    if o["order"] == "easiest-first":
        diff_key = d
    elif o["order"] == "hardest-first":
        diff_key = -d
    else:
        diff_key = 0

    tier = 0 if not cell["proven"] else 1      # unproven first
    return (tier, diff_key, -cell["gap"], cell["skill"])


def plan(conn, opts=None):
    """What the mode will work on, in order, with a reason for each."""
    o = _opts(opts)
    ranked = cells(conn, opts)
    active = [c for c in ranked if not c["mastered"] and c["available"]]
    done = [c for c in ranked if c["mastered"]]
    # Below target with nothing left to serve. Surfacing these matters: left
    # unreported they simply disappear from the queue, which reads as though
    # they were mastered when in fact they are the areas still costing points.
    dry = [c for c in ranked if c.get("exhausted")]

    for c in active:
        if not c["proven"]:
            c["reason"] = (
                f"only {c['attempts']} answered — not enough to judge"
                if c["attempts"]
                else "never attempted"
            )
        else:
            c["reason"] = f"{c['accuracy']:.0%}, target {o['target']:.0%}"

    for c in dry:
        c["reason"] = (
            f"{c['accuracy']:.0%} — no unseen questions left in this cell"
            if c["accuracy"] is not None else "no questions available"
        )

    return {
        "options": o,
        "targets": active,
        "mastered": done,
        "exhausted": dry,
        "remaining": len(active),
        "confident_attempts": o["min_attempts"],
        "confident_by_difficulty": o["min_attempts"],
    }


def queue(conn, opts=None, n=20, exclude=None):
    """Questions from the cells that need work, weakest cell first.

    Newest questions first inside a cell when `recent_first` is set: those are
    the closest thing available to what the current exam looks like.
    """
    o = _opts(opts)
    exclude = [e for e in (exclude or []) if e]
    enabled = sources.enabled_ids(conn)
    ph = ",".join("?" * len(enabled))
    reserve = "" if scheduler.allow_reserved(conn) else "AND q.in_practice_test = 0"

    picked, seen = [], set(exclude)
    for cell in cells(conn, opts):
        if len(picked) >= n:
            break
        if cell["mastered"] or not cell["available"]:
            continue

        ex = ",".join("?" * len(seen)) if seen else "''"
        rows = conn.execute(
            f"""
            SELECT q.* FROM questions q
            LEFT JOIN attempts a ON a.external_id = q.external_id
            WHERE q.skill = ? AND q.difficulty = ?
              AND q.stem IS NOT NULL AND q.stem != '' AND q.unusable = 0
              {reserve} AND q.source IN ({ph})
              AND a.id IS NULL
              AND q.external_id NOT IN ({ex})
            GROUP BY q.external_id
            ORDER BY {"q.created_at DESC," if o["recent_first"] else ""} RANDOM()
            LIMIT ?
            """,
            [cell["skill"], cell["difficulty"]] + enabled + list(seen)
            + [n - len(picked)],
        ).fetchall()

        for r in rows:
            picked.append((r, cell))
            seen.add(r["external_id"])

    out = []
    for row, cell in picked:
        q = db.row_to_question(row)
        # Carry the cell's standing so the UI can show what it is working on.
        q["cell"] = {
            "skill": cell["skill"],
            "difficulty": cell["difficulty"],
            "difficulty_name": cell["difficulty_name"],
            "attempts": cell["attempts"],
            "accuracy": cell["accuracy"],
            "proven": cell["proven"],
            "needs": cell["needs"],
        }
        out.append(q)
    return out
