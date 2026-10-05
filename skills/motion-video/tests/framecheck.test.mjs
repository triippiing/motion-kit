// framecheck.test.mjs -- the frame check: cursor past the stage edges, text past or clipped in its shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, scene } from './harness.mjs';
import { checkFrames, frameIssueText, measure, sampleTimes } from '../scripts/framecheck.mjs';

const REST = "{ at: 0, use: 'button' }", BACK = "{ at: END - 2, use: 'button' }";
const REST_CURSOR = '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]';
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

for (const [edge, at] of [['left', 'x: -2000, y: 100'], ['top', 'x: 140, y: -2000'], ['bottom', 'x: 140, y: 2000']]) {
  test(`the cursor past the ${edge} edge is one grouped issue`, async () => {
    const r = await run(`[${REST}, ${BACK}]`, `[{ at: 0, x: 140, y: 100 }, { at: 2, ${at} }, { at: 4, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]`);
    const c = kinds(r, 'cursor');
    assert.equal(c.length, 1, JSON.stringify(r.issues));
    assert.equal(c[0].edge, edge);
    assert.ok(c[0].px > 0 && c[0].through > c[0].beat);
    assert.match(frameIssueText(c[0]), new RegExp(`^beats? [\\d.]+(-[\\d.]+)?: the cursor goes \\d+ px past the ${edge} edge$`));
  });
}

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
  // Every tab label is drawn twice (in its slot and in the indicator layer); past the 1400 px cap the last tab's
  // slot sits past the shape's right edge in both.
  const tabs = "use: 'tabs', items: ['Overview', 'Activity', 'Settings', 'Billing', 'Team', 'Reports', 'Archive', 'Insights', 'Exports'], active: 'Exports'";
  const r = await run(`[{ at: 0, ${tabs} }, { at: END - 2, ${tabs} }]`, '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]');
  const t = kinds(r, 'text');
  assert.equal(t.length, 1, JSON.stringify(r.issues));
  assert.deepEqual([t[0].text, t[0].how, t[0].beat], ['Exports', 'past', 0]);
  assert.ok(t[0].through > 7);
});

test('text spilling its own box but staying inside the shape is not reported as clipped', async () => {
  // Wide letters overrun a tab's slot (overflow visible, so nothing is cut off) and stay inside the shape.
  const W = 'WWWWWWWWWWWWWWWW', tabs = `use: 'tabs', items: ['${W}', 'Day'], active: '${W}'`;
  const r = await run(`[{ at: 0, ${tabs} }, { at: END - 2, ${tabs} }]`, REST_CURSOR);
  assert.deepEqual(kinds(r, 'text'), []);
});

test('text a component clips inside its own box is reported as cut off', async () => {
  // A checkbox label clips its overflow (overflow hidden, ellipsis); one long word of wide letters cannot wrap.
  const W = 'W'.repeat(30), cb = `use: 'checkbox', label: '${W}'`;
  const r = await run(`[{ at: 0, ${cb} }, { at: END - 2, ${cb} }]`, REST_CURSOR);
  const t = kinds(r, 'text');
  assert.equal(t.length, 1, JSON.stringify(r.issues));
  assert.equal(t[0].how, 'clipped');
  assert.match(frameIssueText(t[0]), /^beats 0-7\.5: text "W{24}…" is cut off by \d+ px$/);
});

// Faded text: a button continuation from a long label to a short one fades the long label out from beat 4 while
// the shape shrinks under it, so it runs well past the shape as it goes. At beat 4.2 its opacity times its
// ancestors' is about 0.02 (under the 0.05 cut-off, not zero): nearly invisible, so not reported; at beat 4 it is
// still fully shown and is (the control). measure() is what checkFrames runs at each sample.
test('text nearly faded out is ignored; the same text fully shown is reported', async () => {
  const long = 'A very long label that goes on and on well past any reasonable width for a button';
  await scene({ bars: 2, states: `[${REST}, { at: 2, use: 'button', label: '${long}' }, { at: 4, use: 'button', label: 'Get started' }, ${BACK}]`, cursor: REST_CURSOR }, async (s, at, bs) => {
    const texts = async (beat) => (await s.page.evaluate(measure, beat * bs)).texts.filter((x) => x.text === long);
    // The fading label in the page: past the shape, with an opacity product between 0 and 0.05.
    const fading = (beat) => s.page.evaluate((t) => {
      window.seek(t);
      const e = document.querySelector('.c-button[data-row="2"] .btn-prev .btn-label'), shape = document.querySelector('#shape');
      let o = 1;
      for (let a = e; a && a !== shape.parentElement; a = a.parentElement) o *= Number(getComputedStyle(a).opacity);
      const r = e.getBoundingClientRect(), b = shape.getBoundingClientRect();
      return { o, past: Math.max(b.left - r.left, r.right - b.right) };
    }, beat * bs);
    const f = await fading(4.2);
    assert.ok(f.o > 0 && f.o < 0.05 && f.past > 50, `the scenario holds at beat 4.2: ${JSON.stringify(f)}`);
    assert.deepEqual(await texts(4.2), []);
    const shown = await texts(4);
    assert.equal(shown.length, 1, JSON.stringify(shown));
    assert.ok(shown[0].over >= 1, JSON.stringify(shown));
  });
});

// A label slot as tall as the shape is not text past the shape: only the words' own line boxes count. Both were
// false warnings measured on the element box (Dashboard tour, Settings change, demo 04).
test('the shape settling a px short of a full-height label slot is not text past its shape', async () => {
  // bar-chart -> tabs: the height spring dips about 3 px under the tabs' 100 px while the tab slots are 100 px.
  const bars = "[{ label: 'Mon', value: 32 }, { label: 'Tue', value: 41 }, { label: 'Wed', value: 38 }]";
  const r = await run(`[{ at: 0, use: 'bar-chart', label: 'Orders', bars: ${bars} }, { at: 2, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Day' }, { at: END - 2, use: 'bar-chart', label: 'Orders', bars: ${bars} }]`, REST_CURSOR);
  assert.deepEqual(kinds(r, 'text'), []);
});

test('a label sliding in inside a full-height slot is not text past its shape', async () => {
  // button -> status: the status label's slot slides up 10 px as it enters, its box briefly past the bottom edge.
  const r = await run(`[${REST}, { at: 2, use: 'status', level: 'warn', text: 'Syncing' }, ${BACK}]`, REST_CURSOR);
  assert.deepEqual(kinds(r, 'text'), []);
});

// Pending media: a page whose seek(t) returns a promise (a footage frame still decoding) is measured only once that
// promise settles. Here the page's seek adds a long label past the shape 50 ms after seeking; measured without the
// await, the label would not exist yet.
test('measure awaits the promise seek returns before measuring', async () => {
  await scene({ bars: 2, states: `[${REST}, ${BACK}]`, cursor: REST_CURSOR }, async (s) => {
    await s.page.evaluate(() => {
      const seek = window.seek;
      window.seek = (t) => {
        seek(t);
        document.querySelector('#late')?.remove();
        return new Promise((r) => setTimeout(() => {
          const d = document.createElement('div');
          d.id = 'late'; d.textContent = 'Late text '.repeat(40);
          d.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap';
          document.querySelector('#shape').append(d);
          r();
        }, 50));
      };
    });
    const got = await s.page.evaluate(measure, 0);
    assert.ok(got.texts.some((x) => x.text.startsWith('Late text')), JSON.stringify(got.texts));
  });
});
