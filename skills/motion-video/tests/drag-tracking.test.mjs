// drag-tracking.test.mjs -- a dragged thumb stays under the cursor (slider and player, the components whose
// meta.drag lists a hotspot), at camera zoom above 1 and at a design scale K above 1.
// The tables copy the launch video's timing: the cursor reaches for the thumb only half a beat before the
// press 'down', so the pointer spring (0.8 beat to settle) is still in flight when the press lands, and the
// release comes half a beat after the move row. All positions are stage px: the cursor tip from inspect(t)
// (and from the #cursor element), the thumb centre from its bounding box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scene } from './harness.mjs';

const TOL = 3;

// In the page at t: the cursor tip (inspect and DOM), the thumb centre, the track box, and whether the
// row's layer has finished its entrance (an entering layer is still scaled about the shape centre).
function probe(s, t, row, thumbSel, trackSel) {
  return s.page.evaluate(([t, row, thumbSel, trackSel]) => {
    window.seek(t);
    const st = document.querySelector('#stage').getBoundingClientRect();
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left - st.left, r: r.right - st.left, cx: (r.left + r.right) / 2 - st.left, cy: (r.top + r.bottom) / 2 - st.top, w: r.width }; };
    const layer = document.querySelector(`.layer[data-row="${row}"]`);
    const cr = document.querySelector('#cursor').getBoundingClientRect();
    return { cursor: window.inspect(t).cursor, tip: { x: cr.left - st.left + cr.width * 7 / 44, y: cr.top - st.top + cr.height * 4 / 44 },
      thumb: box(layer.querySelector(thumbSel)), track: box(layer.querySelector(trackSel)), entered: getComputedStyle(layer).filter === 'none' };
  }, [t, row, thumbSel, trackSel]);
}

const near = (a, b) => Math.hypot(a.x - b.cx, a.y - b.cy);

// One drag: approach at A, 'down' at D, move at M, 'up' at U (beats). Checks, in stage px:
// - the cursor element's tip is where inspect says;
// - from D to U, wherever the cursor is inside the track, the tip is within TOL of the thumb centre;
// - after U, the thumb holds its released place on the track.
async function drag({ name, states, cursor, size, row, D, U, thumbSel, trackSel }) {
  await scene({ bars: 2, bpm: 98, size, states, cursor }, async (s, at, bs) => {
    const checked = [];
    for (let b = D; b <= U + 1e-9; b += 0.05) {
      const p = await probe(s, b * bs, row, thumbSel, trackSel);
      assert.ok(Math.abs(p.tip.x - p.cursor.x) < 0.5 && Math.abs(p.tip.y - p.cursor.y) < 0.5, `${name}: cursor element tip ${JSON.stringify(p.tip)} vs inspect ${JSON.stringify(p.cursor)}`);
      if (!p.entered || p.cursor.x < p.track.l || p.cursor.x > p.track.r) continue;
      checked.push({ beat: +b.toFixed(2), tip: [+p.cursor.x.toFixed(1), +p.cursor.y.toFixed(1)], thumb: [+p.thumb.cx.toFixed(1), +p.thumb.cy.toFixed(1)] });
      assert.ok(near(p.cursor, p.thumb) <= TOL, `${name}: at beat ${b.toFixed(2)} the cursor tip ${JSON.stringify(checked.at(-1).tip)} is ${near(p.cursor, p.thumb).toFixed(1)} px from the thumb centre ${JSON.stringify(checked.at(-1).thumb)}`);
    }
    assert.ok(checked.length >= 8, `${name}: enough held samples inside the track: ${JSON.stringify(checked)}`);
    // Released: the thumb's place along the (unstretched) track does not change.
    const frac = (p) => (p.thumb.cx - p.track.l) / p.track.w;
    const rel = await probe(s, U * bs, row, thumbSel, trackSel);
    for (const b of [U + 0.25, U + 0.5, U + 1]) {
      const p = await probe(s, b * bs, row, thumbSel, trackSel);
      assert.ok(Math.abs(frac(p) - frac(rel)) * p.track.w < 1, `${name}: after release (beat ${b}) the thumb stays at ${frac(rel).toFixed(4)} of the track, got ${frac(p).toFixed(4)}`);
    }
  });
}

// The launch video's slider rows: arrive from the resting cursor on the right, press on the row's first beat.
const sliderCase = (name, row, size, dx = 140) => ({
  name, size, row: 1, D: 2, U: 3.5, thumbSel: '.sl-thumb', trackSel: '.sl-track',
  states: `[{ at: 0, use: 'button' }, { at: 2, use: 'slider', ${row} }, { at: END - 2, use: 'button' }]`,
  cursor: `[{ at: 0, x: 140, y: 100 }, { at: 1.5, target: 'thumb' }, { at: 2, target: 'thumb', press: 'down' }, { at: 3, target: 'thumb', dx: ${dx} }, { at: 3.5, target: 'thumb', dx: ${dx}, press: 'up' }, { at: END - 2, x: 140, y: 100 }]`,
});
// The launch video's player rows: arrive from the left, press half a beat later.
const playerCase = (name, size) => ({
  name, size, row: 1, D: 3, U: 4.5, thumbSel: '.pl-thumb', trackSel: '.pl-track',
  states: "[{ at: 0, use: 'button' }, { at: 2, use: 'player', title: 'Motion Music', artist: 'MC Claude', position: 0.08, duration: 157 }, { at: END - 2, use: 'button' }]",
  cursor: "[{ at: 0, x: -260, y: -100 }, { at: 2.5, target: 'thumb' }, { at: 3, target: 'thumb', press: 'down' }, { at: 4, target: 'thumb', dx: 260 }, { at: 4.5, target: 'thumb', dx: 260, press: 'up' }, { at: END - 2, x: -260, y: -100 }]",
});

test('drag: slider with a label (overstretch false, the launch row) keeps its thumb under the cursor', () =>
  drag(sliderCase('slider labelled', "label: 'Swing', value: 0.5, min: 0.5, max: 0.75, icon: 'none', overstretch: false")));
test('drag: slider without a label (overstretch true) keeps its thumb under the cursor', () =>
  drag(sliderCase('slider plain', 'value: 0.3')));
test('drag: slider overstretched past max and back keeps its thumb under the cursor inside the track', () =>
  drag({ ...sliderCase('slider past max', 'value: 0.6, icon: \'none\''), U: 4,
    cursor: "[{ at: 0, x: 140, y: 100 }, { at: 1.5, target: 'thumb' }, { at: 2, target: 'thumb', press: 'down' }, { at: 2.5, target: 'thumb', dx: 320 }, { at: 3.25, target: 'thumb', dx: -60 }, { at: 4, target: 'thumb', dx: -60, press: 'up' }, { at: END - 2, x: 140, y: 100 }]" }));
test('drag: slider with a label on a 2880 stage (design scale 2) keeps its thumb under the cursor', () =>
  drag(sliderCase('slider labelled K2', "label: 'Swing', value: 0.6, min: 0.5, max: 0.75, overstretch: true", '2880x2880', -120)));
test('drag: player scrub keeps its thumb under the cursor', () => drag(playerCase('player')));
test('drag: player scrub on a 2880 stage (design scale 2) keeps its thumb under the cursor', () => drag(playerCase('player K2', '2880x2880')));

// Hotspot accuracy: once the cursor has settled on 'thumb' (given more than a beat to arrive), its tip is on the
// thumb centre, for every component whose meta.drag lists 'thumb', with and without a label, at zoom > 1.
test('drag: a cursor aimed at thumb lands its tip on the thumb centre', async () => {
  for (const { use, row, thumbSel, trackSel } of [
    { use: 'slider', row: 'value: 0.3', thumbSel: '.sl-thumb', trackSel: '.sl-track' },
    { use: 'slider', row: "label: 'Swing', value: 0.6, min: 0.5, max: 0.75, icon: 'none'", thumbSel: '.sl-thumb', trackSel: '.sl-track' },
    { use: 'player', row: 'position: 0.3', thumbSel: '.pl-thumb', trackSel: '.pl-track' }]) {
    await scene({ bars: 2, bpm: 98, states: `[{ at: 0, use: '${use}', ${row} }, { at: END - 2, use: '${use}', ${row} }]`,
      cursor: "[{ at: 0, x: 140, y: 100 }, { at: 1, target: 'thumb' }, { at: END - 2, x: 140, y: 100 }]" }, async (s, at, bs) => {
      const p = await probe(s, 3 * bs, 0, thumbSel, trackSel);
      const z = await s.page.evaluate(() => +/scale\(([^)]+)\)/.exec(document.querySelector('#camera').style.transform)[1]);
      assert.ok(z > 1, `${use} ${row}: camera zoom above 1 (${z})`);
      assert.ok(near(p.cursor, p.thumb) <= TOL, `${use} ${row}: tip ${JSON.stringify(p.cursor)} vs thumb centre ${JSON.stringify(p.thumb)}`);
    });
  }
});
