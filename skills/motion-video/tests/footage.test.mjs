// footage.mjs and clip.mjs: frames from a synthetic video (lavfi testsrc), the size cap, re-runs into an existing
// clip, the exit-2 errors, and readClip's validation of hand-made clip directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './tmp.mjs';
import { FFMPEG, UsageError } from '../scripts/render.mjs';
import { framePath, readClip, writeClip } from '../scripts/clip.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const TMP = tempDir('mk-footage-');
const VIDEO = path.join(TMP, 'screen recording.mp4');
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', VIDEO]);

const footage = (...args) => spawnSync('node', [path.join(SKILL, 'scripts', 'footage.mjs'), ...args], { encoding: 'utf8' });
const frameFiles = (dir) => readdirSync(dir).filter((f) => /^frame-\d{5}\.jpg$/.test(f));
const jpegSize = (file) => execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=width,height',
  '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
const noTrace = (r) => { assert.match(r.stderr, /^error: /); assert.doesNotMatch(r.stderr, /\n\s+at |Error:.*\n.*node:/); };

test('framePath is 1-based with 5 digits', () => {
  assert.equal(framePath('/c', 1), path.join('/c', 'frame-00001.jpg'));
  assert.equal(framePath('/c', 123), path.join('/c', 'frame-00123.jpg'));
});

test('footage.mjs at the defaults: 60 fps, capped at 1600 wide, a valid video clip', () => {
  const out = path.join(TMP, 'proj', 'footage', 'rec');
  const r = footage(VIDEO, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const clip = readClip(out);
  assert.equal(clip.frames, 120);
  assert.equal(clip.fps, 60);
  assert.equal(clip.width, 1600);
  assert.equal(clip.height, 900);
  assert.equal(clip.height % 2, 0);
  assert.equal(clip.duration, 2);
  assert.equal(clip.mode, 'video');
  assert.deepEqual(clip.steps, []);
  assert.equal(clip.source, 'screen recording.mp4');
  assert.equal(frameFiles(out).length, 120);
  assert.deepEqual(jpegSize(framePath(out, 1)), [1600, 900]);
  assert.equal(r.stdout.trim(), `footage: 120 frames, 2 s, 1600x900 -> ${out}`);
});

test('--fps 30 --max-width 640; a re-run into the same clip leaves no stale frames', () => {
  const out = path.join(TMP, 'rerun');
  assert.equal(footage(VIDEO, '--out', out).status, 0);
  assert.equal(frameFiles(out).length, 120);
  const r = footage(VIDEO, '--out', out, '--fps', '30', '--max-width', '640');
  assert.equal(r.status, 0, r.stderr);
  const clip = readClip(out);
  assert.equal(clip.frames, 60);
  assert.equal(clip.width, 640);
  assert.equal(clip.height, 360);
  assert.equal(frameFiles(out).length, 60);
  assert.deepEqual(readdirSync(out).sort(), ['clip.json', ...frameFiles(out)].sort());
});

test('an odd-width video gives even dimensions', () => {
  const odd = path.join(TMP, 'odd.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=321x241:rate=30', '-t', '0.5', '-pix_fmt', 'yuv444p', odd]);
  const out = path.join(TMP, 'odd');
  const r = footage(odd, '--out', out, '--fps', '10');
  assert.equal(r.status, 0, r.stderr);
  const clip = readClip(out);
  assert.equal(clip.width % 2, 0);
  assert.equal(clip.height % 2, 0);
  assert.deepEqual(jpegSize(framePath(out, 1)), [clip.width, clip.height]);
});

test('bad input exits 2 with error: and no traceback', () => {
  const text = path.join(TMP, 'notes.txt');
  writeFileSync(text, 'not a video\n');
  const busy = path.join(TMP, 'busy');
  mkdirSync(busy, { recursive: true });
  writeFileSync(path.join(busy, 'keep.txt'), 'mine');
  const cases = [
    [[path.join(TMP, 'missing.mp4'), '--out', path.join(TMP, 'x1')], /missing\.mp4/],
    [[text, '--out', path.join(TMP, 'x2')], /not a video/],
    [[VIDEO], /--out/],
    [[VIDEO, '--out', path.join(TMP, 'x3'), '--speed', '2'], /unknown flag --speed/],
    [[VIDEO, '--out', path.join(TMP, 'x4'), '--fps', '0'], /--fps/],
    [[VIDEO, '--out', path.join(TMP, 'x5'), '--max-width', '641'], /--max-width/],
    [[VIDEO, '--out', busy], /not empty/],
    [[], /usage:/],
  ];
  for (const [args, msg] of cases) {
    const r = footage(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    noTrace(r);
    assert.match(r.stderr, msg, args.join(' '));
  }
  assert.deepEqual(readdirSync(busy), ['keep.txt']);
  for (const x of ['x1', 'x2', 'x3', 'x4', 'x5']) assert.throws(() => readdirSync(path.join(TMP, x)), /ENOENT/, x);
});

// A hand-made clip: tiny placeholder frames (readClip checks the files exist, not their pixels).
function fakeClip(name, over = {}, nFiles = 3) {
  const dir = path.join(TMP, 'fake', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= nFiles; n++) writeFileSync(framePath(dir, n), 'jpg');
  const clip = { fps: 30, width: 320, height: 240, frames: 3, duration: 0.1, mode: 'stepped', source: 'app.html', browser: 'webkit',
    steps: [{ name: 'pay', action: 'click', t: 0.05, box: { x: 10, y: 20, w: 30, h: 40 } }], ...over };
  writeFileSync(path.join(dir, 'clip.json'), JSON.stringify(clip));
  return dir;
}

test('readClip accepts a valid clip', () => {
  const clip = readClip(fakeClip('ok'));
  assert.equal(clip.frames, 3);
  assert.equal(clip.steps[0].name, 'pay');
  readClip(fakeClip('dur-within', { duration: 0.1 + 1 / 30 }));
});

test('readClip rejects bad clips with a UsageError naming the dir', () => {
  const missing = path.join(TMP, 'fake', 'empty');
  mkdirSync(missing, { recursive: true });
  const bad = [
    [missing, /clip\.json/],
    [fakeClip('fewer', {}, 2), /frame-00003\.jpg/],
    [fakeClip('extra', {}, 4), /4 frame files/],
    [fakeClip('mode', { mode: 'film' }), /mode/],
    [fakeClip('nobox', { steps: [{ name: 'pay', action: 'click', t: 0.05 }] }), /box/],
    [fakeClip('fps', { fps: 0 }), /fps/],
    [fakeClip('odd', { width: 321 }), /width/],
    [fakeClip('dur', { duration: 0.2 }), /duration/],
    [fakeClip('zero', { frames: 0, duration: 0 }, 0), /frames/],
  ];
  for (const [dir, msg] of bad) {
    assert.throws(() => readClip(dir), (e) => e instanceof UsageError && msg.test(e.message) && e.message.includes(dir), dir);
  }
  const broken = fakeClip('json');
  writeFileSync(path.join(broken, 'clip.json'), '{nope');
  assert.throws(() => readClip(broken), (e) => e instanceof UsageError && /JSON/.test(e.message));
});

test('writeClip writes a clip readClip reads back, and refuses an invalid one', () => {
  const dir = fakeClip('write');
  const clip = { fps: 30, width: 320, height: 240, frames: 3, duration: 0.1, mode: 'realtime', source: 'x', steps: [] };
  writeClip(dir, clip);
  assert.deepEqual(readClip(dir), clip);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'clip.json'), 'utf8')), clip);
  assert.throws(() => writeClip(dir, { ...clip, frames: 5, duration: 5 / 30 }), UsageError);
  assert.deepEqual(readClip(dir), clip);
});
