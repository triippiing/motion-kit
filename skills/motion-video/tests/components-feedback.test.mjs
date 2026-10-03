// components-feedback.test.mjs -- behaviour of the Feedback group in a real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, openScene, scene } from './harness.mjs';
import { beatStills } from '../scripts/beat_stills.mjs';

const REST = "{ at: 0, use: 'button' }, ", BACK = ", { at: END - 2, use: 'button' }";
const STILL = '[{ at: 0, x: 0, y: 200 }, { at: END - 2, x: 0, y: 200 }]';
const rect = (s, sel) => s.page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, w: r.width, cx: r.left + r.width / 2 }; }, sel);

test('loader: the spinner turns 90 degrees in 0.2 s', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'loader' }${BACK}]`, cursor: STILL }, async (s, at, bs) => {
    const angle = async (t) => { await s.seek(t); return s.page.evaluate(() => parseFloat(/rotate\(([-\d.e]+)deg\)/.exec(document.querySelector('.c-loader .ld-arc').style.transform)[1])); };
    const t = 3 * bs, a = await angle(t), b = await angle(t + 0.2);
    assert.ok(Math.abs((((b - a) % 360) + 360) % 360 - 90) < 0.01, `${a} -> ${b}`);
  });
});

test('loader: dots fade in turn and stay a pure function of t', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'loader', style: 'dots' }${BACK}]`, cursor: STILL }, async (s, at) => {
    const read = () => s.page.evaluate(() => [...document.querySelectorAll('.c-loader .ld-dot')].map((d) => Number(d.style.opacity)));
    await at(3);
    const a = await read();
    assert.equal(a.length, 3);
    for (const o of a) assert.ok(o >= 0.35 - 1e-9 && o <= 1, `opacity in range: ${a}`);
    assert.ok(new Set(a.map((o) => o.toFixed(3))).size > 1, `dots out of phase: ${a}`);
    await at(5); await at(3);
    assert.deepEqual(await read(), a);
  });
});

test('check: the tick draws on after the row starts', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'check', label: 'Paid' }${BACK}]`, cursor: STILL }, async (s, at) => {
    const offset = () => s.page.evaluate(() => parseFloat(document.querySelector('.c-check .ck-tick').style.strokeDashoffset));
    await at(2.1);
    assert.ok(await offset() > 0.97, `undrawn at the start: ${await offset()}`);
    await at(3.5);
    assert.ok(await offset() < 0.02, `drawn 1.5 beats in: ${await offset()}`);
  });
});

test('check: a check -> button -> check loop passes the seam check', async () => {
  const dir = makeProject({ bars: 4, states: "[{ at: 0, use: 'check', label: 'Payment sent' }, { at: 4, use: 'button' }, { at: END - 2, use: 'check', label: 'Payment sent' }]", cursor: STILL });
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});

test('toast: the action hotspot sits right of centre', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'toast', text: 'Moved to archive', action: 'Undo' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 200 }, { at: 3, target: 'action' }, { at: END - 2, x: 0, y: 200 }]" }, async (s, at, bs) => {
    const { x, W } = await s.page.evaluate((t) => ({ x: window.inspect(t).cursor.x, W: window.STAGE.width }), 3.9 * bs);
    assert.ok(x > W / 2 + 40, `cursor at ${x} on a ${W} stage`);
  });
});

test('toast: targeting action on a toast without one is a clear error', async () => {
  const dir = makeProject({ bars: 2, states: `[${REST}{ at: 2, use: 'toast' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 200 }, { at: 3, target: 'action' }, { at: END - 2, x: 0, y: 200 }]" });
  // Validation catches it before anything renders, and says what the toast does have.
  await assert.rejects(openScene(dir), /hotspot "action" at beat 3 does not resolve on toast at beat 3 \(it has: toast\)/);
});

test('toast: a continuation with new text crossfades it', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'toast', text: 'Uploading' }, { at: 4, use: 'toast', text: 'Uploaded' }${BACK}]`, cursor: STILL }, async (s, at) => {
    const read = () => s.page.evaluate(() => [...document.querySelectorAll('.c-toast[data-row="2"] .ts-row')].map((e) => [e.textContent, Number(e.style.opacity)]));
    await at(4.02);
    const a = await read();
    assert.deepEqual(a.map((x) => x[0]), ['Uploading', 'Uploaded']);
    assert.ok(a[0][1] > 0.8 && a[1][1] < 0.1, `old text still up at the start: ${JSON.stringify(a)}`);
    await at(5.5);
    const b = await read();
    assert.ok(b[0][1] < 0.01 && b[1][1] > 0.99, `new text in: ${JSON.stringify(b)}`);
  });
});

test('progress: the fill reaches the value and the percentage reads it', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'progress' }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(2.1);
    assert.ok((await rect(s, '.c-progress .pg-fill')).w < 30, 'fills from empty');
    await at(4);
    const w = (await rect(s, '.c-progress .pg-fill')).w / await s.page.evaluate(() => { const z = /scale\(([^)]+)\)/.exec(document.querySelector('#camera').style.transform)[1]; return Number(z); });
    assert.ok(Math.abs(w - 0.62 * 560) <= 2, `fill ${w}`);
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-progress .pg-pct').textContent), '62%');
  });
});

test('progress: a continuation animates the fill from the previous value', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'progress', value: 0.3 }, { at: 4, use: 'progress', value: 0.8 }${BACK}]`, cursor: STILL }, async (s, at) => {
    const pct = () => s.page.evaluate(() => document.querySelector('.c-progress[data-row="2"] .pg-pct').textContent);
    // just after the continuation starts, the fill is still near the previous value (a cue a few ms early
    // reads 31%), not 0 or 80
    await at(4.02);
    const n = parseInt(await pct(), 10);
    assert.ok(n >= 30 && n <= 35, `${n}%`);
    await at(5.8);
    assert.equal(await pct(), '80%');
  });
});

test('status: ok on the house theme (no pos) uses the accent and renders cleanly', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'status', level: 'ok' }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(3);
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-status .st-dot').style.background), 'var(--accent)');
  });
});

test('status: a warning dot pulses; an ok dot does not', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'status', level: 'warn', text: 'Retrying' }, { at: 4, use: 'status', level: 'ok' }${BACK}]`, cursor: STILL }, async (s, at, bs) => {
    const scale = async (row, t) => { await s.seek(t); return s.page.evaluate((row) => document.querySelector(`.c-status[data-row="${row}"] .st-dot`).style.transform, row); };
    const t = 3 * bs;
    assert.notEqual(await scale(1, t), await scale(1, t + 0.6), 'warn pulses');
    assert.equal(await scale(2, 5 * bs), await scale(2, 5 * bs + 0.6), 'ok holds still');
  });
});

// Ruling G: periodic motion fits a whole number of cycles into the loop, so a loop that starts and ends on
// a spinner or pulse matches at the seam even when the loop is not a multiple of the nominal period.
for (const [what, row] of [['loader (spinner)', "use: 'loader'"], ['loader (dots)', "use: 'loader', style: 'dots'"], ['status (warn)', "use: 'status', level: 'warn'"]]) {
  test(`${what}: a 4-bar loop at 128 bpm starting and ending on it passes the seam check`, async () => {
    const dir = makeProject({ bars: 4, bpm: 128, states: `[{ at: 0, ${row} }, { at: 6, use: 'button' }, { at: END - 2, ${row} }]`, cursor: STILL });
    const r = await beatStills(dir);
    assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
  });
}

test('badge: the same count on consecutive rows stays put across the change', async () => {
  await scene({ bars: 2, states: `[{ at: 0, use: 'button' }, { at: 2, use: 'button', badge: 3 }, { at: 4, use: 'button', label: 'Next', badge: 3 }, { at: END - 2, use: 'button' }]`, cursor: STILL }, async (s, at) => {
    for (const b of [3.5, 3.9, 4.0, 4.1, 4.3]) {
      await at(b);
      const o = await s.page.evaluate(() => Math.max(...[...document.querySelectorAll('.mk-badge')].map((e) => Number(e.style.opacity))));
      assert.ok(o > 0.99, `badge fully shown at beat ${b}, got ${o}`);
    }
  });
});

test('badge: a changed count keeps the bubble and pops the number', async () => {
  await scene({ bars: 2, states: `[{ at: 0, use: 'button' }, { at: 2, use: 'button', badge: 3 }, { at: 4, use: 'button', label: 'Next', badge: 4 }, { at: END - 2, use: 'button' }]`, cursor: STILL }, async (s, at) => {
    const shown = () => s.page.evaluate(() => [...document.querySelectorAll('.mk-badge')].filter((e) => Number(e.style.opacity) > 0.5).map((e) => [e.textContent, e.style.transform]));
    await at(3.9); assert.deepEqual((await shown()).map(([t]) => t), ['3']);
    await at(4.1);
    const s1 = await shown();
    assert.deepEqual(s1.map(([t]) => t), ['4'], 'the new count is on at once');
    assert.match(s1[0][1], /scale\((1\.0[5-9]|1\.1\d*)/, 'and pops (scale above 1)');
    await at(4.6); assert.match((await shown())[0][1], /scale\(1\)/, 'settled');
  });
});
