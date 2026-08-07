"""A small local web app. Standard library only, no framework.

Binds to localhost by default. Pass --host 0.0.0.0 to practise from a phone on
the same network.
"""

import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import db, scheduler, stats

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# SQLite connections are not shared across threads; give each its own.
_local = threading.local()
_db_path = None


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

            if route == "/api/plan":
                minutes = int(q.get("minutes", ["30"])[0])
                return self._send(stats.study_plan(_conn(), minutes))

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

            self.send_error(404)
        except KeyError as e:
            self._send({"error": f"unknown question {e}"}, 404)
        except Exception as e:
            self._send({"error": str(e)}, 500)


def serve(host="127.0.0.1", port=8733, db_path=None):
    global _db_path
    _db_path = db_path

    conn = db.connect(db_path)
    count = db.question_count(conn)
    conn.close()

    if count == 0:
        print("No questions stored yet. Run:  ./satprep.py fetch\n")

    httpd = ThreadingHTTPServer((host, port), Handler)
    shown = "localhost" if host == "127.0.0.1" else host
    print(f"satprep running at http://{shown}:{port}   ({count} questions loaded)")
    print("Ctrl-C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
        httpd.server_close()
