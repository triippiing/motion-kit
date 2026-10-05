#!/usr/bin/env node
// gallery.mjs [OUT] [--only a,b] [--stills] -- a project that plays every component in catalog order:
// a neutral rest shape, each component's example (2 beats each), then each component's edge cases
// (2 beats each), then back to rest. Starting from rest gives every example a real entrance.
// --stills writes components/docs-images/<name>.png (480 px) from a settled frame of each example.
// The footage component plays a synthetic clip the gallery makes itself (ffmpeg's testsrc pattern, footage/demo).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './build_catalog.mjs';
import { scaffold } from './scaffold.mjs';
import { openProject, shoot, FFMPEG } from './render.mjs';
import { isMain } from './is_main.mjs';
import { beatTime } from '../components/core/timing.js';

const COMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
const REST = "name: 'rest', w: 160, h: 160, r: 80";

// Builds the gallery project inside ROOT (a directory the caller owns and removes).
export async function gallery({ only = null, root } = {}) {
  if (!root) throw new Error('gallery: root (the directory to build the project in) is required');
  let list = await collect();
  if (only) list = list.filter((c) => only.includes(c.meta.name));
  if (!list.length) throw new Error('no components to show');
  const plays = [
    ...list.map((c) => ({ name: c.meta.name, kind: 'example', src: c.meta.example.replace(/^\{\s*at:\s*[\d.]+,\s*/, '').replace(/\s*\}$/, '') })),
    ...list.flatMap((c) => c.meta.edgeCases.map((e) => ({ name: c.meta.name, kind: 'edge',
      src: [`use: '${c.meta.name}'`, ...Object.entries(e).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)].join(', ') }))),
  ].map((p, i) => ({ ...p, at: 2 + i * 2 }));
  const bars = Math.ceil((plays.length * 2 + 4) / 4);
  const states = `[\n  { at: 0, ${REST} },\n${plays.map((p) => `  { at: ${p.at}, ${p.src} },`).join('\n')}\n  { at: END - 2, ${REST} },\n]`;
  // x/y are shape-centred and scaled by the camera zoom, so the rest stays near the shape to stay on stage
  const cursor = '[\n  { at: 0, x: 140, y: 100 },\n  { at: END - 2, x: 140, y: 100 },\n]';
  const dir = scaffold(root, { states, cursor, bars });
  if (list.some((c) => c.meta.name === 'footage')) await demoClip(root, path.join(dir, 'footage', 'demo'));
  return { dir, list, plays };
}

// footage/demo for the footage component's example and edge cases: 4 s of testsrc, 1280x720 at 30 fps.
async function demoClip(root, out) {
  const video = path.join(root, 'testsrc.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-t', '4', '-pix_fmt', 'yuv420p', video]);
  const { footage } = await import('./footage.mjs');
  await footage(video, out, { fps: 30, maxWidth: 1280 });
}

const USAGE = 'usage: gallery.mjs [OUT] [--only a,b] [--stills]';
// Command-line flags in any order: an optional OUT directory (an empty one is none), --only NAMES, --stills.
export function parseArgs(argv) {
  const o = { out: null, only: null, stills: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stills') o.stills = true;
    else if (a === '--only') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`--only needs a comma-separated list of components (${USAGE})`);
      o.only = v.split(',').filter(Boolean);
    } else if (a.startsWith('--')) throw new Error(`unknown option "${a}" (${USAGE})`);
    else if (o.out !== null) throw new Error(`one OUT directory at most, got "${o.out}" and "${a}" (${USAGE})`);
    else o.out = a || null;
  }
  return o;
}

if (isMain(import.meta.url)) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  const { out, only, stills } = args;
  if (only) {
    const names = (await collect()).map((c) => c.meta.name);
    const bad = only.filter((n) => !names.includes(n));
    if (bad.length || !only.length) { console.error(`error: --only names no known component: ${bad.join(', ') || '(empty)'} (have: ${names.join(', ')})`); process.exit(2); }
  }
  // With no OUT and no --stills the project itself is the output, so it stays and its path is printed.
  const root = mkdtempSync(path.join(tmpdir(), 'mk-gallery-'));
  const keep = !out && !stills;
  let failed = false;
  try {
    const { dir, plays } = await gallery({ only, root });
    if (out) execFileSync('cp', ['-R', dir + '/.', out]);
    if (stills) {
      mkdirSync(path.join(COMP, 'docs-images'), { recursive: true });
      const proj = await openProject(dir, { workers: 1 });
      try {
        const song = proj.song;
        // Thumbnails show the component alone, without the resting cursor.
        await proj.pages[0].evaluate(() => { document.querySelector('#cursor').style.display = 'none'; });
        for (const p of plays.filter((p) => p.kind === 'example')) {
          const t = beatTime(song, p.at + 1 + 0.4);
          const png = await shoot(proj.pages[0], t);
          const f = path.join(COMP, 'docs-images', `${p.name}.png`);
          writeFileSync(f + '.full.png', png);
          execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', f + '.full.png', '-vf', 'scale=480:-1', f]);
          execFileSync('rm', [f + '.full.png']);
        }
      } finally { await proj.close(); }   // an open browser would keep a failed run from exiting
    }
    console.log(out ?? (stills ? path.join(COMP, 'docs-images') : dir));
  } catch (e) {
    failed = true;
    console.error(`error: ${e.message.split('\n')[0]}`);
    process.exitCode = 2;
  } finally {
    // a failed run has no project worth keeping
    if (!keep || failed) rmSync(root, { recursive: true, force: true });
  }
}
