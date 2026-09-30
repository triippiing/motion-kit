#!/usr/bin/env node
// check_brief.mjs PROJECT -- validate MOTION-BRIEF.md: required sections, then the beat table's
// states()/cursor() code with the engine's validator in strict mode (holds, budget, quiet beats).
import { readFileSync, existsSync } from 'node:fs';
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

export async function checkBrief(dir) {
  const errors = [], warnings = [];
  const md = readFileSync(path.join(dir, 'MOTION-BRIEF.md'), 'utf8');
  for (const s of SECTIONS) if (!md.includes(s)) errors.push(`missing section "${s}"`);
  const table = md.slice(md.indexOf('## Beat table'));
  const code = [...table.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  if (!code.trim()) return { errors: [...errors, 'no ```js block with states() and cursor() under "## Beat table"'], warnings };
  const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  let states, cursor;
  try {
    const ctx = vm.createContext({ END: song.beats.length });
    ({ states, cursor } = vm.runInContext(`${code}\n;({ states: states(), cursor: cursor() })`, ctx));
  } catch (e) { return { errors: [...errors, `beat table code does not run: ${e.message}`], warnings }; }
  const r = validate({ states, cursor, registry: await loadRegistry(dir), song, strict: true });
  return { errors: [...errors, ...r.errors], warnings: r.warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir || !existsSync(path.join(dir, 'MOTION-BRIEF.md')) || !existsSync(path.join(dir, 'song.json'))) {
    console.error('usage: check_brief.mjs PROJECT (needs PROJECT/MOTION-BRIEF.md and song.json)'); process.exit(2);
  }
  const r = await checkBrief(dir);
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  console.log(r.errors.length ? `brief has ${r.errors.length} error(s)` : 'brief OK');
  process.exit(r.errors.length ? 1 : 0);
}
