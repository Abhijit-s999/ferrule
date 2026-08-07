# satprep

Adaptive SAT practice built on College Board's own question bank, with metrics
broken down by question type so you can see exactly where the points are going.

No accounts, no tracking, no server. Everything runs locally and your practice
record stays in a SQLite file on your machine.

```
./satprep.py fetch     # download the question bank (once, ~4 min)
./satprep.py serve     # open http://localhost:8733
```

Python 3.9+. **No dependencies** — standard library only, so there is nothing
to install and no virtualenv to manage.

---

## What it does

**Pulls the official bank.** ~3,250 real SAT questions with full text, answer
choices, correct answers and College Board's own written rationales. Every
question is tagged with its domain, its specific skill, and its difficulty.

**Picks what you should actually do next.** Question selection weighs three
things: how badly you're doing on a skill, how much of the real exam that skill
represents, and how little it knows about you so far. Early sessions behave
like a diagnostic; later ones concentrate on what's costing you points.

**Brings back what you missed.** Wrong answers re-enter the queue on a
spaced-repetition schedule, compressed for people testing in weeks rather than
months.

**Reports by question type.** Accuracy and pacing per domain and per skill,
against the real per-question time budget (71s Reading & Writing, 95s Math).
A skill you get right but too slowly is a different problem from one you get
wrong, and the dashboard separates them.

**Protects your practice tests.** See below — this one matters.

---

## Your Bluebook practice tests stay honest

2,019 of the questions in the bank also appear in College Board's official
full-length practice tests. College Board's own question-bank UI exposes these
via a filter it describes as removing *"questions that are also included in
official full-length practice tests."*

If you drill those questions here, your subsequent Bluebook practice test
scores become a memory check rather than a measurement — and you lose your only
realistic gauge of where you stand.

**So satprep holds them back by default.** You practise on the remaining ~1,233
questions and your full-length practice tests stay clean. If you have already
taken every practice test and want the full bank, pass
`allow_practice_test=True` to `select_questions()`.

---

## Commands

| Command | What it does |
| --- | --- |
| `./satprep.py fetch` | Download the bank. Resumable; re-running only fetches what's missing. |
| `./satprep.py serve` | Run the app. `--host 0.0.0.0` to practise from your phone on the same network. |
| `./satprep.py stats` | Per-skill breakdown in the terminal. |
| `./satprep.py plan --minutes 45` | A concrete "do this now" list. |

`--db PATH` (or `SATPREP_DB`) puts the database somewhere other than
`~/.local/share/satprep/satprep.db`.

If you're on a network that intercepts TLS, `fetch --insecure` skips
certificate verification.

---

## Keyboard

`A`–`D` or `1`–`4` answers. `Enter` submits a grid-in, then moves to the next
question. Practising with the keyboard is closer to how Bluebook feels than
clicking through.

---

## Honest limitations

**The score estimate is rough and reads high.** The real SAT is timed,
proctored, and *adaptive* — the difficulty of your second module depends on how
you did in the first, and the hardest points come from items you'd only see
after a strong first module. Practising at your own pace on a self-selected mix
does not reproduce any of that. Treat the number as a direction of travel. The
only trustworthy score estimate is a full-length Bluebook practice test, which
is exactly why this tool goes out of its way not to spoil them.

**This is question-level practice, not test simulation.** It builds accuracy
and speed on specific skills. It does not train stamina, module pacing, or
managing a two-hour sitting. Use Bluebook for those.

**Some skills are thin.** After reserving practice-test questions, a few rare
skills (Cross-Text Connections, Evaluating statistical claims) have only a
handful of questions left. The scheduler will exhaust them and move on.

---

## Licensing

**The code** is MIT. Do what you like with it.

**The questions are not ours to give.** They belong to College Board. This
repository contains no question content whatsoever, and `.gitignore` is set up
to keep it that way — the database and any exported question files are
excluded. `fetch` downloads them from College Board's public question bank into
your own local database at run time.

If you fork this, **do not commit a populated database or a question dump.**
That is the one thing that would turn a study tool into a copyright problem.

SAT and College Board are trademarks registered by College Board, which does
not endorse and is not affiliated with this project.

---

## How it works

```
satprep.py            CLI entry point
satprep/
  fetch.py            two-pass downloader (index tags, then content)
  db.py               SQLite schema, migrations, skill-name normalisation
  scheduler.py        weakness-weighted selection + spaced repetition + grading
  stats.py            per-type analytics, pacing, study plan, score estimate
  server.py           stdlib HTTP server and JSON API
  static/             the frontend (vanilla JS, no build step)
```

The upstream bank ships some skills under two spellings (`Cross-Text
Connections` and `Cross-text Connections`). `db.normalize_skill_names` merges
casing variants on fetch, because otherwise one skill becomes two rows in every
report and two independent accuracy estimates.

Math renders as MathML, which every current browser handles natively — no
KaTeX, no MathJax, no build step.

---

## Contributing

Useful directions:

- A timed full-module mode (27 R&W questions in 32 minutes) for pacing practice
- Adaptive second-module logic that mirrors the real scoring
- Export a wrong-answer set to PDF for offline review
- Better score calibration from real reported score pairs
- PSAT support (`fetch --assessment psat` already pulls the bank; the blueprint
  weights and pacing targets in `scheduler.py`/`stats.py` are SAT-specific)

Keep the zero-dependency constraint if you can — it's most of the reason a
student can go from `git clone` to practising in two minutes.
