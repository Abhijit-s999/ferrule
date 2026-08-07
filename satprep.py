#!/usr/bin/env python3
"""satprep -- adaptive SAT practice against the official question bank.

    ./satprep.py fetch     download the question bank (once, ~2 min)
    ./satprep.py serve     start the app
    ./satprep.py stats     per-skill breakdown in the terminal
    ./satprep.py plan      what to study in the next N minutes
"""

import argparse
import sys

from satprep import db, fetch, server, stats


def cmd_fetch(args):
    conn = db.connect(args.db)
    try:
        fetch.run(
            conn,
            assessment=args.assessment,
            insecure=args.insecure,
            workers=args.workers,
            limit=args.limit,
        )
    except fetch.FetchError as e:
        print(f"\nfetch failed: {e}", file=sys.stderr)
        return 1
    return 0


def cmd_serve(args):
    server.serve(host=args.host, port=args.port, db_path=args.db)
    return 0


def cmd_stats(args):
    conn = db.connect(args.db)
    ov = stats.overview(conn)
    if not ov["attempts"]:
        print("No attempts yet. Run ./satprep.py serve and answer some questions.")
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
    p = argparse.ArgumentParser(prog="satprep", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", help="database path (default ~/.local/share/satprep/satprep.db)")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="download the official question bank")
    f.add_argument("--assessment", default="sat", choices=["sat", "psat", "psat89"])
    f.add_argument("--workers", type=int, default=6)
    f.add_argument("--limit", type=int, help="stop after N questions (for testing)")
    f.add_argument("--insecure", action="store_true",
                   help="skip TLS verification (networks that intercept TLS)")
    f.set_defaults(func=cmd_fetch)

    s = sub.add_parser("serve", help="run the practice app")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8733)
    s.set_defaults(func=cmd_serve)

    st = sub.add_parser("stats", help="per-skill breakdown")
    st.set_defaults(func=cmd_stats)

    pl = sub.add_parser("plan", help="what to study next")
    pl.add_argument("--minutes", type=int, default=30)
    pl.set_defaults(func=cmd_plan)

    rs = sub.add_parser("reset", help="clear your practice record (keeps questions)")
    rs.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    rs.set_defaults(func=cmd_reset)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
