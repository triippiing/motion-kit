#!/usr/bin/env node
// gallery.mjs OUT [--only a,b] [--stills] -- a project that plays every component in catalog order.
// --stills writes components/docs-images/<name>.png (480 px) from a settled frame of each component.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './build_catalog.mjs';
import { makeProject } from '../tests/harness.mjs';
import { openProject, shoot, FFMPEG } from './render.mjs';

const COMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
export async function gallery({ only = null } = {}) {
  let list = await collect();
  if (only) list = list.filter((c) => only.includes(c.meta.name));
  const rows = list.map((c, i) => `  { at: ${i * 2}, ${c.meta.example.replace(/^\{\s*at:\s*[\d.]+,\s*/, '')},`.replace(/\},$/, ' },'));
  const first = list[0].meta.example.replace(/^\{\s*at:\s*[\d.]+,\s*/, '').replace(/\}$/, '');
  const beats = list.length * 2 + 2;
  const bars = Math.ceil(beats / 4);
  const states = `[\n${rows.join('\n')}\n  { at: END - 2, ${first} },\n]`;
  const cursor = "[\n  { at: 0, x: 300, y: 320 },\n  { at: END - 2, x: 300, y: 320 },\n]";
  const dir = makeProject({ states, cursor, bars });
  return { dir, list };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2];
  const oi = process.argv.indexOf('--only');
  const { dir, list } = await gallery({ only: oi > 0 ? process.argv[oi + 1].split(',') : null });
  if (out) execFileSync('cp', ['-R', dir + '/.', out]);
  if (process.argv.includes('--stills')) {
    mkdirSync(path.join(COMP, 'docs-images'), { recursive: true });
    const proj = await openProject(dir, { workers: 1 });
    const song = proj.song;
    // Thumbnails show the component alone; the gallery's resting cursor would sit clipped at the edge.
    await proj.pages[0].evaluate(() => { document.querySelector('#cursor').style.display = 'none'; });
    for (const [i, c] of list.entries()) {
      const t = (song.beats[i * 2 + 1] ?? song.beats.at(-1)).t + 0.4 * song.beat_sec;
      const png = await shoot(proj.pages[0], t);
      const f = path.join(COMP, 'docs-images', `${c.meta.name}.png`);
      writeFileSync(f + '.full.png', png);
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', f + '.full.png', '-vf', 'scale=480:-1', f]);
      execFileSync('rm', [f + '.full.png']);
    }
    await proj.close();
  }
  console.log(dir);
}
