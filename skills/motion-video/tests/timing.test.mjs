import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warp, unwarp, beatTime, beatAt } from '../components/core/timing.js';

const old = (song, b) => { const i = Math.floor(b), fb = song.beats?.[i];
  return (fb ? (fb.cue_t ?? fb.t) : i * song.beat_sec) + (b - i) * song.beat_sec; };

test('swing warp: 0.5 is identity, 0.667 moves the off-beat, ends fixed', () => {
  for (const f of [0, 0.25, 0.5, 0.75, 1]) assert.equal(warp(f, 0.5), f);
  assert.ok(Math.abs(warp(0.5, 0.667) - 0.667) < 1e-12);
  assert.equal(warp(0, 0.75), 0); assert.equal(warp(1, 0.75), 1);
  for (const u of [0, 0.3, 0.667, 0.9]) assert.ok(Math.abs(warp(unwarp(u, 0.667), 0.667) - u) < 1e-12);
});

for (const demo of ['01-reference', '02-finance-promo', '04-library-reference']) {
  test(`parity: ${demo} beat and half-beat times are unchanged`, () => {
    const song = JSON.parse(readFileSync(new URL(`../../../demos/${demo}/song.json`, import.meta.url)));
    for (let b = 0; b <= song.beats.length; b += 0.5) assert.ok(Math.abs(beatTime(song, b) - old(song, b)) < 1e-6, `beat ${b}`);
  });
}

test('drifting grid: the fraction follows the local beat length', () => {
  const song = { beat_sec: 0.5, beats: [{ t: 0 }, { t: 0.5 }, { t: 1.1 }] };
  assert.ok(Math.abs(beatTime(song, 1.5) - 0.8) < 1e-12);
});

test('swing is read from song.sync and moves only off-beats', () => {
  const song = { beat_sec: 0.5, beats: [{ t: 0 }, { t: 0.5 }, { t: 1 }], sync: { swing: 0.667 } };
  assert.equal(beatTime(song, 1), 0.5);
  assert.ok(Math.abs(beatTime(song, 1.5) - (0.5 + 0.667 * 0.5)) < 1e-12);
});

test('beatAt inverts beatTime, swing included', () => {
  const song = { beat_sec: 0.5, beats: [{ t: 0, cue_t: 0.01 }, { t: 0.5 }, { t: 1.1 }], sync: { swing: 0.6 } };
  for (const b of [0, 0.3, 1, 1.5, 1.9]) assert.ok(Math.abs(beatAt(song, beatTime(song, b)) - b) < 1e-9, `beat ${b}`);
});
