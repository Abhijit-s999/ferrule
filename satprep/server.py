"""A small local web app. Standard library only, no framework.

Binds to localhost by default. Pass --host 0.0.0.0 to practise from a phone on
the same network.
"""

import json
import mimetypes
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import db, runtime, scheduler, sources, stats, tutor

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# SQLite connections are not shared across threads; give each its own.
_local = threading.local()
_db_path = None

# First-run question download, driven from the UI so nobody needs a terminal.
FETCH_STATE = {"phase": "idle", "detail": "", "error": "", "count": 0}
_fetch_lock = threading.Lock()


def _run_fetch(with_opensat):
    """Download the question bank in the background, reporting progress."""
    import io
    from contextlib import redirect_stdout

    from . import fetch as fetch_mod

    conn = db.connect(_db_path)
    buf = io.StringIO()

    def watch():
        # fetch.run prints progress; surface the latest line to the UI.
        while FETCH_STATE["phase"] == "running":
            text = buf.getvalue().strip().splitlines()
            if text:
                FETCH_STATE["detail"] = text[-1].strip()
            FETCH_STATE["count"] = db.question_count(conn)
            time.sleep(0.6)

    FETCH_STATE.update(phase="running", detail="Starting…", error="")
    threading.Thread(target=watch, daemon=True).start()
    try:
        with redirect_stdout(buf):
            fetch_mod.run(conn, with_opensat=with_opensat)
        FETCH_STATE.update(
            phase="done", detail="Done.", count=db.question_count(conn)
        )
    except Exception as e:
        FETCH_STATE.update(phase="error", error=str(e))
    finally:
        conn.close()


def _conn():
    if not hasattr(_local, "conn"):
        _local.conn = db.connect(_db_path)
    return _local.conn


class Handler(BaseHTTPRequestHandler):
    server_version = "satprep"

    def log_message(self, fmt, *args):
        pass  # keep the console clean for the fetch/progress output

    # ---------- plumbing ----------

    def _send(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        if not os.path.isfile(path):
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode() or "{}")

    def _stream_start(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _stream_send(self, obj):
        self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
        self.wfile.flush()

    # ---------- routes ----------

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        route = url.path

        try:
            if route == "/" or route == "/index.html":
                return self._send_file(os.path.join(STATIC_DIR, "index.html"))

            if route.startswith("/static/"):
                rel = route[len("/static/"):]
                safe = os.path.normpath(os.path.join(STATIC_DIR, rel))
                if not safe.startswith(STATIC_DIR):
                    return self.send_error(403)
                return self._send_file(safe)

            if route == "/api/state":
                return self._send(stats.overview(_conn()))

            if route == "/api/questions":
                n = int(q.get("n", ["10"])[0])
                test = q.get("test", [None])[0]
                skill = q.get("skill", [None])[0]
                qs = scheduler.select_questions(
                    _conn(),
                    n=max(1, min(n, 60)),
                    test=int(test) if test else None,
                    skill=skill,
                )
                return self._send({"questions": qs})

            if route == "/api/stats":
                conn = _conn()
                return self._send(
                    {
                        "overview": stats.overview(conn),
                        "by_type": stats.by_type(conn),
                        "weakest": stats.weakest(conn),
                        "trend": stats.recent_trend(conn),
                    }
                )

            if route == "/api/analytics":
                conn = _conn()
                return self._send(
                    {
                        "overview": stats.overview(conn),
                        "matrix": stats.skill_difficulty_matrix(conn),
                        "difficulty": stats.difficulty_breakdown(conn),
                        "timeline": stats.timeline(conn),
                        "time_distribution": stats.time_distribution(conn),
                        "weakest": stats.weakest(conn, limit=8),
                        "target_accuracy": stats.TARGET_ACCURACY,
                    }
                )

            if route == "/api/plan":
                minutes = int(q.get("minutes", ["30"])[0])
                return self._send(stats.study_plan(_conn(), minutes))

            if route == "/api/vintages":
                conn = _conn()
                return self._send(
                    {
                        "vintages": stats.vintages(conn),
                        "min_created": scheduler.min_created(conn),
                    }
                )

            if route == "/api/sources":
                conn = _conn()
                return self._send(
                    {
                        "sources": stats.by_source(conn),
                        "vintages": stats.vintages(conn),
                        "min_created": scheduler.min_created(conn),
                        "enabled": sources.enabled_ids(conn),
                        "catalog": list(sources.SOURCES.values()),
                        "not_fetched": list(sources.NOT_FETCHED.values()),
                    }
                )

            if route == "/api/tutor/config":
                return self._send(
                    {
                        "config": tutor.public_config(),
                        "providers": list(tutor.PROVIDERS.values()),
                        "vram_gb": tutor.detect_vram_gb(),
                        "models": tutor.guidance_for(tutor.detect_vram_gb()),
                    }
                )

            if route == "/api/tutor/health":
                return self._send(tutor.health())

            if route == "/api/runtime/status":
                return self._send(runtime.RUNTIME.status())

            if route == "/api/fetch/status":
                return self._send(FETCH_STATE)

            if route == "/api/bank":
                return self._send(self._bank(q))

            if route == "/api/skills":
                rows = _conn().execute(
                    """SELECT test, test_name, domain, skill, COUNT(*) AS n
                       FROM questions WHERE stem IS NOT NULL AND stem != ''
                       GROUP BY test, domain, skill ORDER BY test, domain, skill"""
                ).fetchall()
                return self._send({"skills": [dict(r) for r in rows]})

            self.send_error(404)
        except Exception as e:
            self._send({"error": str(e)}, 500)

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            if route == "/api/session":
                conn = _conn()
                cur = conn.execute(
                    "INSERT INTO sessions (started_at, mode) VALUES (?, ?)",
                    (db.now_ms(), self._body().get("mode", "practice")),
                )
                conn.commit()
                return self._send({"session_id": cur.lastrowid})

            if route == "/api/answer":
                body = self._body()
                conn = _conn()
                eid = body["external_id"]
                correct, detail = scheduler.grade(conn, eid, body.get("response"))
                scheduler.record_attempt(
                    conn,
                    eid,
                    body.get("response"),
                    correct,
                    body.get("elapsed_ms", 0),
                    body.get("session_id"),
                )
                return self._send({"correct": correct, **detail})

            if route == "/api/sources":
                conn = _conn()
                try:
                    enabled = sources.set_enabled(conn, self._body().get("enabled", []))
                except ValueError as e:
                    return self._send({"error": str(e)}, 400)
                return self._send({"enabled": enabled})

            if route == "/api/tutor/config":
                body = self._body()
                # An empty api_key means "leave the stored one alone", so the UI
                # never has to round-trip a secret it deliberately does not hold.
                if not body.get("api_key"):
                    body.pop("api_key", None)
                allowed = {"enabled", "provider", "model", "base_url",
                           "api_key", "temperature", "max_tokens"}
                tutor.save_config({k: v for k, v in body.items() if k in allowed})
                return self._send({"config": tutor.public_config()})

            if route == "/api/tutor/explain":
                return self._explain()

            if route == "/api/vintages":
                conn = _conn()
                scheduler.set_min_created(conn, self._body().get("min_created", 0))
                return self._send(
                    {
                        "min_created": scheduler.min_created(conn),
                        "vintages": stats.vintages(conn),
                    }
                )

            if route == "/api/fetch/start":
                with _fetch_lock:
                    if FETCH_STATE["phase"] == "running":
                        return self._send(FETCH_STATE)
                    opensat = bool(self._body().get("with_opensat"))
                    threading.Thread(
                        target=_run_fetch, args=(opensat,), daemon=True
                    ).start()
                return self._send({"phase": "running"})

            if route == "/api/runtime/start":
                # "Start" now means select + download; loading happens lazily.
                model_id = self._body().get("model_id")
                if not runtime.model_by_id(model_id):
                    return self._send({"error": f"unknown model {model_id}"}, 400)
                runtime.RUNTIME.select_async(model_id)
                return self._send(runtime.RUNTIME.status())

            if route == "/api/runtime/eject":
                # Free the GPU now, keeping the model selected for next time.
                runtime.RUNTIME.stop()
                return self._send(runtime.RUNTIME.status())

            if route == "/api/runtime/stop":
                runtime.RUNTIME.stop()
                tutor.save_config({"enabled": False, "selected_model": ""})
                return self._send(runtime.RUNTIME.status())

            if route == "/api/runtime/delete":
                runtime.RUNTIME.delete_model(self._body().get("model_id"))
                return self._send(runtime.RUNTIME.status())

            self.send_error(404)
        except KeyError as e:
            self._send({"error": f"unknown question {e}"}, 404)
        except Exception as e:
            self._send({"error": str(e)}, 500)

    def _bank(self, q):
        """Browse the whole bank: filter, search, page. No timer, no scoring.

        This is the relaxed counterpart to a practice set -- look things up,
        read the official explanation, work at your own speed. Attempts made
        here are recorded separately so they do not distort pacing stats.
        """
        one = lambda k, d=None: (q.get(k) or [d])[0]
        page = max(1, int(one("page", "1")))
        per = min(50, max(5, int(one("per", "20"))))

        where, params = ["q.stem IS NOT NULL", "q.stem != ''"], []
        for key, col in (("test", "q.test"), ("domain", "q.domain"),
                         ("skill", "q.skill"), ("difficulty", "q.difficulty"),
                         ("source", "q.source")):
            val = one(key)
            if val:
                where.append(f"{col} = ?")
                params.append(int(val) if key == "test" else val)

        search = (one("q") or "").strip()
        if search:
            where.append("(q.stem LIKE ? OR q.stimulus LIKE ?)")
            params += [f"%{search}%", f"%{search}%"]

        if one("unseen") == "1":
            where.append("a.id IS NULL")
        if one("missed") == "1":
            where.append("a.correct = 0")

        clause = " AND ".join(where)
        conn = _conn()
        total = conn.execute(
            f"""SELECT COUNT(DISTINCT q.external_id) AS n FROM questions q
                LEFT JOIN attempts a ON a.external_id = q.external_id
                WHERE {clause}""",
            params,
        ).fetchone()["n"]

        rows = conn.execute(
            f"""SELECT q.*,
                       COUNT(a.id) AS attempts,
                       COALESCE(SUM(a.correct), 0) AS correct
                FROM questions q
                LEFT JOIN attempts a ON a.external_id = q.external_id
                WHERE {clause}
                GROUP BY q.external_id
                ORDER BY q.test, q.domain, q.skill, q.difficulty
                LIMIT ? OFFSET ?""",
            params + [per, (page - 1) * per],
        ).fetchall()

        items = []
        for r in rows:
            item = db.row_to_question(r)
            item["stem"] = r["stem"]
            item["stimulus"] = r["stimulus"]
            item["rationale"] = r["rationale"] or ""
            item["correct_answer"] = json.loads(r["correct_answer"] or "[]")
            item["attempts"] = r["attempts"]
            item["correct"] = r["correct"]
            item["in_practice_test"] = r["in_practice_test"]
            items.append(item)

        facets = {
            "skills": [dict(x) for x in conn.execute(
                """SELECT test, test_name, domain, skill, COUNT(*) n FROM questions
                   WHERE stem IS NOT NULL AND stem != ''
                   GROUP BY test, domain, skill ORDER BY test, domain, skill""")],
            "sources": [dict(x) for x in conn.execute(
                """SELECT source, COUNT(*) n FROM questions
                   WHERE stem IS NOT NULL AND stem != '' GROUP BY source""")],
        }
        return {"items": items, "total": total, "page": page, "per": per,
                "pages": max(1, -(-total // per)), "facets": facets}

    def _explain(self):
        """Stream a tutor explanation for one question."""
        body = self._body()
        conn = _conn()
        row = conn.execute(
            "SELECT * FROM questions WHERE external_id = ?", (body["external_id"],)
        ).fetchone()
        if not row:
            return self._send({"error": "unknown question"}, 404)

        question = db.row_to_question(row)
        question["stem"] = row["stem"]
        question["stimulus"] = row["stimulus"]
        detail = {
            "correct_answer": json.loads(row["correct_answer"] or "[]"),
            "rationale": row["rationale"] or "",
        }

        self._stream_start()
        try:
            # The model is loaded on demand rather than kept resident, so the
            # first question after a pause pays the load and the rest do not.
            runtime.RUNTIME.ensure_running(
                on_status=lambda msg: self._stream_send({"status": msg})
            )
            for chunk in tutor.stream_explanation(
                question, detail, body.get("response"), body.get("mode", "why_wrong")
            ):
                self._stream_send({"delta": chunk})
            self._stream_send({"done": True})
        except tutor.TutorError as e:
            self._stream_send({"error": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass  # the user navigated away mid-stream
        except Exception as e:
            self._stream_send({"error": f"{type(e).__name__}: {e}"})


def serve(host="127.0.0.1", port=8733, db_path=None):
    global _db_path
    _db_path = db_path

    conn = db.connect(db_path)
    count = db.question_count(conn)
    conn.close()

    if count == 0:
        print("No questions stored yet. Run:  ./satprep.py fetch\n")

    # Whatever takes this process down must take the model server with it,
    # otherwise an orphaned llama-server sits on the GPU indefinitely.
    runtime.install_exit_handlers()
    runtime.RUNTIME.start_idle_watch()
    reaped = runtime.reap_stale_server()
    if reaped:
        print(f"stopped an orphaned model server from a previous run (pid {reaped})")

    httpd = ThreadingHTTPServer((host, port), Handler)
    shown = "localhost" if host == "127.0.0.1" else host
    print(f"satprep running at http://{shown}:{port}   ({count} questions loaded)")
    print("Ctrl-C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
        httpd.server_close()
