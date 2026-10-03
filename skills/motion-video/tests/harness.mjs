// harness.mjs -- scaffold a real project with given tables in a temp dir and open it in Chromium.
import assert from 'node:assert/strict';
import { openProject } from '../scripts/render.mjs';
import { scaffold } from '../scripts/scaffold.mjs';
import { tempDir } from './tmp.mjs';

export const makeProject = (opts) => scaffold(tempDir('mk-'), opts);

export async function openScene(dir) {
  const proj = await openProject(dir, { workers: 1 });
  const page = proj.pages[0];
  return {
    page, errors: proj.errors,
    seek: (t) => page.evaluate((t) => window.seek(t), t),
    snap: (sel = '#stage') => page.evaluate((sel) => document.querySelector(sel).outerHTML, sel),
    close: () => proj.close(),
  };
}

// Open a project, hand the test a seek-by-beat helper, and always close the browser (asserting no page errors).
export async function scene(opts, fn) {
  const s = await openScene(makeProject(opts));
  try {
    const bs = await s.page.evaluate(() => fetch('song.json').then((r) => r.json()).then((j) => j.beat_sec));
    await fn(s, async (beat) => s.seek(beat * bs), bs);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
}

// Ruling F: a press in row A, then a continuation row B that states the pressed result, must not flash back to
// A's written state: at B.t0 + 0.05 beat (and later) B shows what A settled on. `read(row)` runs in the page;
// y is where the resting cursor sits (clear of the component).
export async function noFlash({ use, a, b, press, read, y = 400 }) {
  await scene({ bars: 2,
    states: `[{ at: 0, use: '${use}', ${a} }, { at: 2, use: '${use}', ${b} }, { at: END - 2, use: '${use}', ${a} }]`,
    cursor: `[{ at: 0, x: 0, y: ${y} }, { at: 0.5, target: '${press}' }, { at: 0.8, target: '${press}', press: true }, { at: END - 2, x: 0, y: ${y} }]` }, async (s, at) => {
    await at(1.95);
    const end = await s.page.evaluate(read, 0);
    for (const beat of [2.05, 2.3, 3]) {
      await at(beat);
      assert.deepEqual(await s.page.evaluate(read, 1), end, `${use} row B at beat ${beat} matches the end of row A`);
    }
  });
}
