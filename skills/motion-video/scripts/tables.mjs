// tables.mjs -- one place to read, run and list a project's tables (states() and cursor()): the brief's ```js block
// under "## Beat table" (briefCode), index.html's table block between the template's markers (pageCode), running
// either in a fresh vm with END = the song's beat count (runTables), and the marker names their rows sit on
// (markerNames, projectMarkerNames). check_brief.mjs and render.mjs (spliceTables) read the tables through it;
// swap_song.mjs and the sync server list the marker names a project needs, and watch.mjs re-runs the tables.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The table block of the template's index.html runs from START_MARK to END_MARK.
export const START_MARK = '// ---------------- the three tables you edit ----------------';
export const END_MARK = '// ------------------------------------------------------------';

// Tables code that does not run (a syntax error, a throw, or longer than 1 s); the message is check_brief's error.
export class TablesError extends Error {}

// The brief's ```js / ```javascript blocks under "## Beat table", joined ('' when there are none).
export function briefCode(md) {
  const at = md.search(/^## Beat table[ \t]*\r?$/m);
  const table = at < 0 ? '' : md.slice(at);
  return [...table.matchAll(/```(?:js|javascript)\r?\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
}

// The code between index.html's table markers, or null when the page has no markers.
export function pageCode(html) {
  const a = html.indexOf(START_MARK), b = a < 0 ? -1 : html.indexOf(END_MARK, a + START_MARK.length);
  return a < 0 || b < 0 ? null : html.slice(a + START_MARK.length, b);
}

// { states, cursor } from the tables code, run in a fresh context with END = beats (1 s at most).
export function runTables(code, beats) {
  try {
    const ctx = vm.createContext({ END: beats });
    return vm.runInContext(`${code}\n;({ states: states(), cursor: cursor() })`, ctx, { timeout: 1000 });
  } catch (e) {
    const why = e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'took longer than 1 s to run (an endless loop?)' : `does not run: ${e.message}`;
    throw new TablesError(`beat table code ${why}`);
  }
}

// The marker names (string `at`s) across the given row lists, sorted and unique; anything not a list of rows is skipped.
export function markerNames(rows) {
  const names = new Set();
  for (const list of rows) if (Array.isArray(list))
    for (const r of list) if (r && typeof r === 'object' && typeof r.at === 'string') names.add(r.at);
  return [...names].sort();
}

// The marker names a project's tables use: index.html's and (when there is one) the brief's, with END = song.json's
// beat count (0 when song.json cannot be read). Tables that do not run name nothing.
export function projectMarkerNames(dir) {
  const read = (f) => { try { return readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
  let beats = 0;
  try { beats = JSON.parse(read('song.json')).beats.length ?? 0; } catch {}
  const html = read('index.html'), md = read('MOTION-BRIEF.md');
  const rows = [];
  for (const code of [html == null ? null : pageCode(html), md == null ? null : briefCode(md)]) {
    if (!code?.trim()) continue;
    try { const t = runTables(code, beats); rows.push(t.states, t.cursor); } catch (e) { if (!(e instanceof TablesError)) throw e; }
  }
  return markerNames(rows);
}
