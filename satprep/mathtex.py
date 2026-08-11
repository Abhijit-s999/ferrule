"""Turn the LaTeX in community questions into MathML.

College Board ships MathML, which browsers render natively. OpenSAT ships
LaTeX inside `$...$` and `\\(...\\)`, which renders as literal backslashes and
braces — unreadable, and worse, unanswerable when the whole equation is the
question.

Rather than pull in a rendering library, this converts the small subset of
LaTeX that actually appears into the MathML the app already displays. Measured
across the OpenSAT set, that subset is: \\frac (735), \\sqrt (313), \\pi (742),
plus a tail of \\cdot, \\times, \\pm, \\neq, \\circ, \\cap, \\log and \\text,
with superscripts and subscripts throughout.

Anything outside that subset is left as readable plain text rather than being
mangled: a wrong equation is worse than a plain one.
"""

import re

# Single tokens that map straight to a character.
SYMBOLS = {
    "pi": "\u03c0", "theta": "\u03b8", "alpha": "\u03b1", "beta": "\u03b2",
    "cdot": "\u00b7", "times": "\u00d7", "div": "\u00f7", "pm": "\u00b1",
    "mp": "\u2213", "neq": "\u2260", "leq": "\u2264", "le": "\u2264",
    "geq": "\u2265", "ge": "\u2265", "approx": "\u2248", "infty": "\u221e",
    "circ": "\u00b0", "degree": "\u00b0", "cap": "\u2229", "cup": "\u222a",
    "in": "\u2208", "rightarrow": "\u2192", "to": "\u2192", "ldots": "\u2026",
    "dots": "\u2026", "angle": "\u2220", "triangle": "\u25b3", "sum": "\u2211",
}
# Commands whose name is simply rendered upright (functions).
FUNCTIONS = {"log", "ln", "sin", "cos", "tan", "sec", "csc", "cot", "exp", "max", "min"}

# Where maths hides: $$...$$, $...$, \(...\), \[...\].
# $$ must be tried before $, or the display form is split into two empty ones.
SEGMENTS = re.compile(
    r"\$\$(.+?)\$\$"
    r"|\\\((.+?)\\\)"
    r"|\\\[(.+?)\\\]"
    r"|(?<![\w$])\$([^$\n]{1,400})\$(?![\w$])",
    re.S,
)

# Some fragments carry no delimiters at all — "\frac{-54}{w} = 6" sits raw in
# the sentence. Convert those commands in place instead of leaving backslashes
# on screen.
BARE = re.compile(r"\\(?:frac\s*\{[^{}]*\}\s*\{[^{}]*\}|sqrt\s*\{[^{}]*\})")


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _brace(src, i):
    """Read a {...} group (or one character) starting at i. Returns (body, next_i)."""
    if i >= len(src):
        return "", i
    if src[i] != "{":
        if src[i] == "\\":                      # a command like \pi as the argument
            m = re.match(r"\\([a-zA-Z]+)", src[i:])
            if m:
                return m.group(0), i + m.end()
        return src[i], i + 1
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j], j + 1
        j += 1
    return src[i + 1:], len(src)          # unbalanced; take the rest


def _row(latex):
    """Convert a LaTeX fragment into a sequence of MathML elements."""
    out, i, n = [], 0, len(latex)
    while i < n:
        ch = latex[i]

        if ch == "\\":
            m = re.match(r"\\([a-zA-Z]+)", latex[i:])
            if not m:                                   # escaped punctuation
                out.append("<mo>%s</mo>" % _esc(latex[i + 1:i + 2]))
                i += 2
                continue
            name = m.group(1)
            i += m.end()
            if name == "frac":
                num, i = _brace(latex, i)
                den, i = _brace(latex, i)
                out.append("<mfrac><mrow>%s</mrow><mrow>%s</mrow></mfrac>"
                           % (_row(num), _row(den)))
            elif name == "sqrt":
                if i < n and latex[i] == "[":           # \sqrt[3]{x}
                    close = latex.find("]", i)
                    idx = latex[i + 1:close] if close > 0 else "2"
                    i = close + 1 if close > 0 else i
                    body, i = _brace(latex, i)
                    out.append("<mroot><mrow>%s</mrow><mn>%s</mn></mroot>"
                               % (_row(body), _esc(idx)))
                else:
                    body, i = _brace(latex, i)
                    out.append("<msqrt><mrow>%s</mrow></msqrt>" % _row(body))
            elif name == "text" or name == "mathrm":
                body, i = _brace(latex, i)
                out.append("<mtext>%s</mtext>" % _esc(body))
            elif name in FUNCTIONS:
                out.append("<mi>%s</mi>" % name)
            elif name in SYMBOLS:
                sym = SYMBOLS[name]
                tag = "mi" if name in ("pi", "theta", "alpha", "beta") else "mo"
                out.append("<%s>%s</%s>" % (tag, sym, tag))
            else:
                raise ValueError("unsupported command \\" + name)

        elif ch in "^_":
            if not out:
                out.append("<mi></mi>")
            base = out.pop()
            body, i2 = _brace(latex, i + 1)
            i = i2
            tag = "msup" if ch == "^" else "msub"
            out.append("<%s>%s<mrow>%s</mrow></%s>" % (tag, base, _row(body), tag))

        elif ch.isdigit():
            m = re.match(r"\d+(?:\.\d+)?", latex[i:])
            out.append("<mn>%s</mn>" % m.group(0))
            i += m.end()

        elif ch.isalpha():
            out.append("<mi>%s</mi>" % ch)
            i += 1

        elif ch in "+-=<>/*(),[]|!:;":
            out.append("<mo>%s</mo>" % _esc(ch))
            i += 1

        elif ch in "{}":
            i += 1                                    # grouping only

        elif ch.isspace():
            i += 1

        else:
            out.append("<mo>%s</mo>" % _esc(ch))
            i += 1

    return "".join(out)


def _plain(latex):
    """Readable fallback when a fragment uses something we do not convert."""
    s = latex
    s = re.sub(r"\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1)/(\2)", s)
    # NB: the replacement template is not a raw string — "\u221a" must already
    # be the character, since re.sub does not interpret \u escapes in templates.
    s = re.sub(r"\\sqrt\s*\{([^{}]*)\}", "\u221a(\\1)", s)
    for name, sym in SYMBOLS.items():
        s = re.sub(r"\\%s\b" % name, sym, s)
    s = re.sub(r"\\(?:left|right|!|,|;|quad|qquad)\b", "", s)
    s = re.sub(r"\\text\s*\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\\[a-zA-Z]+", "", s)
    s = s.replace("{", "").replace("}", "").replace("$", "")
    return _esc(re.sub(r"\s+", " ", s).strip())


def to_mathml(latex):
    """One LaTeX fragment -> a <math> element, or plain text if unconvertible."""
    try:
        body = _row(latex)
        if not body:
            raise ValueError("empty")
        return '<math xmlns="http://www.w3.org/1998/Math/MathML">%s</math>' % body
    except (ValueError, RecursionError, IndexError):
        return _plain(latex)


def render(html):
    """Replace every LaTeX segment in a string with MathML."""
    if not html:
        return html

    def sub(m):
        frag = next((g for g in m.groups() if g), "")
        # A bare "$12.50" is money, not maths.
        if not re.search(r"[\\^_={}]|[a-zA-Z]\s*[\d(]|\d\s*[a-zA-Z]", frag):
            return m.group(0)
        return to_mathml(frag)

    if "$" in html or "\\(" in html or "\\[" in html:
        html = SEGMENTS.sub(sub, html)

    # Anything still carrying a raw \frac or \sqrt was never delimited.
    if "\\frac" in html or "\\sqrt" in html:
        html = BARE.sub(lambda m: to_mathml(m.group(0)), html)
    return html


def render_options(options_json):
    """Convert LaTeX inside a stored options JSON array.

    The options column holds JSON, where a backslash is escaped as \\\\. Running
    the text converter over that raw string would both miss the commands and
    corrupt the escaping, so parse first, convert each choice, then re-encode.
    """
    import json

    try:
        opts = json.loads(options_json or "[]")
    except (ValueError, TypeError):
        return options_json
    if not isinstance(opts, list):
        return options_json

    changed = False
    for o in opts:
        if isinstance(o, dict) and isinstance(o.get("content"), str):
            new = render(o["content"])
            if new != o["content"]:
                o["content"] = new
                changed = True
    return json.dumps(opts) if changed else options_json


def has_latex(html):
    return bool(html) and bool(
        re.search(r"\\(?:frac|sqrt|pi|cdot|times|pm|neq|le|ge|circ|cap|log|text)\b"
                  r"|\\\(|\\\[", html)
    )
