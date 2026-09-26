/* Maths markup, ported from ferrule/mathtex.py -- see that file for the why.
 *
 *  - fixMathml(): rewrites <mfenced>, which MathML Core dropped, so College
 *    Board's brackets are actually drawn.
 *  - render(): converts the small LaTeX subset OpenSAT uses into MathML,
 *    falling back to readable plain text for anything outside it. */

const SYMBOLS = {
  pi: 'π', theta: 'θ', alpha: 'α', beta: 'β',
  cdot: '·', times: '×', div: '÷', pm: '±',
  mp: '∓', neq: '≠', leq: '≤', le: '≤',
  geq: '≥', ge: '≥', approx: '≈', infty: '∞',
  circ: '°', degree: '°', cap: '∩', cup: '∪',
  in: '∈', rightarrow: '→', to: '→', ldots: '…',
  dots: '…', angle: '∠', triangle: '△', sum: '∑',
};
const FUNCTIONS = new Set(['log', 'ln', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'exp', 'max', 'min']);
const GREEK = new Set(['pi', 'theta', 'alpha', 'beta']);

// $$ must be tried before $, or the display form is split into two empty ones.
const SEGMENTS = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|(?<![\w$])\$([^$\n]{1,400})\$(?![\w$])/g;
// Commands that sit in the sentence with no delimiters at all.
const BARE = /\\(?:frac\s*\{[^{}]*\}\s*\{[^{}]*\}|sqrt\s*\{[^{}]*\})/g;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Read a {...} group (or one token) starting at i. Returns [body, nextIndex]. */
function brace(src, i) {
  if (i >= src.length) return ['', i];
  if (src[i] !== '{') {
    if (src[i] === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (m) return [m[0], i + m[0].length];
    }
    return [src[i], i + 1];
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return [src.slice(i + 1, j), j + 1];
    }
  }
  return [src.slice(i + 1), src.length]; // unbalanced; take the rest
}

class Unsupported extends Error {}

function row(latex) {
  const out = [];
  let i = 0;
  const n = latex.length;
  while (i < n) {
    const ch = latex[i];

    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(latex.slice(i));
      if (!m) {                                   // escaped punctuation
        out.push(`<mo>${esc(latex.slice(i + 1, i + 2))}</mo>`);
        i += 2;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (name === 'frac') {
        let num, den;
        [num, i] = brace(latex, i);
        [den, i] = brace(latex, i);
        out.push(`<mfrac><mrow>${row(num)}</mrow><mrow>${row(den)}</mrow></mfrac>`);
      } else if (name === 'sqrt') {
        if (i < n && latex[i] === '[') {          // \sqrt[3]{x}
          const close = latex.indexOf(']', i);
          const idx = close > 0 ? latex.slice(i + 1, close) : '2';
          if (close > 0) i = close + 1;
          let body;
          [body, i] = brace(latex, i);
          out.push(`<mroot><mrow>${row(body)}</mrow><mn>${esc(idx)}</mn></mroot>`);
        } else {
          let body;
          [body, i] = brace(latex, i);
          out.push(`<msqrt><mrow>${row(body)}</mrow></msqrt>`);
        }
      } else if (name === 'text' || name === 'mathrm') {
        let body;
        [body, i] = brace(latex, i);
        out.push(`<mtext>${esc(body)}</mtext>`);
      } else if (FUNCTIONS.has(name)) {
        out.push(`<mi>${name}</mi>`);
      } else if (name in SYMBOLS) {
        const tag = GREEK.has(name) ? 'mi' : 'mo';
        out.push(`<${tag}>${SYMBOLS[name]}</${tag}>`);
      } else {
        throw new Unsupported(`unsupported command \\${name}`);
      }
    } else if (ch === '^' || ch === '_') {
      if (!out.length) out.push('<mi></mi>');
      const base = out.pop();
      let body;
      [body, i] = brace(latex, i + 1);
      const tag = ch === '^' ? 'msup' : 'msub';
      out.push(`<${tag}>${base}<mrow>${row(body)}</mrow></${tag}>`);
    } else if (/\d/.test(ch)) {
      const m = /^\d+(?:\.\d+)?/.exec(latex.slice(i));
      out.push(`<mn>${m[0]}</mn>`);
      i += m[0].length;
    } else if (/\p{L}/u.test(ch)) {
      out.push(`<mi>${ch}</mi>`);
      i += 1;
    } else if ('+-=<>/*(),[]|!:;'.includes(ch)) {
      out.push(`<mo>${esc(ch)}</mo>`);
      i += 1;
    } else if (ch === '{' || ch === '}' || /\s/.test(ch)) {
      i += 1;                                     // grouping / spacing only
    } else {
      out.push(`<mo>${esc(ch)}</mo>`);
      i += 1;
    }
  }
  return out.join('');
}

/* Readable fallback when a fragment uses something we do not convert. */
function plain(latex) {
  let s = latex;
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  for (const [name, sym] of Object.entries(SYMBOLS)) {
    s = s.replace(new RegExp(`\\\\${name}\\b`, 'g'), sym);
  }
  s = s.replace(/\\(?:left|right|!|,|;|quad|qquad)\b/g, '');
  s = s.replace(/\\text\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\[a-zA-Z]+/g, '');
  s = s.replace(/[{}$]/g, '');
  return esc(s.replace(/\s+/g, ' ').trim());
}

export function toMathml(latex) {
  try {
    const body = row(latex);
    if (!body) throw new Unsupported('empty');
    return `<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`;
  } catch {
    return plain(latex);
  }
}

/* Replace every LaTeX segment in a string with MathML. */
export function render(html) {
  if (!html) return html;
  if (html.includes('$') || html.includes('\\(') || html.includes('\\[')) {
    html = html.replace(SEGMENTS, (whole, a, b, c, d) => {
      const frag = a || b || c || d || '';
      // A bare "$12.50" is money, not maths.
      if (!/[\\^_={}]|[a-zA-Z]\s*[\d(]|\d\s*[a-zA-Z]/.test(frag)) return whole;
      return toMathml(frag);
    });
  }
  if (html.includes('\\frac') || html.includes('\\sqrt')) {
    html = html.replace(BARE, (m) => toMathml(m));
  }
  return html;
}

// ---------------------------------------------------------------- MathML Core

const MFENCED = /<mfenced([^>]*)>((?:(?!<mfenced\b)(?!<\/mfenced>)[\s\S])*)<\/mfenced>/gi;

function attr(name, attrs) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)
    || new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs);
  return m ? m[1] : null;
}

/* Split a MathML fragment into its top-level elements. */
function topLevelChildren(inner) {
  const out = [];
  let depth = 0, start = 0;
  for (const m of inner.matchAll(/<(\/?)([a-zA-Z][\w.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, , , selfclose] = m;
    const end = m.index + m[0].length;
    if (selfclose) {
      if (depth === 0) { out.push(inner.slice(m.index, end)); start = end; }
      continue;
    }
    if (closing) {
      depth--;
      if (depth === 0) { out.push(inner.slice(start, end)); start = end; }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail) out.push(tail);
  return out.map((x) => x.trim()).filter(Boolean);
}

/* Rewrite <mfenced> as MathML Core. Chromium draws its children but silently
 * drops the fences, so f(x) read as "f x" and |4x-3| = -9 as 4x-3 = -9 --
 * which changes the answer. Innermost-first so nesting unwinds correctly. */
export function fixMathml(html) {
  if (!html || !html.includes('<mfenced')) return html;
  const once = (text) => text.replace(MFENCED, (whole, attrs, inner) => {
    const o = attr('open', attrs);
    const c = attr('close', attrs);
    const sep = attr('separators', attrs);
    const open = o !== null ? o : '(';
    const close = c !== null ? c : ')';
    const seps = (sep !== null ? sep : ',').replace(/ /g, '');
    const parts = [];
    if (open) parts.push(`<mo fence="true" stretchy="true">${open}</mo>`);
    topLevelChildren(inner).forEach((kid, i) => {
      if (i) {
        const ch = seps ? seps[Math.min(i - 1, seps.length - 1)] : '';
        if (ch) parts.push(`<mo separator="true">${ch}</mo>`);
      }
      parts.push(kid);
    });
    if (close) parts.push(`<mo fence="true" stretchy="true">${close}</mo>`);
    return `<mrow>${parts.join('')}</mrow>`;
  });
  let prev = null;
  for (let guard = 0; prev !== html && html.includes('<mfenced') && guard < 12; guard++) {
    prev = html;
    html = once(html);
  }
  return html;
}
