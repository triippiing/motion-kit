// media.mjs -- ffmpeg helpers for export.mjs: probe a file, measure loudness, build the two-pass
// loudnorm filter, and encode one delivery file from a render.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { FFMPEG } from './render.mjs';

const run = promisify(execFile);
export const FFPROBE = FFMPEG.replace(/ffmpeg$/, 'ffprobe');

// Size caps: a preset's maxMB is decimal megabytes (10^6 bytes, as platforms count them); aim 3% under
// the cap to leave room for container overhead.
export const MB = 1e6;
export const capBytes = (maxMB) => maxMB * MB;
export const targetBytes = (maxMB) => Math.floor(maxMB * MB * 0.97);

async function ffmpeg(args) {
  try { return (await run(FFMPEG, ['-hide_banner', '-nostats', ...args], { maxBuffer: 64 << 20 })).stderr; }
  catch (e) { throw new Error(`ffmpeg failed: ${String(e.stderr || e.message).trim().slice(-800)}`); }
}

const num = (s) => (s == null || /^-?inf$/i.test(String(s).trim()) ? -Infinity : Number(s));

export async function probe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return { duration: Number(j.format.duration), width: v?.width ?? null, height: v?.height ?? null, fps: d ? n / d : null,
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

// "8M" / "800k" / 8000000 -> bits per second.
export function parseRate(r) {
  const m = String(r).match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) throw new Error(`bad bitrate "${r}" (expected e.g. 8M or 800k)`);
  return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] ?? 1));
}

// Encode one delivery file: drop to `fps`, scale to `size`, H.264 at the preset's CRF (capped by its
// maxrate, with bufsize = 2 x maxrate), AAC after `af` (loudnormArgs), or no audio when `silent`.
// Writes beside `output` and renames on success, so a failed encode never leaves a partial file.
export async function encode(input, output, { size, fps, video = {}, audio = {}, silent = false, af = [] }) {
  const [w, h] = size;
  const args = ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-vf', `fps=${fps},scale=${w}:${h}:flags=lanczos,setsar=1`,
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', video.profile ?? 'high', '-pix_fmt', 'yuv420p', '-crf', String(video.crf ?? 20)];
  if (video.maxrate) { const b = parseRate(video.maxrate); args.push('-maxrate', String(b), '-bufsize', String(2 * b)); }
  if (silent) args.push('-an');
  else args.push('-map', '0:a:0', ...af, '-c:a', 'aac', '-b:a', `${audio.kbps ?? 128}k`, '-ar', '48000');
  const { dir, name, ext } = path.parse(output);
  const part = path.join(dir, `${name}.part${ext}`);
  args.push('-movflags', '+faststart', part);
  try { await ffmpeg(args); await rename(part, output); } catch (e) { await rm(part, { force: true }); throw e; }
}
