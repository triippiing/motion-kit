#!/usr/bin/env node
// beat_stills.mjs DIR -- render one still per beat and a contact sheet (one bar
// per row), then check the loop seam: frame at t=0 vs t=D, and the cursor's
// position and velocity either side. Review the sheet BEFORE a full render.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openProject, shoot, FFMPEG } from './render.mjs';
import { beatTime } from '../components/core/timing.js';

const PSNR_MIN = 45;       // dB; identical frames report inf
const CURSOR_POS_MAX = 0.5; // px
const CURSOR_VEL_MAX = 2;   // px/s

export async function beatStills(dir, { outDir } = {}) {
  const root = path.resolve(dir);
  const out = path.resolve(outDir ?? path.join(root, 'out', 'stills'));
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const proj = await openProject(root, { workers: 4 });
  try {
    const { song, pages, errors } = proj;
    const D = song.loop.duration_sec;
    const stills = [];
    for (let b = 0; b < song.beats.length; b += pages.length) {
      const batch = song.beats.slice(b, b + pages.length);
      const shots = await Promise.all(batch.map((_, k) => shoot(pages[k], beatTime(song, b + k))));
      if (errors.length) throw errors[0];
      for (let k = 0; k < shots.length; k++) {
        const f = path.join(out, `beat_${String(b + k).padStart(3, '0')}.png`);
        await writeFile(f, shots[k]); stills.push(f);
      }
    }
    const cols = song.beats_per_bar ?? 4, rows = Math.ceil(stills.length / cols);
    const sheet = path.join(out, 'contact-sheet.png');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(out, 'beat_%03d.png'),
      '-vf', `scale=360:-1,tile=${cols}x${rows}:padding=12:margin=12:color=0xECEAE6`, '-frames:v', '1', sheet]);

    const notes = [];
    const a = path.join(out, 'seam_start.png'), z = path.join(out, 'seam_end.png');
    await writeFile(a, await shoot(pages[0], 0));
    await writeFile(z, await shoot(pages[0], D));
    const r = spawnSync(FFMPEG, ['-v', 'info', '-i', a, '-i', z, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = r.stderr.match(/average:(inf|[\d.]+)/);
    const psnr = m ? (m[1] === 'inf' ? Infinity : Number(m[1])) : NaN;
    if (!(psnr >= PSNR_MIN)) notes.push(`last frame differs from first frame (PSNR ${psnr} dB < ${PSNR_MIN})`);

    let cursorPos = 0, cursorVel = 0;
    const hasInspect = await pages[0].evaluate(() => typeof window.inspect === 'function');
    if (hasInspect) {
      const h = 1 / 240;
      const at = (t) => pages[0].evaluate((t) => window.inspect(t).cursor, t);
      const [p0, p1, q1, q0] = await Promise.all([at(0), at(h), at(D - h), at(D)]);
      cursorPos = Math.hypot(p0.x - q0.x, p0.y - q0.y);
      cursorVel = Math.hypot((p1.x - p0.x) / h - (q0.x - q1.x) / h, (p1.y - p0.y) / h - (q0.y - q1.y) / h);
      if (cursorPos > CURSOR_POS_MAX) notes.push(`cursor position jumps ${cursorPos.toFixed(2)}px at the seam`);
      if (cursorVel > CURSOR_VEL_MAX) notes.push(`cursor velocity jumps ${cursorVel.toFixed(1)}px/s at the seam`);
    } else {
      notes.push('no window.inspect: cursor seam not checked');
    }
    const ok = psnr >= PSNR_MIN && cursorPos <= CURSOR_POS_MAX && cursorVel <= CURSOR_VEL_MAX;
    return { stills, sheet, seam: { psnr, cursorPos, cursorVel, ok, notes } };
  } finally { await proj.close(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: beat_stills.mjs DIR'); process.exit(2); }
  beatStills(dir).then((r) => {
    console.log(`${r.stills.length} stills; contact sheet: ${r.sheet}`);
    console.log(`seam: ${r.seam.ok ? 'OK' : 'FAIL'} (PSNR ${r.seam.psnr} dB, cursor ${r.seam.cursorPos.toFixed(2)}px / ${r.seam.cursorVel.toFixed(1)}px/s)`);
    for (const n of r.seam.notes) console.log(`  - ${n}`);
    process.exit(r.seam.ok ? 0 : 1);
  }).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
