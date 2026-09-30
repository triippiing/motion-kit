#!/usr/bin/env node
// safezones.mjs -- does the shape or the cursor enter a destination's UI zones (captions, buttons, the action rail)?
//
//   node safezones.mjs DIR --for reels,tiktok [--samples beats|half]
//
// Each preset with non-zero `safe` margins (presets.json, or $MOTION_PRESETS) is checked at its own render size:
// the page is opened at that stage (render.mjs's stage override; project.json is never rewritten), seeked to every
// beat (and half-beat, the default), and the shape's box (#shape, camera zoom included) and the cursor's tip
// (window.inspect(t).cursor) are compared, in stage px, with the margins scaled from the preset's size to the stage.
// Consecutive samples in the same zone are one issue: "beats 12-13.5: shape extends 40 px into the Instagram Reels
// bottom zone". Prints each issue; exit 1 when there are any, 0 when none, 2 on bad input.
// Also the home of the preset helpers export.mjs and check_brief.mjs share, and of the guides overlay (render.mjs --guides).
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beatTime, openProject, UsageError } from './render.mjs';
import { didYouMean } from '../components/core/validate.js';

const DEFAULT_PRESETS = path.resolve(import.meta.dirname, '..', 'presets.json');

export async function loadPresets(file = process.env.MOTION_PRESETS || DEFAULT_PRESETS) {
  return JSON.parse(await readFile(file, 'utf8'));
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

const EDGES = ['top', 'bottom', 'left', 'right'], PARTS = ['shape', 'cursor'];

// How far a box ({ left, top, right, bottom }, stage px) reaches into each margin of a W x H stage.
function intrusions(box, m, W, H) {
  const px = { top: m.top - box.top, bottom: box.bottom - (H - m.bottom), left: m.left - box.left, right: box.right - (W - m.right) };
  return EDGES.filter((e) => m[e] > 0 && px[e] >= 1).map((edge) => ({ edge, px: Math.round(px[edge]) }));
}

// Runs in the page: seek, then the shape's box and the cursor tip in stage px (relative to #stage, which the
// viewport matches at device scale 1, so CSS px are stage px; getBoundingClientRect includes the camera zoom).
function measure(t) {
  window.seek(t);
  const shape = document.querySelector('#shape');
  if (!shape) return null;
  const st = document.querySelector('#stage')?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const b = shape.getBoundingClientRect();
  const box = b.width > 0 && b.height > 0 ? { left: b.left - st.left, top: b.top - st.top, right: b.right - st.left, bottom: b.bottom - st.top } : null;
  const c = typeof window.inspect === 'function' ? window.inspect(t)?.cursor : null;
  return { shape: box, cursor: c && Number.isFinite(c.x) && Number.isFinite(c.y) ? { left: c.x, right: c.x, top: c.y, bottom: c.y } : null };
}

// { issues: [{ preset, beat, through, t, part, edge, px }], notes } -- `beat` is where a run of samples in the zone
// starts, `through` where it ends, px the deepest it reaches. `tables` (a brief's states()/cursor() code) is
// spliced into index.html as served, so a brief is checked before it is built; notes say when that was not possible.
// `loop` (a boolean) overrides project.json's "loop" as served (check_brief --no-loop).
export async function checkSafeZones(dir, { presets, samples = 'half', tables, loop } = {}) {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'song.json'))) throw new UsageError(`${root} is not a motion-video project (no song.json)`);
  if (!['beats', 'half'].includes(samples)) throw new UsageError(`samples must be "beats" or "half", got "${samples}"`);
  const P = await loadPresets();
  const names = resolvePresets(P, presets);
  const design = await designStage(root);
  const song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8'));
  const D = song.loop?.duration_sec ?? Infinity;
  const beats = [];
  for (let b = 0; b < song.beats.length; b++) beats.push(...(samples === 'half' ? [b, b + 0.5] : [b]));
  const at = beats.map((beat) => ({ beat, t: beatTime(song, beat) })).filter((s) => s.t <= D + 1e-9);

  const groups = new Map();
  for (const name of names) {
    const stage = presetStage(P, name, design), m = scaledMargins(P.presets[name], stage);
    if (!m) continue;
    const key = stage.join('x');
    if (!groups.has(key)) groups.set(key, { stage, checks: [] });
    groups.get(key).checks.push({ name, m });
  }

  const issues = [], notes = [];
  for (const { stage, checks } of groups.values()) {
    const proj = await openProject(root, { workers: 1, stage, tables, loop });
    try {
      if (tables && !proj.tablesSpliced && !notes.length) notes.push("index.html has no table markers, so the safe-zone check used index.html's own tables, not the brief's");
      const [W, H] = stage, page = proj.pages[0];
      const open = new Map();   // `${preset}/${part}/${edge}` -> the issue its run is building
      for (let i = 0; i < at.length; i++) {
        const got = await page.evaluate(measure, at[i].t);
        if (proj.errors.length) throw proj.errors[0];
        if (!got) throw new Error('the safe-zone check needs the template\'s #shape element; index.html has none');
        for (const { name, m } of checks) for (const part of PARTS) {
          if (!got[part]) continue;
          for (const { edge, px } of intrusions(got[part], m, W, H)) {
            const key = `${name}/${part}/${edge}`, run = open.get(key);
            if (run && run.last === i - 1) { run.through = at[i].beat; run.px = Math.max(run.px, px); run.last = i; continue; }
            const issue = { preset: name, beat: at[i].beat, through: at[i].beat, t: Math.round(at[i].t * 1000) / 1000, part, edge, px, last: i };
            open.set(key, issue); issues.push(issue);
          }
        }
      }
    } finally { await proj.close(); }
  }
  issues.sort((a, b) => names.indexOf(a.preset) - names.indexOf(b.preset) || a.beat - b.beat
    || PARTS.indexOf(a.part) - PARTS.indexOf(b.part) || EDGES.indexOf(a.edge) - EDGES.indexOf(b.edge));
  return { issues: issues.map(({ last, ...i }) => i), notes };
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
  const P = await loadPresets();
  for (const n of notes) console.log(`note: ${n}`);
  for (const i of issues) console.log(issueText(i, P));
  if (!issues.length) console.log(`no safe-zone issues (${opts.presets.join(', ')})`);
  process.exit(issues.length ? 1 : 0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
