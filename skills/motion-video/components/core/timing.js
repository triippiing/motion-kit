// timing.js: the one definition of musical time, shared by the page, the engine, the scripts and the sync page.
// Pure, no DOM; an ES module that runs in the browser and in Node. Projects get their own copy with components/.

// Swing: where the off-beat lands inside a beat. Piecewise linear through (0,0), (0.5, swing), (1,1).
export const warp = (f, swing = 0.5) => (f <= 0.5 ? f * (swing / 0.5) : swing + (f - 0.5) * ((1 - swing) / 0.5));
export const unwarp = (u, swing = 0.5) => (u <= swing ? u * (0.5 / swing) : 0.5 + (u - swing) * (0.5 / (1 - swing)));

const last = (song) => song.beats.length - 1;
// Grid time of beat i (t), extended by beat_sec past either end.
function grid(song, i) {
  const n = last(song);
  if (i < 0) return song.beats[0].t + i * song.beat_sec;
  if (i > n) return song.beats[n].t + (i - n) * song.beat_sec;
  return song.beats[i].t;
}
// Where beat i sounds: its measured cue (cue_t), else its grid time.
const start = (song, i) => song.beats[i]?.cue_t ?? grid(song, i);

// Loop time (seconds) of beat b (fractional allowed).
export function beatTime(song, b) {
  if (!song.beats?.length) return b * song.beat_sec;
  const i = Math.floor(b), f = b - i;
  const t0 = start(song, i);
  return f === 0 ? t0 : t0 + warp(f, song.sync?.swing ?? 0.5) * (grid(song, i + 1) - grid(song, i));
}

// Fractional beat at loop time t: the inverse of beatTime. Beat i covers [start(i), start(i) + span) with
// span = grid(i+1) - grid(i), so cue offsets that vary leave gaps (times no beat reaches) and overlaps
// (times two beats reach). The rule: when one or more beats cover t, the earliest one, exactly
// (beatTime(beatAt(t)) === t); in a gap, the whole beat whose time is nearest t. Before beat 0 and past the
// last beat the grid extends by whole beats, so beatAt inverts beatTime there too.
export function beatAt(song, t) {
  if (!song.beats?.length) return t / song.beat_sec;
  const n = last(song), bs = song.beat_sec, swing = song.sync?.swing ?? 0.5;
  const lo = Math.min(0, Math.floor((t - grid(song, 0)) / bs)) - 1;
  const hi = n + Math.max(0, Math.floor((t - grid(song, n)) / bs)) + 1;
  let near = lo;
  for (let i = lo; i <= hi; i++) {
    const s = start(song, i), span = grid(song, i + 1) - grid(song, i);
    if (s <= t && t < s + span) return i + unwarp((t - s) / span, swing);
    if (Math.abs(s - t) < Math.abs(start(song, near) - t)) near = i;
  }
  return near;
}
