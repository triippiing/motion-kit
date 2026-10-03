// harness.mjs -- scaffold a real project with given tables and open it in Chromium.
// Tables are JS source strings (so they can use END), spliced into the template's table block.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openProject } from '../scripts/render.mjs';
import { tempDir } from './tmp.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const START = '// ---------------- the three tables you edit ----------------';
const END_MARK = '// ------------------------------------------------------------';

export function makeProject({ states, cursor, bars = 4, bpm = 120, extraSfx = '[]', content = '{}', size } = {}) {
  const root = tempDir('mk-');
  const song = path.join(root, 'beat.wav');
  execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})\nfrom test_analyze_song import click_track\nclick_track(${JSON.stringify(song)}, ${bpm}, seconds=${Math.ceil((bars * 4 * 60) / bpm) + 12})`]);
  const dir = path.join(root, 'p');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [dir, song, '--bars', String(bars), ...(size ? ['--size', size] : [])], { stdio: 'pipe' });
  if (states) {
    const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END_MARK, a);
    if (a < 0 || b < 0) throw new Error(`harness: template table markers not found in ${f} (expected "${START}" then "${END_MARK}")`);
    const tables = `${START}\nconst states = () => ${states};\nconst cursor = () => ${cursor};\nconst extraSfx = () => ${extraSfx};\nconst content = ${content};\n`;
    writeFileSync(f, html.slice(0, a) + tables + html.slice(b));
  }
  return dir;
}

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
