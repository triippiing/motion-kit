// components-data.test.mjs -- behaviour of the Data and content group in a real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, openScene } from './harness.mjs';

// Open a project, hand the test a seek-by-beat helper, and always close the browser.
async function scene(opts, fn) {
  const s = await openScene(makeProject(opts));
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    await fn(s, async (beat) => s.seek(beat * bs), bs);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
}
const REST = "{ at: 0, use: 'button' }, ", BACK = ", { at: END - 2, use: 'button' }";
const STILL = '[{ at: 0, x: 0, y: 400 }, { at: END - 2, x: 0, y: 400 }]';
const one = (row) => ({ bars: 2, states: `[${REST}{ at: 2, ${row} }${BACK}]`, cursor: STILL });
const text = (s, sel) => s.page.evaluate((sel) => document.querySelector(sel).textContent, sel);
const num = (s, sel, prop) => s.page.evaluate(([sel, prop]) => parseFloat(document.querySelector(sel).style[prop]), [sel, prop]);

test('card: title, figure and body reach full opacity in that order', async () => {
  await scene(one("use: 'card'"), async (s, at) => {
    const when = {};
    for (let b = 2; b <= 4.5; b += 0.02) {
      await at(b);
      const o = await s.page.evaluate(() => Object.fromEntries(['cd-title', 'cd-figure', 'cd-body'].map((c) => [c, Number(document.querySelector(`.c-card .${c}`).style.opacity)])));
      for (const [k, v] of Object.entries(o)) if (v > 0.99 && !(k in when)) when[k] = b;
    }
    assert.ok(when['cd-title'] < when['cd-figure'] && when['cd-figure'] < when['cd-body'], JSON.stringify(when));
  });
});

test('counter: counts up to fmt(to), counts down when to < from, shows decimals', async () => {
  await scene({ bars: 4, states: `[${REST}{ at: 2, use: 'counter', from: 0, to: 2450 }, { at: 4, use: 'button' }, { at: 5, use: 'counter', from: 100, to: 10, label: 'Left' }, { at: 7, use: 'button' }, { at: 8, use: 'counter', from: 0, to: 12.5, decimals: 2, prefix: '£' }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(3.95);
    assert.equal(await text(s, '.c-counter[data-row="1"] .ct-value'), '2,450');
    const seen = [];
    for (const b of [5.05, 5.2, 5.35, 5.5, 5.8, 6.9]) { await at(b); seen.push(Number(await text(s, '.c-counter[data-row="3"] .ct-value'))); }
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1], `counts down: ${seen}`);
    assert.ok(seen[0] > 90 && seen.at(-1) === 10, `100 down to 10: ${seen}`);
    await at(10);
    assert.equal(await text(s, '.c-counter[data-row="5"] .ct-value'), '£12.50');
  });
});

test('counter: a continuation rolls on from the previous value', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'counter', to: 2450 }, { at: 4, use: 'counter', to: 3100 }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(4.02);
    const v = Number((await text(s, '.c-counter[data-row="2"] .ct-value')).replace(/,/g, ''));
    assert.ok(v >= 2450 && v < 2500, `starts from 2,450: ${v}`);
    await at(5.9);
    assert.equal(await text(s, '.c-counter[data-row="2"] .ct-value'), '3,100');
  });
});

test('line-chart: the path draws on and targeting point:7 shows its value', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'point:7' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    await at(2.05);
    assert.ok(await num(s, '.c-line-chart .lc-line', 'strokeDashoffset') > 0.97, 'undrawn at the start');
    await at(4.2);
    assert.ok(await num(s, '.c-line-chart .lc-line', 'strokeDashoffset') < 0.02, 'drawn');
    assert.equal(await text(s, '.c-line-chart .lc-tip'), '£13');
    assert.ok(await num(s, '.c-line-chart .lc-tip', 'opacity') > 0.95, 'tip shown');
  });
});

test('line-chart: a continuation morphs from the previous line without redrawing', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart', points: [1, 2, 3] }, { at: 4, use: 'line-chart', points: [3, 2, 1, 4] }${BACK}]`, cursor: STILL }, async (s, at) => {
    const d = () => s.page.evaluate(() => document.querySelector('.c-line-chart[data-row="2"] .lc-line').getAttribute('d'));
    await at(4.01);
    assert.ok(await num(s, '.c-line-chart[data-row="2"] .lc-line', 'strokeDashoffset') < 0.001, 'already drawn');
    const a = await d();
    await at(5.9);
    const b = await d();
    assert.notEqual(a, b, 'the line moves');
    const ys = b.match(/[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1);
    assert.equal(ys.length, 4);
    assert.ok(ys[3] < ys[0] && ys[0] < ys[2], `ends on the new shape: ${ys}`);
  });
});

test('bar-chart: settled heights are proportional to the values; an empty chart renders', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'bar-chart' }, { at: 4, use: 'bar-chart', bars: [] }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(3.95);
    const h = await s.page.evaluate(() => [...document.querySelectorAll('.c-bar-chart[data-row="1"] .bc-bar')].map((e) => parseFloat(e.style.height)));
    const v = [3, 5, 4, 7];
    assert.equal(h.length, 4);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(h[i] / v[i] - h[3] / 7) < 0.5, `heights ${h}`);
    await at(5);
  });
});

test('list: rows enter in order; a press on row:1 highlights row 1 only', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'list' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'row:1' }, { at: 3.5, target: 'row:1', press: true }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    const rows = () => s.page.evaluate(() => [...document.querySelectorAll('.c-list .ls-row')].map((e) => ({ o: Number(e.style.opacity), hl: e.classList.contains('ls-hl') })));
    await at(2.25);
    const mid = await rows();
    assert.ok(mid[0].o > mid[1].o && mid[1].o > mid[2].o, `stagger: ${JSON.stringify(mid)}`);
    await at(3.3);
    assert.deepEqual((await rows()).map((r) => r.hl), [false, false, false]);
    await at(4.2);
    assert.deepEqual((await rows()).map((r) => r.hl), [false, true, false]);
  });
});

test('calendar: real weekdays from the ISO date; a mid-week date shows its Monday-started week', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'calendar', week: '2026-03-23' }, { at: 4, use: 'calendar', week: '2026-03-26' }${BACK}]`, cursor: STILL }, async (s, at) => {
    const days = (row) => s.page.evaluate((row) => [...document.querySelectorAll(`.c-calendar[data-row="${row}"] .cl-day`)].map((e) => `${e.querySelector('.cl-wd').innerText} ${e.querySelector('.cl-date').innerText}`), row);
    await at(3.5);
    const want = ['MON 23', 'TUE 24', 'WED 25', 'THU 26', 'FRI 27', 'SAT 28', 'SUN 29'];
    assert.deepEqual(await days(1), want);
    await at(5.5);
    assert.deepEqual(await days(2), want);
  });
});

test('sparkline: the last point dot pops to full size', async () => {
  await scene(one("use: 'sparkline'"), async (s, at) => {
    const scale = () => s.page.evaluate(() => Number(/scale\(([-\d.e]+)\)/.exec(document.querySelector('.c-sparkline .sp-dot').style.transform)[1]));
    await at(2.1);
    assert.ok(await scale() < 0.01, 'hidden at the start');
    await at(4.5);
    assert.ok(Math.abs(await scale() - 1) < 0.01, `popped: ${await scale()}`);
  });
});

test('goal: the text reads saved of target with the percentage; met on the house theme falls back to accent', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'goal' }, { at: 4, use: 'goal', saved: 4000, met: true }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(3.95);
    assert.equal(await text(s, '.c-goal[data-row="1"] .gl-text'), '£2,450 of £4,000 · 61%');
    await at(4.02);
    const early = await text(s, '.c-goal[data-row="2"] .gl-text');
    assert.match(early, /^£2,[45]\d\d of £4,000 · 6[12]%$/, 'a continuation fills from the old value');
    await at(5.9);
    assert.equal(await text(s, '.c-goal[data-row="2"] .gl-text'), '£4,000 of £4,000 · 100%');
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-goal[data-row="2"] .gl-fill').style.background), 'var(--accent)');
    assert.ok(await num(s, '.c-goal[data-row="2"] .gl-chip', 'opacity') > 0.99, 'check chip shown');
  });
});

// A press in row A, then a continuation row B that states the pressed result, must not flash back.
async function noFlash({ use, a, b, press, read }) {
  await scene({ bars: 2,
    states: `[{ at: 0, use: '${use}', ${a} }, { at: 2, use: '${use}', ${b} }, { at: END - 2, use: '${use}', ${a} }]`,
    cursor: `[{ at: 0, x: 0, y: 400 }, { at: 0.5, target: '${press}' }, { at: 0.8, target: '${press}', press: true }, { at: END - 2, x: 0, y: 400 }]` }, async (s, at) => {
    await at(1.95);
    const end = await s.page.evaluate(read, 0);
    for (const beat of [2.05, 2.3, 3]) {
      await at(beat);
      assert.deepEqual(await s.page.evaluate(read, 1), end, `${use} row B at beat ${beat} matches the end of row A`);
    }
  });
}
test('list: a continuation after a press keeps the pressed row highlighted', async () => {
  await noFlash({ use: 'list', a: 'highlight: -1', b: 'highlight: 2', press: 'row:2', read: (row) =>
    [...document.querySelectorAll(`.c-list[data-row="${row}"] .ls-row`)].map((e) => [e.classList.contains('ls-hl'), e.style.background]) });
});

test('calendar: a continuation after a press keeps the pressed day selected', async () => {
  await noFlash({ use: 'calendar', a: 'selected: -1', b: 'selected: 4', press: 'day:4', read: (row) =>
    [...document.querySelectorAll(`.c-calendar[data-row="${row}"] .cl-day`)].map((e) => [e.classList.contains('cl-sel'), e.style.borderColor]) });
});

test('bar-chart: a continuation after a press keeps the pressed bar highlighted', async () => {
  await noFlash({ use: 'bar-chart', a: "highlight: ''", b: "highlight: 'Wed'", press: 'bar:Wed', read: (row) =>
    [...document.querySelectorAll(`.c-bar-chart[data-row="${row}"] .bc-bar`)].map((e) => [e.classList.contains('bc-hl'), e.style.background]) });
});
