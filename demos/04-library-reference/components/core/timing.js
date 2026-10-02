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
// (times two beats reach). The rule: when one or more beats cover t, the latest one, exactly
// (beatTime(beatAt(t)) === t), so a time on a beat's own cue is that whole beat, not the tail of the one
// before; in a gap, the whole beat whose time is nearest t. Before beat 0 and past the
// last beat the grid extends by whole beats, so beatAt inverts beatTime there too.
export function beatAt(song, t) {
  if (!song.beats?.length) return t / song.beat_sec;
  const n = last(song), bs = song.beat_sec, swing = song.sync?.swing ?? 0.5;
  const lo = Math.min(0, Math.floor((t - grid(song, 0)) / bs)) - 1;
  const hi = n + Math.max(0, Math.floor((t - grid(song, n)) / bs)) + 1;
  let near = lo, hit = null;
  for (let i = lo; i <= hi; i++) {
    const s = start(song, i), span = grid(song, i + 1) - grid(song, i);
    if (s <= t && t < s + span) hit = i + unwarp((t - s) / span, swing);
    if (Math.abs(s - t) < Math.abs(start(song, near) - t)) near = i;
  }
  return hit ?? near;
}

// Markers: named moments from song.json's derived top-level `markers` ([{ name, song_t, t, in_loop }], t in loop
// seconds; no key means none). A table row's `at` may name one. This module never words a message: a bad marker
// throws a MarkerError ({ markerName, known, reason, marker, offset }) and validate.js's markerMessage turns it into text (did-you-mean included).
// reason: 'unknown' (no such marker), 'outside' (marker.in_loop is false), 'not-a-name' (does not start with a
// letter, e.g. at: '4'), 'offset' (the row's offset is not a finite number; offset holds it).
export class MarkerError extends Error {
  constructor({ markerName, known, reason, marker = null, offset }) {
    super(`marker ${JSON.stringify(markerName)}: ${reason}`);
    this.name = 'MarkerError';
    Object.assign(this, { markerName, known, reason, marker, offset });
  }
}

// The exact (fractional) beat of marker `name`: beatAt of its loop time, so beatTime(markerBeat) is the marker.
export function markerBeat(song, name) {
  // Entries that are not { name: string, t: finite } are ignored, so naming one is an unknown marker.
  const list = (Array.isArray(song?.markers) ? song.markers : [])
    .filter((m) => m && typeof m === 'object' && typeof m.name === 'string' && Number.isFinite(m.t));
  const known = list.map((m) => m.name);
  if (typeof name !== 'string' || !/^[a-z]/i.test(name)) throw new MarkerError({ markerName: name, known, reason: 'not-a-name' });
  const marker = list.find((m) => m.name === name);
  if (!marker) throw new MarkerError({ markerName: name, known, reason: 'unknown' });
  if (marker.in_loop === false) throw new MarkerError({ markerName: name, known, reason: 'outside', marker });
  return beatAt(song, marker.t);
}

// A table with every `at: 'name'` (plus optional `offset` in beats) turned into its beat number:
// { ...row, at: markerBeat + offset, marker: name } without `offset`. Rows that fail stay as written and each
// failure is collected as { index, error: MarkerError }. Numeric rows, holes and non-objects pass through.
export function resolveRows(rows, song) {
  const errors = [];
  if (!Array.isArray(rows)) return { rows, errors };
  const out = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || typeof row.at !== 'string') return row;
    const { offset = 0, ...rest } = row;
    try {
      const b = markerBeat(song, row.at);
      if (!Number.isFinite(offset)) throw new MarkerError({ markerName: row.at, known: [], reason: 'offset', offset });
      return { ...rest, at: b + offset, marker: row.at };
    } catch (error) {
      if (!(error instanceof MarkerError)) throw error;
      errors.push({ index, error });
      return row;
    }
  });
  return { rows: out, errors };
}
