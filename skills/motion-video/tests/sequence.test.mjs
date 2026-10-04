import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './tmp.mjs';
import { clickTrack } from '../scripts/scaffold.mjs';
import { UsageError } from '../scripts/render.mjs';
import { initSequence, loadSequence } from '../scripts/sequence.mjs';

const SCRIPT = path.join(import.meta.dirname, '..', 'scripts', 'sequence.mjs');
const song = clickTrack(path.join(tempDir('mk-seq-song-'), 'song.wav'), 120, 40);
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

// A sequence directory holding `json` as sequence.json (a string is written as is) and the chapter dirs `dirs`.
function seqDir(json, dirs = ['a', 'b', 'c']) {
  const d = tempDir('mk-seq-');
  for (const c of dirs) mkdirSync(path.join(d, c));
  if (json !== undefined) writeFileSync(path.join(d, 'sequence.json'), typeof json === 'string' ? json : JSON.stringify(json));
  return d;
}

const valid = () => ({ song, chapters: [{ dir: 'a', bars: 2, from_start: true }, { dir: 'b', bars: 3 }, { dir: 'c', bars: 2 }], fade_out_sec: 2 });

test('loadSequence: a valid file loads, dirs and song resolved against SEQ', () => {
  const d = seqDir(valid());
  const s = loadSequence(d);
  assert.equal(s.root, path.resolve(d));
  assert.equal(s.song, song);
  assert.equal(s.fade_out_sec, 2);
  assert.deepEqual(s.chapters, [
    { name: 'a', dir: path.join(d, 'a'), bars: 2, from_start: true },
    { name: 'b', dir: path.join(d, 'b'), bars: 3 },
    { name: 'c', dir: path.join(d, 'c'), bars: 2 },
  ]);
  // a relative song is relative to SEQ; fade_out_sec defaults to 0; chapter 1 may give start_bar, or no start
  writeFileSync(path.join(d, 'song.wav'), readFileSync(song));
  writeFileSync(path.join(d, 'sequence.json'), JSON.stringify({ song: 'song.wav', chapters: [{ dir: 'a', bars: 1, start_bar: 3 }] }));
  const r = loadSequence(d);
  assert.equal(r.song, path.join(d, 'song.wav'));
  assert.equal(r.fade_out_sec, 0);
  assert.deepEqual(r.chapters, [{ name: 'a', dir: path.join(d, 'a'), bars: 1, start_bar: 3 }]);
  writeFileSync(path.join(d, 'sequence.json'), JSON.stringify({ song, chapters: [{ dir: 'a', bars: 1 }] }));
  assert.deepEqual(loadSequence(d).chapters, [{ name: 'a', dir: path.join(d, 'a'), bars: 1 }]);
});

const bad = [
  ['missing sequence.json', () => seqDir(undefined), /no sequence\.json in .*; make one with sequence\.mjs SEQ init/],
  ['invalid JSON', () => seqDir('{ "song": '), /sequence\.json is not valid JSON/],
  ['not an object', () => seqDir('[]'), /sequence\.json must be an object/],
  ['unknown top-level key', () => seqDir({ ...valid(), loop: true }), /sequence\.json: unknown key "loop"/],
  ['unknown chapter key', () => seqDir({ ...valid(), chapters: [{ dir: 'a', bars: 2, size: 'square' }] }), /chapter 1 \(a\): unknown key "size"/],
  ['no song', () => seqDir({ chapters: valid().chapters }), /sequence\.json: "song" must be a path/],
  ['missing song file', () => seqDir({ ...valid(), song: '/no/such/song.mp3' }), /\/no\/such\/song\.mp3: no such file, or not readable/],
  ['no chapters', () => seqDir({ song, chapters: [] }), /sequence\.json: "chapters" must list at least one chapter/],
  ['chapters not an array', () => seqDir({ song, chapters: {} }), /"chapters" must list at least one chapter/],
  ['chapter without dir', () => seqDir({ song, chapters: [{ bars: 2 }] }), /chapter 1: "dir" must be a directory name/],
  ['missing chapter dir', () => seqDir(valid(), ['a', 'b']), /chapter 3 \(c\): .*\/c is not a directory/],
  ['duplicate dir', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2 }, { dir: 'a', bars: 2 }] }), /chapter 2 \(a\): "a" is already chapter 1/],
  ['bars 0', () => seqDir({ song, chapters: [{ dir: 'a', bars: 0 }] }), /chapter 1 \(a\): "bars" must be a whole number >= 1, got 0/],
  ['bars non-integer', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2.5 }] }), /"bars" must be a whole number >= 1, got 2\.5/],
  ['bars missing', () => seqDir({ song, chapters: [{ dir: 'a' }] }), /"bars" must be a whole number >= 1/],
  ['bars a string', () => seqDir({ song, chapters: [{ dir: 'a', bars: '2' }] }), /"bars" must be a whole number >= 1, got "2"/],
  ['both starts on chapter 1', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2, from_start: true, start_bar: 1 }] }),
    /chapter 1 \(a\): give "from_start" or "start_bar", not both/],
  ['from_start on a later chapter', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2 }, { dir: 'b', bars: 2, from_start: true }] }),
    /chapter 2 \(b\): only chapter 1 has a start \("from_start"\); later chapters start where the previous one ends/],
  ['start_bar on a later chapter', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2 }, { dir: 'b', bars: 2, start_bar: 4 }] }),
    /chapter 2 \(b\): only chapter 1 has a start \("start_bar"\)/],
  ['from_start not a boolean', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2, from_start: 'yes' }] }), /"from_start" must be true or false/],
  ['start_bar negative', () => seqDir({ song, chapters: [{ dir: 'a', bars: 2, start_bar: -1 }] }), /"start_bar" must be a whole number >= 0, got -1/],
  ['bad fade_out_sec', () => seqDir({ ...valid(), fade_out_sec: -1 }), /"fade_out_sec" must be a number of seconds >= 0, got -1/],
];

for (const [name, make, message] of bad) {
  test(`loadSequence rejects: ${name} (UsageError via the API, exit 2 via the CLI)`, () => {
    const d = make();
    assert.throws(() => loadSequence(d), (e) => e instanceof UsageError && message.test(e.message), name);
    const r = cli(d, 'check');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^error: /);
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  });
}

test('CLI: no command, an unknown command or no SEQ prints the usage and exits 2', () => {
  for (const args of [[], [tempDir('mk-seq-')], [tempDir('mk-seq-'), 'frobnicate']]) {
    const r = cli(...args);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^(error: .*\n)?usage: sequence\.mjs SEQ <init\|analyse\|check\|render\|watch>/m);
  }
});

test('init: bad usage exits 2 before anything is made', () => {
  const d = path.join(tempDir('mk-seq-'), 'seq');
  for (const [args, message] of [
    [['a'], /init needs --song PATH/],
    [['--song', song], /init needs at least one chapter name/],
    [['--song', song, 'a', '--bars', '0'], /--bars must be a whole number >= 1, got "0"/],
    [['--song', song, 'a', '--bars'], /--bars needs a value/],
    [['--song', song, 'a', '--loud'], /unknown flag --loud/],
    [['--song', '/no/such.wav', 'a'], /\/no\/such\.wav: no such file, or not readable/],
    [['--song', song, 'a', 'a'], /chapter name "a" given twice/],
    [['--song', song, 'a/b'], /chapter name "a\/b" must be a plain directory name/],
    [['--song', song, '..'], /chapter name "\.\." must be a plain directory name/],
    [['--song', song, 'out'], /"out" is reserved for the sequence's renders/],
  ]) {
    const r = cli(d, 'init', ...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, message);
    assert.equal(existsSync(d), false, 'nothing made');
  }
});

test('init: makes sequence.json and one project per chapter with "loop": false; refuses a second init', () => {
  const d = path.join(tempDir('mk-seq-'), 'seq');
  const r = cli(d, 'init', '--song', song, 'a', 'b', 'c', '--bars', '3');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(d, 'sequence.json'), 'utf8')), {
    song, chapters: [{ dir: 'a', bars: 3, from_start: true }, { dir: 'b', bars: 3 }, { dir: 'c', bars: 3 }], fade_out_sec: 0,
  });
  for (const c of ['a', 'b', 'c']) {
    const p = JSON.parse(readFileSync(path.join(d, c, 'project.json'), 'utf8'));
    assert.equal(p.loop, false, c);
    assert.deepEqual(p.stage, { width: 1440, height: 1440 }, c);
    assert.equal(JSON.parse(readFileSync(path.join(d, c, 'song.json'), 'utf8')).loop.bars, 3, c);
    assert.ok(existsSync(path.join(d, c, 'index.html')), c);
  }
  assert.equal(JSON.parse(readFileSync(path.join(d, 'a', 'song.json'), 'utf8')).loop.from_start, true);
  assert.match(r.stdout, /sequence ready: /);
  const again = cli(d, 'init', '--song', song, 'x');
  assert.equal(again.status, 2);
  assert.match(again.stderr, /sequence\.json exists; not overwriting/);
  assert.equal(existsSync(path.join(d, 'x')), false);
});

test('init (API): default 4 bars, returns the loaded sequence; refuses an existing chapter dir', () => {
  const d = tempDir('mk-seq-');
  mkdirSync(path.join(d, 'taken'));
  assert.throws(() => initSequence(d, { song, names: ['one', 'taken'] }), (e) => e instanceof UsageError && /taken already exists/.test(e.message));
  assert.equal(existsSync(path.join(d, 'one')), false, 'nothing made');
  const s = initSequence(d, { song, names: ['one'] });
  assert.deepEqual(s.chapters, [{ name: 'one', dir: path.join(d, 'one'), bars: 4, from_start: true }]);
  assert.equal(s.song, song);
});
