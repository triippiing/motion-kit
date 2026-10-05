import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from '../../motion-video/tests/tmp.mjs';
import { MAX_ITEMS, normalizeFacts, TAGS, UsageError, validateFacts, writeFacts } from '../scripts/facts.mjs';
import { commandLine } from '../scripts/story_facts.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'story_facts.mjs');
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

const minimal = () => ({
  version: 1,
  source: { kind: 'repo', ref: '/tmp/x', story: 'intro', command: 'story_facts.mjs repo /tmp/x' },
  title: 'x',
  items: [],
});

const full = () => ({
  version: 1,
  source: { kind: 'repo', ref: 'https://github.com/triippiing/motion-kit', story: 'release',
    command: 'story_facts.mjs repo https://github.com/triippiing/motion-kit --release latest' },
  title: 'motion-kit 1.4',
  subtitle: 'Sequences and real-app footage',
  items: [{ label: 'Sequences', detail: 'Chapters on one song', tag: 'feature' }, { label: 'Docs', tag: 'docs' }],
  stats: { stars: 41, commits: 23, contributors: 2 },
  links: { url: 'https://github.com/triippiing/motion-kit', install: 'git clone ... && ./install.sh' },
  media: [{ path: 'docs/media/launch.gif', alt: 'the launch video' }, { path: 'shot.png' }],
});

test('facts: constants', () => {
  assert.deepEqual(TAGS, ['feature', 'fix', 'change', 'docs', 'other']);
  assert.equal(MAX_ITEMS, 12);
  assert.ok(new UsageError('x') instanceof Error);
});

test('validateFacts: accepts a full and a minimal object', () => {
  assert.deepEqual(validateFacts(full()), []);
  assert.deepEqual(validateFacts(minimal()), []);
});

test('validateFacts: rejects bad shapes, one problem each', () => {
  const bad = [
    ['wrong version', (f) => { f.version = 2; }, /version/],
    ['missing source.command', (f) => { delete f.source.command; }, /source\.command/],
    ['missing source.kind', (f) => { delete f.source.kind; }, /source\.kind/],
    ['no source', (f) => { delete f.source; }, /source/],
    ['missing title', (f) => { delete f.title; }, /title/],
    ['items not an array', (f) => { f.items = {}; }, /items/],
    ['bad tag', (f) => { f.items[0].tag = 'feat'; }, /items\[0\]\.tag/],
    ['too many items', (f) => { f.items = Array.from({ length: 13 }, (_, i) => ({ label: `i${i}`, tag: 'other' })); }, /items/],
    ['empty label', (f) => { f.items[0].label = ''; }, /items\[0\]\.label/],
    ['long label', (f) => { f.items[0].label = 'a'.repeat(61); }, /items\[0\]\.label/],
    ['non-number stat', (f) => { f.stats.stars = '41'; }, /stats\.stars/],
    ['NaN stat', (f) => { f.stats.stars = NaN; }, /stats\.stars/],
    ['non-string link', (f) => { f.links.url = 5; }, /links\.url/],
    ['media without path', (f) => { f.media[0] = { alt: 'x' }; }, /media\[0\]\.path/],
    ['unknown key', (f) => { f.subtile = 'typo'; }, /subtile/],
  ];
  for (const [name, mutate, re] of bad) {
    const f = full();
    mutate(f);
    const problems = validateFacts(f);
    assert.ok(problems.length >= 1, name);
    assert.match(problems.join('\n'), re, name);
  }
  assert.ok(validateFacts(null).length >= 1);
  assert.ok(validateFacts([]).length >= 1);
});

test('normalizeFacts: label cut at a word boundary with "…", within 60', () => {
  const f = full();
  f.items[0].label = 'Sequences that run as chapters on one song with an intro and an end card';
  const { label } = normalizeFacts(f).items[0];
  assert.ok(label.length <= 60, label);
  assert.ok(label.endsWith('…'), label);
  assert.ok(f.items[0].label.startsWith(label.slice(0, -1)), label);
  assert.ok(!/\s…$/.test(label), label);
  // the cut falls between words: the text before "…" is a whole-word prefix
  assert.equal(f.items[0].label[label.length - 1], ' ');
  assert.deepEqual(validateFacts(normalizeFacts(f)), []);
});

test('normalizeFacts: detail within 160, a single long word is hard-cut, short text untouched', () => {
  const f = full();
  f.items[0].detail = 'word '.repeat(60);
  f.items[1].label = 'x'.repeat(80);
  const n = normalizeFacts(f);
  assert.ok(n.items[0].detail.length <= 160 && n.items[0].detail.endsWith('word…'), n.items[0].detail);
  assert.equal(n.items[1].label, `${'x'.repeat(59)}…`);
  assert.equal(normalizeFacts(full()).items[0].label, 'Sequences');
  const exact = full();
  exact.items[0].label = 'y'.repeat(60);
  assert.equal(normalizeFacts(exact).items[0].label, 'y'.repeat(60));
});

test('normalizeFacts: quotes survive, whitespace runs and newlines collapse to one space', () => {
  const f = full();
  f.title = '  The "kit"\n  it\'s \t here  ';
  f.items[0].detail = 'line one\r\n\nline "two"';
  const n = normalizeFacts(f);
  assert.equal(n.title, 'The "kit" it\'s here');
  assert.equal(n.items[0].detail, 'line one line "two"');
  const back = JSON.parse(JSON.stringify(n));
  assert.equal(back.title, n.title);
});

test('normalizeFacts: key order and dropped undefined', () => {
  const f = {
    media: [{ alt: 'a', path: 'p.png' }],
    links: { zeta: 'z', alpha: 'a' },
    stats: { stars: 1, commits: 2 },
    items: [{ tag: 'fix', detail: undefined, label: 'L' }],
    subtitle: undefined,
    title: 'T',
    source: { command: 'c', story: 's', ref: 'r', kind: 'k' },
    version: 1,
  };
  const n = normalizeFacts(f);
  assert.deepEqual(Object.keys(n), ['version', 'source', 'title', 'items', 'stats', 'links', 'media']);
  assert.deepEqual(Object.keys(n.source), ['kind', 'ref', 'story', 'command']);
  assert.deepEqual(Object.keys(n.items[0]), ['label', 'tag']);
  assert.deepEqual(Object.keys(n.stats), ['commits', 'stars']);
  assert.deepEqual(Object.keys(n.links), ['alpha', 'zeta']);
  assert.deepEqual(Object.keys(n.media[0]), ['path', 'alt']);
  assert.deepEqual(Object.keys(normalizeFacts(full())), ['version', 'source', 'title', 'subtitle', 'items', 'stats', 'links', 'media']);
});

test('writeFacts: two writes are byte-identical, 2-space JSON with a trailing newline, no temp left', () => {
  const dir = tempDir('mk-facts-');
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  writeFacts(a, full());
  const first = readFileSync(a, 'utf8');
  writeFacts(a, full());
  writeFacts(b, JSON.parse(first));
  assert.equal(readFileSync(a, 'utf8'), first);
  assert.equal(readFileSync(b, 'utf8'), first);
  assert.ok(first.endsWith('}\n') && first.startsWith('{\n  "version": 1,'));
  assert.deepEqual(readdirSync(dir).sort(), ['a.json', 'b.json']);
});

test('writeFacts: invalid facts throw UsageError listing the problems, nothing written', () => {
  const dir = tempDir('mk-facts-');
  const f = full();
  f.version = 3;
  f.items[0].tag = 'nope';
  assert.throws(() => writeFacts(path.join(dir, 'x.json'), f), (e) => e instanceof UsageError && /version/.test(e.message) && /tag/.test(e.message));
  assert.deepEqual(readdirSync(dir), []);
});

test('commandLine: the canonical command, flags in a fixed order, no --out, quoted when needed', () => {
  assert.equal(commandLine('repo', 'SOURCE', { release: 'v2.0.0' }), 'story_facts.mjs repo SOURCE --release v2.0.0');
  assert.equal(commandLine('repo', 'https://github.com/o/r', {}), 'story_facts.mjs repo https://github.com/o/r');
  assert.equal(commandLine('repo', '/a b/c', { pr: '7', intro: false }), "story_facts.mjs repo '/a b/c' --pr 7");
  assert.equal(commandLine('repo', '/x', { intro: true }), 'story_facts.mjs repo /x --intro');
});

test('CLI: bad input exits 2 with an error line, never a traceback', () => {
  const cases = [
    [[], /usage: story_facts\.mjs/],
    [['nope', '.', '--out', 'f.json'], /unknown source kind "nope".*repo/],
    [['repo', '.'], /--out/],
    [['repo'], /usage/],
    [['repo', '.', '--out'], /--out/],
    [['repo', '.', '--bogus', '--out', 'f.json'], /--bogus/],
    [['repo', '.', '--intro', '--release', 'v1', '--out', 'f.json'], /pass one of --intro, --release/],
    [['repo', 'git@github.com:o/r', '--out', 'f.json'], /error: "git@github\.com:o\/r" is not a local path/],
  ];
  for (const [args, re] of cases) {
    const r = cli(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, re, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /, args.join(' '));
  }
});

test('normalizeFacts: subtitle keeps whole sentences within 200, title cut at 80, media alt at 160', () => {
  const f = full();
  const s1 = `First sentence ${'a'.repeat(100)}.`, s2 = `Second sentence ${'b'.repeat(60)}!`, s3 = `Third ${'c'.repeat(60)}.`;
  f.subtitle = `${s1} ${s2}   ${s3}`;
  f.title = 'word '.repeat(30);
  f.media[0].alt = 'alt '.repeat(60);
  const n = normalizeFacts(f);
  assert.equal(n.subtitle, `${s1} ${s2}`);
  assert.ok(n.title.length <= 80 && n.title.endsWith('word…'), n.title);
  assert.ok(n.media[0].alt.length <= 160 && n.media[0].alt.endsWith('alt…'), n.media[0].alt);
  assert.deepEqual(validateFacts(n), []);
  // one sentence longer than 200: cut at a word boundary
  f.subtitle = 'long '.repeat(60);
  const one = normalizeFacts(f).subtitle;
  assert.ok(one.length <= 200 && one.endsWith('long…'), one);
  // short text untouched
  assert.equal(normalizeFacts(full()).subtitle, full().subtitle);
});

test('validateFacts: title over 80, subtitle over 200, alt over 160 are problems', () => {
  const f = full();
  f.title = 't'.repeat(81);
  f.subtitle = 's'.repeat(201);
  f.media[0].alt = 'a'.repeat(161);
  const p = validateFacts(f).join('\n');
  assert.match(p, /title: at most 80/);
  assert.match(p, /subtitle: at most 200/);
  assert.match(p, /media\[0\]\.alt: at most 160/);
});
