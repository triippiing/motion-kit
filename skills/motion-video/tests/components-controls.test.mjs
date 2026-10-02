// components-controls.test.mjs -- behaviour of the Controls group in a real page (button has its own file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, openScene, scene, noFlash } from './harness.mjs';
import * as slider from '../components/controls/slider.js';
import { beatStills } from '../scripts/beat_stills.mjs';

const rect = (s, sel) => s.page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, cx: r.left + r.width / 2 }; }, sel);

test('toggle: a press on the knob moves it to the right half and paints the track accent', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'toggle' }, { at: END - 2, use: 'toggle' }]",
    cursor: "[{ at: 0, x: 0, y: 120 }, { at: 1.5, target: 'knob' }, { at: 2, target: 'knob', press: true }, { at: 4, target: 'knob', dx: 76, press: true }, { at: END - 2, x: 0, y: 120 }]" }, async (s, at) => {
    const accent = await s.page.evaluate(() => { const p = document.createElement('div'); p.style.background = 'var(--accent)'; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
    // Knob centre against track centre: the knob sits a quarter of its travel either side at rest.
    const half = async () => { const k = await rect(s, '.c-toggle[data-row="0"] .tg-knob'), tr = await rect(s, '.c-toggle[data-row="0"] .tg-track'); return k.cx > tr.cx + 10 ? 'right' : k.cx < tr.cx - 10 ? 'left' : 'middle'; };
    await at(1.8);
    assert.equal(await half(), 'left', 'off before the press');
    await at(3);
    assert.equal(await half(), 'right', 'on one beat after the press');
    assert.equal(await s.page.evaluate(() => getComputedStyle(document.querySelector('.c-toggle[data-row="0"] .tg-track')).backgroundColor), accent);
  });
});

test('checkbox: the tick draws on after a press on the box', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'checkbox' }, { at: END - 2, use: 'checkbox' }]",
    cursor: "[{ at: 0, x: 0, y: 120 }, { at: 1.5, target: 'box' }, { at: 2, target: 'box', press: true }, { at: END - 2, x: 0, y: 120 }]" }, async (s, at) => {
    const offset = () => s.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.c-checkbox[data-row="0"] .cb-tick')).strokeDashoffset));
    await at(1.8);
    assert.ok(Math.abs(await offset() - 1) < 0.01, 'undrawn before the press');
    await at(3);
    assert.ok(await offset() < 0.03, `drawn one beat after: ${await offset()}`);
  });
});

test('slider: the thumb follows the cursor while dragged; past max the fill settles back to the track within a beat of release', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'slider', value: 0.5 }, { at: END - 2, use: 'slider', value: 0.5 }]",
    cursor: "[{ at: 0, x: 0, y: 160 }, { at: 1, target: 'thumb' }, { at: 1.5, target: 'thumb', press: 'down' }, { at: 2, x: 460, y: 0 }, { at: 3.5, x: 460, y: 0, press: 'up' }, { at: END - 2, x: 0, y: 160 }]" }, async (s, at, bs) => {
    // Thumb minus cursor (screen px) stays constant while the value is inside the track.
    const pairs = [];
    for (const b of [2.05, 2.1, 2.15, 2.2]) {
      await at(b);
      pairs.push({ cx: await s.page.evaluate((t) => window.inspect(t).cursor.x, b * bs), th: (await rect(s, '.c-slider[data-row="0"] .sl-thumb')).cx });
    }
    assert.ok(pairs.at(-1).cx - pairs[0].cx > 20, `the cursor moved: ${JSON.stringify(pairs)}`);
    for (const p of pairs) assert.ok(Math.abs((p.th - p.cx) - (pairs[0].th - pairs[0].cx)) < 1, `thumb follows the cursor: ${JSON.stringify(pairs)}`);
    await at(3.4);
    const track = await rect(s, '.c-slider[data-row="0"] .sl-track'), fill = await rect(s, '.c-slider[data-row="0"] .sl-fill');
    await at(4.5);
    const track1 = await rect(s, '.c-slider[data-row="0"] .sl-track'), fill1 = await rect(s, '.c-slider[data-row="0"] .sl-fill');
    assert.ok(track.w > track1.w + 10, `overstretched while held past max: ${track.w} vs ${track1.w}`);
    assert.ok(Math.abs(fill1.w - track1.w) < 1, `fill back to the full track: ${fill1.w} vs ${track1.w}`);
  });
});

// The slider's props as a row resolves them: meta defaults overridden by the row.
const sliderProps = (row) => ({ ...Object.fromEntries(Object.entries(slider.meta.props).map(([k, v]) => [k, v[1]])), ...row });

test('slider: without a label the geometry and hotspots are what they were before labels', () => {
  const geo = { w: 640, h: 112, r: 56, fill: 'surface', ink: 'ink' };
  for (const row of [{}, { label: '' }, { value: 0, icon: 'none' }, { value: 1 }, { value: 150, min: 0, max: 100, overstretch: false }]) {
    assert.deepEqual(slider.geometry(sliderProps(row)), geo, JSON.stringify(row));
  }
  const at = (row) => { const p = sliderProps(row); return ['thumb', 'track'].map((n) => slider.hotspot(n, p, geo).x); };
  assert.deepEqual(at({}), [-32, 12]);
  assert.deepEqual(at({ value: 0, icon: 'none' }), [-220, 0]);
  assert.deepEqual(at({ value: 1 }), [232, 12]);
  assert.deepEqual(at({ value: 150, min: 0, max: 100 }), [232, 12]);
});

test('slider: a label widens the shape and puts the thumb and track to its right, inside the shape', () => {
  for (const icon of ['volume', 'none']) {
    const p = sliderProps({ label: 'Swing', value: 0.6, min: 0.5, max: 0.75, icon }), geo = slider.geometry(p);
    assert.ok(geo.w > 640, `wider than the bare slider: ${geo.w}`);
    assert.equal(geo.h, 112);
    const labelRight = 36 + 28 * 0.56 * 'Swing'.length - geo.w / 2;
    for (const n of ['thumb', 'track']) {
      const h = slider.hotspot(n, p, geo);
      assert.ok(h && h.x > labelRight && h.x < geo.w / 2, `${icon} ${n} at ${h?.x}, label ends at ${labelRight}, half width ${geo.w / 2}`);
    }
    assert.ok(slider.geometry(sliderProps({ label: 'Swing amount', icon })).w > geo.w, 'a longer label is wider still');
  }
});

test('slider: with a label the text shows left of the track, the cursor lands on the thumb and a drag still moves it', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'slider', value: 0.5, label: 'Swing' }, { at: END - 2, use: 'slider', value: 0.5, label: 'Swing' }]",
    cursor: "[{ at: 0, x: 0, y: 160 }, { at: 0.5, target: 'thumb' }, { at: 1.5, target: 'thumb', press: 'down' }, { at: 2, x: 460, y: 0 }, { at: 3.5, x: 460, y: 0, press: 'up' }, { at: END - 2, x: 0, y: 160 }]" }, async (s, at, bs) => {
    await at(1.45);
    const label = await rect(s, '.c-slider[data-row="0"] .sl-label'), track = await rect(s, '.c-slider[data-row="0"] .sl-track');
    const thumb = await rect(s, '.c-slider[data-row="0"] .sl-thumb'), shape = await rect(s, '.c-slider[data-row="0"]');
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-slider[data-row="0"] .sl-label').textContent), 'Swing');
    assert.ok(label.w > 20 && label.r < track.l, `label ${JSON.stringify(label)} left of the track ${JSON.stringify(track)}`);
    assert.ok(thumb.l > shape.l && thumb.r < shape.r, 'thumb inside the shape');
    const cx = await s.page.evaluate((t) => window.inspect(t).cursor.x, 1.45 * bs);
    assert.ok(Math.abs(cx - thumb.cx) < 2, `cursor on the thumb: ${cx} vs ${thumb.cx}`);
    const pairs = [];
    for (const b of [2.05, 2.1, 2.15, 2.2]) {
      await at(b);
      pairs.push({ cx: await s.page.evaluate((t) => window.inspect(t).cursor.x, b * bs), th: (await rect(s, '.c-slider[data-row="0"] .sl-thumb')).cx });
    }
    assert.ok(pairs.at(-1).th - pairs[0].th > 20, `the thumb moved: ${JSON.stringify(pairs)}`);
    for (const p of pairs) assert.ok(Math.abs((p.th - p.cx) - (pairs[0].th - pairs[0].cx)) < 1, `thumb follows the cursor: ${JSON.stringify(pairs)}`);
    await at(3.4);
    const held = await rect(s, '.c-slider[data-row="0"] .sl-track');
    await at(4.5);
    const back = await rect(s, '.c-slider[data-row="0"] .sl-track'), fill = await rect(s, '.c-slider[data-row="0"] .sl-fill');
    assert.ok(held.w > back.w + 10, `overstretched while held past max: ${held.w} vs ${back.w}`);
    assert.ok(Math.abs(fill.w - back.w) < 1, `fill back to the full track: ${fill.w} vs ${back.w}`);
  });
});

test('slider: a continuation with a new label crossfades old out and new in', async () => {
  const dir = makeProject({ bars: 2,
    states: "[{ at: 0, use: 'slider', value: 0.6, label: 'Swing' }, { at: 2, use: 'slider', value: 0.6, label: 'Tempo' }, { at: END - 2, use: 'slider', value: 0.6, label: 'Swing' }]",
    cursor: '[{ at: 0, x: 0, y: 160 }, { at: END - 2, x: 0, y: 160 }]' });
  const s = await openScene(dir);
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    const labels = () => s.page.evaluate(() => [...document.querySelectorAll('.c-slider[data-row="1"] .sl-label')]
      .map((e) => ({ text: e.textContent, o: Number(e.style.opacity) })));
    await s.seek(2 * bs + 0.12 * bs);
    const mid = await labels();
    assert.deepEqual(mid.map((r) => r.text), ['Swing', 'Tempo']);
    for (const r of mid) assert.ok(r.o > 0 && r.o < 1, `mid-swap opacity of ${r.text}: ${r.o}`);
    await s.seek(3.8 * bs);
    const done = await labels();
    assert.ok(done[0].o < 0.01 && done[1].o > 0.99, `settled: ${JSON.stringify(done)}`);
    assert.equal(await s.page.evaluate(() => document.querySelectorAll('.c-slider[data-row="0"] .sl-label').length), 1, 'row 0 has one label');
    assert.equal(await s.page.evaluate(() => document.querySelectorAll('.c-slider[data-row="2"] .sl-label').length), 2, 'the last row crossfades back');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('slider: no label element without a label', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'slider', value: 0.5 }, { at: END - 2, use: 'slider', value: 0.5, label: '' }]",
    cursor: '[{ at: 0, x: 0, y: 160 }, { at: END - 2, x: 0, y: 160 }]' }, async (s, at) => {
    await at(1);
    assert.equal(await s.page.evaluate(() => document.querySelectorAll('.sl-label').length), 0);
  });
});

test('tabs: the indicator settles on the pressed tab and a quick reversal stays inside the bar', async () => {
  await scene({ bars: 3,
    states: "[{ at: 0, use: 'tabs' }, { at: END - 2, use: 'tabs' }]",
    cursor: "[{ at: 0, x: 0, y: 120 }, { at: 1, target: 'tab:Month', press: true }, { at: 3, target: 'tab:Day', press: true }, { at: 5, target: 'tab:Month', press: true }, { at: 5.2, target: 'tab:Day', press: true }, { at: END - 2, x: 0, y: 120 }]" }, async (s, at) => {
    const read = () => s.page.evaluate(() => {
      const root = document.querySelector('.c-tabs[data-row="0"] .tb'), ind = root.querySelector('.tb-ind'), m = root.querySelector('.tb-tab[data-item="Month"]');
      return { l: parseFloat(ind.style.left), w: parseFloat(ind.style.width), ml: parseFloat(m.style.left), mw: parseFloat(m.style.width), W: parseFloat(root.style.width) };
    });
    await at(2.5);
    const a = await read();
    assert.ok(Math.abs(a.l - a.ml) < 0.5 && Math.abs(a.w - a.mw) < 0.5, `settled on Month: ${JSON.stringify(a)}`);
    for (let b = 5; b < 7; b += 0.02) {
      await at(b);
      const e = await read();
      assert.ok(e.l >= 8 - 1e-6 && e.l + e.w <= e.W - 8 + 1e-6, `inside the bar at beat ${b.toFixed(2)}: ${JSON.stringify(e)}`);
    }
  });
});

test('input: typing shows one character per perChar and plays one key sound per character', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'input' }, { at: 1, use: 'input', text: 'Rent', typeAt: 0.5, perChar: 0.25 }, { at: END - 2, use: 'input' }]",
    cursor: '[{ at: 0, x: 0, y: 120 }, { at: END - 2, x: 0, y: 120 }]' }, async (s, at) => {
    await at(1 + 0.5 + 2.5 * 0.25);
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-input[data-row="1"] .in-text').textContent), 'Ren');
    const keys = await s.page.evaluate(() => window.SFX.filter((x) => x.file === 'sfx/key.wav').map((x) => x.beat));
    assert.deepEqual(keys, [1.5, 1.75, 2, 2.25]);
  });
});

test('dropdown: an open row staggers its items in order; a press highlights the item', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'dropdown' }, { at: 2, use: 'dropdown', open: true }, { at: END - 2, use: 'dropdown' }]",
    cursor: "[{ at: 0, x: 0, y: 120 }, { at: 1.5, target: 'trigger' }, { at: 1.9, target: 'trigger', press: true }, { at: 3.5, target: 'item:Oldest' }, { at: 4, target: 'item:Oldest', press: true }, { at: END - 2, x: 0, y: 120 }]" }, async (s, at) => {
    const items = () => s.page.evaluate(() => [...document.querySelectorAll('.c-dropdown[data-row="1"] .dd-item')].map((e) => ({ o: Number(e.style.opacity), hl: e.classList.contains('dd-hl'), bg: getComputedStyle(e).backgroundColor })));
    await at(2.2);
    const mid = await items();
    assert.ok(mid[0].o > mid[2].o + 0.05, `item 0 ahead of item 2 mid-stagger: ${JSON.stringify(mid)}`);
    await at(3.8);
    assert.equal((await items())[1].hl, false, 'not highlighted before the press');
    await at(4.6);
    const after = await items();
    assert.ok(after[1].hl, 'Oldest highlighted after the press');
    assert.notEqual(after[1].bg, 'rgba(0, 0, 0, 0)');
  });
});

test('input: key sounds stop when the next row starts', async () => {
  await scene({ bars: 2,
    states: "[{ at: 0, use: 'input' }, { at: 1, use: 'input', text: 'abcdef', typeAt: 0, perChar: 0.5 }, { at: 3, use: 'input', text: 'abcdef' }, { at: END - 2, use: 'input' }]",
    cursor: '[{ at: 0, x: 0, y: 120 }, { at: END - 2, x: 0, y: 120 }]' }, async (s) => {
    const keys = await s.page.evaluate(() => window.SFX.filter((x) => x.file === 'sfx/key.wav').map((x) => x.beat));
    assert.deepEqual(keys, [1, 1.5, 2, 2.5]);
  });
});

test('toggle: a continuation after a press starts from the flipped knob', async () => {
  await noFlash({ y: 120, use: 'toggle', a: 'on: false', b: 'on: true', press: 'knob', read: (row) => {
    const k = document.querySelector(`.c-toggle[data-row="${row}"] .tg-knob`), tr = k.parentNode;
    return [Math.round(parseFloat(k.style.left)), Math.round(parseFloat(k.style.width)), tr.style.background];
  } });
});

test('checkbox: a continuation after a press keeps the tick drawn', async () => {
  await noFlash({ y: 120, use: 'checkbox', a: 'checked: false', b: 'checked: true', press: 'box', read: (row) => {
    const b = document.querySelector(`.c-checkbox[data-row="${row}"] .cb-box`), tick = b.querySelector('.cb-tick');
    return [parseFloat(tick.style.strokeDashoffset) < 0.03, b.style.background, tick.style.opacity];
  } });
});

test('tabs: a continuation after a press keeps the indicator on the pressed tab', async () => {
  await noFlash({ y: 120, use: 'tabs', a: "active: 'Day'", b: "active: 'Month'", press: 'tab:Month', read: (row) => {
    const i = document.querySelector(`.c-tabs[data-row="${row}"] .tb-ind`);
    return [Math.round(parseFloat(i.style.left)), Math.round(parseFloat(i.style.width))];
  } });
});

test('dropdown: a continuation after a press keeps the pressed item highlighted', async () => {
  await noFlash({ y: 120, use: 'dropdown', a: "open: true, selected: 'Newest'", b: "open: true, selected: 'Oldest'", press: 'item:Oldest', read: (row) =>
    [...document.querySelectorAll(`.c-dropdown[data-row="${row}"] .dd-item`)].map((e) => [e.classList.contains('dd-hl'), e.style.background, e.style.opacity]) });
});

// Ruling G: the caret blink is periodic motion, so its period fits the loop and its phase is the loop's:
// a finished input as the first and last row matches at the seam even when 1 s does not divide the loop.
test('input: a 4-bar loop at 128 bpm starting and ending on a finished input passes the seam check', async () => {
  const row = "use: 'input', text: 'Bills', typeAt: 0";
  const dir = makeProject({ bars: 4, bpm: 128, states: `[{ at: 0, ${row} }, { at: 6, use: 'button' }, { at: END - 2, ${row} }]`, cursor: '[{ at: 0, x: 0, y: 200 }, { at: END - 2, x: 0, y: 200 }]' });
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});
