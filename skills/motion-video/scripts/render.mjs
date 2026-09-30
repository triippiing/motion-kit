#!/usr/bin/env node
// render.mjs -- render a motion-video project (index.html + song.json + clip.wav) to MP4.
//
//   node render.mjs DIR [--preview] [--out FILE] [--sub 4] [--workers 4] [--from S --to S]
//   node render.mjs DIR --serve        serve DIR and print a URL (open with ?play to watch live)
//   --stage WxH renders (or serves) at another stage size without touching project.json: the server
//   answers project.json with the stage swapped in; output defaults to out/shapes/WxH/.
//   --guides PRESET renders with translucent bands over that preset's safe zones (safezones.mjs), at the preset's
//   own stage unless --stage says otherwise, to <outdir>/[preview-]guides-PRESET.mp4. A guides render is never
//   stamped, so export.mjs never reuses it.
//
// Full renders take `sub` subframes per output frame, centred on the frame time,
// and blend them with ffmpeg tmix for motion blur. Times wrap modulo the loop,
// so the blur across the seam is continuous; a one-off piece (project.json "loop": false)
// clamps them to [0, D] instead, so its end never blurs into its start. --preview is half size, 1 subframe.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A bad command line, not a bug: main() prints it as `error: ...` and exits 2.
export class UsageError extends Error {}

export const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

// The table block of the template's index.html runs from START_MARK to END_MARK.
const START_MARK = '// ---------------- the three tables you edit ----------------';
const END_MARK = '// ------------------------------------------------------------';

// index.html with its states()/cursor() replaced by `code` (a brief's ```js block), keeping the page's own extraSfx
// and content unless the code defines them. null when the page has no table markers.
export function spliceTables(html, code) {
  const a = html.indexOf(START_MARK), b = a < 0 ? -1 : html.indexOf(END_MARK, a + START_MARK.length);
  if (a < 0 || b < 0) return null;
  const block = html.slice(a + START_MARK.length, b);
  const defines = (src, name) => new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(src);
  let rest = '';
  if (!defines(code, 'extraSfx') && !defines(code, 'content')) {
    const k = block.search(/^\/\/ EXTRA_SFX|^const extraSfx\b/m);
    rest = k < 0 ? 'const extraSfx = () => [];\nconst content = {};\n' : block.slice(k);
  } else {
    if (!defines(code, 'extraSfx')) rest += 'const extraSfx = () => [];\n';
    if (!defines(code, 'content')) rest += 'const content = {};\n';
  }
  return `${html.slice(0, a)}${START_MARK}\n${code}\n${rest}${html.slice(b)}`;
}

// `stage` = [w, h] serves project.json (or {} when absent) with that stage merged in, `loop` (a boolean) with that
// "loop"; `tables` serves index.html with those tables spliced in (spliceTables). Nothing is written.
// `tablesSpliced` says whether the splice took.
export function serve(dir, port = 0, { stage, loop, tables } = {}) {
  const root = path.resolve(dir);
  const state = { tablesSpliced: false };
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(root, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      try {
        let body = (stage || loop != null) && rel === '/project.json' ? await stagedProject(file, { stage, loop }) : await readFile(file);
        if (tables != null && (rel === '/' || rel === '/index.html')) {
          const spliced = spliceTables(body.toString('utf8'), tables);
          if (spliced != null) { body = spliced; state.tablesSpliced = true; }
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/`,
      get tablesSpliced() { return state.tablesSpliced; } }));
  });
}

async function stagedProject(file, { stage, loop }) {
  let proj = {};
  try { proj = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (stage) proj.stage = { width: stage[0], height: stage[1] };
  if (loop != null) proj.loop = loop;
  return JSON.stringify(proj);
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

export async function openProject(dir, { workers = 4, stage: stageOverride, loop, tables } = {}) {
  const root = path.resolve(dir);
  const song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8'));
  const served = await serve(root, 0, { stage: stageOverride, loop, tables });
  const { server, url } = served;
  const browser = await chromium.launch();
  const errors = [];
  try {
    const probePage = await openPage(browser, url, { width: 800, height: 800 }, errors);
    const stage = await probePage.evaluate(() => window.STAGE);
    await probePage.close();
    if (stageOverride && (stage.width !== stageOverride[0] || stage.height !== stageOverride[1]))
      throw new Error(`asked for stage ${stageOverride.join('x')} but the page set ${stage.width}x${stage.height}; index.html must take its stage from project.json`);
    const viewport = { width: stage.width, height: stage.height };
    const pages = await Promise.all(Array.from({ length: workers }, () => openPage(browser, url, viewport, errors)));
    return { browser, pages, stage, song, errors, url, tablesSpliced: served.tablesSpliced,
      async close() { await browser.close(); server.close(); } };
  } catch (e) { await browser.close(); server.close(); throw e; }
}

export async function shoot(page, t) {
  await page.evaluate((t) => window.seek(t), t);
  return page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
}

// Loop time (seconds) of beat `b` (fractional allowed). Same mapping as the page's beatT: cue_t (else t)
// of the floor beat plus the fraction of a beat.
export function beatTime(song, b) {
  const i = Math.floor(b), fb = song.beats?.[i];
  return (fb ? (fb.cue_t ?? fb.t) : i * song.beat_sec) + (b - i) * song.beat_sec;
}

function sfxInputs(dir, song, sfx, offset, duration) {
  const inputs = [], filters = [];
  sfx.forEach((c, n) => {
    const t = beatTime(song, c.beat);
    const ms = Math.round((t - offset) * 1000);
    if (ms < 0 || ms > duration * 1000) return;
    inputs.push('-i', path.join(dir, c.file));
    filters.push(`[${inputs.length / 2 + 1}:a]aresample=48000,volume=${c.gain ?? 1},adelay=${ms}:all=1[s${n}]`);
  });
  return { inputs, filters, labels: filters.map((f) => f.slice(f.lastIndexOf('['))) };
}

// Whether a project loops: project.json's "loop" (default true). An unreadable project.json is reported
// by the caller that cares (check_brief); here it means the default.
export async function projectLoops(root) {
  try { return JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')).loop !== false; } catch { return true; }
}

// What produced a render, written beside it as <out>.render.json so export.mjs can tell a full-quality,
// full-loop render made by this renderer from a preview, a section or a stale one. `renderer` hashes this
// file and the project's components/core/engine.js (the code that turns the tables into frames).
export async function rendererId(root) {
  const h = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url)));
  try { h.update(await readFile(path.join(root, 'components', 'core', 'engine.js'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return h.digest('hex').slice(0, 16);
}

export async function renderStamp(root, { stage, sub, from = null, to = null, preview = false, song }) {
  return { stage, sub, from, to, preview, loop: { duration_sec: song.loop.duration_sec, frames: song.loop.frames },
    renderer: await rendererId(path.resolve(root)) };
}

export const stampPath = (out) => `${out}.render.json`;

export async function render(dir, opts = {}) {
  const root = path.resolve(dir);
  const preview = !!opts.preview;
  let stageOpt = opts.stage, margins = null;
  if (opts.guides) ({ stage: stageOpt, margins } = await (await import('./safezones.mjs')).guidesFor(root, opts.guides, opts.stage));
  const proj = await openProject(root, { workers: opts.workers ?? 4, stage: stageOpt });
  try {
    const { song, pages, errors, stage } = proj;
    if (margins) { const { drawGuides } = await import('./safezones.mjs'); for (const p of pages) await p.evaluate(drawGuides, margins); }
    const fps = song.fps, D = song.loop.duration_sec, frames = song.loop.frames;
    const dt = song.loop.frame_dt ?? D / frames;
    const from = opts.from ?? 0, to = opts.to ?? D;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= to || to > D + 1e-9)
      throw new UsageError(`--from/--to must satisfy 0 <= from < to <= ${D} (the loop duration in seconds); got from ${from}, to ${to}`);
    const sub = preview ? 1 : (opts.sub ?? 4);
    const loops = await projectLoops(root);
    const f0 = opts.from != null ? Math.max(0, Math.floor(opts.from / dt)) : 0;
    const f1 = opts.to != null ? Math.min(frames, Math.ceil(opts.to / dt)) : frames;
    const total = (f1 - f0) * sub;
    const timeAt = (i) => {
      const f = f0 + Math.floor(i / sub), k = i % sub;
      const t = (f + (sub === 1 ? 0 : (k - (sub - 1) / 2) / sub)) * dt;
      return loops ? ((t % D) + D) % D : Math.min(D, Math.max(0, t));
    };
    const outBase = stageOpt ? path.join(root, 'out', 'shapes', stageOpt.join('x')) : path.join(root, 'out');
    const name = opts.guides ? `${preview ? 'preview-' : ''}guides-${opts.guides}.mp4` : preview ? 'preview.mp4' : 'video.mp4';
    const out = path.resolve(opts.out ?? path.join(outBase, name));
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
    await rm(stampPath(out), { force: true });   // never leave an old stamp describing the new file
    await rename(part, out);
    // A guides render is never stamped: export.mjs reuses only stamped renders, and guides must never reach an export.
    if (!opts.guides) await writeFile(stampPath(out), JSON.stringify(await renderStamp(root, { stage: [stage.width, stage.height], sub,
      from: opts.from ?? null, to: opts.to ?? null, preview, song }), null, 2) + '\n');
    } catch (e) { ff.kill('SIGKILL'); await rm(part, { force: true }); throw e; }
    if (process.stderr.isTTY) process.stderr.write('\n');
    return out;
  } finally { await proj.close(); }
}

const USAGE = 'usage: render.mjs DIR [--preview] [--out FILE] [--sub N] [--workers N] [--from S --to S] [--stage WxH] [--guides PRESET] [--serve [--port N]]';

// "WxH" -> [w, h]: even integers >= 64 (H.264 4:2:0 needs even sizes).
export function parseStage(s) {
  const m = /^(\d+)x(\d+)$/.exec(s ?? '');
  const wh = m && [Number(m[1]), Number(m[2])];
  if (!wh || wh.some((n) => n < 64 || n % 2)) throw new UsageError(`--stage must be WxH with even integers >= 64, got "${s}"`);
  return wh;
}

function parseArgs(argv) {
  const VALUE = new Set(['out', 'sub', 'workers', 'from', 'to', 'port', 'stage', 'guides']), BOOL = new Set(['preview', 'serve']);
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
  return { dir, o, sub: posInt('sub'), workers: posInt('workers'), port: posInt('port'), from: secs('from'), to: secs('to'),
    stage: o.stage == null ? undefined : parseStage(o.stage) };
}

async function main() {
  const { dir, o, sub, workers, port, from, to, stage } = parseArgs(process.argv.slice(2));
  if (!dir) throw new UsageError(USAGE);
  if (o.serve && o.guides) throw new UsageError('--guides renders a video; it does not apply to --serve');
  if (o.serve) {
    const { url } = await serve(dir, port ?? 8123, { stage });
    console.log(`${url}?play   (click the page to start audio)`);
    return;
  }
  console.log(await render(dir, { preview: !!o.preview, out: o.out, sub, workers, from, to, stage, guides: o.guides }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
