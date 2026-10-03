// gallery.test.mjs -- browser-level: every component (example and edge cases) mounts, renders purely,
// starts no CSS animation, and the gallery loops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gallery, parseArgs } from '../scripts/gallery.mjs';
import { openScene } from './harness.mjs';
import { beatStills } from '../scripts/beat_stills.mjs';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tempDir } from './tmp.mjs';

test('every component renders purely (same DOM whatever came before) and the gallery loops', async () => {
  const { dir, plays } = await gallery({ root: tempDir('mk-galtest-') });
  const s = await openScene(dir);
  try {
    assert.deepEqual(s.errors, []);
    const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
    const D = song.loop.duration_sec;
    const seek = async (t) => {
      await s.seek(t);
      assert.equal(await s.page.evaluate(() => document.getAnimations().length), 0, `a CSS transition or animation is running at ${t}`);
    };
    for (const p of plays) for (const frac of [0.25, 0.73, 1.5]) {
      const t = song.beats[p.at].t + frac * song.beat_sec;   // entrance, mid-entrance, settled
      await seek(0); await seek(t); const a = await s.snap();
      await seek(D * 0.9); await seek(t); const b = await s.snap();
      assert.equal(a, b, `${p.name} (${p.kind}, beat ${p.at}) is not a pure function of t at +${frac} beat`);
    }
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});

test('gallery --only with an unknown name is a clear error, exit 2', () => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), '', '--only', 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: --only names no known component: nope/);
});

test('gallery flags: OUT is optional and --only takes the next argument', () => {
  assert.deepEqual(parseArgs(['--only', 'tabs,dock', '--stills']), { out: null, only: ['tabs', 'dock'], stills: true });
  assert.deepEqual(parseArgs(['out/g', '--stills']), { out: 'out/g', only: null, stills: true });
  assert.deepEqual(parseArgs(['--stills', '--only', 'button', 'out/g']), { out: 'out/g', only: ['button'], stills: true });
  assert.deepEqual(parseArgs(['', '--stills']), { out: null, only: null, stills: true }, 'an empty OUT is no OUT');
  assert.throws(() => parseArgs(['--only']), /--only needs a comma-separated list of components/);
  assert.throws(() => parseArgs(['--still']), /unknown option "--still"/);
  assert.throws(() => parseArgs(['a', 'b']), /one OUT directory at most/);
});

test('gallery --only x --stills without OUT checks the names first (no OUT called --only)', () => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), '--only', 'nope', '--stills'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: --only names no known component: nope/);
});

test('gallery.mjs imports nothing from tests/', () => {
  const src = readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/tests\//);
});

test('gallery OUT leaves no temp project behind', () => {
  const temps = () => readdirSync(tmpdir()).filter((n) => n.startsWith('mk-gallery-')).sort();
  const out = path.join(tempDir('mk-gout-'), 'g');
  const before = temps();
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), out, '--only', 'button'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(out, 'index.html')), 'the project is in OUT');
  assert.deepEqual(temps(), before);
});

test('gallery with an unwritable OUT is a clear error, no stack trace, no temp project left', () => {
  const temps = () => readdirSync(tmpdir()).filter((n) => n.startsWith('mk-gallery-')).sort();
  const file = path.join(tempDir('mk-gout-'), 'file');
  writeFileSync(file, 'x');
  const before = temps();
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), path.join(file, 'x'), '--only', 'button'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /^error: /m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.deepEqual(temps(), before);
});

// With no OUT and no --stills the project is the output: it stays and its path is printed.
test('gallery with no OUT and no --stills prints a project that exists', () => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'gallery.mjs'), '--only', 'button'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const printed = r.stdout.trim().split('\n').at(-1);
  try {
    assert.ok(existsSync(path.join(printed, 'index.html')), `no index.html in ${printed}`);
    assert.match(path.basename(path.dirname(printed)), /^mk-gallery-/);
  } finally {
    if (path.basename(path.dirname(printed)).startsWith('mk-gallery-')) rmSync(path.dirname(printed), { recursive: true, force: true });
  }
});
