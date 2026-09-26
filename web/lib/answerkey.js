/* Catch OpenSAT answer keys that disagree with their own worked solutions.
 * Ported from ferrule/answerkey.py -- see that file for the reasoning. In
 * short: when every choice is a plain number and the explanation ends on a
 * value matching exactly one of them, the key follows the explanation; when
 * anything is less certain, the key is left exactly as upstream wrote it. */

const NUM = String.raw`-?\d[\d,]*(?:\.\d+)?`;

// The value the explanation finishes on: "... = 17." / "... is 50 people."
const FINAL = new RegExp(
  String.raw`(?:=|\bis|\bare|\bequals|\bbe)\s*\$?(` + NUM + String.raw`)\s*(?:%|[a-z ]{0,24})?$`,
  'i',
);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/* Markup to plain text, without inventing numbers: tags become spaces, so a
 * fraction's parts stay "4 5" rather than fusing into "45". */
function flat(text) {
  let s = (text || '').replace(/<[^>]+>/g, ' ');
  s = unescapeHtml(s);
  s = s.replace(/−/g, '-').replace(/–/g, '-').replace(/\\\$/g, '$');
  s = s.replace(/\s+/g, ' ').trim();
  return s.replace(/(^|[=(,]\s?|\bis |\bare )-\s+(?=\d)/g, '$1-');
}

function choiceValue(content) {
  const s = flat(content).replace(/\$/g, '').replace(/%/g, '').trim();
  return new RegExp(`^${NUM}$`).test(s) ? parseFloat(s.replace(/,/g, '')) : null;
}

function finalValue(rationale) {
  const m = FINAL.exec(flat(rationale).replace(/[ .)*]+$/, ''));
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

/* The letter the worked solution supports, or null to keep `key` as is. */
export function correctedKey(options, key, rationale) {
  if (!key || key.length !== 1 || !options || !options.length) return null;
  const values = new Map(options.map((o) => [o.letter, choiceValue(o.content)]));
  if ([...values.values()].includes(null) || !values.has(key[0])) return null;
  const final = finalValue(rationale);
  if (final === null) return null;
  const hits = [...values].filter(([, v]) => v === final).map(([letter]) => letter);
  return hits.length === 1 && hits[0] !== key[0] ? hits[0] : null;
}
