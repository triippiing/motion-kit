import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const P = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../presets.json'), 'utf8'));
// An estimated entry names a top-level field or a field of the audio, video or gif block (e.g. "lufs").
const isField = (p, f) => [p, p.audio, p.video, p.gif].some((o) => o && Object.hasOwn(o, f));
const NAMES = ['reels','tiktok','shorts','x','x-landscape','linkedin','linkedin-landscape','discord','discord-nitro','web','gif'];
test('every destination exists', () => { for (const n of NAMES) assert.ok(P.presets[n], n); });
test('every preset is complete and consistent', () => {
  for (const [n, p] of Object.entries(P.presets)) {
    assert.ok(['square','vertical','landscape','design'].includes(p.shape), n);
    if (p.shape !== 'design') assert.deepEqual(p.size ?? P.shapes[p.shape], P.shapes[p.shape], `${n} size matches its shape`);
    assert.ok([30, 60].includes(p.fps), n);
    assert.ok(p.maxSeconds === null || p.maxSeconds > 0, n);
    const maxMB = p.gif ? p.gif.maxMB : p.maxMB;
    assert.ok(maxMB === null || maxMB > 0, `${n} maxMB`);
    if (p.gif) assert.equal(p.maxMB, undefined, `${n}: the cap lives in gif.maxMB only`);
    assert.equal(p.estimate, undefined, `${n}: use per-field "estimated", not "estimate"`);
    assert.ok(Array.isArray(p.estimated ?? []), `${n}.estimated is a list`);
    assert.ok(p.source || p.estimated?.length > 0, `${n} needs a source or a non-empty estimated list`);
    for (const f of p.estimated ?? []) assert.ok(isField(p, f), `${n}.estimated names "${f}", which is not a field of the preset`);
    assert.match(p.checked, /^\d{4}-\d{2}-\d{2}$/, n);
    const [w, h] = p.size ?? [1440, 1440];
    for (const k of ['top','bottom','left','right']) assert.ok(p.safe[k] >= 0, `${n}.safe.${k}`);
    assert.ok(p.safe.left + p.safe.right < w && p.safe.top + p.safe.bottom < h, `${n} safe zone leaves room`);
    assert.equal(typeof p.public, 'boolean', n);
  }
});
test('discord caps: free 20 MB, Nitro 1 GB (stored as 1000 MB)', () => {
  assert.equal(P.presets.discord.maxMB, 20);
  assert.equal(P.presets['discord-nitro'].maxMB, 1000);
});
