"""Where questions come from, and what each provider allows.

satprep is a collation of freely available SAT resources. Every question in the
database records which source it came from, and every source declares its terms
here in one place, so attribution is a property of the data rather than a note
in a README that drifts out of date.

The hard rule: satprep never redistributes question content. Sources are
fetched at run time into the user's own local database. See ATTRIBUTION.md.
"""

# ---------------------------------------------------------------------------
# Sources we fetch from
# ---------------------------------------------------------------------------

SOURCES = {
    "collegeboard": {
        "id": "collegeboard",
        "name": "College Board SAT Suite Question Bank",
        "short": "College Board",
        "url": "https://satsuiteeducatorquestionbank.collegeboard.org/",
        "publisher": "College Board",
        "official": True,
        "default_enabled": True,
        "has_skill_tags": True,
        "access": (
            "Public educator question bank; no account or API key required. "
            "Fetched from the same endpoint the public site calls from a browser."
        ),
        "terms": (
            "Questions are the copyright of College Board. satprep does not "
            "redistribute them: each user fetches their own local copy. "
            "SAT and College Board are trademarks registered by College Board, "
            "which does not endorse and is not affiliated with this project."
        ),
        "why": (
            "Written by the people who write the exam, tagged to the real "
            "domain/skill taxonomy, and shipped with official rationales. "
            "This is the calibration standard."
        ),
    },
    "opensat": {
        "id": "opensat",
        "name": "OpenSAT question database",
        "short": "OpenSAT",
        "url": "https://github.com/Anas099X/OpenSAT",
        "publisher": "Anas Shohdy and OpenSAT contributors",
        "official": False,
        "default_enabled": False,
        "has_skill_tags": False,
        "access": "Public JSON database published by the OpenSAT project.",
        "terms": (
            "OpenSAT's licence grants database use explicitly: \"Users are free "
            "to use the OpenSAT database for commercial purposes... without "
            "restriction.\" The separate restrictions in that licence apply to "
            "OpenSAT's own source code, which satprep does not use or copy."
        ),
        "why": (
            "Community-written practice questions, distinct from the official "
            "bank (measured overlap under 1%). Off by default: they are not "
            "calibrated to real exam difficulty and carry only domain tags, no "
            "skill tags, so they cannot feed skill-level metrics."
        ),
    },
}

DEFAULT_SOURCES = [s["id"] for s in SOURCES.values() if s["default_enabled"]]


# ---------------------------------------------------------------------------
# Sources we deliberately do not fetch from
# ---------------------------------------------------------------------------
# Recorded here so the reasoning is auditable and nobody has to re-derive it.

NOT_FETCHED = {
    "oneprep": {
        "name": "OnePrep",
        "url": "https://www.oneprep.com/",
        "reason": (
            "OnePrep's robots.txt disallows automated access to its question "
            "API (`Disallow: /api/`), separately disallows the ClaudeBot and "
            "anthropic-ai agents entirely, and sets `Content-Signal: "
            "ai-train=no, use=reference` as an express reservation of rights. "
            "Its content is marked \"All rights reserved\"."
        ),
        "status": (
            "Linked and credited as a recommended free resource, which its "
            "terms do permit. Not scraped, not mirrored, not bundled."
        ),
    },
}


def get(source_id):
    return SOURCES.get(source_id)


def label(source_id):
    src = SOURCES.get(source_id)
    return src["short"] if src else source_id


def enabled_ids(conn):
    """Which sources the user currently practises from."""
    from . import db

    raw = db.get_meta(conn, "enabled_sources")
    if not raw:
        return list(DEFAULT_SOURCES)
    ids = [s for s in raw.split(",") if s in SOURCES]
    return ids or list(DEFAULT_SOURCES)


def set_enabled(conn, ids):
    from . import db

    valid = [s for s in ids if s in SOURCES]
    if not valid:
        raise ValueError("at least one source must stay enabled")
    db.set_meta(conn, "enabled_sources", ",".join(valid))
    return valid
