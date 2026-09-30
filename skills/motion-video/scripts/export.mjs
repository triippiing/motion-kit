#!/usr/bin/env node
// export.mjs -- turn a finished project into ready-to-post files, one per destination preset.
//
//   node export.mjs DIR --for reels,x,discord,web [--silent]
//
// Presets (presets.json beside this skill, or $MOTION_PRESETS) are grouped by shape and each shape is
// rendered once: the project's own stage into out/video.mp4, other shapes into out/shapes/<shape>/video.mp4
// via render.mjs's stage override (project.json is never rewritten). A render newer than every project file
// is reused. Each preset is then encoded from its shape's render (fps drop, scale, CRF capped by maxrate,
// two-pass loudnorm to the preset's LUFS and true peak, or no audio with --silent) into out/exports/<preset>.mp4,
// and out/exports/manifest.json records every file with what was measured.
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render, UsageError } from './render.mjs';
import { encode, loudnormArgs, measureLoudness, probe } from './media.mjs';

const DEFAULT_PRESETS = path.resolve(import.meta.dirname, '..', 'presets.json');

export async function loadPresets(file = process.env.MOTION_PRESETS || DEFAULT_PRESETS) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function resolvePresets(P, names) {
  if (!names?.length) throw new UsageError('--for needs at least one preset name');
  const known = Object.keys(P.presets);
  for (const n of names) {
    if (P.presets[n]) continue;
    const best = known.map((k) => [editDistance(n, k), k]).sort((a, b) => a[0] - b[0])[0];
    const hint = best && best[0] <= Math.max(2, n.length / 3) ? ` (did you mean "${best[1]}"?)` : '';
    throw new UsageError(`unknown preset "${n}"${hint}; known: ${known.join(', ')}`);
  }
  return [...new Set(names)];
}

// Newest mtime of the project's own files (everything outside out/ and dotfiles).
async function newestSource(root) {
  let newest = 0;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || (d === root && e.name === 'out')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else newest = Math.max(newest, (await stat(p)).mtimeMs);
    }
  };
  await walk(root);
  return newest;
}

// A render is reused when it is newer than every project file and has the stage we need.
async function reusable(file, [w, h], newest) {
  if (!existsSync(file) || (await stat(file)).mtimeMs < newest) return false;
  const p = await probe(file);
  return p.width === w && p.height === h;
}

export async function exportProject(dir, { for: names, silent = false, outDir, log = console.log } = {}) {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'song.json'))) throw new UsageError(`${root} is not a motion-video project (no song.json)`);
  const P = await loadPresets();
  const chosen = resolvePresets(P, names);
  let project = {};
  try { project = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new UsageError(`project.json is not valid JSON: ${e.message}`); }
  const design = [project.stage?.width ?? 1440, project.stage?.height ?? 1440];
  const exportsDir = path.resolve(outDir ?? path.join(root, 'out', 'exports'));
  const rel = (p) => path.relative(root, p);

  // Group by render stage: a shape whose size is the design stage shares the design render.
  const groups = new Map();
  for (const name of chosen) {
    const p = P.presets[name];
    const stage = p.shape === 'design' ? design : P.shapes[p.shape];
    if (!stage) throw new UsageError(`preset "${name}" has unknown shape "${p.shape}"`);
    const isDesign = stage[0] === design[0] && stage[1] === design[1];
    const key = isDesign ? 'design' : p.shape;
    if (!groups.has(key)) groups.set(key, { shape: key, stage, file: isDesign ? path.join(root, 'out', 'video.mp4') : path.join(root, 'out', 'shapes', key, 'video.mp4'), presets: [] });
    groups.get(key).presets.push(name);
  }

  const newest = await newestSource(root);
  const renders = [];
  for (const g of groups.values()) {
    const reused = await reusable(g.file, g.stage, newest);
    if (!reused) await render(root, g.shape === 'design' ? {} : { stage: g.stage, out: g.file });
    renders.push({ shape: g.shape, path: rel(g.file), width: g.stage[0], height: g.stage[1], reused });
  }

  await mkdir(exportsDir, { recursive: true });
  const commercial = project.music === 'commercial';
  const files = [];
  for (const g of groups.values()) {
    const src = await probe(g.file);
    for (const name of g.presets) {
      const p = P.presets[name], notes = [], warnings = [];
      const size = p.size ?? g.stage;
      let noAudio = silent || !p.audio?.codec;
      if (!noAudio && !src.acodec) { noAudio = true; notes.push('render has no audio'); }
      let af = [];
      if (!noAudio) {
        af = await loudnormArgs(g.file, p.audio);
        if (af.skipped) notes.push('loudness skipped (near-silent input)');
        if (commercial && p.public) warnings.push(`commercial music on a public platform (${p.label ?? name}) risks a mute or takedown: export with --silent or use a licensed track`);
      }
      const out = path.join(exportsDir, `${name}.mp4`);
      await encode(g.file, out, { size, fps: p.fps, video: p.video, audio: p.audio, silent: noAudio, af });
      const m = await probe(out);
      const loud = m.acodec ? await measureLoudness(out) : null;
      files.push({ preset: name, path: rel(out), bytes: m.bytes, duration: m.duration, width: m.width, height: m.height, fps: m.fps,
        vcodec: m.vcodec, acodec: m.acodec, lufs: loud ? round1(loud.I) : null, truePeak: loud ? round1(loud.TP) : null,
        notes, warnings, source: p.source ?? null, checked: p.checked ?? null, estimated: p.estimated ?? [] });
    }
  }
  // Keep the order the presets were asked for.
  files.sort((a, b) => chosen.indexOf(a.preset) - chosen.indexOf(b.preset));
  const manifest = { project: path.basename(root), created: new Date().toISOString(), renders, files };
  await writeFile(path.join(exportsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const f of files) log(summary(f));
  return manifest;
}

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

function summary(f) {
  const audio = f.acodec ? `${f.lufs} LUFS ${f.truePeak} dBTP` : 'no audio';
  const extra = [...f.notes, ...f.warnings.map((w) => `warning: ${w}`), f.estimated.length ? `estimated: ${f.estimated.join(', ')}` : null].filter(Boolean);
  return `${f.preset.padEnd(20)} ${f.width}x${f.height} ${f.fps}fps ${f.duration.toFixed(2)}s ${(f.bytes / 1e6).toFixed(2)} MB ${audio}  ${f.path}`
    + (extra.length ? `\n${' '.repeat(21)}${extra.join('; ')}` : '');
}

const USAGE = 'usage: export.mjs DIR --for PRESET[,PRESET...] [--silent]';

function parseArgs(argv) {
  const o = { silent: false }; let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (dir != null) throw new UsageError(`unexpected argument "${a}"`); dir = a; continue; }
    if (a === '--silent') o.silent = true;
    else if (a === '--for') {
      if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError('--for needs a comma-separated list of presets');
      o.for = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else throw new UsageError(`unknown flag ${a}`);
  }
  if (!dir) throw new UsageError(USAGE);
  if (!o.for) throw new UsageError('--for is required (e.g. --for reels,x,discord,web)');
  return { dir, ...o };
}

async function main() {
  const { dir, ...opts } = parseArgs(process.argv.slice(2));
  await exportProject(dir, opts);
  console.log(`manifest: ${path.join(path.resolve(dir), 'out', 'exports', 'manifest.json')}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
