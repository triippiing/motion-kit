// clip.mjs -- the clip format: a directory of JPEG frames (frame-00001.jpg ... frame-NNNNN.jpg; frame 1 is clip
// time 0) plus clip.json { fps, width, height, frames, duration, mode, source?, browser?, steps }. readClip validates
// a clip, writeClip validates and writes clip.json, framePath names a frame, and extractFrames fills a clip
// directory with the frames of a video (footage.mjs, and capture.mjs --realtime).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { FFMPEG, UsageError } from './render.mjs';
import { probe } from './media.mjs';

const run = promisify(execFile);
export const MODES = ['stepped', 'realtime', 'video'];
const FRAME = /^frame-\d{5}\.jpg$/;
const MAX_FRAMES = 99999;

// Frame n (1-based) of the clip in dir.
export const framePath = (dir, n) => path.join(dir, `frame-${String(n).padStart(5, '0')}.jpg`);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const evenInt = (x) => Number.isInteger(x) && x >= 2 && x % 2 === 0;

// Check a clip object against the frames in dir; throws a UsageError naming dir.
function validate(dir, clip) {
  const bad = (msg) => { throw new UsageError(`clip ${dir}: ${msg}`); };
  if (clip == null || typeof clip !== 'object' || Array.isArray(clip)) bad('clip.json must hold an object');
  const { fps, width, height, frames, duration, mode, steps } = clip;
  if (!isNum(fps) || fps <= 0) bad(`fps must be a number > 0, got ${JSON.stringify(fps)}`);
  if (!evenInt(width)) bad(`width must be an even integer >= 2, got ${JSON.stringify(width)}`);
  if (!evenInt(height)) bad(`height must be an even integer >= 2, got ${JSON.stringify(height)}`);
  if (!Number.isInteger(frames) || frames < 1 || frames > MAX_FRAMES) bad(`frames must be an integer from 1 to ${MAX_FRAMES}, got ${JSON.stringify(frames)}`);
  if (!isNum(duration) || Math.abs(duration - frames / fps) > 1 / fps + 1e-9) {
    bad(`duration must be frames / fps (${+(frames / fps).toFixed(6)} s, within one frame), got ${JSON.stringify(duration)}`);
  }
  if (!MODES.includes(mode)) bad(`mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(mode)}`);
  for (const k of ['source', 'browser']) if (clip[k] != null && typeof clip[k] !== 'string') bad(`${k} must be a string`);
  if (!Array.isArray(steps)) bad('steps must be a list');
  steps.forEach((s, i) => {
    const where = `step ${i + 1}${typeof s?.name === 'string' ? ` (${s.name})` : ''}`;
    if (s == null || typeof s !== 'object') bad(`${where} must be an object`);
    if (typeof s.name !== 'string' || !s.name) bad(`${where} needs a name`);
    if (typeof s.action !== 'string' || !s.action) bad(`${where} needs an action`);
    if (!isNum(s.t) || s.t < 0) bad(`${where} needs a time t >= 0 (clip seconds)`);
    const b = s.box;
    if (b == null || typeof b !== 'object' || !['x', 'y', 'w', 'h'].every((k) => isNum(b[k]))) bad(`${where} needs a box {x, y, w, h} (clip pixels)`);
  });
  let files;
  try { files = readdirSync(dir).filter((f) => FRAME.test(f)); } catch (e) { bad(`cannot list frames (${e.code || e.message})`); }
  for (let n = 1; n <= frames; n++) if (!existsSync(framePath(dir, n))) bad(`clip.json says ${frames} frames but ${path.basename(framePath(dir, n))} is missing`);
  if (files.length !== frames) bad(`clip.json says ${frames} frames but the directory has ${files.length} frame files`);
  return clip;
}

// Read and validate the clip in dir.
export function readClip(dir) {
  const file = path.join(dir, 'clip.json');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    throw new UsageError(`clip ${dir}: no clip.json there (${e.code === 'ENOENT' ? 'not a clip' : e.code || e.message})`);
  }
  let clip;
  try { clip = JSON.parse(text); } catch (e) { throw new UsageError(`clip ${dir}: clip.json is not valid JSON (${e.message})`); }
  return validate(dir, clip);
}

// Validate clip against the frames already in dir, then write dir/clip.json (via a temp file, renamed).
export function writeClip(dir, clip) {
  validate(dir, clip);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'clip.json'), tmp = `${file}.tmp-${process.pid}`;
  try { writeFileSync(tmp, `${JSON.stringify(clip, null, 2)}\n`); renameSync(tmp, file); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  return clip;
}

// Fill dir with the frames of `video` at `fps`, `maxWidth` wide at most (never scaled up; even dimensions, height
// keeps the aspect), JPEG quality 3. dir must be new, empty, or an existing clip (its frames and clip.json are
// replaced; other files are left alone). Frames go to a temp directory beside dir first, so a failed run leaves dir
// as it was. Writes no clip.json: the caller does (writeClip). Returns { frames, width, height }.
export async function extractFrames(video, dir, { fps = 60, maxWidth = 1600 } = {}) {
  if (!isNum(fps) || fps <= 0) throw new UsageError(`fps must be a number > 0, got ${fps}`);
  if (!evenInt(maxWidth)) throw new UsageError(`max width must be an even integer >= 2, got ${maxWidth}`);
  if (!existsSync(video)) throw new UsageError(`no such video: ${video}`);
  let info;
  try { info = await probe(video); } catch { info = null; }
  if (!info?.width) throw new UsageError(`${video} is not a video (ffprobe found no video stream)`);

  let existing = [];
  try { existing = readdirSync(dir); } catch (e) { if (e.code !== 'ENOENT') throw new UsageError(`cannot use ${dir} as the clip directory (${e.code || e.message})`); }
  if (existing.length && !existing.includes('clip.json')) {
    throw new UsageError(`${dir} is not empty and is not a clip (no clip.json); pick a new or empty directory`);
  }

  const parent = path.dirname(path.resolve(dir));
  mkdirSync(parent, { recursive: true });
  const tmp = await mkdtemp(path.join(parent, `.${path.basename(dir)}.tmp-`));
  try {
    try {
      await run(FFMPEG, ['-hide_banner', '-nostats', '-v', 'error', '-i', video, '-map', '0:v:0',
        '-vf', `fps=${fps},scale='min(${maxWidth},trunc(iw/2)*2)':-2`, '-q:v', '3', '-start_number', '1', path.join(tmp, 'frame-%05d.jpg')],
      { maxBuffer: 64 << 20 });
    } catch (e) { throw new Error(`ffmpeg failed: ${String(e.stderr || e.message).trim().slice(-800)}`); }
    const frames = (await readdir(tmp)).filter((f) => FRAME.test(f)).length;
    if (!frames) throw new UsageError(`${video} gave no frames at ${fps} fps`);
    if (frames > MAX_FRAMES) throw new UsageError(`${video} gives ${frames} frames at ${fps} fps; a clip holds at most ${MAX_FRAMES}`);
    const { width, height } = await probe(framePath(tmp, 1));

    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (FRAME.test(f) || f === 'clip.json') rmSync(path.join(dir, f), { force: true });
    for (let n = 1; n <= frames; n++) await rename(framePath(tmp, n), framePath(dir, n));
    return { frames, width, height };
  } finally { await rm(tmp, { recursive: true, force: true }); }
}
