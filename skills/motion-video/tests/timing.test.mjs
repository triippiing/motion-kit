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
  for (const b of [0, 0.3, 1.5, 1.9]) assert.ok(Math.abs(beatAt(song, beatTime(song, b)) - b) < 1e-9, `beat ${b}`);
  // Beat 0 runs from its cue (0.01) for a whole grid beat, to 0.51, so 0.5 (beat 1) is also reached by beat 0:
  // the earlier beat wins.
  assert.ok(Math.abs(beatTime(song, beatAt(song, 0.5)) - 0.5) < 1e-12);
  assert.ok(beatAt(song, 0.5) < 1);
});

// Each beat i covers [start(i), start(i) + span(i)): its cue, for one grid beat. Cue offsets that vary leave
// gaps (times no beat reaches) and overlaps (times two beats reach).
const sp = (song, i) => { const n = song.beats.length - 1, g = (k) => (k < 0 ? song.beats[0].t + k * song.beat_sec
  : k > n ? song.beats[n].t + (k - n) * song.beat_sec : song.beats[k].t); return g(i + 1) - g(i); };
const covers = (song, i, t) => { const s = beatTime(song, i); return s <= t && t < s + sp(song, i); };

for (const demo of ['01-reference', '02-finance-promo', '04-library-reference']) {
  for (const swing of [0.5, 0.62]) {
    test(`beatAt on ${demo} (swing ${swing}): exact where reachable, within the largest gap elsewhere`, () => {
      const song = { ...JSON.parse(readFileSync(new URL(`../../../demos/${demo}/song.json`, import.meta.url))), sync: { swing } };
      const N = song.beats.length;
      let gap = 0;
      for (let i = -1; i <= N; i++) gap = Math.max(gap, beatTime(song, i + 1) - (beatTime(song, i) + sp(song, i)));
      const reachable = (t) => { for (let i = -2; i <= N + 4; i++) if (covers(song, i, t)) return true; return false; };
      let worst = 0;
      for (let t = 0; t <= beatTime(song, N + 2); t += 0.005) {
        const err = Math.abs(beatTime(song, beatAt(song, t)) - t);
        if (reachable(t)) assert.ok(err < 1e-9, `t ${t}: reachable but off by ${err}`);
        worst = Math.max(worst, err);
      }
      assert.ok(worst <= gap + 1e-9, `worst ${worst} > largest gap ${gap}`);
      for (let b = 0; b <= N + 2; b = Math.round((b + 0.01) * 100) / 100) {
        const t = beatTime(song, b);
        let earlier = false;
        for (let i = -2; i < Math.floor(b); i++) if (covers(song, i, t)) earlier = true;
        if (!earlier) assert.ok(Math.abs(beatAt(song, t) - b) < 1e-9, `beat ${b}`);
      }
    });
  }
}

test('beatAt extrapolates past the last beat with whole beats', () => {
  const song = { beat_sec: 0.5, beats: [{ t: 0, cue_t: 0.01 }, { t: 0.5, cue_t: 0.49 }, { t: 1 }] };
  for (const b of [3, 3.5, 4.25, 10.75]) assert.ok(Math.abs(beatAt(song, beatTime(song, b)) - b) < 1e-9, `beat ${b}`);
});
