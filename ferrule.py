#!/usr/bin/env python3
"""ferrule -- adaptive SAT practice against the official question bank.

    ./ferrule.py fetch     download the question bank (once, ~2 min)
    ./ferrule.py serve     start the app
    ./ferrule.py stats     per-skill breakdown in the terminal
    ./ferrule.py plan      what to study in the next N minutes
"""

import argparse
import os
import sys

from ferrule import db, fetch, server, sources, stats


def cmd_fetch(args):
    conn = db.connect(args.db)
    try:
        fetch.run(
            conn,
            assessment=args.assessment,
            insecure=args.insecure,
            workers=args.workers,
            limit=args.limit,
            with_opensat=args.with_opensat,
            only=args.source,
        )
    except fetch.FetchError as e:
        print(f"\nfetch failed: {e}", file=sys.stderr)
        return 1
    return 0


def cmd_sources(args):
    conn = db.connect(args.db)

    if args.enable or args.disable:
        current = set(sources.enabled_ids(conn))
        current |= set(args.enable or [])
        current -= set(args.disable or [])
        try:
            sources.set_enabled(conn, sorted(current))
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1

    enabled = set(sources.enabled_ids(conn))
    print()
    for src in sources.SOURCES.values():
        n = conn.execute(
            "SELECT COUNT(*) FROM questions WHERE source = ? "
            "AND stem IS NOT NULL AND stem != ''",
            (src["id"],),
        ).fetchone()[0]
        mark = "on " if src["id"] in enabled else "off"
        tag = "official" if src["official"] else "community"
        print(f"  [{mark}] {src['short']:<16} {n:>5} questions   {tag}")
        print(f"        {src['url']}")
        print(f"        {src['why']}\n")

    if sources.NOT_FETCHED:
        print("  Not fetched, by design:")
        for nf in sources.NOT_FETCHED.values():
            print(f"    {nf['name']} -- {nf['url']}")
            print(f"      {nf['reason']}\n")
    return 0


def cmd_serve(args):
    server.serve(host=args.host, port=args.port, db_path=args.db)
    return 0


def cmd_stats(args):
    conn = db.connect(args.db)
    ov = stats.overview(conn)
    if not ov["attempts"]:
        print("No attempts yet. Run ./ferrule.py serve and answer some questions.")
        return 0

    print(f"\n{ov['attempts']} questions answered  |  "
          f"{ov['accuracy']:.0%} accurate  |  {ov['avg_ms']/1000:.0f}s avg")
    if ov["projection"]:
        bits = "  ".join(f"{k}: {v}" for k, v in ov["projection"].items())
        print(f"rough estimate -> {bits}")
    print()

    for domain in stats.by_type(conn):
        if not domain["attempts"]:
            continue
        print(f"{domain['test_name']} / {domain['domain']}  "
              f"({domain['accuracy']:.0%} of {domain['attempts']})")
        for s in domain["skills"]:
            if not s["attempts"]:
                continue
            pace = f"{s['avg_ms']/1000:>4.0f}s" if s["avg_ms"] else "   -"
            flag = "  <-- slow" if s["pace_ratio"] and s["pace_ratio"] > 1.25 else ""
            print(f"    {s['skill'][:46]:<46} {s['correct']:>3}/{s['attempts']:<3} "
                  f"{s['accuracy']:>5.0%} {pace}{flag}")
        print()

    print("Drill next:")
    for w in stats.weakest(conn):
        print(f"  - {w['skill']}  ({w['reason']})")
    return 0


def cmd_selftest(args):
    """Check that a build is actually complete. Run by the release build.

    Exists because the failure it catches is silent: if the frontend is left
    out of a frozen bundle, every API route still answers and only the pages
    404, so a smoke test that hits /api/state passes while the app is unusable.
    """
    from ferrule import server

    problems = []
    required = ["index.html", "app.js", "charts.js", "style.css"]
    print(f"static dir: {server.STATIC_DIR}")
    for name in required:
        path = os.path.join(server.STATIC_DIR, name)
        ok = os.path.isfile(path) and os.path.getsize(path) > 0
        print(f"  {'ok  ' if ok else 'MISSING'} {name}")
        if not ok:
            problems.append(name)

    try:
        conn = db.connect(args.db)
        conn.execute("SELECT 1").fetchone()
        print("  ok   database opens")
    except Exception as e:
        problems.append(f"database: {e}")
        print(f"  FAIL database: {e}")

    # The first-run download reports progress from a second thread. That
    # thread used to read the fetch thread's sqlite connection, which raises
    # ProgrammingError on first use and killed the reporter outright: the
    # download itself ran fine while the UI sat on "Starting…" and 0 stored
    # for four minutes, which every user reads as a hang. Invisible to any
    # check that only asserts the download eventually finishes, so it is
    # asserted directly here -- offline, against a stub fetch.
    try:
        import shutil
        import tempfile
        import threading as _th
        import time as _time

        from ferrule import fetch as _fetch
        from ferrule import server as _srv

        # Cleaned up by hand rather than with TemporaryDirectory. The reporter
        # thread closes its connection up to a tick after the fetch ends, and
        # Windows refuses to delete a file that is still open -- which failed
        # the build on a check that had already passed.
        tmp = tempfile.mkdtemp(prefix="ferrule-selftest-")
        try:
            _srv._db_path = os.path.join(tmp, "probe.db")
            probe = db.connect(_srv._db_path)
            probe.execute(
                "INSERT INTO questions (external_id, test, test_name, domain, "
                "skill, difficulty, stem) VALUES "
                "('probe-1', 1, 'Reading and Writing', 'INI', 'Central Ideas', 'E', 'x')"
            )
            probe.commit()
            probe.close()

            real_run = _fetch.run
            _fetch.run = lambda conn, **kw: _time.sleep(1.4)
            try:
                _srv.FETCH_STATE.update(
                    phase="running", detail="Starting…", error="", count=0)
                worker = _th.Thread(target=_srv._run_fetch, args=(False,))
                worker.start()
                # Sample WHILE it runs. Checking the final count proves
                # nothing: _run_fetch writes that itself on the way out, so a
                # dead reporter still ends on the right number having shown
                # the user nothing for the whole download.
                seen_during = 0
                while worker.is_alive():
                    if _srv.FETCH_STATE.get("phase") == "running":
                        seen_during = max(seen_during, _srv.FETCH_STATE.get("count", 0))
                    _time.sleep(0.1)
                worker.join(timeout=20)
            finally:
                _fetch.run = real_run

            phase = _srv.FETCH_STATE.get("phase")
            if phase != "done":
                problems.append(f"fetch progress: ended on {phase!r}, not 'done'")
                print(f"  FAIL fetch progress ended on {phase!r}")
            elif seen_during < 1:
                problems.append("fetch progress: reporter never updated mid-run")
                print("  FAIL fetch progress never updated mid-run "
                      "(reporter thread died -- the UI would look hung)")
            else:
                print("  ok   fetch reports progress while running")
        finally:
            _time.sleep(1.0)                 # let the reporter close its handle
            shutil.rmtree(tmp, ignore_errors=True)
    except Exception as e:
        problems.append(f"fetch progress: {e}")
        print(f"  FAIL fetch progress: {e}")

    if problems:
        print(f"\nselftest FAILED: {', '.join(problems)}", file=sys.stderr)
        return 1
    print("\nselftest passed")
    return 0


def cmd_reset(args):
    """Clear the practice record, keeping the downloaded question bank."""
    conn = db.connect(args.db)
    n = conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
    if not args.yes:
        print(f"This deletes {n} recorded attempts (questions are kept).")
        if input("Type 'yes' to confirm: ").strip().lower() != "yes":
            print("cancelled")
            return 1
    for table in ("attempts", "reviews", "sessions"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()
    print(f"cleared {n} attempts; {db.question_count(conn)} questions kept")
    return 0


def cmd_plan(args):
    conn = db.connect(args.db)
    plan = stats.study_plan(conn, args.minutes)
    print(f"\nNext {plan['minutes']} minutes:\n")
    for i, step in enumerate(plan["steps"], 1):
        print(f"  {i}. {step['label']}")
    print()
    return 0


def main():
    p = argparse.ArgumentParser(prog="ferrule", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", help="database path (default ~/.local/share/ferrule/ferrule.db)")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="download the official question bank")
    f.add_argument("--assessment", default="sat", choices=["sat", "psat", "psat89"])
    f.add_argument("--workers", type=int, default=6)
    f.add_argument("--limit", type=int, help="stop after N questions (for testing)")
    f.add_argument("--insecure", action="store_true",
                   help="skip TLS verification (networks that intercept TLS)")
    f.add_argument("--with-opensat", action="store_true",
                   help="also download the OpenSAT community question database")
    f.add_argument("--source", choices=["collegeboard", "opensat"],
                   help="fetch only this source")
    f.set_defaults(func=cmd_fetch)

    sr = sub.add_parser("sources", help="list question sources, enable or disable them")
    sr.add_argument("--enable", nargs="+", choices=list(sources.SOURCES))
    sr.add_argument("--disable", nargs="+", choices=list(sources.SOURCES))
    sr.set_defaults(func=cmd_sources)

    s = sub.add_parser("serve", help="run the practice app")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8733)
    s.set_defaults(func=cmd_serve)

    st = sub.add_parser("stats", help="per-skill breakdown")
    st.set_defaults(func=cmd_stats)

    pl = sub.add_parser("plan", help="what to study next")
    pl.add_argument("--minutes", type=int, default=30)
    pl.set_defaults(func=cmd_plan)

    ST = sub.add_parser("selftest", help="verify this build is complete (used by CI)")
    ST.set_defaults(func=cmd_selftest)

    rs = sub.add_parser("reset", help="clear your practice record (keeps questions)")
    rs.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    rs.set_defaults(func=cmd_reset)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
