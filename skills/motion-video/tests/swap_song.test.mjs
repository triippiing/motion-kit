import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeProject } from './harness.mjs';
import { tempDir } from './tmp.mjs';
import { clickTrack } from '../scripts/scaffold.mjs';
import { swapSong, windowLine } from '../scripts/swap_song.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(SKILL, 'scripts', 'swap_song.mjs');

// A 4-bar project at 120 BPM whose states table has a row at 'drop' and five rows in all (4 states: more than a
// 1-bar loop at 100 BPM allows, which is 2), analysed from bar 1 so .source.json is written, with a sync section
// holding the marker and a nudge. A fresh one per test: each swap changes the project.
function project() {
  const dir = makeProject({ bars: 4, bpm: 120,
    states: "[{ at: 0, use: 'button' }, { at: 'drop', use: 'button' }, { at: 2, use: 'button' }, { at: 3, use: 'button' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  execFileSync('python3', [path.join(SKILL, 'scripts', 'analyze_song.py'), path.join(path.dirname(dir), 'beat.wav'),
    '--out', dir, '--bars', '4', '--start-bar', '1'], { stdio: 'pipe' });
  const f = path.join(dir, 'song.json'), s = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, JSON.stringify({ ...s, sync: { nudge_ms: -10, markers: [{ name: 'drop', t: s.loop.start_sec + 1 }] } }, null, 2));
  return dir;
}

const song100 = clickTrack(path.join(tempDir('mk-swap-'), 'song100.wav'), 100, 40);

test('swap: backs up, clears sync, re-analyses at the new tempo with the same bars, lists names to place', async () => {
  const dir = project();
  const r = await swapSong(dir, song100);
  assert.ok(existsSync(path.join(r.backup, 'song.json')) && existsSync(path.join(r.backup, 'clip.wav')));
  assert.match(path.relative(dir, r.backup), /^\.swap-backup\/\d{8}-\d{6}$/);
  const s = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  assert.equal(s.sync, undefined);
  assert.ok(Math.abs(s.bpm - 100) < 1, String(s.bpm));
  assert.equal(s.loop.bars, 4);
  assert.deepEqual(r.toPlace, ['drop']);
  assert.ok(Math.abs(r.before.bpm - 120) < 1 && Math.abs(r.after.bpm - 100) < 1);
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.source.json'), 'utf8')).path, realpathSync(song100));
});

test('swap: --bars and --start-bar are passed to the analyser', async () => {
  const dir = project();
  await swapSong(dir, song100, { bars: 2, startBar: 1 });
  const s = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  assert.equal(s.loop.bars, 2);
  assert.equal(s.loop.start_bar, 1);
});

test('swap report: the window line says where the loop starts, and how to keep it when it moved', async () => {
  assert.equal(windowLine(0, 23), 'window: bar 0 -> 23 (pass --start-bar 0 to keep it)');
  assert.equal(windowLine(21, 21), 'window: bar 21 (unchanged)');
  assert.equal(windowLine(undefined, 4), 'window: bar 4');
  // the project starts at bar 1
  const r = await swapSong(project(), song100, { startBar: 1 });
  assert.equal(r.before.startBar, 1);
  assert.equal(r.after.startBar, 1);
});

test('swap: a song shorter than the loop leaves the project as it was', async () => {
  const dir = project();
  const before = ['song.json', 'clip.wav', '.source.json'].map((f) => readFileSync(path.join(dir, f)));
  const short = clickTrack(path.join(tempDir('mk-swap-'), 'short.wav'), 120, 3);
  await assert.rejects(swapSong(dir, short), /shorter than the requested loop/);
  assert.deepEqual(['song.json', 'clip.wav', '.source.json'].map((f) => readFileSync(path.join(dir, f))), before);
});

test('swap CLI: report lines, --no-open, bad usage exit 2', () => {
  const dir = project();
  const r = spawnSync(process.execPath, [SCRIPT, dir, song100, '--no-open'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const tempo = /^tempo: ([\d.]+) -> ([\d.]+) BPM \(confidence [\d.]+\)$/m.exec(r.stdout);
  assert.ok(tempo, r.stdout);
  assert.ok(Math.abs(Number(tempo[1]) - 120) < 1 && Math.abs(Number(tempo[2]) - 100) < 1, tempo[0]);
  assert.match(r.stdout, /^loop: 4 bars = [\d.]+ s \(was [\d.]+ s\)$/m);
  assert.match(r.stdout, /^window: bar (1 \(unchanged\)|1 -> \d+ \(pass --start-bar 1 to keep it\))$/m);
  const moved = spawnSync(process.execPath, [SCRIPT, project(), song100, '--no-open', '--start-bar', '2'], { encoding: 'utf8' });
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /^window: bar 1 -> 2 \(pass --start-bar 1 to keep it\)$/m);
  assert.match(r.stdout, /^to place: drop$/m);
  const bad = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /^error: /m);
  const missing = spawnSync(process.execPath, [SCRIPT, dir, '/nope/song.wav', '--no-open'], { encoding: 'utf8' });
  assert.equal(missing.status, 2); assert.match(missing.stderr, /^error: .*\/nope\/song\.wav/m);
});

test('swap report: tables with more states than the new song allows warn with both numbers', async () => {
  // a 1-bar loop at 100 BPM allows 2 states (4 beats, 2 beats each); index.html's table above has 4
  const dir = project();
  const r = await swapSong(dir, song100, { bars: 1 });
  assert.equal(r.budget, 'the tables have 4 states; the new song allows 2 (shorten the table or pass --bars)');
});

// A signal to the swap process alone (kill PID, a wrapper) while the analyser runs: the analyser is stopped before
// the backup goes back, so it cannot overwrite the restored files, and the backup is kept. The fake analyser sleeps,
// then overwrites song.json; its argv carries a marker so pgrep finds only this test's process.
test('swap CLI: SIGTERM to the swap stops the analyser, restores song.json and keeps the backup', { timeout: 30_000 }, async () => {
  const dir = project();
  const before = readFileSync(path.join(dir, 'song.json'));
  const marker = `mk-swap-orphan-${process.pid}-${Date.now()}`;
  const python = path.join(tempDir('mk-fakepy-'), 'python3');
  writeFileSync(python, `#!/bin/sh\nexec python3 -c 'import sys, time; time.sleep(2); open(sys.argv[1], "w").write("{}")' ${JSON.stringify(path.join(dir, 'song.json'))} ${marker}\n`);
  chmodSync(python, 0o755);
  const running = () => spawnSync('pgrep', ['-f', marker]).status === 0;
  const until = async (ok, ms) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return true; return ok(); };
  const child = spawn(process.execPath, [SCRIPT, dir, song100, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MK_ANALYSER_PYTHON: python } });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  try {
    assert.ok(await until(running, 10_000), 'the fake analyser started');
    const code = await new Promise((resolve) => { child.on('exit', (c) => resolve(c)); child.kill('SIGTERM'); });
    assert.equal(code, 143);
    assert.ok(await until(() => !running(), 3000), 'the analyser is still running after the swap exited');
    await new Promise((r) => setTimeout(r, 2500));   // past the fake analyser's write, had it survived
    assert.deepEqual(readFileSync(path.join(dir, 'song.json')), before);
    const kept = readdirSync(path.join(dir, '.swap-backup'));
    assert.equal(kept.length, 1);
    assert.ok(existsSync(path.join(dir, '.swap-backup', kept[0], 'song.json')));
    assert.match(stderr, /^backup kept at .*\.swap-backup\/\d{8}-\d{6}$/m);
  } finally {
    child.kill('SIGKILL');
    spawnSync('pkill', ['-KILL', '-f', marker]);
  }
});
