#!/usr/bin/env node
// footage.mjs -- turn any video (a screen recording, a phone capture) into a clip for the footage component.
//
//   node footage.mjs VIDEO --out CLIPDIR [--fps N] [--max-width PX]
//
// Extracts the video's frames with ffmpeg at --fps (default 60) into CLIPDIR as frame-00001.jpg ..., the video's
// size capped at --max-width (default 1600; never scaled up; even dimensions, aspect kept), and writes clip.json
// with mode "video", no steps, and source = the video's file name. CLIPDIR must be new, empty, or an existing clip
// (whose frames are replaced). Clips are git-ignored (footage/), like renders.
import path from 'node:path';
import { UsageError } from './render.mjs';
import { isMain } from './is_main.mjs';
import { extractFrames, writeClip } from './clip.mjs';

const USAGE = 'usage: footage.mjs VIDEO --out CLIPDIR [--fps N] [--max-width PX]';

export async function footage(video, out, { fps = 60, maxWidth = 1600 } = {}) {
  const { frames, width, height } = await extractFrames(video, out, { fps, maxWidth });
  return writeClip(out, { fps, width, height, frames, duration: frames / fps, mode: 'video', source: path.basename(video), steps: [] });
}

function parseArgs(argv) {
  const o = {}; let video;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (video != null) throw new UsageError(`unexpected argument "${a}"`); video = a; continue; }
    const k = { '--out': 'out', '--fps': 'fps', '--max-width': 'maxWidth' }[a];
    if (!k) throw new UsageError(`unknown flag ${a}`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value`);
    o[k] = argv[++i];
  }
  if (!video) throw new UsageError(USAGE);
  if (!o.out) throw new UsageError('--out CLIPDIR is required (e.g. --out footage/NAME in the project)');
  const fps = o.fps == null ? 60 : Number(o.fps);
  if (o.fps != null && (o.fps.trim() === '' || !Number.isFinite(fps) || fps <= 0)) throw new UsageError(`--fps must be a number > 0, got "${o.fps}"`);
  const maxWidth = o.maxWidth == null ? 1600 : Number(o.maxWidth);
  if (o.maxWidth != null && (!/^[0-9]+$/.test(o.maxWidth) || maxWidth < 2 || maxWidth % 2)) {
    throw new UsageError(`--max-width must be an even integer >= 2, got "${o.maxWidth}"`);
  }
  return { video, out: o.out, fps, maxWidth };
}

async function main() {
  const { video, out, ...opts } = parseArgs(process.argv.slice(2));
  const clip = await footage(video, out, opts);
  console.log(`footage: ${clip.frames} frames, ${+clip.duration.toFixed(3)} s, ${clip.width}x${clip.height} -> ${out}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
