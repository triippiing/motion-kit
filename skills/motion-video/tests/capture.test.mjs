// capture.mjs: frame-exact stepped capture of a generated fixture page in WebKit and Chromium (CSS transition and
// keyframes, setTimeout, a rAF counter, a click, typing), byte-identical re-runs, named steps, a selector that matches
// nothing, and the exit-2 errors. A browser whose executable is missing is skipped with a message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { FFMPEG } from '../scripts/render.mjs';
import { framePath, readClip } from '../scripts/clip.mjs';
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

const capture = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
function captureAsync(...args) {   // for the timing test: a spawnSync timeout would kill the browser mid-run
  return new Promise((resolve) => {
    const p = spawn('node', [SCRIPT, ...args]);
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
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
    near(rgbAt(framePath(out, frameAt(0.5)), 40, 40), [127.5, 0, 127.5], 40, 'frame at t=0.5');
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
}

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
    [[APP, '--steps', STEPS_FILE, '--out', o, '--realtime'], /--realtime is not built yet/],
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
});

test('a browser that is not installed exits 2 with the install command', () => {
  const r = spawnSync('node', [SCRIPT, APP, '--steps', STEPS_FILE, '--out', path.join(TMP, 'nobrowser')],
    { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(TMP, 'no-browsers') } });
  assert.equal(r.status, 2, r.stderr);
  noTrace(r);
  assert.ok(r.stderr.startsWith(`error: playwright webkit is not installed: (cd ${SKILL} && npx playwright install webkit)`), r.stderr);
});
