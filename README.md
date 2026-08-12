# ferrule

Free, adaptive SAT practice built on openly available question banks, with
analytics broken down by **skill and difficulty**, and an optional AI tutor that
runs on your own machine.

No accounts. No tracking. No subscription. Nothing leaves your computer unless
you explicitly choose a hosted AI provider.

![Education should not cost money](https://img.shields.io/badge/price-%240-brightgreen)

---

## Install

Grab the installer for your platform from
[Releases](../../releases). **Nothing else is required** — Python is bundled, so
there is no runtime to install and no terminal to open.

| Platform | File | How |
| --- | --- | --- |
| Windows | `ferrule-Setup-*.exe` | Double-click, choose a folder, done |
| macOS | `ferrule-*.dmg` | Open, drag to Applications, then see below |
| Linux | `ferrule-*.AppImage` | `chmod +x` then run |
| Linux (Debian/Ubuntu) | `ferrule_*.deb` | `sudo apt install ./ferrule_*.deb` |

### macOS: the first launch needs one extra step

ferrule is signed ad-hoc but **not notarised** — notarisation requires a paid
Apple Developer account. macOS therefore quarantines it on download, and refuses
to open it with a message that says the app *"is damaged and can't be opened"*.
Nothing is damaged; that is simply what Gatekeeper says about software it cannot
verify.

Either **right-click the app → Open → Open**, which is the supported path, or
clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/ferrule.app
```

After that it opens normally. If you would rather not do either, run it from
source — the instructions are below and involve no Gatekeeper at all.

On first launch the app offers to download the question bank for you. That is
the whole setup.

<details>
<summary>Running from source instead</summary>

```bash
git clone https://github.com/Abhijit-s999/ferrule && cd ferrule
npm install && npm start
```

A source checkout uses your system Python 3.9+ rather than a bundled one. The
backend has **no Python dependencies** — standard library only.

To build the installers yourself:

```bash
npm run backend      # freeze the Python backend for THIS platform
npm run build:linux  # or build:win / build:mac
```

PyInstaller cannot cross-compile, so each platform's installer must be built on
that platform. `.github/workflows/release.yml` does all three on tag push.
</details>

To put it in your application launcher (Linux, any desktop):

```bash
./scripts/install-desktop.sh              # adds the entry and icons
./scripts/install-desktop.sh --uninstall  # removes them again
```

That writes a desktop entry, a `ferrule` launcher on your PATH, and icons at
every standard size — all under `~/.local/share`, so it needs no root. After
that, ferrule appears in your launcher like any installed program, and the
compositor matches its window to the entry, so the taskbar shows the real icon
rather than a generic Electron one.

**Command line**, if you prefer it:

```bash
./ferrule.py fetch     # download the question bank (~4 min, once)
./ferrule.py serve     # then open http://localhost:8733
```

---

## What it does

### Practice that targets your weaknesses

Question selection weighs how badly you're doing on a skill, how much of the
real exam that skill represents, and how little it knows about you so far. Early
sessions behave like a diagnostic; later ones concentrate on what is actually
costing you points. Wrong answers return on a spaced-repetition schedule
compressed for people testing in weeks, not months.

### Analytics at the grain that matters

Everything is tagged by **skill AND difficulty**, so the reporting goes further
than "you're bad at algebra":

- **Skill × difficulty heatmap** — 29 skills × 3 difficulty bands. A row that is
  strong on the left and weak on the right is a skill you *have*, but not yet at
  exam difficulty. That is a different fix from one you are missing everywhere,
  and the app flags it as a **cliff**.
- **Accuracy at each difficulty**, per section.
- **Where your time goes** — a histogram of how long questions actually take,
  stacked by difficulty, with the real per-question budget marked. Averages hide
  the tail; a 40-second average with a few four-minute questions is a pacing
  problem an average will never show you.
- **Pace against the real budget** — 71s per Reading & Writing question, 95s per
  Math question.
- **Work done over time** — daily volume, minutes spent, running total.
- Cells with too little data are faded rather than shouted, so a single unlucky
  question never looks like a verdict.

### An AI tutor that sets itself up

Click a model. ferrule downloads the inference engine and the model, starts the
server, and wires it up. **No Ollama, no LM Studio, no terminal, no GGUF
knowledge, no accounts.**

- The engine is a prebuilt [llama.cpp](https://github.com/ggml-org/llama.cpp)
  release binary, chosen for your platform. On Linux and Windows it prefers the
  Vulkan build, which gives GPU acceleration on NVIDIA, AMD and Intel alike with
  no CUDA download; macOS uses the native build with Metal.
- Your GPU is detected and each model is labelled **fits / tight / needs more
  VRAM** before you download anything.
- Every model lists honest pros *and* cons. The small ones say plainly that they
  get maths wrong.
- Downloads resume, so a dropped connection does not cost you 5 GB.
- The tutor gets the question, your answer, and the official rationale as ground
  truth, and is told to explain the *method* rather than restate the answer.

Already have Ollama, LM Studio, llama.cpp, or a hosted API? Point ferrule at it
in Settings instead. Any OpenAI-compatible endpoint works, plus Anthropic's API
natively. API keys are stored in `~/.config/ferrule/config.json` with
owner-only permissions — never in the database, never in the repo.

**The tutor is entirely optional.** Everything else works without it.

---

## Question sources

ferrule collates free resources; it wrote none of the questions. Full detail and
terms are in **[ATTRIBUTION.md](ATTRIBUTION.md)**.

| Source | Questions | Default | Notes |
| --- | --- | --- | --- |
| [College Board SAT Suite Question Bank](https://satsuiteeducatorquestionbank.collegeboard.org/) | ~3,250 | **on** | Official. Domain + skill + difficulty tags, official rationales. |
| [OpenSAT](https://github.com/Anas099X/OpenSAT) | ~2,340 | off | Community-written. Licence explicitly permits database use. |

Sources are only added when their licence or terms clearly permit programmatic
access — check `robots.txt` and the licence before proposing one.

**ferrule never redistributes question content.** This repository contains no
questions. Everything is fetched at run time into a local database that
`.gitignore` keeps out of version control. If you fork this, keep that rule.

OpenSAT is **off by default** on purpose: those questions are not calibrated to
real exam difficulty and carry only domain tags, so they cannot feed skill-level
metrics. Turn them on for extra volume — accuracy is always reported per source,
so the official numbers stay clean either way.


---

## Your Bluebook practice tests stay honest

2,019 questions in the official bank also appear in College Board's full-length
practice tests. College Board's own tooling exposes these behind a filter it
describes as removing *"questions that are also included in official full-length
practice tests."*

Drill those here and your Bluebook scores become a memory check instead of a
measurement — and that is your only realistic gauge of where you stand. **So
ferrule holds them back by default**, leaving ~1,233 official questions to
practise on, which is far more than anyone gets through in a few weeks.

---

## Commands

| Command | What it does |
| --- | --- |
| `./ferrule.py fetch` | Download the bank. Resumable. `--with-opensat` adds the community set. |
| `./ferrule.py serve` | Run the backend. `--host 0.0.0.0` to practise from your phone. |
| `./ferrule.py stats` | Per-skill breakdown in the terminal. |
| `./ferrule.py plan --minutes 45` | A concrete "do this now" list. |
| `./ferrule.py sources` | List sources and their terms; `--enable` / `--disable`. |
| `./ferrule.py reset` | Clear your practice record, keep the questions. |

`--db PATH` or `FERRULE_DB` relocates the database from
`~/.local/share/ferrule/ferrule.db`. `fetch --insecure` skips TLS verification
on networks that intercept it.

Keyboard: `A`–`D` or `1`–`4` to answer, `Enter` to submit a grid-in and to move
on.

---

## Honest limitations

**The score estimate reads high.** The real SAT is timed, proctored and
*adaptive* — the second module's difficulty depends on the first. Self-paced
practice on a self-selected mix reproduces none of that. The number is a
direction of travel. It is computed from official questions only, and ignores
community questions entirely, because they are not calibrated.

**This is question-level practice, not test simulation.** It builds accuracy and
speed per skill. It does not train stamina or module pacing. Use Bluebook for
those — which is exactly why this app protects them.

**Small models get maths wrong.** A 3B model will confidently misapply an
algebraic step. The app says so on every model card. Prefer the 7B default, and
treat the official rationale — not the tutor — as the source of truth.

**The heatmap is sparse at first.** 29 skills × 3 difficulties is 87 cells; a
hundred questions fills about one each. Low-confidence cells are faded on
purpose.

**No automated tests yet.** Everything here was verified by running it, but a
test suite is the first thing this needs before others depend on it.

---

## How it works

```
ferrule.py            CLI entry point
desktop/main.js       Electron shell: spawns the backend, opens the window
ferrule/
  fetch.py            multi-source downloader
  sources.py          every source's terms and attribution, in one place
  db.py               SQLite schema, migrations, provenance, de-duplication
  scheduler.py        weakness-weighted selection, spaced repetition, grading
  stats.py            skill x difficulty analytics, pacing, score estimate
  runtime.py          downloads and manages the local model engine
  tutor.py            provider abstraction, prompting, streaming
  server.py           stdlib HTTP server and JSON API
  static/             frontend: vanilla JS, inline-SVG charts, no build step
```

Two data-quality fixes worth knowing about, because both would silently corrupt
the metrics:

- The official bank ships some skills under two spellings (`Cross-Text
  Connections` and `Cross-text Connections`). Left alone, one skill becomes two
  rows and two independent accuracy estimates. `db.normalize_skill_names` merges
  casing variants on fetch.
- OpenSAT's `id` field is **not unique** — 2,474 questions share 1,200 ids
  (`random_id_a1` appears 91 times). Keying on it silently discards half the
  bank, so ferrule keys on a content hash instead.

Maths renders as MathML, which every current browser handles natively — no
KaTeX, no MathJax, no build step. Chart colours were run through a
contrast/colour-blindness validator against this app's own surfaces rather than
picked by eye.

---

## Contributing

Useful directions:

- A timed full-module mode (27 R&W questions in 32 minutes) for pacing practice
- Adaptive second-module logic mirroring real scoring
- A test suite
- Bundling Python so Windows needs no separate install
- Export a wrong-answer set to PDF for offline review
- Better score calibration from real reported score pairs
- PSAT support (`fetch --assessment psat` already works; the blueprint weights
  and pacing targets are SAT-specific)

Keep the zero-Python-dependency constraint if you can — it is most of the reason
a student can go from clone to practising in two minutes.

## Licence

Code is [MIT](LICENSE). The licence covers the software only, explicitly not the
questions, which are not ours to license. See [ATTRIBUTION.md](ATTRIBUTION.md).

SAT® and College Board are trademarks registered by College Board, which does
not endorse and is not affiliated with this project.
