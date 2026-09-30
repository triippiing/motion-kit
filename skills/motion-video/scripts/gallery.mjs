#!/usr/bin/env node
// gallery.mjs OUT [--only a,b] [--stills] -- a project that plays every component in catalog order:
// a neutral rest shape, each component's example (2 beats each), then each component's edge cases
// (2 beats each), then back to rest. Starting from rest gives every example a real entrance.
// --stills writes components/docs-images/<name>.png (480 px) from a settled frame of each example.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './build_catalog.mjs';
import { makeProject } from '../tests/harness.mjs';
import { openProject, shoot, FFMPEG } from './render.mjs';

const COMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
const REST = "name: 'rest', w: 160, h: 160, r: 80";

export async function gallery({ only = null } = {}) {
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
  const cursor = '[\n  { at: 0, x: 300, y: 320 },\n  { at: END - 2, x: 300, y: 320 },\n]';
  const dir = makeProject({ states, cursor, bars });
  return { dir, list, plays };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const out = process.argv[2];
  const oi = process.argv.indexOf('--only');
  const only = oi > 0 ? (process.argv[oi + 1] ?? '').split(',').filter(Boolean) : null;
  if (only) {
    const names = (await collect()).map((c) => c.meta.name);
    const bad = only.filter((n) => !names.includes(n));
    if (bad.length || !only.length) { console.error(`error: --only names no known component: ${bad.join(', ') || '(empty)'} (have: ${names.join(', ')})`); process.exit(2); }
  }
  const { dir, plays } = await gallery({ only });
  if (out) execFileSync('cp', ['-R', dir + '/.', out]);
  if (process.argv.includes('--stills')) {
    mkdirSync(path.join(COMP, 'docs-images'), { recursive: true });
    const proj = await openProject(dir, { workers: 1 });
    const song = proj.song;
    // Thumbnails show the component alone; the gallery's resting cursor would sit clipped at the edge.
    await proj.pages[0].evaluate(() => { document.querySelector('#cursor').style.display = 'none'; });
    for (const p of plays.filter((p) => p.kind === 'example')) {
      const t = (song.beats[p.at + 1] ?? song.beats.at(-1)).t + 0.4 * song.beat_sec;
      const png = await shoot(proj.pages[0], t);
      const f = path.join(COMP, 'docs-images', `${p.name}.png`);
      writeFileSync(f + '.full.png', png);
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', f + '.full.png', '-vf', 'scale=480:-1', f]);
      execFileSync('rm', [f + '.full.png']);
    }
    await proj.close();
  }
  console.log(dir);
}
