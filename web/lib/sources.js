/* Where questions come from, and what each provider allows.
 * Mirrors ferrule/sources.py; see that file and ATTRIBUTION.md for the terms.
 *
 * The hard rule holds here too: the web build never redistributes question
 * content. The site serves only the app; each visitor's browser fetches the
 * questions itself, straight from the source, into its own storage. */

import { getMeta, setMeta } from './store.js';

export const SOURCES = {
  collegeboard: {
    id: 'collegeboard',
    name: 'College Board SAT Suite Question Bank',
    short: 'College Board',
    url: 'https://satsuiteeducatorquestionbank.collegeboard.org/',
    publisher: 'College Board',
    official: true,
    default_enabled: true,
    has_skill_tags: true,
    access:
      'Public educator question bank; no account or API key required. ' +
      'Fetched from the same endpoint the public site calls from a browser.',
    terms:
      'Questions are the copyright of College Board. ferrule does not ' +
      'redistribute them: each user fetches their own local copy. ' +
      'SAT and College Board are trademarks registered by College Board, ' +
      'which does not endorse and is not affiliated with this project.',
    why:
      'Written by the people who write the exam, tagged to the real ' +
      'domain/skill taxonomy, and shipped with official rationales. ' +
      'This is the calibration standard.',
  },
  opensat: {
    id: 'opensat',
    name: 'OpenSAT question database',
    short: 'OpenSAT',
    url: 'https://github.com/Anas099X/OpenSAT',
    publisher: 'Anas Shohdy and OpenSAT contributors',
    official: false,
    default_enabled: false,
    has_skill_tags: false,
    access: 'Public JSON database published by the OpenSAT project.',
    terms:
      'OpenSAT\'s licence grants database use explicitly: "Users are free ' +
      'to use the OpenSAT database for commercial purposes... without ' +
      'restriction." The separate restrictions in that licence apply to ' +
      'OpenSAT\'s own source code, which ferrule does not use or copy.',
    why:
      'Community-written practice questions, distinct from the official ' +
      'bank (measured overlap under 1%). Off by default: they are not ' +
      'calibrated to real exam difficulty and carry only domain tags, no ' +
      'skill tags, so they cannot feed skill-level metrics.',
  },
};

export const DEFAULT_SOURCES = Object.values(SOURCES)
  .filter((s) => s.default_enabled).map((s) => s.id);

export const NOT_FETCHED = {};

export const get = (id) => SOURCES[id] || null;

export function enabledIds(db) {
  const raw = getMeta(db, 'enabled_sources');
  if (!raw) return [...DEFAULT_SOURCES];
  const ids = raw.split(',').filter((s) => s in SOURCES);
  return ids.length ? ids : [...DEFAULT_SOURCES];
}

export function setEnabled(db, ids) {
  const valid = (ids || []).filter((s) => s in SOURCES);
  if (!valid.length) throw new Error('at least one source must stay enabled');
  setMeta(db, 'enabled_sources', valid.join(','));
  return valid;
}

export const placeholders = (list) => list.map(() => '?').join(',');
