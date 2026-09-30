// harness.mjs -- scaffold a real project with given tables and open it in Chromium.
// Tables are JS source strings (so they can use END), spliced into the template's table block.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openProject } from '../scripts/render.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const START = '// ---------------- the three tables you edit ----------------';
const END_MARK = '// ------------------------------------------------------------';

export function makeProject({ states, cursor, bars = 4, bpm = 120, extraSfx = '[]', content = '{}', size } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mk-'));
  const song = path.join(root, 'beat.wav');
  execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})\nfrom test_analyze_song import click_track\nclick_track(${JSON.stringify(song)}, ${bpm}, seconds=${Math.ceil((bars * 4 * 60) / bpm) + 12})`]);
  const dir = path.join(root, 'p');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [dir, song, '--bars', String(bars), ...(size ? ['--size', size] : [])], { stdio: 'pipe' });
  if (states) {
    const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END_MARK, a);
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
