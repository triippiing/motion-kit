// framecheck.test.mjs -- the frame check: cursor past the stage edges, text past or clipped in its shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from './harness.mjs';
import { checkFrames, frameIssueText, sampleTimes } from '../scripts/framecheck.mjs';

const REST = "{ at: 0, use: 'button' }", BACK = "{ at: END - 2, use: 'button' }";
const run = (states, cursor) => checkFrames(makeProject({ bars: 2, states, cursor }), {});
const kinds = (r, k) => r.issues.filter((i) => i.kind === k);

test('sampleTimes: every beat and half beat inside the loop', () => {
  const song = { beats: [0, 1, 2, 3].map((i) => ({ i, t: i * 0.5, cue_t: i * 0.5 })), beat_sec: 0.5, loop: { duration_sec: 2 } };
  assert.deepEqual(sampleTimes(song).map((s) => s.beat), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(sampleTimes(song, 'beats').map((s) => s.beat), [0, 1, 2, 3]);
});

test('a plain brief has no frame issues', async () => {
  const r = await run(`[${REST}, ${BACK}]`, '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]');
  assert.deepEqual(r.issues, []);
});

test('the cursor past the right edge is one grouped issue', async () => {
  const r = await run(`[${REST}, ${BACK}]`, '[{ at: 0, x: 140, y: 100 }, { at: 2, x: 2000, y: 100 }, { at: 4, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]');
  const c = kinds(r, 'cursor');
  assert.equal(c.length, 1, JSON.stringify(r.issues));
  assert.equal(c[0].edge, 'right');
  assert.ok(c[0].px > 0 && c[0].through > c[0].beat);
  assert.match(frameIssueText(c[0]), /^beats? [\d.]+(-[\d.]+)?: the cursor goes \d+ px past the right edge$/);
});

test('a hidden cursor off-stage is not reported', async () => {
  const r = await run(`[${REST}, ${BACK}]`, '[{ at: 0, x: 140, y: 100 }, { at: 1, x: 3000, y: 100, hide: true }, { at: 4, x: 140, y: 100, hide: true }, { at: 5, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]');
  assert.deepEqual(kinds(r, 'cursor'), []);
});

test('a button label too long for its shape is reported with the text cut to 24 characters', async () => {
  const long = 'A very long label that goes on and on well past any reasonable width for a button';
  const r = await run(`[${REST}, { at: 2, use: 'button', label: '${long}' }, ${BACK}]`, '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]');
  const t = kinds(r, 'text');
  assert.ok(t.length >= 1, JSON.stringify(r.issues));
  assert.equal(t[0].text, `${long.slice(0, 24)}…`);
  assert.match(frameIssueText(t[0]), /^beats? [\d.]+(-[\d.]+)?: text "A very long label that g…" (runs \d+ px past its shape|is cut off by \d+ px)$/);
});

test('the same overflowing text shown twice in one frame is still one grouped issue', async () => {
  // The active tab's label is drawn twice (in its slot and in the indicator); wide letters clip in both.
  const W = 'WWWWWWWWWWWWWWWW', tabs = `use: 'tabs', items: ['${W}', 'Day'], active: '${W}'`;
  const r = await run(`[{ at: 0, ${tabs} }, { at: END - 2, ${tabs} }]`, '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]');
  const t = kinds(r, 'text');
  assert.equal(t.length, 1, JSON.stringify(r.issues));
  assert.equal(t[0].beat, 0);
  assert.ok(t[0].through > 7);
});
