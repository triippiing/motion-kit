// gallery.test.mjs -- browser-level: every component (example and edge cases) mounts, renders purely,
// starts no CSS animation, and the gallery loops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gallery, parseArgs } from '../scripts/gallery.mjs';
import { openScene } from './harness.mjs';
import { beatStills } from '../scripts/beat_stills.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('every component renders purely (same DOM whatever came before) and the gallery loops', async () => {
  const { dir, plays } = await gallery();
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
