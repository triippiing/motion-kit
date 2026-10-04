import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './tmp.mjs';
import { execFileSync } from 'node:child_process';
import { clickTrack } from '../scripts/scaffold.mjs';
import { UsageError } from '../scripts/render.mjs';
import { analyseSequence, checkSequence, clock, initSequence, loadSequence, mergeSync, renderSequence } from '../scripts/sequence.mjs';
import { START_MARK, END_MARK } from '../scripts/tables.mjs';

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
  ['a chapter called out', () => seqDir({ song, chapters: [{ dir: 'out', bars: 2 }] }, ['out']),
    /chapter 1 \(out\): chapter name "out" is reserved for the sequence's renders/],
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

// ---- analyse and check ----

const ANALYSER = path.join(import.meta.dirname, '..', 'scripts', 'analyze_song.py');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2));
const songOf = (d, c) => readJson(path.join(d, c, 'song.json'));
const editSong = (d, c, fn) => { const f = path.join(d, c, 'song.json'); writeJson(f, fn(readJson(f))); };
const analyser = (...args) => spawnSync('python3', [ANALYSER, ...args], { encoding: 'utf8',
  env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` } });
const noFrames = async () => ({ issues: [] });

// intro (2 bars, from_start), kit (3), end (2) on the 40 s click track; intro's sync set by ear, kit's set differently
function freshSequence() {
  const d = path.join(tempDir('mk-seq-an-'), 'seq');
  initSequence(d, { song, names: ['intro', 'kit', 'end'], bars: 2 });
  const f = path.join(d, 'sequence.json');
  const j = readJson(f);
  j.chapters[1].bars = 3;
  writeJson(f, j);
  editSong(d, 'intro', (s) => ({ ...s, sync: { nudge_ms: -10, swing: 0.6 } }));
  editSong(d, 'kit', (s) => ({ ...s, sync: { nudge_ms: 25, markers: [{ name: 'drop', t: 6 }] } }));
  return d;
}

let analysed = null; // { dir, stdout } of one CLI analyse, shared by the tests below (each copies it before changing it)
function analysedSequence() {
  if (analysed) return analysed;
  const dir = freshSequence();
  const r = cli(dir, 'analyse');
  assert.equal(r.status, 0, r.stderr);
  analysed = { dir, stdout: r.stdout };
  return analysed;
}
function copyOfAnalysed() {
  const d = path.join(tempDir('mk-seq-copy-'), 'seq');
  cpSync(analysedSequence().dir, d, { recursive: true });
  // song paths in sequence.json are absolute (the click track), so the copy loads as is
  return d;
}

test('clock: m:ss.s with the carry', () => {
  assert.equal(clock(0), '0:00.0');
  assert.equal(clock(4.94), '0:04.9');
  assert.equal(clock(37.9), '0:37.9');
  assert.equal(clock(59.96), '1:00.0');
  assert.equal(clock(125.25), '2:05.3');
});

test('analyse: chapters abut on the song, one line each; chapter 1\'s sync goes to every chapter', () => {
  const { dir, stdout } = analysedSequence();
  const s = ['intro', 'kit', 'end'].map((c) => songOf(dir, c));
  assert.equal(s[0].loop.from_start, true);
  assert.deepEqual(s.map((x) => x.loop.bars), [2, 3, 2]);
  for (let k = 1; k < 3; k++) {
    const prev = s[k - 1].loop, cur = s[k].loop;
    assert.ok(Math.abs(cur.start_sec - (prev.start_sec + prev.duration_sec)) < 0.001, `chapter ${k + 1}: ${cur.start_sec} vs ${prev.start_sec + prev.duration_sec}`);
    assert.equal(cur.start_bar, prev.start_bar + prev.bars);
  }
  // the grid is intro's; kit's marker (song time) is kept and shared with every chapter
  for (const x of s) assert.deepEqual(x.sync, { nudge_ms: -10, swing: 0.6, markers: [{ name: 'drop', t: 6 }] });
  assert.ok(s[1].markers.some((m) => m.name === 'drop' && m.in_loop), 'drop is in kit\'s loop');
  const bak = path.join(dir, 'kit', 'song.json.bak');
  assert.deepEqual(readJson(bak).sync, { nudge_ms: 25, markers: [{ name: 'drop', t: 6 }] }, 'kit\'s old song.json kept');
  assert.match(stdout, new RegExp(`^warning: kit's sync was replaced by intro's \\(old song\\.json kept as ${bak.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`, 'm'));
  assert.doesNotMatch(stdout, /intro's sync was replaced/);
  assert.doesNotMatch(stdout, /end's sync was replaced/, 'end had no sync of its own');
  const lines = stdout.split('\n').filter((l) => /^(intro|kit|end): /.test(l));
  assert.equal(lines.length, 3, stdout);
  ['intro', 'kit', 'end'].forEach((c, k) => {
    const L = s[k].loop;
    assert.equal(lines[k], `${c}: bars ${L.start_bar}-${L.start_bar + L.bars - 1}, ${clock(L.start_sec)}-${clock(L.start_sec + L.duration_sec)}`);
  });
});

test('analyse (API): returns each chapter\'s window; a start_bar on chapter 1 is used; no sync anywhere when chapter 1 has none', async () => {
  const d = copyOfAnalysed();
  const f = path.join(d, 'sequence.json');
  const j = readJson(f);
  delete j.chapters[0].from_start;
  j.chapters[0].start_bar = 3;
  writeJson(f, j);
  editSong(d, 'intro', (s) => { const { sync, ...rest } = s; return rest; });
  const warned = [];
  const r = analyseSequence(loadSequence(d), { warn: (m) => warned.push(m) });
  assert.deepEqual(r.map((x) => [x.name, x.start_bar]), [['intro', 3], ['kit', 5], ['end', 8]]);
  for (const x of r) {
    const L = songOf(d, x.name).loop;
    assert.deepEqual(x, { name: x.name, start_bar: L.start_bar, start_sec: L.start_sec, duration_sec: L.duration_sec });
  }
  // kit and end had intro's old grid; they keep only the shared marker
  assert.deepEqual(warned, ['kit', 'end'].map((c) => `${c}'s sync was removed (intro has none) (old song.json kept as ${path.join(d, c, 'song.json.bak')})`));
  for (const c of ['intro', 'kit', 'end']) assert.deepEqual(songOf(d, c).sync, { markers: [{ name: 'drop', t: 6 }] }, c);
  assert.deepEqual((await checkSequence(loadSequence(d), { frameCheck: noFrames })).errors, []);
});

test('analyse: the analyser\'s error is surfaced with the chapter name, exit 2', () => {
  const d = copyOfAnalysed();
  const f = path.join(d, 'sequence.json');
  const j = readJson(f);
  j.chapters[2].bars = 40; // longer than the song
  writeJson(f, j);
  const r = cli(d, 'analyse');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^error: end: song is shorter than the requested loop/m);
  assert.doesNotMatch(r.stderr, /Traceback|\n\s+at /);
});

test('check: passes on the analysed sequence', async () => {
  const d = copyOfAnalysed();
  const r = cli(d, 'check');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /sequence OK: 3 chapters/);
  assert.deepEqual(await checkSequence(loadSequence(d), { frameCheck: noFrames }), { errors: [], warnings: [] });
});

test('check: a chapter re-analysed by hand so the windows no longer abut fails, naming the chapter and the gap', () => {
  const d = copyOfAnalysed();
  const kit = songOf(d, 'kit').loop;
  const a = analyser(song, '--out', path.join(d, 'kit'), '--bars', '3', '--start-bar', String(kit.start_bar + 1));
  assert.equal(a.status, 0, a.stderr);
  const r = cli(d, 'check');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^error: kit starts 2\.000 s after intro ends$/m);
  assert.match(r.stderr, /^error: end starts 2\.000 s before kit ends$/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('check: a chapter brief is checked (not as a loop); its errors carry the chapter name', async () => {
  const d = copyOfAnalysed();
  writeFileSync(path.join(d, 'kit', 'MOTION-BRIEF.md'), '# Motion brief\n\n## Request\nA promo.\n');
  const r = cli(d, 'check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: kit: missing section "## Decisions"$/m);
  assert.match(r.stderr, /^error: kit: no ```js block/m);
  assert.doesNotMatch(r.stderr, /error: (intro|end): /);
  // a table that ends somewhere else than it starts passes: chapters are not loops (and the API passes the stub on)
  let seen = null;
  const tables = "const states = () => [\n  { at: 0, use: 'button', label: 'Go' },\n  { at: 4, use: 'check' },\n];\nconst cursor = () => [\n  { at: 0, x: 240, y: 280 },\n  { at: 1.5, target: 'button' },\n  { at: 2, target: 'button', press: true },\n];";
  writeFileSync(path.join(d, 'kit', 'MOTION-BRIEF.md'), `# Motion brief\n\n## Request\nA promo.\n\n## Decisions\n- square\n\n## Moments\n1. a\n\n## Beat table\n\n\`\`\`js\n${tables}\n\`\`\`\n`);
  const res = await checkSequence(loadSequence(d), { frameCheck: async (dir, o) => { seen = { dir, loop: o.loop }; return { issues: [] }; } });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(seen, { dir: path.join(d, 'kit'), loop: false });
  const { checkBrief } = await import('../scripts/check_brief.mjs');
  assert.notDeepEqual((await checkBrief(path.join(d, 'kit'), { loop: true, frameCheck: noFrames })).errors, [], 'as a loop it would fail');
  for (const w of res.warnings) assert.match(w, /^kit: /);
});

test('check: chapters with different bpm, sync or fps are errors', async () => {
  const run = async (mutate) => {
    const d = copyOfAnalysed();
    mutate(d);
    return (await checkSequence(loadSequence(d), { frameCheck: noFrames })).errors;
  };
  const bpm = songOf(analysedSequence().dir, 'intro').bpm;
  assert.deepEqual(await run((d) => editSong(d, 'end', (s) => ({ ...s, bpm: 121 }))), [`end: bpm 121 differs from intro's ${bpm}`]);
  assert.deepEqual(await run((d) => editSong(d, 'kit', (s) => ({ ...s, sync: { ...s.sync, swing: 0.5 } }))),
    ["kit: sync differs from the sequence's (intro's grid, every chapter's markers): run sequence.mjs SEQ analyse"]);
  // a marker placed on one chapter after analyse: the others lack it
  const late = await run((d) => editSong(d, 'end', (s) => ({ ...s, sync: { ...s.sync, markers: [...s.sync.markers, { name: 'outro', t: 12 }] } })));
  assert.deepEqual(late, ['intro', 'kit'].map((c) => `${c}: sync differs from the sequence's (intro's grid, every chapter's markers): run sequence.mjs SEQ analyse`));
  const fps = await run((d) => {
    const L = songOf(d, 'kit').loop;
    const a = analyser(song, '--out', path.join(d, 'kit'), '--bars', '3', '--start-bar', String(L.start_bar), '--fps', '30');
    assert.equal(a.status, 0, a.stderr);
  });
  assert.deepEqual(fps, ["kit: fps 30 differs from intro's 60"]);
  // a chapter never analysed, or analysed with other bars than sequence.json gives
  assert.deepEqual(await run((d) => editSong(d, 'end', (s) => ({ ...s, loop: { ...s.loop, bars: 4 } }))),
    ['end: song.json has 4 bars, sequence.json says 2 (run sequence.mjs SEQ analyse)']);
  const r = cli(seqWithoutSong(), 'check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: b: no song\.json \(run sequence\.mjs SEQ analyse\)$/m);
});

// a sequence whose chapters are bare directories (never analysed)
function seqWithoutSong() {
  return seqDir({ song, chapters: [{ dir: 'b', bars: 2 }] }, ['b']);
}

test('mergeSync: grid from chapter 1, markers merged by name; a clash keeps chapter 1\'s (else the earlier) and warns', () => {
  const ch = (name, sync) => ({ name, sync });
  const m = mergeSync([
    ch('intro', { nudge_ms: -10, markers: [{ name: 'drop', t: 10 }] }),
    ch('kit', { nudge_ms: 5, bpm: 121, markers: [{ name: 'drop', t: 12 }, { name: 'hit', t: 7, note: 'snare' }] }),
    ch('end', { markers: [{ name: 'hit', t: 8 }, { name: 'drop', t: 10 }] }),
  ]);
  assert.deepEqual(m.sync, { nudge_ms: -10, markers: [{ name: 'drop', t: 10 }, { name: 'hit', t: 7, note: 'snare' }] });
  assert.deepEqual(m.warnings, [
    'marker "drop": intro has it at 10.000 s, kit at 12.000 s; keeping intro\'s',
    'marker "hit": kit has it at 7.000 s, end at 8.000 s; keeping kit\'s',
  ]);
  assert.deepEqual(mergeSync([ch('a', undefined), ch('b', { swing: 0.6 })]), { sync: undefined, warnings: [] });
  assert.deepEqual(mergeSync([ch('a', { swing: 0.6 }), ch('b', undefined)]).sync, { swing: 0.6 });
});

test('analyse: a marker clash keeps chapter 1\'s time and warns with both', () => {
  const d = copyOfAnalysed();
  editSong(d, 'intro', (s) => ({ ...s, sync: { ...s.sync, markers: [{ name: 'drop', t: 2 }] } }));
  const r = cli(d, 'analyse');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^warning: marker "drop": intro has it at 2\.000 s, kit at 6\.000 s; keeping intro's$/m);
  for (const c of ['intro', 'kit', 'end']) assert.deepEqual(songOf(d, c).sync.markers, [{ name: 'drop', t: 2 }], c);
  assert.equal(cli(d, 'check').status, 0);
});

test('analyse: chapter 1 from_start with a pickup beat still abuts', () => {
  const t = tempDir('mk-seq-pick-');
  const pick = path.join(t, 'pickup.wav');
  execFileSync('python3', [path.join(import.meta.dirname, '..', 'scripts', 'click_track.py'), pick, '120', '--seconds', '30', '--pickup', '1'], { stdio: 'pipe' });
  const d = path.join(t, 'seq');
  initSequence(d, { song: pick, names: ['a', 'b'], bars: 2 });
  editSong(d, 'a', (s) => ({ ...s, sync: { pickup_beats: 1 } }));
  const r = cli(d, 'analyse');
  assert.equal(r.status, 0, r.stderr);
  const [a, b] = ['a', 'b'].map((c) => songOf(d, c).loop);
  assert.equal(a.from_start, true);
  assert.equal(songOf(d, 'a').beats.length, 9, 'the pickup beat plus 2 bars');
  assert.ok(Math.abs(b.start_sec - (a.start_sec + a.duration_sec)) < 0.001, `${b.start_sec} vs ${a.start_sec + a.duration_sec}`);
  assert.equal(b.start_bar, a.start_bar + 2);
  assert.equal(cli(d, 'check').status, 0);
});

// ---- render ----

const FFMPEG_BIN = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg';
const FFPROBE_BIN = FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe');
const SR = 48000;
// Mono float samples at 48 kHz of `file` (from `ss` seconds for `t`, when given).
function pcm(file, { ss, t } = {}) {
  const args = ['-v', 'error', ...(ss != null ? ['-ss', ss.toFixed(6)] : []), '-i', file, ...(t != null ? ['-t', t.toFixed(6)] : []),
    '-map', '0:a', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
  const b = execFileSync(FFMPEG_BIN, args, { maxBuffer: 1 << 30 });
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}
const videoFrames = (f) => Number(JSON.parse(execFileSync(FFPROBE_BIN, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
  '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', f], { encoding: 'utf8' })).streams[0].nb_read_frames);
const audioDuration = (f) => Number(execFileSync(FFPROBE_BIN, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration',
  '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
// Best normalised correlation of a[i0..i1) against b over lags of up to `lag` samples (absorbs AAC's alignment).
function correlation(a, b, i0, i1, lag = 96) {
  let best = -1;
  for (let k = -lag; k <= lag; k++) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = i0; i < i1; i++) { const x = a[i], y = b[i + k] ?? 0; ab += x * y; aa += x * x; bb += y * y; }
    if (aa > 0 && bb > 0) best = Math.max(best, ab / Math.sqrt(aa * bb));
  }
  return best;
}
// Gain of `a` relative to `b` over [i0, i1): least squares.
function gain(a, b, i0, i1) {
  let ab = 0, bb = 0;
  for (let i = i0; i < i1; i++) { ab += a[i] * b[i]; bb += b[i] * b[i]; }
  return ab / bb;
}
const energy = (a, i0, i1) => { let e = 0; for (let i = i0; i < i1; i++) e += a[i] * a[i]; return e; };

const TABLES = { states: "[{ at: 0, use: 'button', label: 'Go' }]", cursor: '[{ at: 0, x: 240, y: 280 }, { at: 2, x: 0, y: 300 }]',
  extraSfx: "[{ beat: 2.5, file: 'sfx/key.wav', gain: 1 }]" };
function setTables(dir, { states, cursor, extraSfx } = TABLES, note = '') {
  const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
  const a = html.indexOf(START_MARK), b = html.indexOf(END_MARK, a);
  writeFileSync(f, `${html.slice(0, a)}${START_MARK}\n${note}const states = () => ${states};\nconst cursor = () => ${cursor};\n`
    + `const extraSfx = () => ${extraSfx};\nconst content = {};\n${html.slice(b)}`);
}

// intro (2 bars, from_start), kit (3), end (2) on the click track at 12 fps on a 192x192 stage, fade_out_sec 1, each with
// one key sound at beat 2.5 (end another inside the fade); analysed, not rendered.
function smallSequence() {
  const d = path.join(tempDir('mk-seq-r-'), 'seq');
  initSequence(d, { song, names: ['intro', 'kit', 'end'], bars: 2 });
  const f = path.join(d, 'sequence.json'), j = readJson(f);
  j.chapters[1].bars = 3; j.fade_out_sec = 1;
  writeJson(f, j);
  for (const c of ['intro', 'kit', 'end']) {
    editSong(d, c, (s) => ({ ...s, fps: 12 }));
    const pj = path.join(d, c, 'project.json');
    writeJson(pj, { ...readJson(pj), stage: { width: 192, height: 192 } });
    // end also has a key sound inside the fade (beat 7.25 of 8: 0.375 s before the end)
    setTables(path.join(d, c), c === 'end' ? { ...TABLES, extraSfx: "[{ beat: 2.5, file: 'sfx/key.wav', gain: 1 }, { beat: 7.25, file: 'sfx/key.wav', gain: 1 }]" } : TABLES);
  }
  const r = cli(d, 'analyse');
  assert.equal(r.status, 0, r.stderr);
  return d;
}

let small = null; // one analysed smallSequence(), copied by the tests that change it (never rendered)
function copyOfSmall() {
  small ??= smallSequence();
  const d = path.join(tempDir('mk-seq-rc-'), 'seq');
  cpSync(small, d, { recursive: true });
  return d;
}

let rendered = null; // { dir, out, log } of one preview render of smallSequence(), shared by the render tests in order
async function renderedSequence() {
  if (rendered) return rendered;
  const dir = copyOfSmall(), log = [];
  const out = await renderSequence(loadSequence(dir), { preview: true, log: (m) => log.push(m) });
  rendered = { dir, out, log };
  return rendered;
}

test('render: one video of every chapter\'s frames over one continuous cut of the song, chapter sounds at their offsets', async () => {
  const { dir, out, log } = await renderedSequence();
  assert.equal(out, path.join(dir, 'out', 'sequence-preview.mp4'), 'a preview never replaces the full sequence.mp4');
  assert.deepEqual(log.map((l) => l.replace(/:.*/, '')), ['intro', 'kit', 'end']);
  for (const l of log) assert.match(l, /: rendered$/);
  const loops = ['intro', 'kit', 'end'].map((c) => songOf(dir, c).loop);
  const chapterFrames = ['intro', 'kit', 'end'].map((c) => videoFrames(path.join(dir, c, 'out', 'preview.mp4')));
  assert.deepEqual(chapterFrames, loops.map((L) => L.frames));
  assert.equal(videoFrames(out), chapterFrames.reduce((a, b) => a + b));
  // the video starts with the audio (a chapter render's AAC priming must not delay it) and its frames are evenly spaced
  const pts = execFileSync(FFPROBE_BIN, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', out],
    { encoding: 'utf8' }).trim().split('\n').map((l) => Number(l.replace(/,.*/, ''))).sort((a, b) => a - b);
  pts.forEach((t, i) => assert.ok(Math.abs(t - i / 12) < 0.002, `frame ${i} at ${t} s, not ${(i / 12).toFixed(4)} s`));
  const total = loops.reduce((a, L) => a + L.duration_sec, 0);
  assert.ok(Math.abs(audioDuration(out) - total) <= 1 / 12, `audio ${audioDuration(out)} s vs ${total} s`);

  const got = pcm(out), ref = pcm(song, { ss: loops[0].start_sec, t: total });
  // at each join the audio is the song itself: no fade, no dip, no click
  let at = 0;
  for (const L of loops.slice(0, -1)) {
    at += L.duration_sec;
    const i = Math.round(at * SR), w = Math.round(0.05 * SR);
    assert.ok(energy(ref, i - w, i + w) > 0, 'the click track has a click at the join');
    const c = correlation(got, ref, i - w, i + w);
    assert.ok(c >= 0.99, `correlation ${c.toFixed(4)} at the join at ${at.toFixed(3)} s`);
    assert.ok(Math.abs(gain(got, ref, i - Math.round(0.01 * SR), i + Math.round(0.01 * SR)) - 1) < 0.05, `no dip at ${at.toFixed(3)} s`);
  }
  // each chapter's key sound (beat 2.5) is in the mix at its chapter's offset, and nothing else is added
  const { beatTime } = await import('../components/core/timing.js');
  const residual = got.map((x, i) => x - (ref[i] ?? 0));
  at = 0;
  for (const c of ['intro', 'kit', 'end']) {
    const t = at + beatTime(songOf(dir, c), 2.5), i = Math.round(t * SR);
    assert.ok(energy(residual, i, i + Math.round(0.03 * SR)) > 50 * energy(residual, i - Math.round(0.06 * SR), i - Math.round(0.03 * SR)),
      `${c}'s key sound at ${t.toFixed(3)} s`);
    at += songOf(dir, c).loop.duration_sec;
  }
  // the last fade_out_sec (1 s) ramps to silence: the click half-way through is at about half gain, the one before at full
  const g = (t) => gain(got, ref, Math.round(t * SR) - 48, Math.round((t + 0.03) * SR));
  assert.ok(Math.abs(g(total - 1.5) - 1) < 0.05, `before the fade: ${g(total - 1.5)}`);
  assert.ok(Math.abs(g(total - 0.5) - 0.5) < 0.1, `half-way through the fade: ${g(total - 0.5)}`);
  // the fade is on the whole mix: end's key sound 0.375 s before the end is at about 0.375 of the gain of its first one
  const ramp = (i) => Math.min(1, Math.max(0, (total - i / SR) / 1));
  const unfaded = got.map((x, i) => x - ramp(i) * (ref[i] ?? 0));
  const cue = (t) => energy(unfaded, Math.round(t * SR), Math.round((t + 0.03) * SR));
  const endStart = total - songOf(dir, 'end').loop.duration_sec, endSong = songOf(dir, 'end');
  const ratio = Math.sqrt(cue(endStart + beatTime(endSong, 7.25)) / cue(endStart + beatTime(endSong, 2.5)));
  assert.ok(ratio > 0.2 && ratio < 0.55, `a sound inside the fade is faded too: gain ${ratio.toFixed(3)}`);
  const tail = got.subarray(got.length - Math.round(0.005 * SR));
  assert.ok(Math.max(...tail.map(Math.abs)) < 0.01, 'silent at the very end');

  const stamp = readJson(`${out}.render.json`);
  assert.equal(stamp.preview, true);
  assert.deepEqual(stamp.stage, [192, 192]);
  assert.deepEqual(stamp.chapters.map((c) => c.name), ['intro', 'kit', 'end']);
  for (const c of stamp.chapters) assert.deepEqual(c.stamp, readJson(path.join(dir, c.name, 'out', 'preview.mp4.render.json')));
});

test('render: editing one chapter re-renders only that chapter', async () => {
  const { dir } = await renderedSequence();
  const stampOf = (c) => path.join(dir, c, 'out', 'preview.mp4.render.json');
  const before = Object.fromEntries(['intro', 'kit', 'end'].map((c) => [c, { mtime: statSync(stampOf(c)).mtimeMs, body: readFileSync(stampOf(c), 'utf8') }]));
  const f = path.join(dir, 'kit', 'index.html');
  writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', '<!-- edited -->\n</body>'));
  const later = new Date(Date.now() + 2000);
  utimesSync(f, later, later);
  const log = [];
  const r = cli(dir, 'render', '--preview');
  assert.equal(r.status, 0, r.stderr);
  log.push(...r.stdout.split('\n').filter((l) => /^(intro|kit|end): /.test(l)));
  assert.deepEqual(log, ['intro: reused', 'kit: rendered', 'end: reused']);
  for (const c of ['intro', 'end']) {
    assert.equal(statSync(stampOf(c)).mtimeMs, before[c].mtime, c);
    assert.equal(readFileSync(stampOf(c), 'utf8'), before[c].body, c);
  }
  assert.ok(readJson(stampOf('kit')).sources > JSON.parse(before.kit.body).sources);
  assert.match(r.stdout, /out\/sequence-preview\.mp4$/m);
});

test('render: chapters of different stage sizes or fps fail before anything is rendered', async () => {
  const sized = copyOfSmall();
  const pj = path.join(sized, 'kit', 'project.json');
  writeJson(pj, { ...readJson(pj), stage: { width: 256, height: 192 } });
  await assert.rejects(renderSequence(loadSequence(sized), { preview: true }),
    (e) => e instanceof UsageError && /kit: stage 256x192 differs from intro's 192x192/.test(e.message));
  const r = cli(sized, 'render', '--preview');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: kit: stage 256x192 differs from intro's 192x192/m);
  for (const c of ['intro', 'kit', 'end']) assert.equal(existsSync(path.join(sized, c, 'out')), false, c);
  assert.equal(existsSync(path.join(sized, 'out')), false);

  const fps = copyOfSmall();
  editSong(fps, 'end', (s) => ({ ...s, fps: 24 }));
  await assert.rejects(renderSequence(loadSequence(fps), { preview: true }),
    (e) => e instanceof UsageError && /end: fps 24 differs from intro's 12/.test(e.message));
  for (const c of ['intro', 'kit', 'end']) assert.equal(existsSync(path.join(fps, c, 'out')), false, c);

  // never analysed, or windows that no longer abut: also before any render
  const gap = copyOfSmall();
  editSong(gap, 'end', (s) => ({ ...s, loop: { ...s.loop, start_sec: s.loop.start_sec + 0.5 } }));
  await assert.rejects(renderSequence(loadSequence(gap), { preview: true }),
    (e) => e instanceof UsageError && /end starts 0\.500 s after kit ends \(run sequence\.mjs SEQ analyse\)/.test(e.message));
  const bare = cli(seqWithoutSong(), 'render');
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /^error: b: no song\.json \(run sequence\.mjs SEQ analyse\)/m);
});

test('render --stage WxH: every chapter at that size, joined under out/shapes/WxH/', async () => {
  const d = copyOfSmall();
  const pj = path.join(d, 'kit', 'project.json');
  writeJson(pj, { ...readJson(pj), stage: { width: 256, height: 192 } });   // the override wins over the chapters' own sizes
  const seq = loadSequence(d);
  seq.chapters = seq.chapters.slice(0, 1);   // one short chapter keeps it quick
  const out = await renderSequence(seq, { preview: true, stage: [128, 64], log: () => {} });
  assert.equal(out, path.join(d, 'out', 'shapes', '128x64', 'sequence-preview.mp4'));
  assert.ok(existsSync(path.join(d, 'intro', 'out', 'shapes', '128x64', 'preview.mp4')));
  assert.deepEqual(readJson(`${out}.render.json`).stage, [128, 64]);
  assert.equal(videoFrames(out), songOf(d, 'intro').loop.frames);
});

// ---- export ----

const EXPORT = path.join(import.meta.dirname, '..', 'scripts', 'export.mjs');
const testPreset = (o) => ({ label: o.name ?? 'test', group: 'test', fps: 30, maxSeconds: null, maxMB: null, video: { codec: 'h264', crf: 26, profile: 'high' },
  audio: { codec: 'aac', kbps: 96, lufs: -14, truePeak: -1 }, safe: { top: 0, bottom: 0, left: 0, right: 0 }, public: true, source: null, checked: null,
  estimated: [], notes: 'test preset', ...o });
// Three presets on the design shape (one render): web (mp4, webm, poster), gif, and zoned, whose safe zones leave only a
// 12 px band across the middle of the 192x192 stage, so every chapter's shape is in them.
const EXPORT_PRESETS = path.join(tempDir('mk-seq-presets-'), 'presets.json');
writeFileSync(EXPORT_PRESETS, JSON.stringify({ shapes: { square: [192, 192] }, presets: {
  web: testPreset({ name: 'web', shape: 'design', fps: 24, outputs: ['mp4', 'webm', 'poster'] }),
  gif: testPreset({ name: 'gif', shape: 'design', public: false, audio: { codec: null, kbps: 0, lufs: -14, truePeak: -1 }, gif: { width: 192, fps: 12, maxMB: 20 } }),
  zoned: testPreset({ name: 'zoned', label: 'Zoned', shape: 'design', public: false, safe: { top: 90, bottom: 90, left: 0, right: 0 } }),
} }));
const exportCli = (...args) => spawnSync(process.execPath, [EXPORT, ...args], { encoding: 'utf8', env: { ...process.env, MOTION_PRESETS: EXPORT_PRESETS } });
async function withExportPresets(fn) {
  const old = process.env.MOTION_PRESETS;
  process.env.MOTION_PRESETS = EXPORT_PRESETS;
  try { return await fn(); } finally { if (old === undefined) delete process.env.MOTION_PRESETS; else process.env.MOTION_PRESETS = old; }
}
const mediaDuration = (f) => Number(execFileSync(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());

test('export SEQ --for web,gif,zoned: the joined full render through the presets; manifest lists the chapters; zones per chapter', async () => {
  const { exportProject } = await import('../scripts/export.mjs');
  const d = copyOfSmall();
  const pj = path.join(d, 'kit', 'project.json');
  writeJson(pj, { ...readJson(pj), music: 'commercial' });   // one chapter's commercial music warns for the whole piece
  const log = [];
  const m = await withExportPresets(() => exportProject(d, { for: ['web', 'gif', 'zoned'], log: (l) => log.push(l) }));
  const joined = path.join(d, 'out', 'sequence.mp4');
  assert.ok(existsSync(joined), 'a full render of the sequence, never the preview');
  assert.equal(existsSync(path.join(d, 'out', 'sequence-preview.mp4')), false);
  assert.equal(readJson(`${joined}.render.json`).preview, false);
  assert.deepEqual(m.sequence, { chapters: ['intro', 'kit', 'end'] });
  assert.equal(m.project, 'seq');
  assert.deepEqual(m.renders.map((r) => [r.size, r.path]), [['192x192', 'out/sequence.mp4']]);
  assert.deepEqual(m.renders[0].chapters.map((c) => c.name), ['intro', 'kit', 'end']);
  assert.deepEqual(readJson(path.join(d, 'out', 'exports', 'manifest.json')), JSON.parse(JSON.stringify(m)));
  assert.deepEqual(m.files.map((f) => `${f.preset}.${f.format}`), ['web.mp4', 'web.webm', 'web.jpg', 'gif.gif', 'zoned.mp4']);
  for (const f of m.files) assert.ok(existsSync(path.join(d, f.path)) && f.path.startsWith('out/exports/'), f.path);
  const total = mediaDuration(joined);
  for (const f of m.files.filter((x) => x.duration != null)) assert.ok(Math.abs(f.duration - total) <= 0.1, `${f.preset}.${f.format}: ${f.duration} s vs ${total} s`);
  const webMp4 = m.files[0];
  assert.deepEqual([webMp4.width, webMp4.height, webMp4.fps, webMp4.acodec], [192, 192, 24, 'aac']);
  assert.ok(webMp4.warnings.some((w) => /commercial music.*--silent/.test(w)), JSON.stringify(webMp4.warnings));
  // safe zones: each chapter's own check at that shape, prefixed with its name, on the zoned preset only
  const zoned = m.files.find((f) => f.preset === 'zoned');
  for (const c of ['intro', 'kit', 'end']) {
    assert.ok(zoned.warnings.some((w) => w.startsWith(`${c}: `) && / px into the Zoned (top|bottom) zone$/.test(w)), `${c}: ${JSON.stringify(zoned.warnings)}`);
  }
  for (const f of m.files.filter((x) => x.preset !== 'zoned')) assert.ok(!f.warnings.some((w) => /zone/.test(w)), f.preset);
  assert.equal(log.length, 5);
});

test('export SEQ (CLI): an unknown preset is still error: ... exit 2, before anything is rendered; --silent; --guides per chapter', () => {
  const d = copyOfSmall();
  let r = exportCli(d, '--for', 'web,webb');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^error: unknown preset "webb" \(did you mean "web"\?\)/);
  assert.equal(existsSync(path.join(d, 'out')), false);
  for (const c of ['intro', 'kit', 'end']) assert.equal(existsSync(path.join(d, c, 'out')), false, c);
  // a chapter that is not analysed: the sequence's own error, exit 2
  const bare = exportCli(seqWithoutSong(), '--for', 'gif');
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /^error: b: no song\.json \(run sequence\.mjs SEQ analyse\)/m);

  r = exportCli(d, '--for', 'gif,zoned', '--guides');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^intro: gif\s+no safe zones.*\nintro: zoned\s+intro\/out\/shapes\/192x192\/preview-guides-zoned\.mp4\nkit: gif/);
  for (const c of ['intro', 'kit', 'end']) assert.ok(existsSync(path.join(d, c, 'out', 'shapes', '192x192', 'preview-guides-zoned.mp4')), c);
  assert.equal(existsSync(path.join(d, 'out', 'exports')), false, 'guides export nothing');

  r = exportCli(d, '--for', 'gif,web', '--silent');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^manifest: .*seq\/out\/exports\/manifest\.json$/m);
  const m = readJson(path.join(d, 'out', 'exports', 'manifest.json'));
  assert.deepEqual(m.files.map((f) => [f.preset, f.format, f.acodec]), [['gif', 'gif', null], ['web', 'mp4', null], ['web', 'webm', null], ['web', 'jpg', null]]);
});
