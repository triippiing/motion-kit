#!/usr/bin/env node
// capture.mjs -- capture a real HTML app as a clip for the footage component, frame-exact (or on the real clock).
//
//   node capture.mjs URL|FILE --steps FILE --out CLIPDIR [--browser webkit|chromium] [--size WxH] [--fps N]
//                    [--scale N] [--realtime]
//
// Opens the page (an http(s):// or file:// URL, or a file, served from its own directory on 127.0.0.1 so relative
// assets load) in WebKit (default) or Chromium at --size (default 1280x800) and --scale (device pixels per CSS
// pixel, default 1; 2 for retina-sharp stepped frames), plays the steps (capture_steps.mjs has the format) and
// writes one JPEG per frame at --fps (default 60) plus clip.json (mode "stepped", browser, source, the named steps'
// t and box) into CLIPDIR, which must be new, empty, or an existing clip (its frames are replaced). Clips are
// git-ignored (footage/), like renders. Frames go to a temp directory beside CLIPDIR first, so a failed run leaves
// it as it was.
//
// Stepped capture runs the page on a fake clock, so the same page and steps give the same frames on every run:
// - Playwright's page.clock fakes Date, performance.now, timers and requestAnimationFrame, installed paused before
//   the page loads. The clock's start is made exact first: Playwright replays its install/pause log into every new
//   document with the real milliseconds that passed between those calls, so a probe page reads that slip and the
//   clock is run on to TICKS0 (1000 ms), with Date set back to 0. The page then always loads at performance.now()
//   1000 and Date.now() 0. Frame i (0-based, clip time i / fps) is at performance.now() 1000 + round(i * 1000 / fps):
//   the clock is run to that whole millisecond (runFor rounds up to whole ms, so stepping by 1000 / fps would drift).
// - CSS transitions and animations (and Web Animations) run on the browser's own timeline, which the fake clock does
//   not touch. An init script's __mkSync(now) pauses each animation the first time it sees one (in
//   document.getAnimations(), which also starts any transition a style change is due to start) and sets its
//   currentTime to (now - the frame it was first seen) x playbackRate. Each frame it is called after the frame's
//   input, so an animation a click starts is at 0 on the click's frame; one a timer starts between frames is at 0 on
//   the next frame (as a browser starts animations on its next frame). Animations the page paused itself are left
//   alone.
// - Paint wait: after the sync, two ticks of the browser's real requestAnimationFrame (Playwright keeps it, unfaked,
//   as window.__pwClock.builtins: a Playwright internal, tested with the pinned playwright 1.63.0), then the
//   screenshot (JPEG quality 90, caret hidden: it blinks on a real timer). Measured: WebKit's screenshots already
//   matched with no wait; Chromium's first frame differed with zero or one tick and matched from two on, so two in
//   both. Headless WebKit runs requestAnimationFrame at 30 Hz, so a WebKit frame costs ~70 ms, Chromium ~50 ms.
// Limits: a page's own Web Animation that it pauses and replays later is not re-synced; wheel scrolling is applied
// at once (no smooth scrolling), in both browsers; video and audio elements play on the real clock; only the main
// frame's animations are synced (an <iframe>'s run on the real clock).
//
// --realtime is for an app that will not step (a fake clock breaks it, or it animates in ways the sync cannot reach):
// no fake clock and no animation sync. Playwright records the context (recordVideo) while the same planned steps run
// on the real clock: the StepRunner is called for frame i at the absolute deadline zero + i / fps (a late frame just
// runs late), so pointer moves, keys and wheel turns keep their eased timing. The context is closed to flush the
// video and ffmpeg cuts the clip's frames from it (clip.mjs extractFrames), mode "realtime". Clip zero is when the
// page has loaded (and its fonts) and the selectors are checked; a named step's t is the real time of its action since
// then, so frame round(t * fps) + 1 shows it, approximately. Measured with playwright 1.63.0 on macOS:
// - Start: the recording's first frame is VIDEO_LAG after the context is created (Chromium 67-107 ms over 13 runs,
//   WebKit 81-160 ms; read off the first frame showing a colour flip made at a known time, so to within one 40 ms
//   recorded frame; the webm's creation_time is earlier, as ffmpeg starts the video at its first frame). The clip is
//   cut from zero, so the loading page is not in it, for the steps' frame count, so the ~0.4 s the recording runs on
//   into the close is not either. The lag's spread (~±40 ms) is what the warning "about ±1 frame per step" is for.
// - Rate and size: the recording is 25 fps (at --fps 30 or 60 some frames repeat) and in CSS pixels (--scale has no
//   effect on its frames; the clip is never scaled up). Playwright pads the picture grey to the recording's size, and
//   WebKit on macOS draws it at 90% with a light 1 px edge and its colours shifted (pure green comes out
//   rgb(115, 252, 76)), so a 320x240 WebKit clip is ~286x216. So a blue page is shown for CAL_MS before the app, and
//   the page's area is read off it (contentArea) and cropped out; the named steps' boxes are mapped into it. Use
//   Chromium for sharp, true-colour realtime footage.
// Realtime frames also differ from run to run, and nothing waits for the page's animations.
import { chromium, webkit } from 'playwright';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import { FFMPEG, UsageError, serve } from './render.mjs';
import { isMain } from './is_main.mjs';
import { MAX_FRAMES, checkClipDir, extractFrames, framePath, prepareClipDir, writeClip } from './clip.mjs';
import { StepRunner, checkSteps, planSteps } from './capture_steps.mjs';

const USAGE = 'usage: capture.mjs URL|FILE --steps FILE --out CLIPDIR [--browser webkit|chromium] [--size WxH] [--fps N] [--scale N] [--realtime]';
const SKILL = path.resolve(import.meta.dirname, '..');
const BROWSERS = { webkit, chromium };
const run = promisify(execFile);
const TICKS0 = 1000;
const VIDEO_LAG = { chromium: 0.085, webkit: 0.13 };   // s from newContext to the recording's first frame (see the header)
const CAL_BLUE = '#0000ff', CAL_MS = 300;   // realtime: the calibration page's colour and how long it shows
const REALTIME_WARNING = 'warning: realtime capture: timing is approximate (about ±1 frame per step)';

// Runs in every document before its own scripts: window.__mkSync(now) puts every animation on the fake clock.
function syncScript() {
  const seen = new WeakMap();
  window.__mkSync = (now) => {
    for (const a of document.getAnimations()) {
      let start = seen.get(a);
      if (start === undefined) {
        start = a.playState === 'paused' ? null : now;
        seen.set(a, start);
        if (start !== null) a.pause();
      }
      if (start !== null) a.currentTime = (now - start) * a.playbackRate;
    }
  };
}

// Sync the animations to `now`, then wait two real animation frames for the paint (see the header).
async function syncAndPaint(now) {
  window.__mkSync(now);
  const raf = window.__pwClock.builtins.requestAnimationFrame;
  await new Promise((resolve) => raf(() => raf(resolve)));
}

// What to open: { url, source, file } (file: the local file to serve, or null for an http(s) URL).
function resolveTarget(target) {
  if (/^https?:\/\//i.test(target)) return { url: target, source: target, file: null };
  let file = target, source = path.basename(target);
  if (/^file:\/\//i.test(target)) {
    try { file = fileURLToPath(target); } catch (e) { throw new UsageError(`${target} is not a usable file:// URL (${e.message})`); }
    source = target;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    throw new UsageError(`${target}: give an http(s):// or file:// URL, or an HTML file`);
  }
  if (!existsSync(file)) throw new UsageError(`no such file: ${file} (give an http(s):// or file:// URL, or an HTML file)`);
  if (statSync(file).isDirectory()) throw new UsageError(`${file} is a directory; give the HTML file in it`);
  return { url: null, source, file: path.resolve(file) };
}

function checkOptions({ browser, size, fps, scale }) {
  if (!BROWSERS[browser]) throw new UsageError(`--browser must be webkit or chromium, got "${browser}"`);
  if (!Array.isArray(size) || size.length !== 2 || !size.every((x) => Number.isInteger(x) && x >= 2)) {
    throw new UsageError(`--size must be WxH in whole pixels >= 2, got ${JSON.stringify(size)}`);
  }
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) throw new UsageError(`--fps must be a number > 0, got ${fps}`);
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 4) throw new UsageError(`--scale must be a number from above 0 to 4, got ${scale}`);
  const [w, h] = size.map((x) => x * scale);
  if (![w, h].every((x) => Number.isInteger(x) && x % 2 === 0)) {
    throw new UsageError(`--size ${size.join('x')} at --scale ${scale} gives ${w}x${h} frames; both must come out as even whole pixels`);
  }
  return [w, h];
}

export async function capture(target, steps, { out, browser = 'webkit', size = [1280, 800], fps = 60, scale = 1, realtime = false } = {}) {
  if (!out) throw new UsageError('--out CLIPDIR is required (e.g. --out footage/NAME in the project)');
  const [width, height] = checkOptions({ browser, size, fps, scale });
  const plan = planSteps(checkSteps(steps), fps);
  if (plan.frames > MAX_FRAMES) throw new UsageError(`these steps make ${plan.frames} frames at ${fps} fps; a clip holds at most ${MAX_FRAMES}`);
  const { url: remote, source, file } = resolveTarget(target);
  checkClipDir(out);
  const type = BROWSERS[browser];
  if (!existsSync(type.executablePath())) throw new UsageError(`playwright ${browser} is not installed: (cd ${SKILL} && npx playwright install ${browser})`);

  const parent = path.dirname(path.resolve(out));
  mkdirSync(parent, { recursive: true });
  const errors = [];
  let tmp, served, instance;
  try {
    tmp = await mkdtemp(path.join(parent, `.${path.basename(out)}.tmp-`));
    if (file) served = await serve(path.dirname(file));
    const url = remote ?? served.url + encodeURIComponent(path.basename(file));
    instance = await type.launch();
    const job = { instance, url, errors, tmp, out, plan, fps, size, scale, browser, frame: [width, height] };
    const got = await (realtime ? recordRealtime(job) : recordStepped(job));
    instance = null;
    if (realtime) console.error(REALTIME_WARNING);
    if (errors.length) console.error(`warning: the page threw ${errors.length} error(s) during the capture; the first: ${errors[0].message}`);
    return writeClip(out, { fps, width: got.width, height: got.height, frames: got.frames, duration: got.frames / fps,
      mode: realtime ? 'realtime' : 'stepped', source, browser, steps: got.record });
  } finally {
    if (instance) await instance.close().catch(() => {});
    served?.server.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

// Stepped capture (see the header): frames into tmp on the fake clock, then into out. Closes the browser; returns
// { record: the named steps, frames, width, height }.
async function recordStepped({ instance, url, errors, tmp, out, plan, fps, size, scale, frame }) {
  const context = await instance.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e));
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(0);
  await page.goto('data:text/html,<title>clock</title>');
  const slip = await page.evaluate(() => performance.now());
  if (slip >= TICKS0) throw new Error(`the fake clock slipped ${slip} ms while starting (more than ${TICKS0}); try again`);
  await page.clock.runFor(TICKS0 - slip);
  await page.clock.setSystemTime(0);
  await page.addInitScript(syncScript);

  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => [typeof window.__mkSync === 'function', typeof window.__pwClock?.builtins?.requestAnimationFrame === 'function']);
  if (!ok[0]) throw new Error('the animation sync script did not load into the page');
  if (!ok[1]) throw new Error('this Playwright has no window.__pwClock.builtins.requestAnimationFrame (capture.mjs is tested with playwright 1.63.0, as pinned in package.json)');

  const runner = new StepRunner(page, plan, { fps, size, scale });
  await runner.start();
  let ticks = TICKS0;
  for (let i = 0; i < plan.frames; i++) {
    const now = TICKS0 + Math.round((i * 1000) / fps);
    if (now > ticks) { await page.clock.runFor(now - ticks); ticks = now; }
    await runner.frame(i);
    await page.evaluate(syncAndPaint, now);
    await page.screenshot({ path: framePath(tmp, i + 1), type: 'jpeg', quality: 90, caret: 'hide' });
  }
  await instance.close();

  prepareClipDir(out);
  for (let n = 1; n <= plan.frames; n++) await rename(framePath(tmp, n), framePath(out, n));
  return { record: runner.record, frames: plan.frames, width: frame[0], height: frame[1] };
}

// Realtime capture (see the header): the steps on the real clock while Playwright records, then the recording's
// frames into out (all of the steps' frames, unless the recording ends short). Closes the browser; returns
// { record: the named steps, frames, width, height }.
async function recordRealtime({ instance, url, errors, tmp, out, plan, fps, size, scale, browser }) {
  const created = Date.now();
  const context = await instance.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: scale,
    recordVideo: { dir: tmp, size: { width: size[0], height: size[1] } } });   // screencasts are CSS pixels, so this is all
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e));
  // A blue page first, for contentArea; trimmed off with the rest of the lead.
  await page.goto(`data:text/html,<body style="margin:0;background:${encodeURIComponent(CAL_BLUE)}"></body>`);
  await new Promise((resolve) => setTimeout(resolve, CAL_MS / 2));
  const cal = Date.now();
  await new Promise((resolve) => setTimeout(resolve, CAL_MS / 2));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  let zero;
  const runner = new StepRunner(page, plan, { fps, size, scale: 1, clock: () => Math.round(Date.now() - zero) / 1000 });
  await runner.start();
  zero = Math.max(Date.now(), created + VIDEO_LAG[browser] * 1000);
  const until = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms - Date.now())));
  for (let i = 0; i < plan.frames; i++) {
    await until(zero + (i * 1000) / fps);
    await runner.frame(i);
  }
  await until(zero + (plan.frames * 1000) / fps);
  const video = page.video();
  await context.close();
  const file = await video.path();
  await instance.close();

  const lag = (t) => Math.max(0, (t - created) / 1000 - VIDEO_LAG[browser]);   // wall ms -> recording seconds
  const area = await contentArea(file, lag(cal), size);
  if (Math.abs(area.kx / area.ky - 1) > 0.03) throw new Error(`the page fills ${area.w}x${area.h} of the recording, not the ${size.join('x')} viewport's shape`);
  const { x, y, w, h } = area;
  const got = await extractFrames(file, out, { fps, maxWidth: w, start: lag(zero), limit: plan.frames, crop: { x, y, w, h } });
  const r = (v) => Math.round(v * 100) / 100;   // clip pixels
  const record = runner.record.map((s) => ({ ...s,
    box: { x: r(s.box.x * area.kx - x), y: r(s.box.y * area.ky - y), w: r(s.box.w * area.kx), h: r(s.box.h * area.ky) } }));
  return { record, frames: got.frames, width: got.width, height: got.height };
}

// Where the page is in a recording made at the viewport's `size`: { x, y, w, h } (w and h even) plus kx, ky
// (recording pixels per CSS pixel), read off its frame at `t` s (the blue page) as the blue runs along a row and a
// column. Playwright pads the picture grey to the recording's size, and WebKit on macOS draws it at 90% with a light
// 1 px edge, which this leaves out.
async function contentArea(video, t, size) {
  const [w, h] = size;
  let buf;
  try {
    ({ stdout: buf } = await run(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { encoding: 'buffer', maxBuffer: w * h * 3 + (1 << 20) }));
  } catch (e) { throw new Error(`ffmpeg could not read the recording: ${String(e.stderr || e.message).trim().slice(-400)}`); }
  if (buf.length < w * h * 3) throw new Error(`the recording is not ${w}x${h} (ffmpeg gave ${buf.length} bytes for its frame at ${t.toFixed(2)} s)`);
  const blue = (x, y) => { const i = (y * w + x) * 3; return buf[i + 2] > 150 && buf[i] < 100 && buf[i + 1] < 100; };
  const span = (n, at) => {   // the first and last blue pixel along a line of n
    let a = 0, b = n - 1;
    while (a < n && !at(a)) a++;
    while (b > a && !at(b)) b--;
    return [a, b];
  };
  const my = Math.floor(h / 4), mx = Math.floor(w / 4);   // inside even a 90% picture
  const [x0, x1] = span(w, (x) => blue(x, my)), [y0, y1] = span(h, (y) => blue(mx, y));
  // The picture is drawn from the top-left corner (Playwright pads right and bottom), so its scale is its far edge.
  const area = { x: x0, y: y0, w: (x1 - x0 + 1) & ~1, h: (y1 - y0 + 1) & ~1, kx: (x1 + 1) / w, ky: (y1 + 1) / h };
  if (x0 >= w || y0 >= h || area.w < Math.min(w, 16) / 2 || area.h < Math.min(h, 16) / 2 || x0 > w / 8 || y0 > h / 8) {
    throw new Error(`could not find the page in the recording (its calibration frame at ${t.toFixed(2)} s is not blue where the page should be)`);
  }
  return area;
}

function parseArgs(argv) {
  const o = {}; let target;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (target != null) throw new UsageError(`unexpected argument "${a}"`); target = a; continue; }
    if (a === '--realtime') { o.realtime = true; continue; }
    const k = { '--steps': 'steps', '--out': 'out', '--browser': 'browser', '--size': 'size', '--fps': 'fps', '--scale': 'scale' }[a];
    if (!k) throw new UsageError(`unknown flag ${a}`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value`);
    o[k] = argv[++i];
  }
  if (!target) throw new UsageError(USAGE);
  if (!o.steps) throw new UsageError('--steps FILE is required (a JSON list of steps, e.g. [{"click": "#pay"}])');
  if (!o.out) throw new UsageError('--out CLIPDIR is required (e.g. --out footage/NAME in the project)');
  const opts = { out: o.out, browser: o.browser ?? 'webkit', realtime: !!o.realtime };
  if (o.size != null) {
    const m = /^(\d+)x(\d+)$/.exec(o.size);
    if (!m) throw new UsageError(`--size must be WxH, e.g. 1280x800, got "${o.size}"`);
    opts.size = [Number(m[1]), Number(m[2])];
  }
  for (const k of ['fps', 'scale']) {
    if (o[k] == null) continue;
    opts[k] = Number(o[k]);
    if (o[k].trim() === '' || !Number.isFinite(opts[k]) || opts[k] <= 0) throw new UsageError(`--${k} must be a number > 0, got "${o[k]}"`);
  }
  return { target, stepsFile: o.steps, opts };
}

function readSteps(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`cannot read steps file ${file} (${e.code || e.message})`); }
  try { return JSON.parse(text); } catch (e) { throw new UsageError(`steps file ${file} is not valid JSON (${e.message})`); }
}

async function main() {
  const { target, stepsFile, opts } = parseArgs(process.argv.slice(2));
  const clip = await capture(target, readSteps(stepsFile), opts);
  console.log(`capture: ${clip.frames} frames, ${+clip.duration.toFixed(3)} s, ${clip.width}x${clip.height} (${clip.mode}, ${clip.browser}) -> ${opts.out}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
