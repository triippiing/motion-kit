#!/usr/bin/env node
// safezones.mjs -- does the shape or the cursor enter a destination's UI zones (captions, buttons, the action rail)?
//
//   node safezones.mjs DIR --for reels,tiktok [--samples beats|half]
//
// Each preset with non-zero `safe` margins (presets.json, or $MOTION_PRESETS) is checked at its own render size:
// the page is opened at that stage (render.mjs's stage override; project.json is never rewritten), seeked to every
// beat (and half-beat, the default), and the shape's box (#shape, camera zoom included) and the cursor's tip
// (window.inspect(t).cursor) plus the drawn arrow right and down of it (the #cursor path's box) are compared, in stage px, with the margins scaled from the preset's size to the stage.
// Consecutive samples in the same zone are one issue: "beats 12-13.5: shape extends 40 px into the Instagram Reels
// bottom zone". Prints each issue; exit 1 when there are any, 0 when none, 2 on bad input.
// Also the home of the preset helpers export.mjs and check_brief.mjs share, and of the guides overlay (render.mjs --guides).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './render.mjs';
import { checkFrames } from './framecheck.mjs';
import { didYouMean } from '../components/core/validate.js';
import { isMain } from './is_main.mjs';

const DEFAULT_PRESETS = path.resolve(import.meta.dirname, '..', 'presets.json');

// The presets file; unreadable, malformed or missing its two objects is a UsageError (error: ..., exit 2).
export async function loadPresets(file = process.env.MOTION_PRESETS || DEFAULT_PRESETS) {
  let text, P;
  try { text = await readFile(file, 'utf8'); } catch (e) { throw new UsageError(`cannot read presets ${file}: ${e.code ?? e.message}`); }
  try { P = JSON.parse(text); } catch (e) { throw new UsageError(`presets ${file} is not valid JSON: ${e.message}`); }
  if (!P || typeof P.shapes !== 'object' || typeof P.presets !== 'object') throw new UsageError(`presets ${file} needs "shapes" and "presets" objects`);
  return P;
}

// Known preset names, de-duplicated in the order given; an unknown one is a UsageError with a did-you-mean.
export function resolvePresets(P, names) {
  if (!names?.length) throw new UsageError('--for needs at least one preset name');
  const known = Object.keys(P.presets);
  for (const n of names) {
    if (P.presets[n]) continue;
    const best = didYouMean(n, known);
    throw new UsageError(`unknown preset "${n}"${best ? ` (did you mean "${best}"?)` : ''}; known: ${known.join(', ')}`);
  }
  return [...new Set(names)];
}

// The project's own stage from project.json (the design shape), 1440x1440 when it does not say.
export async function designStage(root) {
  let project = {};
  try { project = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new UsageError(`project.json is not valid JSON: ${e.message}`); }
  return [project.stage?.width ?? 1440, project.stage?.height ?? 1440];
}

// The stage a preset renders at: its shape's size, or the design stage for shape "design".
export function presetStage(P, name, design) {
  const p = P.presets[name];
  const stage = p.shape === 'design' ? design : P.shapes[p.shape];
  if (!stage) throw new UsageError(`preset "${name}" has unknown shape "${p.shape}"`);
  return stage;
}

// The preset's safe margins in px of `stage` (scaled from the preset's own size), or null when it has none.
export function scaledMargins(p, stage) {
  if (!p.safe) return null;
  const [w, h] = p.size ?? stage, sx = stage[0] / w, sy = stage[1] / h;
  const m = { top: p.safe.top * sy, bottom: p.safe.bottom * sy, left: p.safe.left * sx, right: p.safe.right * sx };
  return Object.values(m).some((v) => v > 0) ? m : null;
}

// { issues: [{ preset, beat, through, t, part, edge, px }], notes } -- `beat` is where a run of samples in the zone
// starts, `through` where it ends, px the deepest it reaches. The page is sampled by framecheck.mjs (shared with
// check_brief's frame check); `tables` (a brief's states()/cursor() code) is spliced into index.html as served, so a
// brief is checked before it is built; notes say when that was not possible. `loop` (a boolean) overrides
// project.json's "loop" as served (check_brief --no-loop).
export async function checkSafeZones(dir, opts = {}) {
  const r = await checkFrames(dir, { ...opts, frame: false });
  return { issues: r.issues.map(({ kind, ...i }) => i), notes: r.notes };
}

// "beat 12: shape extends 40 px into the Instagram Reels bottom zone" (or "beats 12-13.5: ..." for a run).
export function issueText(i, P) {
  const label = P.presets[i.preset]?.label ?? i.preset;
  const when = i.through != null && i.through !== i.beat ? `beats ${i.beat}-${i.through}` : `beat ${i.beat}`;
  return `${when}: ${i.part === 'shape' ? 'shape extends' : 'cursor is'} ${i.px} px into the ${label} ${i.edge} zone`;
}

// What render.mjs --guides needs: the preset's stage (unless one is given) and its margins scaled to that stage.
export async function guidesFor(root, name, stage) {
  const P = await loadPresets();
  resolvePresets(P, [name]);
  stage ??= presetStage(P, name, await designStage(root));
  return { stage, margins: scaledMargins(P.presets[name], stage) ?? { top: 0, bottom: 0, left: 0, right: 0 } };
}

// Runs in the page (after ready): translucent bands over each margin, above everything. seek() never touches them.
export function drawGuides(m) {
  const wrap = document.createElement('div');
  wrap.id = 'mk-guides';
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
  const band = (css) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;background:rgba(255,32,96,0.4);${css}`; wrap.append(d); };
  if (m.top > 0) band(`left:0;right:0;top:0;height:${m.top}px`);
  if (m.bottom > 0) band(`left:0;right:0;bottom:0;height:${m.bottom}px`);
  if (m.left > 0) band(`left:0;width:${m.left}px;top:${m.top}px;bottom:${m.bottom}px`);
  if (m.right > 0) band(`right:0;width:${m.right}px;top:${m.top}px;bottom:${m.bottom}px`);
  document.body.append(wrap);
}

const USAGE = 'usage: safezones.mjs DIR --for PRESET[,PRESET...] [--samples beats|half]';

function parseArgs(argv) {
  const o = {}; let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (dir != null) throw new UsageError(`unexpected argument "${a}"`); dir = a; continue; }
    if (a !== '--for' && a !== '--samples') throw new UsageError(`unknown flag ${a}`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value`);
    o[a.slice(2)] = argv[++i];
  }
  if (!dir) throw new UsageError(USAGE);
  if (!o.for) throw new UsageError('--for is required (e.g. --for reels,tiktok)');
  return { dir, presets: o.for.split(',').map((s) => s.trim()).filter(Boolean), samples: o.samples ?? 'half' };
}

async function main() {
  const { dir, ...opts } = parseArgs(process.argv.slice(2));
  const { issues, notes } = await checkSafeZones(dir, opts);
  const P = await loadPresets(), design = await designStage(path.resolve(dir));
  const names = resolvePresets(P, opts.presets), zoned = names.filter((n) => scaledMargins(P.presets[n], presetStage(P, n, design)));
  for (const n of notes) console.log(`note: ${n}`);
  for (const n of names) if (!zoned.includes(n)) console.log(`no safe zones for ${n} (the whole frame is shown)`);
  for (const i of issues) console.log(issueText(i, P));
  if (!issues.length && zoned.length) console.log(`no safe-zone issues (${zoned.join(', ')})`);
  process.exit(issues.length ? 1 : 0);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
