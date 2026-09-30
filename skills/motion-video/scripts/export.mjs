#!/usr/bin/env node
// export.mjs -- turn a finished project into ready-to-post files, one per destination preset.
//
//   node export.mjs DIR --for reels,x,discord,web [--silent]
//
// Presets (presets.json beside this skill, or $MOTION_PRESETS) are grouped by render size and each size is
// rendered once into out/shapes/<W>x<H>/video.mp4 via render.mjs's stage override (project.json is never
// rewritten, and the user's out/video.mp4 is never overwritten). An existing render (out/video.mp4 for the
// design size, or the shapes/ one) is reused only when its render.json stamp says it is a full-quality,
// full-loop render at that size by the current renderer, and it is newer than every project file. Each preset is then
// encoded from its shape's render (fps drop, scale, CRF capped by maxrate, two-pass loudnorm to the preset's LUFS and
// true peak, or no audio with --silent) into out/exports/<preset>.mp4. Over the preset's maxMB, the MP4 is re-encoded
// two-pass at the bitrate that fills the cap, stepping the resolution down (1080/720/540 short side) when that bitrate is
// under the size's quality floor; when no size works the export stops with an error. `web` also writes <preset>.webm
// (VP9/Opus) and <preset>.jpg (a poster at beat 1.5); `gif` writes <preset>.gif, narrowing until it fits gif.maxMB.
// Everything is written into a staging dir and moved into out/exports only when the whole export succeeds, then
// out/exports/manifest.json records every file with what was measured. Over maxSeconds is a warning, not an error.
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beatTime, render, renderStamp, stampPath, UsageError } from './render.mjs';
import { capBytes, capSizes, encode, encodeGif, encodeWebm, fitToCap, loudnessMiss, loudnormArgs, measureLoudness, MB, poster, probe } from './media.mjs';

// A size cap that cannot be met: bad input for this project (exit 2), but not a usage mistake.
export class CapError extends UsageError {}

// The poster frame: beat 1 plus half a beat, after the first beat's motion has settled.
const POSTER_BEAT = 1.5;
const GIF_TRIES = 4;

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

// Whether `file` can stand in for a fresh export render at `stage`: its stamp matches exactly what
// render.mjs would write for a full-quality (4 subframes, not preview) full-loop render at that stage by the
// current renderer, its video lasts the loop (within one frame), and it is newer than every project file.
export async function reusableRender(dir, file, stage) {
  const root = path.resolve(dir);
  if (!existsSync(file) || !existsSync(stampPath(file))) return false;
  const song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8'));
  let stamp;
  try { stamp = JSON.parse(await readFile(stampPath(file), 'utf8')); } catch { return false; }
  const want = await renderStamp(root, { stage, sub: 4, preview: false, song });
  if (JSON.stringify(stamp) !== JSON.stringify(want)) return false;
  if ((await stat(file)).mtimeMs < await newestSource(root)) return false;
  const p = await probe(file);
  return p.width === stage[0] && p.height === stage[1] && Math.abs(p.videoDuration - song.loop.duration_sec) <= 1 / song.fps + 1e-6;
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
  // Manifest paths are relative to the project when they are inside it, absolute otherwise.
  const rel = (p) => { const r = path.relative(root, p); return r.startsWith('..') || path.isAbsolute(r) ? p : r; };

  // Group by render size: shapes of the same size (including the design shape) share one render.
  const groups = new Map();
  for (const name of chosen) {
    const p = P.presets[name];
    const stage = p.shape === 'design' ? design : P.shapes[p.shape];
    if (!stage) throw new UsageError(`preset "${name}" has unknown shape "${p.shape}"`);
    const size = `${stage[0]}x${stage[1]}`;
    if (!groups.has(size)) groups.set(size, { size, stage, shapes: [], presets: [] });
    const g = groups.get(size);
    if (!g.shapes.includes(p.shape)) g.shapes.push(p.shape);
    g.presets.push(name);
  }

  const renders = [];
  for (const g of groups.values()) {
    const own = path.join(root, 'out', 'shapes', g.size, 'video.mp4');
    const isDesign = g.stage[0] === design[0] && g.stage[1] === design[1];
    const candidates = isDesign ? [path.join(root, 'out', 'video.mp4'), own] : [own];
    g.file = null;
    for (const c of candidates) if (await reusableRender(root, c, g.stage)) { g.file = c; break; }
    const reused = !!g.file;
    if (!reused) g.file = await render(root, { stage: g.stage, out: own });
    renders.push({ size: g.size, shapes: g.shapes, path: rel(g.file), reused });
  }

  await mkdir(exportsDir, { recursive: true });
  const song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8'));
  const commercial = project.music === 'commercial';
  const files = [];
  // Encode into a staging dir; nothing reaches exportsDir unless every preset succeeds.
  const staging = await mkdtemp(path.join(exportsDir, '.staging-'));
  try {
    for (const g of groups.values()) {
      const src = await probe(g.file);
      for (const name of g.presets) files.push(...await exportPreset(name, P.presets[name], g.file, src));
    }
    for (const f of files) await rename(f.staged, f.final);
  } finally { await rm(staging, { recursive: true, force: true }); }

  async function exportPreset(name, p, input, src) {
    const size = p.size ?? [src.width, src.height];
    const label = p.label ?? name;
    const notes = [];
    let noAudio = silent || !p.audio?.codec;
    if (!noAudio && !src.acodec) { noAudio = true; notes.push('render has no audio'); }
    let af = [];
    if (!noAudio) {
      af = await loudnormArgs(input, p.audio);
      if (af.skipped) notes.push('loudness skipped (near-silent input)');
    }
    const at = (ext) => ({ staged: path.join(staging, `${name}.${ext}`), final: path.join(exportsDir, `${name}.${ext}`) });
    const out = [];
    // Measure a finished file and build its manifest entry (warnings that depend on what it contains are added here).
    const entry = async (format, where, { stepDown = null, extraNotes = [], still = false, ...extra } = {}) => {
      const m = await probe(where.staged), warnings = [];
      const loud = m.acodec ? await measureLoudness(where.staged) : null;
      if (m.acodec && commercial && p.public)
        warnings.push(`commercial music on a public platform (${label}) risks a mute or takedown: export with --silent or use a licensed track`);
      if (loud && !af.skipped) { const miss = loudnessMiss(loud, p.audio); if (miss) warnings.push(miss); }
      if (!still && p.maxSeconds && m.duration > p.maxSeconds)
        warnings.push(`over the ${p.maxSeconds} s maximum length for ${label} (${m.duration.toFixed(2)} s): the platform may reject or trim it`);
      return { preset: name, format, path: rel(where.final), bytes: m.bytes, duration: still ? null : m.duration, width: m.width, height: m.height,
        fps: still ? null : m.fps, vcodec: m.vcodec, acodec: m.acodec, lufs: loud ? round1(loud.I) : null, truePeak: loud ? round1(loud.TP) : null,
        ...extra, stepDown, notes: [...notes, ...extraNotes], warnings, source: p.source ?? null, checked: p.checked ?? null,
        estimated: p.estimated ?? [], staged: where.staged, final: where.final };
    };

    if (p.gif) {
      // GIF: narrow by 0.8 per try until it fits its cap (gif.maxMB, the one source of the GIF cap).
      const cap = p.gif.maxMB ?? p.maxMB, where = at('gif');
      let width = Math.min(p.gif.width ?? src.width, src.width), first = null, m;
      for (let tries = 1; ; tries++) {
        await encodeGif(input, where.staged, { width, fps: p.gif.fps ?? p.fps });
        m = await probe(where.staged);
        first ??= [m.width, m.height];
        if (!cap || m.bytes <= capBytes(cap)) break;
        if (tries === GIF_TRIES) throw new Error(`${name}: GIF still ${(m.bytes / MB).toFixed(2)} MB at width ${width} after ${GIF_TRIES} tries; cap is ${cap} MB (lower gif.fps or gif.width, or shorten the piece)`);
        width = Math.max(2, Math.round((width * 0.8) / 2) * 2);
      }
      const stepped = m.width !== first[0];
      return [await entry('gif', where, { stepDown: stepped ? { from: first, to: [m.width, m.height] } : null })];
    }

    const outputs = p.outputs ?? ['mp4'];
    const cap = p.maxMB;
    // Never ship a file over the cap: formats without a fitting strategy just check it.
    const checkCap = async (where) => {
      const bytes = (await stat(where.staged)).size;
      if (cap && bytes > capBytes(cap)) throw new CapError(`${name}: ${path.basename(where.final)} is ${(bytes / MB).toFixed(2)} MB, over its ${cap} MB cap`);
    };
    if (outputs.includes('mp4')) {
      const where = at('mp4'), opts = { size, fps: p.fps, video: p.video, audio: p.audio, silent: noAudio, af };
      await encode(input, where.staged, opts);
      let bytes = (await stat(where.staged)).size, stepDown = null;
      const capNotes = [];
      if (cap && bytes > capBytes(cap)) {
        // Over the cap at CRF: two-pass at the bitrate that fills it; one retry aiming lower if the container overshoots.
        const crfMB = (bytes / MB).toFixed(2);
        for (const headroom of [0.97, 0.93]) {
          const fit = fitToCap({ duration: src.duration, maxMB: cap, audioKbps: noAudio ? 0 : p.audio.kbps, sizes: capSizes(size), headroom });
          if (fit.error) throw new CapError(`${name}: ${fit.error}`);
          await encode(input, where.staged, { ...opts, size: fit.size, videoKbps: fit.videoKbps });
          bytes = (await stat(where.staged)).size;
          stepDown = fit.size[0] === size[0] && fit.size[1] === size[1] ? null : { from: size, to: fit.size, videoKbps: fit.videoKbps };
          capNotes[0] = `over ${cap} MB at CRF ${p.video?.crf ?? 20} (${crfMB} MB): two-pass at ${fit.videoKbps} kbps`;
          if (bytes <= capBytes(cap)) break;
        }
        if (bytes > capBytes(cap)) throw new Error(`${name}: two-pass encode still ${(bytes / MB).toFixed(2)} MB, over its ${cap} MB cap`);
      }
      out.push(await entry('mp4', where, { stepDown, extraNotes: capNotes }));
    }
    if (outputs.includes('webm')) {
      const where = at('webm');
      await encodeWebm(input, where.staged, { size, fps: p.fps, silent: noAudio, af });
      await checkCap(where);
      out.push(await entry('webm', where));
    }
    if (outputs.includes('poster')) {
      const where = at('jpg');
      const t = Math.min(beatTime(song, POSTER_BEAT), src.duration - 1 / song.fps);
      await poster(input, where.staged, { size, t });
      await checkCap(where);
      out.push(await entry('jpg', where, { still: true, posterAt: Math.round(t * 1000) / 1000, extraNotes: [`poster at beat ${POSTER_BEAT} (${t.toFixed(3)} s)`] }));
    }
    return out;
  }

  // Keep the order the presets were asked for (a preset's own files stay in mp4, webm, jpg order).
  const ordered = files.map((f, i) => [f, i]).sort((a, b) => chosen.indexOf(a[0].preset) - chosen.indexOf(b[0].preset) || a[1] - b[1])
    .map(([{ staged, final, ...f }]) => f);
  const manifest = { project: path.basename(root), created: new Date().toISOString(), renders, files: ordered };
  await writeFile(path.join(exportsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const f of ordered) log(summary(f));
  return manifest;
}

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

// One line per file; the notes and warnings themselves are in the manifest.
function summary(f) {
  const audio = f.duration == null ? 'still' : f.acodec ? `${f.lufs} LUFS ${f.truePeak} dBTP` : 'no audio';
  const timing = f.duration == null ? '' : `${f.fps}fps ${f.duration.toFixed(2)}s `;
  const n = (count, word) => (count ? `, ${count} ${word}${count > 1 ? 's' : ''}` : '');
  const step = f.stepDown ? `, stepped down from ${f.stepDown.from.join('x')}` : '';
  return `${f.preset.padEnd(20)} ${f.width}x${f.height} ${timing}${(f.bytes / MB).toFixed(2)} MB ${audio}  ${f.path}`
    + `${step}${n(f.warnings.length, 'warning')}${n(f.notes.length, 'note')}${n(f.estimated.length, 'estimated value')}`;
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
    if (e instanceof UsageError && !(e instanceof CapError) && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
