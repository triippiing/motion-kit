// button.test.mjs -- the reference component's behaviour in a real page: press kinds and continuations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, openScene } from './harness.mjs';
import { checkFrames } from '../scripts/framecheck.mjs';

const scaleOf = (s, row) => s.page.evaluate((row) => {
  const m = document.querySelector(`.c-button[data-row="${row}"] .btn`).style.transform.match(/scale\(([\d.]+)\)/);
  return Number(m[1]);
}, row);

test('button: a tap dips and recovers; a held press keeps the dip until up', async () => {
  const dir = makeProject({ bars: 2,
    states: "[{ at: 0, use: 'button', label: 'Go' }, { at: END - 2, use: 'button', label: 'Go' }]",
    cursor: "[{ at: 0, x: 0, y: 0 }, { at: 1, target: 'button', press: true }, { at: 2, target: 'button', press: 'down' }, { at: 4, target: 'button', press: 'up' }, { at: END - 2, x: 0, y: 0 }]" });
  const s = await openScene(dir);
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    const at = async (beat) => { await s.seek(beat * bs); return scaleOf(s, 0); };
    assert.equal(await at(0.5), 1);
    assert.ok(await at(1.02) < 0.985, 'tap dips');
    assert.ok(await at(1.9) > 0.999, 'tap recovers');
    for (const b of [2.5, 3, 3.9]) assert.ok(await at(b) < 0.971, `held at beat ${b}`);
    assert.ok(await at(4.9) > 0.999, 'released after up');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('button: a continuation with a new label crossfades old out and new in', async () => {
  const dir = makeProject({ bars: 2,
    states: "[{ at: 0, use: 'button', label: 'Go' }, { at: 2, use: 'button', label: 'Going', icon: 'check' }, { at: END - 2, use: 'button', label: 'Go' }]",
    cursor: '[{ at: 0, x: 0, y: 0 }, { at: END - 2, x: 0, y: 0 }]' });
  const s = await openScene(dir);
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    const rows = () => s.page.evaluate(() => [...document.querySelectorAll('.c-button[data-row="1"] .btn-row')]
      .map((e) => ({ text: e.textContent, o: Number(e.style.opacity) })));
    await s.seek(2 * bs + 0.12 * bs);
    const mid = await rows();
    assert.deepEqual(mid.map((r) => r.text), ['Go', 'Going']);
    for (const r of mid) assert.ok(r.o > 0 && r.o < 1, `mid-swap opacity of ${r.text}: ${r.o}`);
    await s.seek(3.8 * bs);
    const done = await rows();
    assert.ok(done[0].o < 0.01 && done[1].o > 0.99, `settled: ${JSON.stringify(done)}`);
    assert.equal(await s.page.evaluate(() => document.querySelectorAll('.c-button[data-row="0"] .btn-row').length), 1, 'row 0 has one label');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('button: a short label after a long one stays inside the shape', async () => {
  const long = 'A very long label that goes on and on well past any reasonable width for a button';
  const dir = makeProject({ bars: 2,
    states: `[{ at: 0, use: 'button' }, { at: 2, use: 'button', label: '${long}' }, { at: 4, use: 'button', label: 'Get started' }, { at: END - 2, use: 'button' }]`,
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  const s = await openScene(dir);
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    // The new label's box against the shape's, and its opacity times every ancestor's up to #shape.
    const cur = () => s.page.evaluate(() => {
      const e = document.querySelector('.c-button[data-row="2"] .btn-cur .btn-label'), shape = document.querySelector('#shape');
      let o = 1;
      for (let a = e; a && a !== shape; a = a.parentElement) o *= Number(getComputedStyle(a).opacity);
      const r = e.getBoundingClientRect(), b = shape.getBoundingClientRect();
      return { l: r.left - b.left, r: b.right - r.right, t: r.top - b.top, b: b.bottom - r.bottom, o };
    });
    for (const beat of [4.3, 4.6, 5]) {
      await s.seek(beat * bs);
      const c = await cur();
      for (const side of ['l', 'r', 't', 'b']) assert.ok(c[side] >= -1, `beat ${beat}: 'Get started' inside the shape (${side}): ${JSON.stringify(c)}`);
      if (beat === 5) assert.ok(c.o > 0.9, `shown by beat 5: ${c.o}`);
    }
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
  const r = await checkFrames(dir, {});
  assert.deepEqual(r.issues.filter((i) => i.kind === 'text' && i.text.includes('Get started')), []);
});

// Jack's call: a label past the 1200 px cap shows its start (from the left padding, cut off on the right by the
// shape); a label that fits stays centred.
test('button: a label past the width cap starts at the left padding; one that fits is centred', async () => {
  const long = 'A very long label that goes on and on well past any reasonable width for a button';
  for (const [label, check] of [[long, 'start'], ['Get started', 'centre']]) {
    const dir = makeProject({ bars: 2,
      states: `[{ at: 0, use: 'button', label: '${label}' }, { at: END - 2, use: 'button', label: '${label}' }]`,
      cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
    const s = await openScene(dir);
    try {
      const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
      await s.seek(1 * bs);
      // CSS px (the camera zoom divided out): the label's left edge and centre against the shape's.
      const g = await s.page.evaluate(() => {
        const e = document.querySelector('.c-button .btn-cur .btn-label'), shape = document.querySelector('#shape');
        const r = e.getBoundingClientRect(), b = shape.getBoundingClientRect(), k = r.width / e.offsetWidth;
        return { left: (r.left - b.left) / k, centre: (r.left + r.right - b.left - b.right) / 2 / k, over: r.width > b.width };
      });
      if (check === 'start') {
        assert.ok(g.over, `the long label is wider than the shape: ${JSON.stringify(g)}`);
        assert.ok(g.left >= 0 && g.left <= 56 + 2, `the long label starts at the left padding: ${JSON.stringify(g)}`);
      } else assert.ok(Math.abs(g.centre) <= 1, `'Get started' is centred: ${JSON.stringify(g)}`);
      assert.deepEqual(s.errors, []);
    } finally { await s.close(); }
  }
});
