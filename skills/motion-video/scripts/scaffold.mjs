// scaffold.mjs -- a real project from given tables on a synthetic click track (the gallery and the tests use it).
// Tables are JS source strings (so they can use END), spliced into the template's table block.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { START_MARK as START, END_MARK } from './tables.mjs';

const HERE = import.meta.dirname;

// A click track at BPM in FILE (click_track.py); returns FILE.
export function clickTrack(file, bpm = 120, seconds = 40) {
  execFileSync('python3', [path.join(HERE, 'click_track.py'), file, String(bpm), '--seconds', String(seconds)], { stdio: 'pipe' });
  return file;
}

// Builds ROOT/beat.wav and the project ROOT/p (ROOT is created if needed); returns the project directory.
export function scaffold(root, { states, cursor, bars = 4, bpm = 120, extraSfx = '[]', content = '{}', size } = {}) {
  mkdirSync(root, { recursive: true });
  const song = clickTrack(path.join(root, 'beat.wav'), bpm, Math.ceil((bars * 4 * 60) / bpm) + 12);
  const dir = path.join(root, 'p');
  execFileSync(path.join(HERE, 'new_project.sh'), [dir, song, '--bars', String(bars), ...(size ? ['--size', size] : [])], { stdio: 'pipe' });
  if (states) {
    const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END_MARK, a);
    if (a < 0 || b < 0) throw new Error(`scaffold: template table markers not found in ${f} (expected "${START}" then "${END_MARK}")`);
    const tables = `${START}\nconst states = () => ${states};\nconst cursor = () => ${cursor};\nconst extraSfx = () => ${extraSfx};\nconst content = ${content};\n`;
    writeFileSync(f, html.slice(0, a) + tables + html.slice(b));
  }
  return dir;
}
