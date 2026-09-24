"""Catch OpenSAT answer keys that disagree with their own worked solutions.

OpenSAT is community-written, and a few percent of its maths questions carry a
key that points at the wrong letter: the explanation works through to
"$450 + $50 = $500", $500 is choice B, and the key says D ($600). The reader
is then marked right for the wrong answer, and the tutor -- which is handed
the key -- contradicts the worked solution sitting under the question.

The worked solution is the more trustworthy of the two, because it shows its
reasoning and the key is a single letter. So when the solution ends on a value
that is exactly one of the choices, and that choice is not the keyed one, the
key is moved to it.

This deliberately does nothing unless it is sure. Every choice must be a plain
number, and the explanation must END on "= value" or "is value"; anything else
(expressions, fractions, a solution that trails off into prose) is left as
upstream wrote it. A missed correction costs one bad question, but a wrong
"correction" would break a key that was right.
"""

import html
import re

_NUM = r"-?\d[\d,]*(?:\.\d+)?"

# The value the explanation finishes on: "... = 17." / "... is 50 people."
_FINAL = re.compile(
    r"(?:=|\bis|\bare|\bequals|\bbe)\s*\$?(" + _NUM + r")\s*(?:%|[a-z ]{0,24})?$",
    re.I,
)


def _flat(text):
    """Markup to plain text, without inventing numbers.

    Tags become spaces, so the parts of a MathML fraction or power stay
    separate tokens ("4 5") rather than fusing into a number nobody wrote
    ("45"). A minus written as its own <mo> is rejoined to its number.
    """
    s = re.sub(r"<[^>]+>", " ", text or "")
    s = html.unescape(s)
    s = s.replace("−", "-").replace("–", "-").replace("\\$", "$")
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"(^|[=(,]\s?|\bis |\bare )-\s+(?=\d)", r"\1-", s)


def _choice_value(content):
    s = _flat(content).replace("$", "").replace("%", "").strip()
    return float(s.replace(",", "")) if re.fullmatch(_NUM, s) else None


def _final_value(rationale):
    m = _FINAL.search(_flat(rationale).rstrip(" .)*"))
    return float(m.group(1).replace(",", "")) if m else None


def corrected_key(options, key, rationale):
    """The letter the worked solution supports, or None to keep `key` as is.

    `options` is [{"letter", "content"}], `key` a list like ["D"].
    """
    if not key or len(key) != 1 or not options:
        return None
    values = {o.get("letter"): _choice_value(o.get("content")) for o in options}
    if None in values.values() or key[0] not in values:
        return None
    final = _final_value(rationale)
    if final is None:
        return None
    hits = [letter for letter, v in values.items() if v == final]
    if len(hits) == 1 and hits[0] != key[0]:
        return hits[0]
    return None
