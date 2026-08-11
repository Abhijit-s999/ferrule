"""Fetch the official SAT question bank into the local database.

Source: College Board's Educator Question Bank, the same public endpoint the
site at satsuiteeducatorquestionbank.collegeboard.org calls from the browser.
No account or API key is required.

Two passes:
  1. index   -- one request per (test, domain) returns every question's tags
                (domain, skill, difficulty). Cheap, ~4k rows.
  2. content -- one request per question for stem/choices/answer/rationale.
                Resumable: questions already stored are skipped.
"""

import concurrent.futures
import json
import ssl
import sys
import time
import urllib.error
import urllib.request

from . import db

BASE = "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank"
LOOKUP_URL = f"{BASE}/lookup"
LIST_URL = f"{BASE}/digital/get-questions"
DETAIL_URL = f"{BASE}/digital/get-question"

# Assessment ids from /lookup: 99 = SAT, 100 = PSAT/NMSQT & PSAT 10, 102 = PSAT 8/9
ASSESSMENTS = {"sat": 99, "psat": 100, "psat89": 102}
TEST_IDS = {"R&W": 1, "Math": 2}
TEST_NAMES = {1: "Reading and Writing", 2: "Math"}

UA = "Mozilla/5.0 (X11; Linux x86_64) ferrule/1.0 (+https://github.com/)"


class FetchError(Exception):
    pass


def _ssl_context(insecure=False):
    if insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


def _request(url, payload=None, insecure=False, timeout=45, retries=4):
    """POST json (or GET when payload is None) with backoff on transient errors."""
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {
        "User-Agent": UA,
        "Accept": "application/json",
        "Origin": "https://satsuiteeducatorquestionbank.collegeboard.org",
        "Referer": "https://satsuiteeducatorquestionbank.collegeboard.org/",
    }
    if data:
        headers["Content-Type"] = "application/json"

    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(
                req, timeout=timeout, context=_ssl_context(insecure)
            ) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            last = e
            # Client errors other than rate-limiting will not fix themselves.
            if e.code < 500 and e.code != 429:
                raise FetchError(f"{url} -> HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
            last = e
            if isinstance(e, urllib.error.URLError) and isinstance(
                getattr(e, "reason", None), ssl.SSLCertVerificationError
            ):
                raise FetchError(
                    "TLS certificate verification failed. If you are on a network that "
                    "intercepts TLS, re-run with --insecure."
                ) from e
        time.sleep(1.5 * (2**attempt))
    raise FetchError(f"{url} failed after {retries} attempts: {last}")


def fetch_lookup(insecure=False):
    """The live taxonomy plus the practice-test item lists."""
    return _request(LOOKUP_URL, None, insecure)


def taxonomy_from(lookup):
    """Return {test_id: [domain_code, ...]} from a lookup payload."""
    domains = lookup.get("lookupData", {}).get("domain", {})
    out = {}
    for label, entries in domains.items():
        test_id = TEST_IDS.get(label)
        if test_id:
            out[test_id] = [d["primaryClassCd"] for d in entries]
    if not out:
        raise FetchError("lookup returned no domains; the API shape may have changed")
    return out


def practice_test_ids(lookup):
    """Question ids that also appear in official full-length practice tests.

    College Board's own UI exposes these as an 'Exclude Active Questions'
    filter, described there as removing "questions that are also included in
    official full-length practice tests".
    """
    return list(lookup.get("readingLiveItems") or []) + list(
        lookup.get("mathLiveItems") or []
    )


def fetch_index(conn, assessment=99, insecure=False):
    """Pass 1: store tag metadata for every question in the bank."""
    lookup = fetch_lookup(insecure)
    taxonomy = taxonomy_from(lookup)
    total = 0
    for test_id, domain_codes in sorted(taxonomy.items()):
        payload = {
            "asmtEventId": assessment,
            "test": test_id,
            "domain": ",".join(domain_codes),
        }
        rows = _request(LIST_URL, payload, insecure)
        for row in rows:
            # Questions carrying only an `ibn` are references to printed books;
            # their content is not served by the API, so they are unusable here.
            if not row.get("external_id"):
                continue
            db.upsert_question_stub(conn, row, test_id, TEST_NAMES[test_id])
            total += 1
        conn.commit()
        print(f"  indexed {len(rows):>5} rows for {TEST_NAMES[test_id]}", flush=True)

    merged = db.normalize_skill_names(conn)
    if merged:
        print(f"  merged {merged} skill-name casing variant(s)")

    unusable = db.flag_unanswerable(conn)
    if unusable:
        print(f"  held back {unusable} question(s) that reference a figure the bank omits")

    flagged = db.mark_practice_test_items(conn, practice_test_ids(lookup))
    print(f"  flagged {flagged} questions as also appearing in full-length practice tests")
    return total


def fetch_content(conn, insecure=False, workers=6, limit=None):
    """Pass 2: download question content for anything not already stored."""
    pending = [
        r["external_id"]
        for r in conn.execute(
            "SELECT external_id FROM questions "
            "WHERE stem IS NULL OR stem = '' ORDER BY test, domain, skill"
        )
    ]
    if limit:
        pending = pending[:limit]
    if not pending:
        print("  all question content already downloaded")
        return 0

    print(f"  downloading {len(pending)} questions with {workers} workers...", flush=True)
    done = failed = 0
    started = time.time()

    def grab(eid):
        return eid, _request(DETAIL_URL, {"external_id": eid}, insecure)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(grab, eid): eid for eid in pending}
        for future in concurrent.futures.as_completed(futures):
            try:
                eid, payload = future.result()
                db.store_question_content(conn, eid, payload)
                done += 1
            except Exception as e:  # one bad question must not kill the run
                failed += 1
                if failed <= 3:
                    print(f"    warn: {futures[future]}: {e}", file=sys.stderr)
            if done % 100 == 0 and done:
                conn.commit()
                rate = done / max(time.time() - started, 0.01)
                remaining = (len(pending) - done) / max(rate, 0.01)
                print(
                    f"    {done}/{len(pending)}  ({rate:.0f}/s, ~{remaining:.0f}s left)",
                    flush=True,
                )
    conn.commit()
    print(f"  stored {done} questions ({failed} failed)")
    return done


# --------------------------------------------------------------------------
# OpenSAT (community-written questions; see sources.py for licence terms)
# --------------------------------------------------------------------------

OPENSAT_URL = "https://api.jsonsilo.com/public/942c3c3b-3a0c-4be3-81c2-12029def19f5"


def fetch_opensat(conn, insecure=False):
    """Download the OpenSAT database. One request; the whole set is one blob."""
    data = _request(OPENSAT_URL, None, insecure, timeout=90)
    stored = 0
    for section in ("english", "math"):
        items = data.get(section) or []
        for item in items:
            if not item.get("id") or not (item.get("question") or {}).get("question"):
                continue
            db.store_opensat_question(conn, item, section)
            stored += 1
        conn.commit()
        print(f"  stored {len(items):>5} {section} questions", flush=True)
    return stored


def run(conn, assessment="sat", insecure=False, workers=6, limit=None,
        with_opensat=False, only=None):
    """Fetch enabled sources into the local database."""
    if only in (None, "collegeboard"):
        asmt = ASSESSMENTS.get(assessment, 99)
        print("College Board -- pass 1: indexing question tags")
        indexed = fetch_index(conn, asmt, insecure)
        print(f"  {indexed} questions indexed\n")
        print("College Board -- pass 2: downloading question content")
        fetch_content(conn, insecure, workers, limit)

    if with_opensat or only == "opensat":
        print("\nOpenSAT -- downloading community question database")
        try:
            n = fetch_opensat(conn, insecure)
            print(f"  {n} OpenSAT questions stored")
        except FetchError as e:
            print(f"  OpenSAT fetch failed (continuing): {e}", file=sys.stderr)

    db.set_meta(conn, "last_fetch", db.now_ms())
    complete = db.question_count(conn, only_complete=True)
    print(f"\nReady: {complete} questions available locally.")
    for row in conn.execute(
        "SELECT source, COUNT(*) n FROM questions "
        "WHERE stem IS NOT NULL AND stem != '' GROUP BY source"
    ):
        print(f"  {row['source']:<14} {row['n']}")
    return complete
