import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const P = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../presets.json'), 'utf8'));
const NAMES = ['reels','tiktok','shorts','x','x-landscape','linkedin','linkedin-landscape','discord','discord-nitro','web','gif'];
test('every destination exists', () => { for (const n of NAMES) assert.ok(P.presets[n], n); });
test('every preset is complete and consistent', () => {
  for (const [n, p] of Object.entries(P.presets)) {
    assert.ok(['square','vertical','landscape','design'].includes(p.shape), n);
    if (p.shape !== 'design') assert.deepEqual(p.size ?? P.shapes[p.shape], P.shapes[p.shape], `${n} size matches its shape`);
    assert.ok([30, 60].includes(p.fps), n);
    assert.ok(p.maxSeconds === null || p.maxSeconds > 0, n);
    assert.ok(p.maxMB === null || p.maxMB > 0, n);
    assert.ok(p.source || p.estimate === true, `${n} needs a source or estimate:true`);
    assert.match(p.checked, /^\d{4}-\d{2}-\d{2}$/, n);
    const [w, h] = p.size ?? [1440, 1440];
    for (const k of ['top','bottom','left','right']) assert.ok(p.safe[k] >= 0, `${n}.safe.${k}`);
    assert.ok(p.safe.left + p.safe.right < w && p.safe.top + p.safe.bottom < h, `${n} safe zone leaves room`);
    assert.equal(typeof p.public, 'boolean', n);
  }
});
test('discord caps: free 10 MB, nitro larger (500 MB per Jack; 1 GB announced) unless sourced otherwise', () => {
  assert.ok(P.presets.discord.maxMB > 0 && P.presets['discord-nitro'].maxMB > P.presets.discord.maxMB);
});
