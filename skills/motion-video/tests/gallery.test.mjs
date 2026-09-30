// gallery.test.mjs -- browser-level: every component mounts, renders purely, and the gallery loops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gallery } from '../scripts/gallery.mjs';
import { openScene } from './harness.mjs';
import { beatStills } from '../scripts/beat_stills.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('every component renders purely (same pixels-to-DOM whatever came before) and the gallery loops', async () => {
  const { dir, list } = await gallery();
  const s = await openScene(dir);
  try {
    assert.deepEqual(s.errors, []);
    const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
    const D = song.loop.duration_sec;
    for (let i = 0; i < list.length; i++) {
      const t = song.beats[i * 2].t + 0.73 * song.beat_sec;      // mid-entrance
      await s.seek(0); await s.seek(t); const a = await s.snap();
      await s.seek(D * 0.9); await s.seek(t); const b = await s.snap();
      assert.equal(a, b, `${list[i].meta.name} is not a pure function of t`);
    }
  } finally { await s.close(); }
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});
