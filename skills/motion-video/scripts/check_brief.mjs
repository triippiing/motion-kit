#!/usr/bin/env node
// check_brief.mjs PROJECT [--no-loop] -- validate MOTION-BRIEF.md: required sections, then the beat table's
// states()/cursor() code with the engine's validator in strict mode (holds, budget, quiet beats).
// A piece is checked as a loop (last rows repeat the first) unless --no-loop is given or the project's
// project.json says "loop": false (a launch video that ends on its own end card).
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { validate } from '../components/core/validate.js';

const SECTIONS = ['## Request', '## Decisions', '## Moments', '## Beat table'];

export async function loadRegistry(dir) {
  const own = path.join(dir, 'components', 'index.js');
  const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'index.js');
  return (await import(pathToFileURL(existsSync(own) ? own : lib).href)).registry;
}

// Whether the project loops, from project.json's "loop" (default true). A project.json that does not parse
// comes back with a warning, and the piece is checked as a loop.
export function projectLoop(dir) {
  const f = path.join(dir, 'project.json');
  if (!existsSync(f)) return { loop: true, warning: null };
  try { return { loop: JSON.parse(readFileSync(f, 'utf8')).loop !== false, warning: null }; } catch (e) {
    return { loop: true, warning: `project.json is not valid JSON (${e.message}); checking as a loop` };
  }
}

// loop: an explicit option wins (--no-loop), else project.json's.
export async function checkBrief(dir, opts = {}) {
  const errors = [], warnings = [];
  const proj = projectLoop(dir), loop = opts.loop ?? proj.loop;
  if (proj.warning) warnings.push(proj.warning);
  const md = readFileSync(path.join(dir, 'MOTION-BRIEF.md'), 'utf8');
  const heading = (s) => new RegExp(`^${s}[ \\t]*\\r?$`, 'm');
  for (const s of SECTIONS) if (!heading(s).test(md)) errors.push(`missing section "${s}"`);
  const at = md.search(heading('## Beat table'));
  const table = at < 0 ? '' : md.slice(at);
  const code = [...table.matchAll(/```(?:js|javascript)\r?\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  if (!code.trim()) return { errors: [...errors, 'no ```js block with states() and cursor() under "## Beat table"'], warnings };
  const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  let states, cursor;
  try {
    const ctx = vm.createContext({ END: song.beats.length });
    ({ states, cursor } = vm.runInContext(`${code}\n;({ states: states(), cursor: cursor() })`, ctx, { timeout: 1000 }));
  } catch (e) {
    const why = e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'took longer than 1 s to run (an endless loop?)' : `does not run: ${e.message}`;
    return { errors: [...errors, `beat table code ${why}`], warnings };
  }
  const r = validate({ states, cursor, registry: await loadRegistry(dir), song, loop, strict: true });
  return { errors: [...errors, ...r.errors], warnings: [...warnings, ...r.warnings] };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [dir, ...opts] = process.argv.slice(2);
  const bad = opts.find((o) => o !== '--no-loop');
  if (bad) { console.error(`error: unknown option "${bad}" (usage: check_brief.mjs PROJECT [--no-loop])`); process.exit(2); }
  if (!dir || !existsSync(path.join(dir, 'MOTION-BRIEF.md')) || !existsSync(path.join(dir, 'song.json'))) {
    console.error('usage: check_brief.mjs PROJECT [--no-loop] (needs PROJECT/MOTION-BRIEF.md and song.json)'); process.exit(2);
  }
  const loop = opts.includes('--no-loop') ? false : projectLoop(dir).loop;
  const r = await checkBrief(dir, { loop });
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  console.log(r.errors.length ? `brief has ${r.errors.length} error(s)` : `brief OK${loop ? '' : ' (not a loop)'}`);
  process.exit(r.errors.length ? 1 : 0);
}
