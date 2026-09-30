// components-chrome.test.mjs -- behaviour of the App chrome group in a real page.
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
const REST = "{ at: 0, use: 'button' }, ", BACK = ", { at: END - 2, use: 'button' }";
const STILL = '[{ at: 0, x: 0, y: 400 }, { at: END - 2, x: 0, y: 400 }]';
const text = (s, sel) => s.page.evaluate((sel) => document.querySelector(sel).textContent, sel);
const num = (s, sel, prop) => s.page.evaluate(([sel, prop]) => parseFloat(document.querySelector(sel).style[prop]), [sel, prop]);
const cursorX = (s, beat, bs) => s.page.evaluate((t) => window.inspect(t).cursor.x, beat * bs);

test('player: a press on play brings the pause icon to full opacity', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'player' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'play' }, { at: 3, target: 'play', press: true }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at, bs) => {
    await at(2.9);
    assert.equal(await num(s, '.c-player .pl-pause', 'opacity'), 0, 'paused before the press');
    assert.equal(await num(s, '.c-player .pl-play', 'opacity'), 1);
    await at(4.2);
    assert.equal(await num(s, '.c-player .pl-pause', 'opacity'), 1, 'pause icon shown after the press');
    assert.equal(await num(s, '.c-player .pl-play', 'opacity'), 0);
    // Playing: the position runs on with the clock (1.5 beats = 0.75 s of a 214 s track).
    const a = await num(s, '.c-player .pl-fill', 'width');
    await at(5.7);
    const b = await num(s, '.c-player .pl-fill', 'width'), want = (1.5 * bs / 214) * 528;
    assert.ok(Math.abs(b - a - want) < 0.05, `position advances while playing: ${a} -> ${b} (want +${want})`);
  });
});

test('player: dragging the thumb moves the elapsed time', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'player' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'thumb' }, { at: 3, target: 'thumb', press: 'down' }, { at: 3.5, target: 'thumb', dx: 200 }, { at: 4.5, target: 'thumb', dx: 200, press: 'up' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    const secs = async () => { const [m, ss] = (await text(s, '.c-player .pl-elapsed')).split(':').map(Number); return m * 60 + ss; };
    await at(2.9);
    const before = await secs();
    assert.equal(before, Math.floor(0.25 * 214), 'starts at position');
    await at(5.5);
    const after = await secs();
    assert.ok(after > before + 40, `dragged right: ${before}s -> ${after}s`);
  });
});

test('player: a continuation after a press keeps playing (no flash back to paused)', async () => {
  await noFlash({ use: 'player', a: 'playing: false', b: 'playing: true', press: 'play', read: (row) =>
    ['.pl-play', '.pl-pause'].map((c) => document.querySelector(`.c-player[data-row="${row}"] ${c}`).style.opacity) });
});

test('player: a continuation carries the position on, or seeks when it writes a new one', async () => {
  await scene({ bars: 3, states: `[${REST}{ at: 2, use: 'player', playing: true }, { at: 4, use: 'player', playing: true }, { at: 6, use: 'player', playing: true, position: 1 }${BACK}]`, cursor: STILL }, async (s, at) => {
    const el = (row) => text(s, `.c-player[data-row="${row}"] .pl-elapsed`);
    await at(3.98);
    const a = await el(1);
    await at(4.02);
    assert.equal(await el(2), a, 'carries on from where playback got to');
    await at(6.02);
    assert.equal(await el(3), '3:34', 'seeks to the written position');
  });
});

test('island: the waveform bars move with t and are a pure function of it', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'island' }${BACK}]`, cursor: STILL }, async (s, at, bs) => {
    const bars = async (t) => { await s.seek(t); return s.page.evaluate(() => [...document.querySelectorAll('.c-island .is-bar')].map((e) => parseFloat(e.style.height))); };
    const t = 4 * bs, a = await bars(t), b = await bars(t + 0.1);
    assert.equal(a.length, 4);
    assert.notDeepEqual(a, b, 'heights change over 0.1 s');
    for (const h of [...a, ...b]) assert.ok(h >= 10 && h <= 28, `height in 10..28: ${h}`);
    await bars(0.5);
    assert.deepEqual(await bars(t), a, 'same t, same heights');
  });
});

// Ruling G: the waveform is periodic motion, so a loop that starts and ends on the island matches at the seam.
test('island: a 4-bar loop at 128 bpm starting and ending on it passes the seam check', async () => {
  const dir = makeProject({ bars: 4, bpm: 128, states: "[{ at: 0, use: 'island' }, { at: 6, use: 'button' }, { at: END - 2, use: 'island' }]", cursor: STILL });
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});

test('command: typing "exp" leaves only the two Export rows open; one key sound per character', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'command', query: 'exp', typeAt: 0.5, perChar: 0.25 }${BACK}]`, cursor: STILL }, async (s, at) => {
    const rows = () => s.page.evaluate(() => [...document.querySelectorAll('.c-command .cm-row')].map((e) => [e.dataset.item, parseFloat(e.style.height)]));
    await at(2.4);
    assert.ok((await rows()).every(([, h]) => h > 79), 'all rows open before typing');
    await at(5);
    const open = (await rows()).filter(([, h]) => h > 0).map(([n]) => n);
    assert.deepEqual(open, ['Export report', 'Export CSV']);
    assert.equal(await text(s, '.c-command .cm-text'), 'exp');
    const keys = await s.page.evaluate(() => window.SFX.filter((x) => x.file === 'sfx/key.wav').map((x) => x.beat));
    assert.deepEqual(keys, [2.5, 2.75, 3]);
  });
});

test('command: a query that matches nothing shows No results', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'command', query: 'zz', typeAt: 0.5 }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(2.4);
    assert.equal(await num(s, '.c-command .cm-empty', 'opacity'), 0, 'hidden while rows show');
    await at(4.5);
    assert.equal(await num(s, '.c-command .cm-empty', 'opacity'), 1);
  });
});

test('command: a press on row:1 selects the second visible row', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'command', query: 'exp' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'row:1' }, { at: 3, target: 'row:1', press: true }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    const sel = () => s.page.evaluate(() => [...document.querySelectorAll('.c-command .cm-row.cm-sel')].map((e) => e.dataset.item));
    await at(2.9);
    assert.deepEqual(await sel(), ['Export report']);
    await at(4);
    assert.deepEqual(await sel(), ['Export CSV']);
  });
});

test('command: a continuation after a press keeps the pressed row selected', async () => {
  await noFlash({ use: 'command', a: 'selected: 0', b: 'selected: 2', press: 'row:2', read: (row) =>
    [...document.querySelectorAll(`.c-command[data-row="${row}"] .cm-row`)].map((e) => [e.classList.contains('cm-sel'), e.style.background]) });
});

test('dock: the pill settles on the pressed item; a quick reversal stays inside the dock and never below 0.75 item wide', async () => {
  await scene({ bars: 3, states: "[{ at: 0, use: 'dock' }, { at: END - 2, use: 'dock' }]",
    cursor: "[{ at: 0, x: 0, y: 200 }, { at: 1, target: 'item:Settings', press: true }, { at: 3, target: 'item:Today', press: true }, { at: 3.3, target: 'item:Settings', press: true }, { at: 3.5, target: 'item:Plan', press: true }, { at: END - 2, x: 0, y: 200 }]" }, async (s, at) => {
    const read = () => s.page.evaluate(() => {
      const root = document.querySelector('.c-dock[data-row="0"] .dk'), pill = root.querySelector('.dk-pill'), it = root.querySelector('.dk-item[data-item="Settings"]');
      return { l: parseFloat(pill.style.left), w: parseFloat(pill.style.width), il: parseFloat(it.style.left), iw: parseFloat(it.style.width), W: parseFloat(root.style.width) };
    });
    await at(2.5);
    const a = await read();
    assert.ok(Math.abs(a.l - (a.il + 6)) < 0.5 && Math.abs(a.w - (a.iw - 12)) < 0.5, `settled on Settings: ${JSON.stringify(a)}`);
    for (let b = 3; b < 5.5; b += 0.02) {
      await at(b);
      const e = await read();
      assert.ok(e.l >= 12 - 1e-6 && e.l + e.w <= e.W - 12 + 1e-6, `inside the dock at beat ${b.toFixed(2)}: ${JSON.stringify(e)}`);
      assert.ok(e.w >= 0.75 * 140 - 1e-6, `at least 0.75 item wide at beat ${b.toFixed(2)}: ${e.w}`);
    }
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-dock[data-row="0"] .dk-item.dk-on').dataset.item), 'Plan');
  });
});

test('dock: a continuation after a press keeps the pill on the pressed item', async () => {
  await noFlash({ use: 'dock', a: "active: 'Plan'", b: "active: 'Settings'", press: 'item:Settings', read: (row) => {
    const p = document.querySelector(`.c-dock[data-row="${row}"] .dk-pill`);
    return [Math.round(parseFloat(p.style.left)), Math.round(parseFloat(p.style.width))];
  } });
});

test('sheet: the primary action has the accent background and sits right of Cancel', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'sheet' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'action:Cancel' }, { at: 4, target: 'action:Delete' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at, bs) => {
    await at(3.5);
    const bg = await s.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.c-sheet .sh-action')].map((e) => [e.dataset.label, e.style.background])));
    assert.equal(bg.Delete, 'var(--accent)');
    assert.notEqual(bg.Cancel, 'var(--accent)');
    assert.ok(await cursorX(s, 4.9, bs) > await cursorX(s, 3.9, bs) + 50, 'Delete is right of Cancel');
  });
});

test('banner: the title is fully visible one beat after the row starts', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'banner' }${BACK}]`, cursor: STILL }, async (s, at) => {
    await at(2.1);
    assert.ok(await num(s, '.c-banner .bn-title', 'opacity') < 0.2, 'not yet in');
    await at(3);
    assert.equal(await num(s, '.c-banner .bn-title', 'opacity'), 1);
    assert.equal(await text(s, '.c-banner .bn-title'), 'Payday');
  });
});

test('avatar-stack: the targeted avatar lifts 10px and its neighbours spread', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'avatar-stack' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'avatar:1' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    const off = () => s.page.evaluate(() => [...document.querySelectorAll('.c-avatar-stack .as-av')].map((e) => /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(e.style.transform).slice(1).map(Number)));
    await at(2.9);
    assert.deepEqual((await off()).map(([x, y]) => [Math.round(x), Math.round(y)]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
    await at(4.5);
    const o = await off();
    assert.ok(Math.abs(o[1][1] + 10) < 0.05, `avatar 1 lifted: ${o[1]}`);
    assert.ok(Math.abs(o[0][0] + 8) < 0.05 && Math.abs(o[2][0] - 8) < 0.05, `neighbours spread: ${JSON.stringify(o)}`);
    assert.ok(Math.abs(o[0][1]) < 0.05, 'others stay down');
  });
});

test('chip-row: a single-select press moves the selection; multi-select keeps both', async () => {
  await scene({ bars: 4, states: `[${REST}{ at: 2, use: 'chip-row' }, { at: 6, use: 'button' }, { at: 8, use: 'chip-row', multi: true }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'chip:Bills' }, { at: 3, target: 'chip:Bills', press: true }, { at: 8.5, target: 'chip:Savings' }, { at: 9, target: 'chip:Savings', press: true }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    const on = (row) => s.page.evaluate((row) => [...document.querySelectorAll(`.c-chip-row[data-row="${row}"] .cr-chip.cr-on`)].map((e) => e.dataset.label), row);
    await at(2.9);
    assert.deepEqual(await on(1), ['All']);
    await at(4.5);
    assert.deepEqual(await on(1), ['Bills']);
    assert.equal(await s.page.evaluate(() => document.querySelector('.c-chip-row[data-row="1"] .cr-chip[data-label="Bills"]').style.background), 'var(--accent)');
    await at(10.5);
    assert.deepEqual(await on(3), ['All', 'Savings']);
  });
});

test('chip-row: a continuation after a press keeps the pressed chip selected', async () => {
  await noFlash({ use: 'chip-row', a: "selected: ['All']", b: "selected: ['Fun']", press: 'chip:Fun', read: (row) =>
    [...document.querySelectorAll(`.c-chip-row[data-row="${row}"] .cr-chip`)].map((e) => [e.classList.contains('cr-on'), e.style.background]) });
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
