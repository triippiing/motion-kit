#!/usr/bin/env node
// capture.mjs -- capture a real HTML app as a clip for the footage component, frame-exact.
//
//   node capture.mjs URL|FILE --steps FILE --out CLIPDIR [--browser webkit|chromium] [--size WxH] [--fps N]
//                    [--scale N] [--realtime]
//
// Opens the page (an http(s):// or file:// URL, or a file, served from its own directory on 127.0.0.1 so relative
// assets load) in WebKit (default) or Chromium at --size (default 1280x800) and --scale (device pixels per CSS
// pixel, default 1; 2 for retina-sharp frames), plays the steps (capture_steps.mjs has the format) and writes one
// JPEG per frame at --fps (default 60) plus clip.json (mode "stepped", browser, source, the named steps' t and box)
// into CLIPDIR, which must be new, empty, or an existing clip (its frames are replaced). Clips are git-ignored
// (footage/), like renders.
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
import { chromium, webkit } from 'playwright';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UsageError, serve } from './render.mjs';
import { isMain } from './is_main.mjs';
import { checkClipDir, framePath, prepareClipDir, writeClip } from './clip.mjs';
import { StepRunner, checkSteps, planSteps } from './capture_steps.mjs';

const USAGE = 'usage: capture.mjs URL|FILE --steps FILE --out CLIPDIR [--browser webkit|chromium] [--size WxH] [--fps N] [--scale N] [--realtime]';
const SKILL = path.resolve(import.meta.dirname, '..');
const BROWSERS = { webkit, chromium };
const TICKS0 = 1000;
const MAX_FRAMES = 99999;

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
  if (realtime) throw new UsageError('--realtime is not built yet');
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
  const tmp = await mkdtemp(path.join(parent, `.${path.basename(out)}.tmp-`));
  const served = file ? await serve(path.dirname(file)) : null;
  const errors = [];
  let instance;
  try {
    instance = await type.launch();
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

    await page.goto(remote ?? served.url + encodeURIComponent(path.basename(file)), { waitUntil: 'load' });
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
    instance = null;

    prepareClipDir(out);
    for (let n = 1; n <= plan.frames; n++) await rename(framePath(tmp, n), framePath(out, n));
    if (errors.length) console.error(`warning: the page threw ${errors.length} error(s) during the capture; the first: ${errors[0].message}`);
    return writeClip(out, { fps, width, height, frames: plan.frames, duration: plan.frames / fps, mode: 'stepped', source, browser, steps: runner.record });
  } finally {
    if (instance) await instance.close().catch(() => {});
    served?.server.close();
    await rm(tmp, { recursive: true, force: true });
  }
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
