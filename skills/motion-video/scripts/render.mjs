#!/usr/bin/env node
// render.mjs -- render a motion-video project (index.html + song.json + clip.wav) to MP4.
//
//   node render.mjs DIR [--preview] [--out FILE] [--sub 4] [--workers 4] [--from S --to S]
//   node render.mjs DIR --serve        serve DIR and print a URL (open with ?play to watch live)
//
// Full renders take `sub` subframes per output frame, centred on the frame time,
// and blend them with ffmpeg tmix for motion blur. Times wrap modulo the loop,
// so the blur across the seam is continuous. --preview is half size, 1 subframe.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A bad command line, not a bug: main() prints it as `error: ...` and exits 2.
export class UsageError extends Error {}

export const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

export function serve(dir, port = 0) {
  const root = path.resolve(dir);
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(root, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function openPage(browser, url, viewport, errors) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(url);
  const ok = await page.evaluate(() => typeof window.seek === 'function' && !!window.ready);
  if (!ok) throw new Error('index.html must define window.seek(t), window.ready and window.STAGE -- see motion-video/template/index.html');
  let timer;
  try {
    await Promise.race([
      page.evaluate(() => window.ready),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('window.ready did not resolve within 30s (fonts or song.json?)')), 30000); }),
    ]);
  } finally { clearTimeout(timer); }
  // STAGE may be set inside ready (the template reads project.json there).
  const stage = await page.evaluate(() => window.STAGE);
  if (!stage || !(stage.width > 0) || !(stage.height > 0)) throw new Error('index.html must define window.STAGE = {width, height} by the time window.ready resolves');
  return page;
}

export async function openProject(dir, { workers = 4 } = {}) {
  const root = path.resolve(dir);
  const song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8'));
  const { server, url } = await serve(root);
  const browser = await chromium.launch();
  const errors = [];
  try {
    const probePage = await openPage(browser, url, { width: 800, height: 800 }, errors);
    const stage = await probePage.evaluate(() => window.STAGE);
    await probePage.close();
    const viewport = { width: stage.width, height: stage.height };
    const pages = await Promise.all(Array.from({ length: workers }, () => openPage(browser, url, viewport, errors)));
    return { browser, pages, stage, song, errors, url,
      async close() { await browser.close(); server.close(); } };
  } catch (e) { await browser.close(); server.close(); throw e; }
}

export async function shoot(page, t) {
  await page.evaluate((t) => window.seek(t), t);
  return page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
}

function sfxInputs(dir, song, sfx, offset, duration) {
  const inputs = [], filters = [];
  sfx.forEach((c, n) => {
    // Same mapping as the page's beatT: cue_t of the floor beat plus the fraction.
    const i = Math.floor(c.beat), fb = song.beats?.[i];
    const t = (fb ? (fb.cue_t ?? fb.t) : i * song.beat_sec) + (c.beat - i) * song.beat_sec;
    const ms = Math.round((t - offset) * 1000);
    if (ms < 0 || ms > duration * 1000) return;
    inputs.push('-i', path.join(dir, c.file));
    filters.push(`[${inputs.length / 2 + 1}:a]aresample=48000,volume=${c.gain ?? 1},adelay=${ms}:all=1[s${n}]`);
  });
  return { inputs, filters, labels: filters.map((f) => f.slice(f.lastIndexOf('['))) };
}

export async function render(dir, opts = {}) {
  const root = path.resolve(dir);
  const preview = !!opts.preview;
  const proj = await openProject(root, { workers: opts.workers ?? 4 });
  try {
    const { song, pages, errors } = proj;
    const fps = song.fps, D = song.loop.duration_sec, frames = song.loop.frames;
    const dt = song.loop.frame_dt ?? D / frames;
    const from = opts.from ?? 0, to = opts.to ?? D;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= to || to > D + 1e-9)
      throw new UsageError(`--from/--to must satisfy 0 <= from < to <= ${D} (the loop duration in seconds); got from ${from}, to ${to}`);
    const sub = preview ? 1 : (opts.sub ?? 4);
    const f0 = opts.from != null ? Math.max(0, Math.floor(opts.from / dt)) : 0;
    const f1 = opts.to != null ? Math.min(frames, Math.ceil(opts.to / dt)) : frames;
    const total = (f1 - f0) * sub;
    const timeAt = (i) => {
      const f = f0 + Math.floor(i / sub), k = i % sub;
      const t = (f + (sub === 1 ? 0 : (k - (sub - 1) / 2) / sub)) * dt;
      return ((t % D) + D) % D;
    };
    const out = path.resolve(opts.out ?? path.join(root, 'out', preview ? 'preview.mp4' : 'video.mp4'));
    await mkdir(path.dirname(out), { recursive: true });
    // Encode beside the target under the same extension (ffmpeg picks the muxer from it)
    // and rename on success, so a failed render never destroys the previous video.
    const { dir: outDir, name: outName, ext: outExt } = path.parse(out);
    const part = path.join(outDir, `${outName}.part${outExt}`);

    const offset = f0 * dt, duration = (f1 - f0) * dt;
    const sfx = await pages[0].evaluate(() => window.SFX || []);
    for (const c of sfx) if (!existsSync(path.join(root, c.file))) throw new Error(`SFX file not found: ${c.file} (listed in window.SFX)`);
    const clip = path.join(root, 'clip.wav');
    const s = sfxInputs(root, song, sfx, offset, duration);
    const vf = [sub > 1 ? `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/${fps}/TB` : null,
      preview ? 'scale=trunc(iw/4)*2:-2' : null, 'format=yuv420p'].filter(Boolean).join(',');
    const args = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps * sub), '-c:v', 'png', '-i', '-'];
    let graph = `[0:v]${vf}[v]`;
    if (existsSync(clip)) {
      args.push('-ss', offset.toFixed(6), '-t', duration.toFixed(6), '-i', clip, ...s.inputs);
      graph += s.filters.length
        ? `;${s.filters.join(';')};[1:a]${s.labels.join('')}amix=inputs=${s.labels.length + 1}:normalize=0:duration=first[a]`
        : ';[1:a]anull[a]';
      args.push('-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '256k');
    } else {
      args.push('-filter_complex', graph, '-map', '[v]');
    }
    args.push('-r', String(fps), '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '23' : '16',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', duration.toFixed(6), part);

    const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d; });
    const done = new Promise((resolve, reject) => ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-800)}`))));

    const B = pages.length;
    done.catch(() => {});   // failures are surfaced by the awaits below, never as an unhandled rejection
    try {
    for (let b = 0; b < total; b += B) {
      const n = Math.min(B, total - b);
      const shots = await Promise.all(Array.from({ length: n }, (_, k) => shoot(pages[k], timeAt(b + k))));
      if (errors.length) throw errors[0];
      for (const png of shots) if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
      if (process.stderr.isTTY) process.stderr.write(`\r${Math.round(((b + n) / total) * 100)}%`);
    }
    ff.stdin.end();
    await done;
    await rename(part, out);
    } catch (e) { ff.kill('SIGKILL'); await rm(part, { force: true }); throw e; }
    if (process.stderr.isTTY) process.stderr.write('\n');
    return out;
  } finally { await proj.close(); }
}

const USAGE = 'usage: render.mjs DIR [--preview] [--out FILE] [--sub N] [--workers N] [--from S --to S] [--serve [--port N]]';

function parseArgs(argv) {
  const VALUE = new Set(['out', 'sub', 'workers', 'from', 'to', 'port']), BOOL = new Set(['preview', 'serve']);
  const o = {}; let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { dir ??= a; continue; }
    const k = a.slice(2);
    if (BOOL.has(k)) o[k] = true;
    else if (VALUE.has(k)) {
      if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`--${k} needs a value`);
      o[k] = argv[++i];
    } else throw new UsageError(`unknown flag ${a}`);
  }
  const posInt = (k) => {
    if (o[k] == null) return undefined;
    if (!/^[0-9]+$/.test(o[k]) || Number(o[k]) < 1) throw new UsageError(`--${k} must be a positive integer, got "${o[k]}"`);
    return Number(o[k]);
  };
  const secs = (k) => {
    if (o[k] == null) return undefined;
    if (o[k].trim() === '' || !Number.isFinite(Number(o[k]))) throw new UsageError(`--${k} must be a number of seconds, got "${o[k]}"`);
    return Number(o[k]);
  };
  return { dir, o, sub: posInt('sub'), workers: posInt('workers'), port: posInt('port'), from: secs('from'), to: secs('to') };
}

async function main() {
  const { dir, o, sub, workers, port, from, to } = parseArgs(process.argv.slice(2));
  if (!dir) throw new UsageError(USAGE);
  if (o.serve) {
    const { url } = await serve(dir, port ?? 8123);
    console.log(`${url}?play   (click the page to start audio)`);
    return;
  }
  console.log(await render(dir, { preview: !!o.preview, out: o.out, sub, workers, from, to }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
