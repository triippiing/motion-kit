// media.mjs -- ffmpeg helpers for export.mjs: probe a file, measure loudness, build the two-pass
// loudnorm filter, fit a size cap, and encode delivery files (H.264 CRF or two-pass, VP9 WebM, poster
// JPG, palette GIF) from a render.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FFMPEG } from './render.mjs';

const run = promisify(execFile);
export const FFPROBE = FFMPEG.replace(/ffmpeg$/, 'ffprobe');

// Size caps: a preset's maxMB is decimal megabytes (10^6 bytes, as platforms count them); aim 3% under
// the cap to leave room for container overhead (a retry aims 7% under).
export const MB = 1e6;
export const capBytes = (maxMB) => maxMB * MB;
export const targetBytes = (maxMB, headroom = 0.97) => Math.floor(maxMB * MB * headroom);

// Lowest video bitrate (kbps) worth shipping, by short side. Below it a smaller frame looks better.
export const FLOOR_KBPS = { 1080: 1500, 720: 800, 540: 450 };
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

// The sizes a capped encode may use, largest first: the preset size, then the same shape scaled to each
// FLOOR_KBPS short side below it (even dimensions; never scaled up).
export function capSizes([w, h], floorKbps = FLOOR_KBPS) {
  const s = Math.min(w, h), out = [[w, h]];
  for (const k of Object.keys(floorKbps).map(Number).sort((a, b) => b - a)) if (k < s) out.push([even((w * k) / s), even((h * k) / s)]);
  return out;
}

// The floor for a size: the table's value at its short side; for a short side not in the table (e.g. a
// 1440 square, or a small test stage), the nearest entry scaled by pixel area.
export function floorFor([w, h], floorKbps = FLOOR_KBPS) {
  const s = Math.min(w, h), k = Object.keys(floorKbps).map(Number).reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
  return Math.round(floorKbps[k] * (s / k) ** 2);
}

// Video bitrate that fills maxMB (less headroom and the audio's share) over `duration`, at the largest of
// `sizes` whose floor it meets: { size, videoKbps }, or { error } when even the smallest size is under its floor.
export function fitToCap({ duration, maxMB, audioKbps = 0, sizes, floorKbps = FLOOR_KBPS, headroom = 0.97 }) {
  const videoKbps = Math.floor((targetBytes(maxMB, headroom) * 8) / 1000 / duration - audioKbps);
  for (const size of sizes) if (videoKbps >= floorFor(size, floorKbps)) return { size, videoKbps };
  const last = sizes.at(-1);
  return { error: `cannot fit ${maxMB} MB in ${duration.toFixed(2)} s: that leaves ${Math.max(0, videoKbps)} kbps for video`
    + `${audioKbps ? ` after ${audioKbps} kbps of audio` : ''}, and even ${last.join('x')} needs at least ${floorFor(last, floorKbps)} kbps`
    + ` (raise maxMB, shorten the piece${audioKbps ? ', or export --silent' : ''})` };
}

async function ffmpeg(args) {
  try { return (await run(FFMPEG, ['-hide_banner', '-nostats', ...args], { maxBuffer: 64 << 20 })).stderr; }
  catch (e) { throw new Error(`ffmpeg failed: ${String(e.stderr || e.message).trim().slice(-800)}`); }
}

const num = (s) => (s == null || /^-?inf$/i.test(String(s).trim()) ? -Infinity : Number(s));

export async function probe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate,duration:format=duration', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return { duration: Number(j.format.duration), videoDuration: v ? Number(v.duration) : null, width: v?.width ?? null, height: v?.height ?? null, fps: d ? n / d : null,
    vcodec: v?.codec_name ?? null, acodec: a?.codec_name ?? null, bytes: (await stat(file)).size };
}

// Integrated loudness (LUFS) and true peak (dBTP) of the first audio stream, from ebur128's summary.
export async function measureLoudness(file) {
  const err = await ffmpeg(['-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-']);
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const I = summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/), TP = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
  if (!I || !TP) throw new Error(`could not read ebur128 summary for ${file}`);
  return { I: num(I[1]), TP: num(TP[1]) };
}

// Two-pass loudnorm: measure the input, then return ffmpeg args applying a linear gain to reach
// `lufs` without exceeding `truePeak` (loudnorm falls back to its dynamic mode when a linear gain
// would clip). Returns an array of ffmpeg args; `.skipped` is true (and the array empty) when the
// input is near-silent (below -50 LUFS), where normalising would only amplify noise.
export async function loudnormArgs(file, { lufs, truePeak }) {
  const target = `I=${lufs}:TP=${truePeak}:LRA=11`;
  const err = await ffmpeg(['-i', file, '-map', '0:a:0', '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  const measured = { I: num(m.input_i), TP: num(m.input_tp), LRA: num(m.input_lra), thresh: num(m.input_thresh), offset: num(m.target_offset) };
  if (!(measured.I >= -50)) return Object.assign([], { skipped: true, measured });
  const f = `loudnorm=${target}:measured_I=${measured.I}:measured_TP=${measured.TP}:measured_LRA=${measured.LRA}`
    + `:measured_thresh=${measured.thresh}:offset=${measured.offset}:linear=true,aresample=48000`;
  return Object.assign(['-af', f], { skipped: false, measured });
}

// After an encode: a warning when the file missed its loudness target by more than 1 LU or its true
// peak ceiling by more than 0.5 dB (loudnorm falls back to dynamic mode, or AAC adds overshoot); else null.
export function loudnessMiss({ I, TP }, { lufs, truePeak }) {
  const miss = [];
  if (!(Math.abs(I - lufs) <= 1)) miss.push(`integrated ${I.toFixed(1)} LUFS vs target ${lufs}`);
  if (!(TP <= truePeak + 0.5)) miss.push(`true peak ${TP.toFixed(1)} dBTP vs ceiling ${truePeak}`);
  return miss.length ? `loudness missed its target: ${miss.join('; ')}` : null;
}

// "8M" / "800k" / 8000000 -> bits per second.
export function parseRate(r) {
  const m = String(r).match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) throw new Error(`bad bitrate "${r}" (expected e.g. 8M or 800k)`);
  return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] ?? 1));
}

// Run ffmpeg into `output` via a .part file beside it, renamed on success, so a failed encode never leaves
// a partial file. `args(part)` builds the ffmpeg args for the part path.
async function atomically(output, args) {
  const { dir, name, ext } = path.parse(output);
  const part = path.join(dir, `${name}.part${ext}`);
  try { await ffmpeg(args(part)); await rename(part, output); } catch (e) { await rm(part, { force: true }); throw e; }
}

const scaleTo = ([w, h]) => `scale=${w}:${h}:flags=lanczos,setsar=1`;
const aacArgs = ({ silent, af, audio }) => (silent ? ['-an'] : ['-map', '0:a:0', ...af, '-c:a', 'aac', '-b:a', `${audio.kbps ?? 128}k`, '-ar', '48000']);

// Encode one delivery MP4: drop to `fps`, scale to `size`, H.264 High yuv420p, AAC after `af` (loudnormArgs),
// or no audio when `silent`; faststart. Rate control: the preset's CRF (capped by its maxrate, bufsize =
// 2 x maxrate) or, with `videoKbps`, a two-pass average bitrate with maxrate = 2 x videoKbps (or the preset's
// maxrate if lower) and bufsize = 2 x maxrate. The pass log lives in a temp dir removed on every path.
export async function encode(input, output, { size, fps, video = {}, audio = {}, silent = false, af = [], videoKbps = null }) {
  const head = ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-vf', `fps=${fps},${scaleTo(size)}`,
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', video.profile ?? 'high', '-pix_fmt', 'yuv420p'];
  const tail = (part) => [...aacArgs({ silent, af, audio }), '-movflags', '+faststart', part];
  if (!videoKbps) {
    const rate = ['-crf', String(video.crf ?? 20)];
    if (video.maxrate) { const b = parseRate(video.maxrate); rate.push('-maxrate', String(b), '-bufsize', String(2 * b)); }
    return atomically(output, (part) => [...head, ...rate, ...tail(part)]);
  }
  const b = videoKbps * 1000, max = Math.min(2 * b, video.maxrate ? parseRate(video.maxrate) : Infinity);
  const logDir = await mkdtemp(path.join(tmpdir(), 'mk-2pass-'));
  const rate = ['-b:v', String(b), '-maxrate', String(max), '-bufsize', String(2 * max), '-passlogfile', path.join(logDir, 'x264')];
  try {
    await ffmpeg([...head, ...rate, '-pass', '1', '-an', '-f', 'null', '-']);
    await atomically(output, (part) => [...head, ...rate, '-pass', '2', ...tail(part)]);
  } finally { await rm(logDir, { recursive: true, force: true }); }
}

// WebM: VP9 at constant quality (CRF 34, -b:v 0) and Opus 96k after `af`, same fps drop and scale.
// cpu-used 2 keeps VP9 at a practical speed for full-size renders (libvpx's default is its slowest).
export async function encodeWebm(input, output, { size, fps, silent = false, af = [] }) {
  const audio = silent ? ['-an'] : ['-map', '0:a:0', ...af, '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000'];
  return atomically(output, (part) => ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-vf', `fps=${fps},${scaleTo(size)}`,
    '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-cpu-used', '2', '-pix_fmt', 'yuv420p', ...audio, '-f', 'webm', part]);
}

// Poster: the frame at `t` seconds, scaled to `size`, as a JPEG (quality 3).
export async function poster(input, output, { size, t }) {
  return atomically(output, (part) => ['-y', '-v', 'error', '-ss', t.toFixed(6), '-i', input, '-map', '0:v:0', '-frames:v', '1',
    '-vf', scaleTo(size), '-q:v', '3', '-update', '1', '-f', 'image2', '-c:v', 'mjpeg', part]);
}

// GIF: `fps`, `width` wide (height keeps the aspect), with a palette built from the frames that change.
export async function encodeGif(input, output, { width, fps }) {
  const graph = `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];`
    + '[b][p]paletteuse=dither=bayer:bayer_scale=4';
  return atomically(output, (part) => ['-y', '-v', 'error', '-i', input, '-filter_complex', graph, '-an', '-f', 'gif', part]);
}
