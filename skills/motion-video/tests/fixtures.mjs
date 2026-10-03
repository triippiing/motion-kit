import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { FFMPEG } from '../scripts/render.mjs';
import { tempDir } from './tmp.mjs';

// A tiny project: 64x64 stage, 1s loop, 4 beats. `body` is the seek implementation.
export function fixture({ seek = 'document.body.style.background = "#808080";', sfx = null, beats = null, name = 'fx proj (1)' } = {}) {
  const dir = path.join(tempDir('mv-'), name);
  mkdirSync(path.join(dir, 'sfx'), { recursive: true });
  const song = {
    fps: 60, beat_sec: 0.25, beats_per_bar: 4,
    loop: { duration_sec: 1, frames: 60, frame_dt: 1 / 60 },
    beats: beats ?? [0, 1, 2, 3].map((i) => ({ i, t: i * 0.25, cue_t: i * 0.25, frame: i * 15, bar: 0, beat_in_bar: i })),
  };
  writeFileSync(path.join(dir, 'song.json'), JSON.stringify(song));
  writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body style="margin:0">
<script>
window.STAGE = { width: 64, height: 64 };
${sfx ? `window.SFX = ${JSON.stringify(sfx)};` : ''}
window.ready = Promise.resolve();
window.seek = function (t) { ${seek} };
window.inspect = function (t) { return { cursor: { x: 10, y: 10 } }; };
</script></body></html>`);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', path.join(dir, 'clip.wav')]);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=1000:r=48000', '-t', '0.05', path.join(dir, 'sfx', 'click.wav')]);
  return dir;
}

export function probe(file) {
  return JSON.parse(execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,nb_read_frames,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
}

// Mean gray of frame n, or of the box { x, y, w, h } in it.
export function grayFrame(file, n, box = null) {
  const crop = box ? `,crop=${box.w}:${box.h}:${box.x}:${box.y}` : '';
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n})${crop}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

export function audioSamples(file) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}
