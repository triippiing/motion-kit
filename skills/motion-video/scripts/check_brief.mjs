#!/usr/bin/env node
// check_brief.mjs PROJECT [--no-loop] -- validate MOTION-BRIEF.md: required sections, then the beat table's
// states()/cursor() code with the engine's validator in strict mode (holds, budget, quiet beats), with fill/ink
// checked against the project's theme.json. A project it cannot read (malformed song.json) is "error: ...", exit 2.
// A piece is checked as a loop (last rows repeat the first) unless --no-loop is given or the project's
// project.json says "loop": false (a launch video that ends on its own end card).
// A `**Exports:** reels, tiktok, web` line in ## Decisions names the destination presets (unknown names are errors):
// the brief's tables are then checked against each preset's safe zones (safezones.mjs, in a browser; only when there
// is such a line), each issue a warning, and a commercial track (a **Song:** or **Music:** line calling it
// commercial) with public presets is a warning too.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { validate } from '../components/core/validate.js';
import { checkSafeZones, issueText, loadPresets, resolvePresets } from './safezones.mjs';

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

// The house theme's colour roles (what extract_theme.py writes without a product CSS).
export const HOUSE = { canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b' };
const readJson = (dir, name) => {
  const text = readFileSync(path.join(dir, name), 'utf8');
  try { return JSON.parse(text); } catch (e) { throw new Error(`${name} is not valid JSON (${e.message})`); }
};

// The project's theme roles from theme.json, else the house roles.
export function projectTheme(dir) {
  return existsSync(path.join(dir, 'theme.json')) ? readJson(dir, 'theme.json') : HOUSE;
}

// The text of the brief's ## Decisions section ('' when it has none).
export function briefDecisions(md) {
  const m = /^## Decisions[ \t]*\r?$/m.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length), next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

// A Decisions line `**Label:** value` (optionally a list item; "**Label**:" too): its value, or null.
function decision(md, label) {
  const m = new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?\\*\\*${label}(?::\\*\\*|\\*\\*:)(.*?)\\r?$`, 'mi').exec(briefDecisions(md));
  return m ? m[1].trim() : null;
}

// The preset names on the Exports line (lower-cased, in order; `code` spans, parentheses and a trailing full stop
// dropped), [] for an empty line, or null when the brief has no Exports line.
export function briefExports(md) {
  const v = decision(md, 'Exports');
  if (v == null) return null;
  return v.replace(/\([^)]*\)/g, '').replace(/[`.]+/g, ' ').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Whether the brief says the music is a commercial track: its **Song:** or **Music:** line uses the word
// "commercial" (not "non-commercial" or "not commercial" / "not a commercial ..."). planner.md has the planner say so
// on the Song line ("a commercial track, so social platforms would likely mute it"); `**Music:** commercial` also works.
export function briefCommercial(md) {
  return ['Song', 'Music'].some((k) => /(?<!\bnon-?|\bnot (?:a )?)\bcommercial\b/i.test(decision(md, k) ?? ''));
}

// loop: an explicit option wins (--no-loop), else project.json's. safeZones: the safe-zone check (tests stub it).
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
  const song = readJson(dir, 'song.json');
  if (!Array.isArray(song?.beats)) throw new Error('song.json has no beats list (re-run analyze_song.py)');
  const theme = projectTheme(dir);
  let states, cursor;
  try {
    const ctx = vm.createContext({ END: song.beats.length });
    ({ states, cursor } = vm.runInContext(`${code}\n;({ states: states(), cursor: cursor() })`, ctx, { timeout: 1000 }));
  } catch (e) {
    const why = e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'took longer than 1 s to run (an endless loop?)' : `does not run: ${e.message}`;
    return { errors: [...errors, `beat table code ${why}`], warnings };
  }
  const r = validate({ states, cursor, registry: await loadRegistry(dir), song, theme, loop, strict: true });
  errors.push(...r.errors); warnings.push(...r.warnings);
  const exp = briefExports(md);
  if (exp == null) return { errors, warnings };   // no Exports line: nothing more, and no browser
  if (!exp.length) return { errors: [...errors, 'Exports: names no presets (a comma list, e.g. **Exports:** reels, x, web)'], warnings };
  const P = await loadPresets();
  let names;
  try { names = resolvePresets(P, exp); } catch (e) { return { errors: [...errors, `Exports: ${e.message}`], warnings }; }
  const pub = names.filter((n) => P.presets[n].public && P.presets[n].audio?.codec !== null).map((n) => P.presets[n].label ?? n);
  if (pub.length && briefCommercial(md))
    warnings.push(`commercial music with public exports (${pub.join(', ')}) risks a mute or takedown: export those with --silent or use a licensed track`);
  // The page runs the same tables, so it would only fail on what the errors already say.
  if (errors.length) return { errors, warnings };
  try {
    const { issues, notes = [] } = await (opts.safeZones ?? checkSafeZones)(dir, { presets: names, samples: 'half', tables: code, loop });
    warnings.push(...notes, ...issues.map((i) => issueText(i, P)));
  } catch (e) { warnings.push(`the safe-zone check did not run: ${e.message.split('\n')[0]}`); }
  return { errors, warnings };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [dir, ...opts] = process.argv.slice(2);
  const bad = opts.find((o) => o !== '--no-loop');
  if (bad) { console.error(`error: unknown option "${bad}" (usage: check_brief.mjs PROJECT [--no-loop])`); process.exit(2); }
  if (!dir || !existsSync(path.join(dir, 'MOTION-BRIEF.md')) || !existsSync(path.join(dir, 'song.json'))) {
    console.error('usage: check_brief.mjs PROJECT [--no-loop] (needs PROJECT/MOTION-BRIEF.md and song.json)'); process.exit(2);
  }
  const loop = opts.includes('--no-loop') ? false : projectLoop(dir).loop;
  let r;
  try { r = await checkBrief(dir, { loop }); } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  console.log(r.errors.length ? `brief has ${r.errors.length} error(s)` : `brief OK${loop ? '' : ' (not a loop)'}`);
  process.exit(r.errors.length ? 1 : 0);
}
