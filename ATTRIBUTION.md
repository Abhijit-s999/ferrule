# Attribution and sources

ferrule is a collation of freely available SAT resources. It wrote none of the
questions it shows you. This file records where everything comes from, under
what terms, and what ferrule does and does not do with it.

**The single rule this project is built around: ferrule never redistributes
question content.** No questions are stored in this repository. Nothing is
mirrored, bundled, or re-hosted. Every source is fetched at run time, over the
public internet, into a database on the user's own machine that `.gitignore`
keeps out of version control.

If you fork this project, keep that rule. It is the difference between a study
tool and a copyright problem.

---

## Questions

### College Board SAT Suite Question Bank — *default source*

- **Publisher:** College Board
- **Source:** <https://satsuiteeducatorquestionbank.collegeboard.org/>
- **Used for:** ~3,250 official SAT questions with domain, skill and difficulty
  tags, answer keys, and College Board's own written rationales.
- **How it is accessed:** the public educator question bank, which requires no
  account, no login and no API key. ferrule calls the same endpoint the public
  website calls from a browser.
- **Terms:** the questions are the copyright of College Board. ferrule does not
  redistribute them — each user fetches their own local copy.

> SAT® and College Board are trademarks registered by College Board. College
> Board does not endorse, and is not affiliated with, this project.

This is the calibration standard for everything in the app: score estimates,
skill-level metrics and difficulty analytics are computed from official
questions only.

### OpenSAT — *optional, off by default*

- **Publisher:** Anas Shohdy and OpenSAT contributors
- **Source:** <https://github.com/Anas099X/OpenSAT>
- **Used for:** ~2,340 community-written practice questions with explanations,
  tagged by domain.
- **Terms:** OpenSAT's licence grants database use explicitly — *"Users are free
  to use the OpenSAT database for commercial purposes. This means you can
  utilize the data for your own projects or services without restriction."* The
  other restrictions in that licence cover OpenSAT's own source code, which
  ferrule does not use, copy or derive from.
- **Why it is off by default:** these questions are not calibrated to real exam
  difficulty, and they carry only domain tags with no skill breakdown, so they
  cannot feed skill-level metrics. Measured overlap with the official bank is
  under 1%, so they are genuinely additional material rather than a copy — but
  mixing them into your statistics would make those statistics mean less.
  Enable them in Settings when you want extra volume; per-source accuracy is
  reported separately either way.

### OnePrep — *linked, deliberately not fetched*

- **Source:** <https://www.oneprep.com/>
- **Status:** credited and recommended as a free resource. Not scraped, not
  mirrored, not bundled.
- **Why:** OnePrep's `robots.txt` disallows automated access to its question API
  (`Disallow: /api/`), separately disallows the `ClaudeBot` and `anthropic-ai`
  agents entirely, and sets `Content-Signal: ai-train=no, use=reference` as an
  express reservation of rights under Article 4 of EU Directive 2019/790. Its
  content is published "All rights reserved".

Linking to a free resource is something its terms permit, and OnePrep is a
genuinely good free question bank. Go use it directly — just not through this
app.

---

## Software

### llama.cpp

- **Source:** <https://github.com/ggml-org/llama.cpp>
- **Licence:** MIT
- **Used for:** the local inference engine. ferrule downloads an official
  prebuilt release binary for your platform; it does not vendor or modify the
  source.

### Models

ferrule downloads GGUF model files from Hugging Face on request. Each model
keeps its own licence, shown in the app before you download it:

| Model | Publisher | Licence |
| --- | --- | --- |
| Qwen2.5 7B / 0.5B Instruct | Alibaba Cloud (Qwen) | Apache 2.0 |
| Llama 3.1 8B Instruct | Meta | Llama 3.1 Community Licence |
| Llama 3.2 3B Instruct | Meta | Llama 3.2 Community Licence |
| Gemma 2 9B Instruct | Google | Gemma Terms of Use |

GGUF conversions are commonly published by community quantisers (notably
[bartowski](https://huggingface.co/bartowski)); the underlying model licence is
the one that governs use.

No model is bundled with ferrule, and none is downloaded unless you ask for it.

---

## ferrule itself

The **code** is MIT licensed — see [LICENSE](LICENSE). The licence covers the
software only, and explicitly not the questions, which are not ours to license.

---

## If you are a rights holder

If you publish one of the sources above and want its use here changed or
removed, open an issue. Removing a source is a small change: it is one entry in
`ferrule/sources.py`, because attribution is stored next to the code that
fetches it rather than only in documentation.
