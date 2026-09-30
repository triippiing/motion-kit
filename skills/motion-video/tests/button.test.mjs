// button.test.mjs -- the reference component's behaviour in a real page: press kinds and continuations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, openScene } from './harness.mjs';

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
