// components-controls.test.mjs -- behaviour of the Controls group in a real page (button has its own file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, openScene } from './harness.mjs';
import { beatStills } from '../scripts/beat_stills.mjs';

// Open a project, hand the test a seek-by-beat helper, and always close the browser.
async function scene(opts, fn) {
  const s = await openScene(makeProject(opts));
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    await fn(s, async (beat) => s.seek(beat * bs), bs);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
}
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

// Ruling F: a press in row A, then a continuation row B that states the pressed result, must not flash
// back to A's written state: at B.t0 + 0.05 beat (and later) B shows what A settled on.
async function noFlash({ use, a, b, press, read }) {
  await scene({ bars: 2,
    states: `[{ at: 0, use: '${use}', ${a} }, { at: 2, use: '${use}', ${b} }, { at: END - 2, use: '${use}', ${a} }]`,
    cursor: `[{ at: 0, x: 0, y: 120 }, { at: 0.5, target: '${press}' }, { at: 0.8, target: '${press}', press: true }, { at: END - 2, x: 0, y: 120 }]` }, async (s, at) => {
    await at(1.95);
    const end = await s.page.evaluate(read, 0);
    for (const beat of [2.05, 2.3, 3]) {
      await at(beat);
      assert.deepEqual(await s.page.evaluate(read, 1), end, `${use} row B at beat ${beat} matches the end of row A`);
    }
  });
}
test('toggle: a continuation after a press starts from the flipped knob', async () => {
  await noFlash({ use: 'toggle', a: 'on: false', b: 'on: true', press: 'knob', read: (row) => {
    const k = document.querySelector(`.c-toggle[data-row="${row}"] .tg-knob`), tr = k.parentNode;
    return [Math.round(parseFloat(k.style.left)), Math.round(parseFloat(k.style.width)), tr.style.background];
  } });
});

test('checkbox: a continuation after a press keeps the tick drawn', async () => {
  await noFlash({ use: 'checkbox', a: 'checked: false', b: 'checked: true', press: 'box', read: (row) => {
    const b = document.querySelector(`.c-checkbox[data-row="${row}"] .cb-box`), tick = b.querySelector('.cb-tick');
    return [parseFloat(tick.style.strokeDashoffset) < 0.03, b.style.background, tick.style.opacity];
  } });
});

test('tabs: a continuation after a press keeps the indicator on the pressed tab', async () => {
  await noFlash({ use: 'tabs', a: "active: 'Day'", b: "active: 'Month'", press: 'tab:Month', read: (row) => {
    const i = document.querySelector(`.c-tabs[data-row="${row}"] .tb-ind`);
    return [Math.round(parseFloat(i.style.left)), Math.round(parseFloat(i.style.width))];
  } });
});

test('dropdown: a continuation after a press keeps the pressed item highlighted', async () => {
  await noFlash({ use: 'dropdown', a: "open: true, selected: 'Newest'", b: "open: true, selected: 'Oldest'", press: 'item:Oldest', read: (row) =>
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
