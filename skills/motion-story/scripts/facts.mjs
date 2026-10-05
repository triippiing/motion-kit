// facts.mjs -- the facts format (version 1): what a source reader found, before Claude turns it into STORY.md.
//
//   { version: 1, source: { kind, ref, story, command }, title, subtitle?, items: [{ label, detail?, tag }],
//     stats?: { name: number }, links?: { name: string }, media?: [{ path, alt? }] }
//
// validateFacts is the one definition of the shape (every source kind writes it); normalizeFacts collapses
// whitespace in the text, cuts long text at a word boundary with "…" (a subtitle to its whole sentences that fit,
// when it can; caps: title 80, subtitle 200, label 60, detail and alt 160) and puts the keys in a fixed order;
// writeFacts does both and writes the file atomically. The same input gives byte-identical output.
import { renameSync, rmSync, writeFileSync } from 'node:fs';

export class UsageError extends Error {}

export const TAGS = ['feature', 'fix', 'change', 'docs', 'other'];
export const MAX_ITEMS = 12;
export const MAX_LABEL = 60;
export const MAX_DETAIL = 160;
export const MAX_TITLE = 80;
export const MAX_SUBTITLE = 200;
export const MAX_ALT = 160;

const TOP = ['version', 'source', 'title', 'subtitle', 'items', 'stats', 'links', 'media'];
const SOURCE = ['kind', 'ref', 'story', 'command'];
const ITEM = ['label', 'detail', 'tag'];
const MEDIA = ['path', 'alt'];

const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const chars = (s) => [...s].length;

// Every whitespace run (newlines included) to one space, trimmed.
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// s squashed and, when longer than max characters, cut to at most max (the "…" included): at the last space
// before the cut, or mid-word when the first word alone is too long.
export function cut(s, max) {
  const c = [...squash(s)];
  if (c.length <= max) return c.join('');
  let head = c.slice(0, max - 1);
  if (c[max - 1] !== ' ') {
    const i = head.lastIndexOf(' ');
    if (i > 0) head = head.slice(0, i);
  }
  return `${head.join('').trimEnd()}…`;
}

// s squashed and, when longer than max, its leading whole sentences that fit; when not even the first fits, cut().
export function sentences(s, max) {
  const t = squash(s);
  if (chars(t) <= max) return t;
  let kept = '';
  for (const part of t.split(/(?<=[.!?…])\s+/)) {
    const next = kept ? `${kept} ${part}` : part;
    if (chars(next) > max) break;
    kept = next;
  }
  return kept || cut(t, max);
}

// The keys of obj in the given order, then any others (sorted, so validateFacts can name them); undefined dropped.
function ordered(obj, keys) {
  const out = {};
  for (const k of [...keys, ...Object.keys(obj).filter((k) => !keys.includes(k)).sort()]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

const sortedKeys = (obj) => ordered(obj, Object.keys(obj).sort());
const text = (x, max) => (typeof x === 'string' ? (max ? cut(x, max) : squash(x)) : x);

// A copy of facts in the canonical form. Values of the wrong type are kept as they are, for validateFacts to report.
export function normalizeFacts(facts) {
  if (!isObj(facts)) return facts;
  const f = ordered(facts, TOP);
  if (isObj(f.source)) f.source = ordered(f.source, SOURCE);
  if ('title' in f) f.title = text(f.title, MAX_TITLE);
  if (typeof f.subtitle === 'string') f.subtitle = sentences(f.subtitle, MAX_SUBTITLE);
  if (Array.isArray(f.items)) {
    f.items = f.items.map((it) => {
      if (!isObj(it)) return it;
      const o = ordered(it, ITEM);
      if ('label' in o) o.label = text(o.label, MAX_LABEL);
      if ('detail' in o) o.detail = text(o.detail, MAX_DETAIL);
      return o;
    });
  }
  for (const k of ['stats', 'links']) if (isObj(f[k])) f[k] = sortedKeys(f[k]);
  if (Array.isArray(f.media)) {
    f.media = f.media.map((m) => {
      if (!isObj(m)) return m;
      const o = ordered(m, MEDIA);
      if ('alt' in o) o.alt = text(o.alt, MAX_ALT);
      return o;
    });
  }
  return f;
}

// The problems with facts, one line each; empty when it is valid.
export function validateFacts(facts) {
  if (!isObj(facts)) return ['facts must be an object'];
  const p = [];
  const unknown = (obj, keys, where) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) p.push(`${where}${k}: unknown field`);
  };
  unknown(facts, TOP, '');
  if (facts.version !== 1) p.push(`version must be 1, got ${JSON.stringify(facts.version)}`);
  if (!isObj(facts.source)) p.push('source must be an object with kind, ref, story and command');
  else {
    for (const k of SOURCE) if (!isText(facts.source[k])) p.push(`source.${k} must be a non-empty string`);
    unknown(facts.source, SOURCE, 'source.');
  }
  if (!isText(facts.title)) p.push('title must be a non-empty string');
  else if (chars(facts.title) > MAX_TITLE) p.push(`title: at most ${MAX_TITLE} characters`);
  if ('subtitle' in facts && typeof facts.subtitle !== 'string') p.push('subtitle must be a string');
  else if (chars(facts.subtitle ?? '') > MAX_SUBTITLE) p.push(`subtitle: at most ${MAX_SUBTITLE} characters`);
  if (!Array.isArray(facts.items)) p.push('items must be an array');
  else {
    if (facts.items.length > MAX_ITEMS) p.push(`items: at most ${MAX_ITEMS}, got ${facts.items.length}`);
    facts.items.forEach((it, i) => {
      const at = `items[${i}]`;
      if (!isObj(it)) { p.push(`${at} must be an object`); return; }
      if (!isText(it.label)) p.push(`${at}.label must be a non-empty string`);
      else if (chars(it.label) > MAX_LABEL) p.push(`${at}.label: at most ${MAX_LABEL} characters`);
      if ('detail' in it) {
        if (typeof it.detail !== 'string') p.push(`${at}.detail must be a string`);
        else if (chars(it.detail) > MAX_DETAIL) p.push(`${at}.detail: at most ${MAX_DETAIL} characters`);
      }
      if (!TAGS.includes(it.tag)) p.push(`${at}.tag must be one of ${TAGS.join(', ')}, got ${JSON.stringify(it.tag)}`);
      unknown(it, ITEM, `${at}.`);
    });
  }
  const map = (k, ok, what) => {
    if (!(k in facts)) return;
    if (!isObj(facts[k])) { p.push(`${k} must be an object of ${what}s`); return; }
    for (const [name, v] of Object.entries(facts[k])) if (!ok(v)) p.push(`${k}.${name} must be a ${what}`);
  };
  map('stats', (v) => typeof v === 'number' && Number.isFinite(v), 'number');
  map('links', (v) => typeof v === 'string', 'string');
  if ('media' in facts) {
    if (!Array.isArray(facts.media)) p.push('media must be an array');
    else facts.media.forEach((m, i) => {
      const at = `media[${i}]`;
      if (!isObj(m)) { p.push(`${at} must be an object`); return; }
      if (!isText(m.path)) p.push(`${at}.path must be a non-empty string`);
      if ('alt' in m && typeof m.alt !== 'string') p.push(`${at}.alt must be a string`);
      else if (chars(m.alt ?? '') > MAX_ALT) p.push(`${at}.alt: at most ${MAX_ALT} characters`);
      unknown(m, MEDIA, `${at}.`);
    });
  }
  return p;
}

// Normalizes and validates facts, then writes them to file (two-space JSON, trailing newline) through a temp file
// and a rename, so a reader never sees half a file. Invalid facts throw UsageError naming every problem.
// Returns the facts as written.
export function writeFacts(file, facts) {
  const f = normalizeFacts(facts);
  const problems = validateFacts(f);
  if (problems.length) throw new UsageError(`invalid facts:\n  ${problems.join('\n  ')}`);
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(f, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return f;
}
