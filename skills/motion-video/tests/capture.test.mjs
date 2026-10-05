// capture.mjs: frame-exact stepped capture of a generated fixture page in WebKit and Chromium (CSS transition and
// keyframes, setTimeout, a rAF counter, a click, typing), byte-identical re-runs, named steps, a selector that matches
// nothing, --realtime recording on the real clock, and the exit-2 errors (a selector Playwright cannot parse among
// them). A browser whose executable is missing is skipped with a message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { FFMPEG } from '../scripts/render.mjs';
import { framePath, readClip } from '../scripts/clip.mjs';
import { calibrate, isCalibration } from '../scripts/capture.mjs';
import { tempDir } from './tmp.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(SKILL, 'scripts', 'capture.mjs');
const TMP = tempDir('mk-capture-');
const FPS = 30;

// The fixture: #box's 1 s linear background transition starts at load; #spin turns once a second (keyframes);
// #title goes from a black block to a white one at 1.0 s (setTimeout); #count counts rAF callbacks; clicking #btn
// turns it green.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; background: #fff; font: 16px/1 monospace; }
#box { position: absolute; left: 10px; top: 10px; width: 60px; height: 60px; background: rgb(255, 0, 0); transition: background-color 1s linear; }
#box.on { background: rgb(0, 0, 255); }
#spin { position: absolute; left: 100px; top: 10px; width: 60px; height: 20px; background: rgb(0, 160, 0); animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
#title { position: absolute; left: 180px; top: 10px; width: 120px; height: 60px; background: #000; color: #000; overflow: hidden; }
#title[data-late] { background: #fff; color: #fff; }
#count { position: absolute; left: 10px; top: 90px; }
#btn { position: absolute; left: 10px; top: 120px; width: 100px; height: 40px; border: 0; background: #ccc; }
body[data-clicked] #btn { background: rgb(0, 255, 0); }
#q { position: absolute; left: 130px; top: 120px; width: 150px; height: 30px; font-size: 20px; }
#list { position: absolute; left: 10px; top: 180px; width: 100px; height: 50px; overflow: auto; }
#list div { height: 50px; }
</style></head><body>
<div id="box"></div><div id="spin"></div><div id="title">now</div><div id="count">0</div>
<button id="btn">press</button><input id="q">
<div id="list"><div style="background: rgb(255, 0, 0)"></div><div style="background: rgb(0, 0, 255)"></div><div style="background: rgb(0, 0, 255)"></div></div>
<script>
const title = document.getElementById('title');
setTimeout(() => { title.textContent = 'later'; title.dataset.late = ''; }, 1000);
let count = 0;
const c = document.getElementById('count');
(function tick() { c.textContent = String(++count); requestAnimationFrame(tick); })();
document.getElementById('btn').addEventListener('click', () => { document.body.dataset.clicked = performance.now(); });
addEventListener('load', () => { const b = document.getElementById('box'); getComputedStyle(b).backgroundColor; b.classList.add('on'); });
</script></body></html>
`;
const SITE = path.join(TMP, 'site');
mkdirSync(SITE, { recursive: true });
const APP = path.join(SITE, 'my app.html');
writeFileSync(APP, PAGE);

const STEPS = [{ wait: 0.5 }, { click: '#btn', name: 'press' }, { type: '#q', text: 'hi' }, { wait: 0.5 }];
const DURATION = 0.5 + 0.5 + 0.4 + (0.4 + 2 / 12) + 0.5 + 0.5;
const stepsFile = (name, steps) => { const f = path.join(TMP, `${name}.json`); writeFileSync(f, JSON.stringify(steps)); return f; };
const STEPS_FILE = stepsFile('steps', STEPS);

const REALTIME_WARNING = 'warning: realtime capture: timing is approximate (about ±1 frame per step)';
const WEBKIT_WARNING = 'warning: webkit realtime recordings on macOS are smaller and colour-shifted; chromium is the realtime default';
const capture = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
function captureAsync(...args) {   // for the timing test: a spawnSync timeout would kill the browser mid-run
  return new Promise((resolve) => {
    const p = spawn('node', [SCRIPT, ...args]);
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    // A capture that hangs is killed after 60 s (status null), so its test fails instead of never ending.
    const kill = setTimeout(() => p.kill('SIGKILL'), 60000);
    p.on('close', (status) => { clearTimeout(kill); resolve({ status, stdout, stderr }); });
  });
}
const noTrace = (r) => { assert.match(r.stderr, /^error: /); assert.doesNotMatch(r.stderr, /\n\s+at |Error:.*\n.*node:/); };
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// Frame index (1-based) shown at clip time t.
const frameAt = (t) => Math.round(t * FPS) + 1;

// Mean RGB of the w x h block centred on (x, y) in a JPEG frame (3x3 by default).
function rgbAt(file, x, y, w = 3, h = 3) {
  const crop = `crop=${w}:${h}:${x - Math.floor(w / 2)}:${y - Math.floor(h / 2)}`;
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', crop, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const sum = [0, 0, 0];
  for (let i = 0; i < buf.length; i++) sum[i % 3] += buf[i];
  return sum.map((s) => s / (buf.length / 3));
}
const near = (got, want, tol, what) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= tol),
  `${what}: got rgb(${got.map((v) => v.toFixed(0))}), want within ${tol} of rgb(${want})`);

function installed(browserType) {
  try { accessSync(browserType.executablePath()); return true; } catch { return false; }
}

for (const [name, browserType] of [['webkit', webkit], ['chromium', chromium]]) {
  const skip = installed(browserType) ? false : `playwright ${name} is not installed: (cd ${SKILL} && npx playwright install ${name})`;
  const out = path.join(TMP, name, 'clip');
  const again = path.join(TMP, name, 'again');
  let first;

  test(`${name}: captures the fixture into a valid stepped clip`, { skip }, async () => {
    first = await captureAsync(APP, '--steps', STEPS_FILE, '--out', out, '--fps', String(FPS), '--size', '320x240', '--browser', name);
    assert.equal(first.status, 0, first.stderr);
    const clip = readClip(out);
    assert.equal(clip.frames, Math.round(DURATION * FPS));
    assert.equal(clip.fps, FPS);
    assert.deepEqual([clip.width, clip.height], [320, 240]);
    assert.equal(clip.mode, 'stepped');
    assert.equal(clip.browser, name);
    assert.equal(clip.source, 'my app.html');
    assert.equal(first.stdout.trim(), `capture: ${clip.frames} frames, ${+clip.duration.toFixed(3)} s, 320x240 (stepped, ${name}) -> ${out}`);
  });

  test(`${name}: the CSS transition is at its midpoint at 0.5 s and done by 1 s`, { skip }, () => {
    near(rgbAt(framePath(out, 1), 40, 40), [255, 0, 0], 40, 'frame at t=0');
    near(rgbAt(framePath(out, frameAt(0.5)), 40, 40), [127.5, 0, 127.5], 12, 'frame at t=0.5');
    near(rgbAt(framePath(out, frameAt(1.2)), 40, 40), [0, 0, 255], 40, 'frame at t=1.2');
  });

  test(`${name}: @keyframes follow the clock (a quarter turn at 0.25 s)`, { skip }, () => {
    // #spin is 60x20 centred on (130, 20): flat at t=0 and t=0.5, upright at t=0.25 and t=0.75.
    const green = [0, 160, 0], white = [255, 255, 255];
    near(rgbAt(framePath(out, 1), 130, 45), white, 40, 'below the bar at t=0');
    near(rgbAt(framePath(out, frameAt(0.25)), 130, 45), green, 40, 'below the bar at t=0.25');
    near(rgbAt(framePath(out, frameAt(0.5)), 130, 45), white, 40, 'below the bar at t=0.5');
    near(rgbAt(framePath(out, frameAt(0.75)), 130, 45), green, 40, 'below the bar at t=0.75');
  });

  test(`${name}: setTimeout(1000) shows on the frame for t = 1.0 s, not before`, { skip }, () => {
    near(rgbAt(framePath(out, frameAt(1) - 1), 240, 40), [0, 0, 0], 40, 'title one frame before 1.0 s');
    near(rgbAt(framePath(out, frameAt(1)), 240, 40), [255, 255, 255], 40, 'title at 1.0 s');
  });

  test(`${name}: the named step has its time and box; the click lands on its frame`, { skip }, () => {
    const clip = readClip(out);
    assert.deepEqual(clip.steps.map((s) => s.name), ['press']);
    const press = clip.steps[0];
    assert.equal(press.action, 'click');
    assert.ok(Math.abs(press.t - (0.5 + 0.5 + 0.4)) <= 1 / FPS + 1e-9, `press.t ${press.t}`);
    for (const [k, v] of Object.entries({ x: 10, y: 120, w: 100, h: 40 })) assert.ok(Math.abs(press.box[k] - v) <= 1, `box.${k} ${press.box[k]}`);
    const n = Math.round(press.t * FPS) + 1;
    near(rgbAt(framePath(out, n - 1), 20, 128), [204, 204, 204], 40, '#btn the frame before the click');
    near(rgbAt(framePath(out, n), 20, 128), [0, 255, 0], 40, '#btn on the click frame');
  });

  test(`${name}: typing shows in the input`, { skip }, () => {
    const clip = readClip(out);
    const ink = (n) => { const [r, g, b] = rgbAt(framePath(out, n), 150, 141, 16, 14); return (r + g + b) / 3; };
    assert.ok(ink(clip.frames) < ink(frameAt(1.5)) - 30, `the first typed letter darkens the input (${ink(frameAt(1.5))} -> ${ink(clip.frames)})`);
  });

  test(`${name}: a second run gives byte-identical frames`, { skip }, async () => {
    const r = await captureAsync(APP, '--steps', STEPS_FILE, '--out', again, '--fps', String(FPS), '--size', '320x240', '--browser', name);
    assert.equal(r.status, 0, r.stderr);
    const frames = readClip(out).frames;
    assert.equal(readClip(again).frames, frames);
    const differ = [];
    for (let n = 1; n <= frames; n++) if (hash(framePath(out, n)) !== hash(framePath(again, n))) differ.push(n);
    assert.deepEqual(differ, [], `frames that differ between runs: ${differ.join(', ')}`);
    assert.ok(new Set(Array.from({ length: frames }, (_, i) => hash(framePath(out, i + 1)))).size > frames / 2, 'the frames change over time');
  });

  test(`${name}: hover and scroll steps; --scale 2 doubles the frame and the boxes`, { skip }, async () => {
    const dir = path.join(TMP, name, 'scroll');
    const steps = stepsFile(`scroll-${name}`, [{ hover: '#btn', name: 'over', move: 0.2 }, { scroll: 60, in: '#list', name: 'roll' }]);
    const r = await captureAsync(APP, '--steps', steps, '--out', dir, '--fps', '20', '--size', '320x240', '--scale', '2', '--browser', name);
    assert.equal(r.status, 0, r.stderr);
    const clip = readClip(dir);
    assert.deepEqual([clip.width, clip.height], [640, 480]);
    assert.equal(clip.frames, Math.round((0.5 + 0.2 + 0.4 + 0.3 + 0.5) * 20));
    const [over, roll] = clip.steps;
    assert.equal(over.action, 'hover');
    assert.ok(Math.abs(over.t - 0.7) <= 0.05 + 1e-9, `over.t ${over.t}`);
    for (const [k, v] of Object.entries({ x: 20, y: 240, w: 200, h: 80 })) assert.ok(Math.abs(over.box[k] - v) <= 2, `over.box.${k} ${over.box[k]}`);
    assert.equal(roll.action, 'scroll');
    near(rgbAt(framePath(dir, 1), 100, 400), [255, 0, 0], 40, '#list before the scroll');
    near(rgbAt(framePath(dir, clip.frames), 100, 400), [0, 0, 255], 40, '#list after scrolling 60 px');
  });

  test(`${name}: a step whose selector matches nothing exits 1 within 10 s, naming the step`, { skip }, async () => {
    const steps = stepsFile(`missing-${name}`, [{ wait: 0.1 }, { click: '#missing' }]);
    const t0 = Date.now();
    const r = await captureAsync(APP, '--steps', steps, '--out', path.join(TMP, name, 'missing'), '--size', '320x240', '--fps', '10', '--browser', name);
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /^error: step 2 \(click "#missing"\): no element matches/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });

  test(`${name}: a paint wait that never ends exits 1 within 10 s, naming the Playwright internals`, { skip }, async () => {
    // The page swaps Playwright's kept real requestAnimationFrame for one that never calls back.
    const stall = path.join(SITE, 'stall.html');
    writeFileSync(stall, '<!doctype html><body><script>window.__pwClock.builtins.requestAnimationFrame = () => 0;</script></body>');
    const t0 = Date.now();
    const r = await captureAsync(stall, '--steps', stepsFile(`stall-${name}`, [{ wait: 0.1 }]), '--out', path.join(TMP, name, 'stall'), '--size', '320x240', '--fps', '10', '--browser', name);
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stderr, 'error: paint wait timed out (Playwright internals changed? capture.mjs is tested with playwright 1.63.0)\n');
    assert.ok(!readdirSync(path.join(TMP, name)).includes('stall'), 'no clip directory is left behind');
  });

  test(`${name}: --realtime records the fixture on the real clock into a valid realtime clip`, { skip }, async () => {
    const dir = path.join(TMP, name, 'realtime');
    const r = await captureAsync(APP, '--steps', STEPS_FILE, '--out', dir, '--fps', String(FPS), '--size', '320x240', '--browser', name, '--realtime');
    assert.equal(r.status, 0, r.stderr);
    const clip = readClip(dir);
    assert.equal(clip.mode, 'realtime');
    assert.equal(clip.browser, name);
    assert.equal(clip.fps, FPS);
    assert.ok(Math.abs(clip.duration - DURATION) <= 0.1 * DURATION, `duration ${clip.duration}, steps total ${DURATION}`);
    // CSS pixels; WebKit on macOS records at 90% (capture.mjs header), so the clip may be smaller, never larger.
    const k = clip.width / 320;
    assert.ok(k > 0.85 && k <= 1 && Math.abs(clip.height / 240 - k) < 0.03, `clip ${clip.width}x${clip.height}`);
    if (name === 'chromium') assert.deepEqual([clip.width, clip.height], [320, 240]);
    assert.deepEqual(clip.steps.map((s) => s.name), ['press']);
    const press = clip.steps[0];
    assert.equal(press.action, 'click');
    assert.ok(Math.abs(press.t - (0.5 + 0.5 + 0.4)) <= 0.25, `press.t ${press.t}`);   // npm test runs files at once
    for (const [key, v] of Object.entries({ x: 10, y: 120, w: 100, h: 40 })) assert.ok(Math.abs(press.box[key] - v * k) <= 3, `box.${key} ${press.box[key]}`);
    // The box sits on #btn in the clip: grey there 0.2 s before the click, green 0.2 s after (WebKit's colours shift).
    const [x, y] = [Math.round(press.box.x + press.box.w / 2), Math.round(press.box.y + press.box.h / 4)];
    const grey = rgbAt(framePath(dir, frameAt(press.t - 0.2)), x, y), green = rgbAt(framePath(dir, frameAt(press.t + 0.2)), x, y);
    assert.ok(Math.max(...grey) - Math.min(...grey) < 25 && grey[0] > 150, `#btn before the click: rgb(${grey.map((v) => v.toFixed(0))})`);
    assert.ok(green[1] - Math.max(green[0], green[2]) > 80, `#btn after the click: rgb(${green.map((v) => v.toFixed(0))})`);
    assert.equal(r.stderr.split('\n').filter((l) => l === REALTIME_WARNING).length, 1, r.stderr);
    assert.equal(r.stderr.split('\n').filter((l) => l === WEBKIT_WARNING).length, name === 'webkit' ? 1 : 0, r.stderr);
    assert.equal(r.stdout.trim(), `capture: ${clip.frames} frames, ${+clip.duration.toFixed(3)} s, ${clip.width}x${clip.height} (realtime, ${name}) -> ${dir}`);
  });
}

test('--realtime without --browser records in chromium', { skip: installed(chromium) ? false : 'playwright chromium is not installed' }, async () => {
  const dir = path.join(TMP, 'realtime-default');
  const r = await captureAsync(APP, '--steps', stepsFile('short', [{ wait: 0.2 }]), '--out', dir, '--fps', '10', '--size', '320x240', '--realtime');
  assert.equal(r.status, 0, r.stderr);
  const clip = readClip(dir);
  assert.equal(clip.browser, 'chromium');
  assert.equal(clip.mode, 'realtime');
  assert.ok(!r.stderr.includes(WEBKIT_WARNING), r.stderr);
});

// A stand-in recording: dark for 0.12 s (before the page), the blue calibration page to 0.52 s, its magenta flip to
// 1.12 s, then the white app. The flip was made 0.3 s after the context, so the recording runs 0.22 s ahead.
test('calibrate measures the recording offset off the blue-to-magenta flip; isCalibration spots the page', () => {
  const video = path.join(TMP, 'cal.mp4');
  const part = (c, d) => ['-f', 'lavfi', '-i', `color=c=${c}:s=320x240:r=25:d=${d}`];
  execFileSync(FFMPEG, ['-v', 'error', '-y', ...part('0x1c1c1c', 0.12), ...part('0x0000ff', 0.4), ...part('0xff00ff', 0.6), ...part('white', 1),
    '-filter_complex', 'concat=n=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', video]);
  return (async () => {
    const cal = await calibrate(video, [320, 240], 0.3);
    assert.ok(Math.abs(cal.offset - 0.22) <= 0.04 + 1e-9, `offset ${cal.offset}`);
    assert.ok(cal.still >= 0.12 && cal.still < 0.52, `still ${cal.still}`);
    assert.equal(await isCalibration(video, 0.8, [320, 240]), true);
    assert.equal(await isCalibration(video, 0.3, [320, 240]), true);
    assert.equal(await isCalibration(video, 1.5, [320, 240]), false);
    const flat = path.join(TMP, 'noflip.mp4');
    execFileSync(FFMPEG, ['-v', 'error', '-y', ...part('0x0000ff', 1), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', flat]);
    await assert.rejects(calibrate(flat, [320, 240], 0.3), /calibration/);
  })();
});

test('bad input exits 2 with error: and no traceback', () => {
  const bad = (name, text) => { const f = path.join(TMP, `${name}.json`); writeFileSync(f, text); return f; };
  const busy = path.join(TMP, 'busy');
  mkdirSync(busy, { recursive: true });
  writeFileSync(path.join(busy, 'keep.txt'), 'mine');
  const o = path.join(TMP, 'never');
  const cases = [
    [[], /usage:/],
    [[APP, '--out', o], /--steps/],
    [[APP, '--steps', STEPS_FILE], /--out/],
    [[APP, '--steps', path.join(TMP, 'nope.json'), '--out', o], /cannot read steps file/],
    [[APP, '--steps', bad('badjson', '[{wait:'), '--out', o], /not valid JSON/],
    [[APP, '--steps', bad('notlist', '{"wait": 1}'), '--out', o], /list of steps/],
    [[APP, '--steps', bad('unknown', '[{"wait": 1}, {"tap": "#btn"}]'), '--out', o], /step 2: unknown key "tap"/],
    [[APP, '--steps', bad('two', '[{"click": "#btn", "hover": "#btn"}]'), '--out', o], /step 1 has two actions/],
    [[APP, '--steps', bad('none', '[{"name": "x"}]'), '--out', o], /step 1 has no action/],
    [[APP, '--steps', bad('textclick', '[{"click": "#btn", "text": "x"}]'), '--out', o], /step 1: "text" does not go with click/],
    [[APP, '--steps', bad('notext', '[{"type": "#q"}]'), '--out', o], /step 1.*text/],
    [[APP, '--steps', bad('negwait', '[{"wait": -1}]'), '--out', o], /step 1.*wait/],
    [[APP, '--steps', bad('dupe', '[{"click": "#btn", "name": "a"}, {"hover": "#btn", "name": "a"}]'), '--out', o], /"a" is used twice/],
    [[APP, '--steps', STEPS_FILE, '--out', o, '--size', '320'], /--size/],
    [[APP, '--steps', STEPS_FILE, '--out', o, '--size', '321x240'], /--size/],
    [[APP, '--steps', STEPS_FILE, '--out', o, '--fps', '0'], /--fps/],
    [[APP, '--steps', STEPS_FILE, '--out', o, '--scale', 'big'], /--scale/],
    [[APP, '--steps', STEPS_FILE, '--out', o, '--browser', 'firefox'], /--browser/],
    [[APP, '--steps', STEPS_FILE, '--out', o, '--speed', '2'], /unknown flag --speed/],
    [[APP, '--steps', bad('badsel', '[{"wait": 0.1}, {"click": "##"}]'), '--out', o, '--size', '320x240', '--fps', '10'], /step 2 \(click "##"\): Playwright cannot parse the selector/],
    [[APP, '--steps', bad('badsel-rt', '[{"hover": "div["}]'), '--out', o, '--size', '320x240', '--fps', '10', '--realtime'], /step 1 \(hover "div\["\): Playwright cannot parse the selector/],
    [['ftp://example.invalid/app', '--steps', STEPS_FILE, '--out', o], /http\(s\):\/\/ or file:\/\//],
    [['file:///no/such/app.html', '--steps', STEPS_FILE, '--out', o], /no such file/],
    [[path.join(TMP, 'missing.html'), '--steps', STEPS_FILE, '--out', o], /missing\.html/],
    [[APP, '--steps', STEPS_FILE, '--out', busy], /not empty/],
  ];
  for (const [args, msg] of cases) {
    const r = capture(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    noTrace(r);
    assert.match(r.stderr, msg, args.join(' '));
  }
  assert.deepEqual(readdirSync(busy), ['keep.txt']);
  assert.throws(() => readdirSync(o), /ENOENT/);
  assert.deepEqual(readdirSync(TMP).filter((f) => f.startsWith('.never.tmp-')), [], 'no temp directory left behind');
});

test('a browser that is not installed exits 2 with the install command', () => {
  const r = spawnSync('node', [SCRIPT, APP, '--steps', STEPS_FILE, '--out', path.join(TMP, 'nobrowser')],
    { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(TMP, 'no-browsers') } });
  assert.equal(r.status, 2, r.stderr);
  noTrace(r);
  assert.ok(r.stderr.startsWith(`error: playwright webkit is not installed: (cd ${SKILL} && npx playwright install webkit)`), r.stderr);
});
