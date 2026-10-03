// components-data.test.mjs -- behaviour of the Data and content group in a real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scene, noFlash } from './harness.mjs';

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
    assert.equal(await text(s, '.c-line-chart .lc-tip'), '13', 'the default format is neutral: no currency');
    assert.ok(await num(s, '.c-line-chart .lc-tip', 'opacity') > 0.95, 'tip shown');
  });
});

// Ruling H: the tooltip follows the cursor rows aimed at points, not the pointer's path, so a pointer passing
// close to point 6 on its way to point 7 never flashes point 6's value.
test('line-chart: travelling to point:7 never shows another point; leaving hides the tooltip', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'point:7' }, { at: 4.5, x: 0, y: 400 }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at, bs) => {
    const seen = await s.page.evaluate(([a, b, bs]) => {
      const out = new Set();
      for (let beat = a; beat <= b + 1e-9; beat += 0.005) { window.seek(beat * bs); out.add(document.querySelector('.c-line-chart .lc-tip').textContent); }
      return [...out];
    }, [2, 4, bs]);
    assert.ok(!seen.includes('9'), `tooltip texts seen: ${seen}`);
    assert.deepEqual(seen.filter(Boolean), ['13']);
    await at(2.99);
    assert.equal(await num(s, '.c-line-chart .lc-tip', 'opacity'), 0, 'hidden before the cursor row');
    await at(4.9);
    assert.ok(await num(s, '.c-line-chart .lc-tip', 'opacity') < 0.01, 'gone once the cursor is aimed elsewhere');
  });
});

test('line-chart: the hover prop pops at +1.6 beats; an out-of-range index shows nothing', async () => {
  await scene({ bars: 4, states: `[${REST}{ at: 2, use: 'line-chart', hover: 3, format: { prefix: '£' } }, { at: 5, use: 'button' }, { at: 6, use: 'line-chart', hover: 20 }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(3.55);
    assert.equal(await num(s, '.c-line-chart[data-row="1"] .lc-tip', 'opacity'), 0, 'not before +1.6 beats');
    await at(4.4);
    assert.ok(await num(s, '.c-line-chart[data-row="1"] .lc-tip', 'opacity') > 0.95, 'up after');
    assert.equal(await text(s, '.c-line-chart[data-row="1"] .lc-tip'), '£8');
    await at(8.5);
    assert.equal(await num(s, '.c-line-chart[data-row="3"] .lc-tip', 'opacity'), 0);
    assert.equal(await text(s, '.c-line-chart[data-row="3"] .lc-tip'), '');
  });
});

test('line-chart: a continuation that drops hover fades the old tooltip out', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart', hover: 3 }, { at: 4, use: 'line-chart' }${BACK}]`, cursor: STILL }, async (s, at) => {
    const op = () => num(s, '.c-line-chart[data-row="2"] .lc-tip', 'opacity');
    await at(4.03);
    const a = await op();
    assert.ok(a > 0.5 && a < 1, `fading, not cut: ${a}`);
    await at(4.6);
    assert.ok(await op() < 0.01, 'gone');
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

test('goal: a continuation that changes the target eases the text with the bar', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'goal', saved: 2000, target: 4000 }, { at: 4, use: 'goal', saved: 2000, target: 8000 }${BACK}]`, cursor: STILL }, async (s, at) => {
    const read = () => s.page.evaluate(() => ({ text: document.querySelector('.c-goal[data-row="2"] .gl-text').textContent,
      w: parseFloat(document.querySelector('.c-goal[data-row="2"] .gl-fill').style.width) }));
    await at(4.02);
    assert.match((await read()).text, /^£2,000 of £4,\d{3} · (50|49)%$/, 'starts on the old target');
    await at(4.6);
    const mid = await read(), m = /of £([\d,]+) · (\d+)%/.exec(mid.text);
    const target = Number(m[1].replace(/,/g, ''));
    assert.ok(target > 4000 && target < 8000, `target easing: ${mid.text}`);
    assert.ok(Math.abs(mid.w / 664 - 2000 / target) < 0.01, `bar agrees with text: ${mid.w} vs ${mid.text}`);
    await at(5.9);
    assert.equal((await read()).text, '£2,000 of £8,000 · 25%');
  });
});

// Follow-up: the engine carries the cursor's aim across a continuation, so a hovered point stays hovered.
test('line-chart: a point hovered before a continuation keeps its tooltip across the new row', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart' }, { at: 4, use: 'line-chart', label: 'Balance' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'point:7' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at, bs) => {
    const ops = await s.page.evaluate(([a, b, bs]) => {
      const out = [];
      for (let beat = a; beat <= b + 1e-9; beat += 0.01) {
        window.seek(beat * bs);
        const tip = [...document.querySelectorAll('.c-line-chart .lc-tip')].find((e) => Number(e.closest('.layer').style.opacity) > 0.5);
        out.push([beat.toFixed(2), Number(tip.style.opacity), tip.textContent]);
      }
      return out;
    }, [3.9, 4.4, bs]);
    for (const [beat, o, txt] of ops) assert.ok(o > 0.95 && txt === '13', `tooltip kept at beat ${beat}: ${o} ${txt}`);
  });
});

test('line-chart: moving from point A to point B fades A out while B pops in', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'point:2' }, { at: 4.5, target: 'point:5' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    await at(4.6);   // 0.1 beat after the aim moves: both visible
    const tips = await s.page.evaluate(() => [...document.querySelectorAll('.c-line-chart .lc-tip, .c-line-chart .lc-tip-out')].map((e) => [e.textContent, Number(e.style.opacity)]));
    const a = tips.find(([t]) => t === '5'), b = tips.find(([t]) => t === '10');   // default points: [4,6,5,8,7,10,9,13]
    assert.ok(a && a[1] > 0.05 && a[1] < 0.95, `A fading: ${JSON.stringify(tips)}`);
    assert.ok(b && b[1] > 0.05, `B popping: ${JSON.stringify(tips)}`);
    await at(4.8);
    const out = await s.page.evaluate(() => Number(document.querySelector('.c-line-chart .lc-tip-out').style.opacity));
    assert.ok(out < 0.01, 'A gone after 0.2 beat');
  });
});

test('line-chart: hopping between points faster than they pop never flashes the outgoing point', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'point:1' }, { at: 3.25, target: 'point:3' }, { at: 3.5, target: 'point:5' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at, bs) => {
    const rows = await s.page.evaluate((bs) => {
      const out = [];
      for (let j = 0; j <= 120; j++) {
        const beat = 2.9 + j / 100;
        window.seek(beat * bs);
        const cur = document.querySelector('.c-line-chart .lc-tip'), o = document.querySelector('.c-line-chart .lc-tip-out');
        out.push([beat.toFixed(2), cur.textContent, Number(cur.style.opacity), o.textContent, Number(o.style.opacity)]);
      }
      return out;
    }, bs);
    const last = {};   // each point's tooltip opacity the last time it was the current one
    let prev = null;
    for (const [beat, ct, co, ot, oo] of rows) {
      if (ot && prev && prev[3] === ot) assert.ok(oo - prev[4] <= 0.05, `outgoing ${ot} rises at ${beat}: ${prev[4]} -> ${oo}`);
      if (ot) assert.ok(oo <= (last[ot] ?? 0) + 0.02, `outgoing ${ot} at ${beat} is ${oo}, above its ${last[ot]} at the switch`);
      if (ct) last[ct] = co;
      prev = [beat, ct, co, ot, oo];
    }
    assert.ok(rows.some(([, , , ot, oo]) => ot === '6' && oo > 0.05), 'point 1 is seen fading out');
  });
});

test('line-chart: leaving the point the hover prop already shows keeps its tooltip up', async () => {
  await scene({ bars: 4, states: `[${REST}{ at: 2, use: 'line-chart', hover: 4 }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'point:4' }, { at: 4.5, x: 0, y: 400 }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    for (const b of [4.5, 4.6, 4.7, 4.8, 5]) { await at(b); assert.ok(await num(s, '.c-line-chart .lc-tip', 'opacity') > 0.95, `kept at ${b}`); }
  });
});

test('line-chart: a hover prop taking over from a faded cursor hover fades in, not snaps', async () => {
  await scene({ bars: 4, states: `[${REST}{ at: 2, use: 'line-chart', hover: 4 }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'point:1' }, { at: 4.5, x: 0, y: 400 }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at, bs) => {
    // the cursor hover fades out from 4.5 over 0.2 beat; the hover prop (due at 3.6) then fades in
    const o = [];
    for (const b of [4.71, 4.8, 4.9, 5.2]) { await at(b); o.push(await num(s, '.c-line-chart .lc-tip', 'opacity')); }
    assert.ok(o[0] < 0.5, `starts low, got ${o}`);
    assert.ok(o[3] > 0.95, `reaches full, got ${o}`);
    assert.ok(o[1] <= o[2] && o[2] <= o[3], `rises, got ${o}`);
    // the four samples above miss a snap between them: no 0.01 beat step may jump the tooltip up by more than 0.2
    const steps = await s.page.evaluate((bs) => {
      const out = [];
      for (let beat = 4.5; beat <= 5.2 + 1e-9; beat += 0.01) { window.seek(beat * bs); out.push(Number(document.querySelector('.c-line-chart .lc-tip').style.opacity)); }
      return out;
    }, bs);
    const jump = Math.max(...steps.slice(1).map((v, j) => v - steps[j]));
    assert.ok(jump < 0.2, `fades in without a snap, largest step ${jump}`);
  });
});

test('goal: a continuation from a zero target never shows a runaway percentage', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'goal', saved: 2450, target: 0 }, { at: 4, use: 'goal', saved: 2450, target: 4000 }${BACK}]`, cursor: STILL }, async (s, at, bs) => {
    const texts = await s.page.evaluate(([a, b, bs]) => {
      const out = [];
      for (let beat = a; beat <= b + 1e-9; beat += 0.02) { window.seek(beat * bs); out.push(document.querySelector('.c-goal[data-row="2"] .gl-text').textContent); }
      return out;
    }, [4, 5.9, bs]);
    for (const t of texts) {
      const m = /of £([\d,]+) · (\d+)%$/.exec(t);
      assert.ok(m, `reads saved of target: ${t}`);
      assert.equal(m[1], '4,000', `the new target shows at once: ${t}`);
      assert.ok(Number(m[2]) <= 100, `percentage stays sane: ${t}`);
    }
    assert.equal(texts.at(-1), '£2,450 of £4,000 · 61%');
  });
});

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
