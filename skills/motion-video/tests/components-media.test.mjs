// components-media.test.mjs -- the footage component: clip time and frame index as pure functions of t (from, speed,
// clamp, continuation), step:/point: hotspots through cover and contain, frame-exact rendering in a real page against
// the clip's own JPEGs, seek order not mattering, and the brief checks (missing clip, unknown step, a held last frame).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './tmp.mjs';
import { makeProject, openScene } from './harness.mjs';
import { FFMPEG, shoot } from '../scripts/render.mjs';
import { footage as makeClip } from '../scripts/footage.mjs';
import { checkBrief } from '../scripts/check_brief.mjs';
import { validate } from '../components/core/validate.js';
import { registry } from '../components/index.js';
import * as F from '../components/media/footage.js';

// One synthetic clip for the whole file: testsrc moves every frame. 1280x720 at 30 fps, 2 s, 60 frames.
const TMP = tempDir('mk-media-');
const VIDEO = path.join(TMP, 'testsrc.mp4');
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', VIDEO]);
const CLIP = path.join(TMP, 'clip');
const clip = await makeClip(VIDEO, CLIP, { fps: 30, maxWidth: 1280 });
const withClip = (dir, name = 'demo') => { cpSync(CLIP, path.join(dir, 'footage', name), { recursive: true }); return dir; };

// RGB bytes of a w x h crop at (x, y) of an image file (or PNG buffer), decoded by ffmpeg.
const rgb = (input, { x, y, w, h }) => execFileSync(FFMPEG, ['-v', 'error', '-i', typeof input === 'string' ? input : 'pipe:0',
  '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: typeof input === 'string' ? undefined : input, maxBuffer: 64 << 20 });
const mad = (a, b) => { assert.equal(a.length, b.length); let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const frameFile = (n) => path.join(CLIP, `frame-${String(n).padStart(5, '0')}.jpg`);

// ---- pure functions

const clips = { demo: clip };
const ctxAt = (row, t1, extra = {}) => ({ clips, beatT: (b) => b * 0.5, row, t1, continues: false, prev: null, ...extra });
const props = (row) => ({ src: 'demo', from: 0, speed: 1, fit: 'cover', width: 0, ...row });

test('clip time: from, speed, clamped to the clip, frozen outside the row', () => {
  const row = { at: 2, use: 'footage', src: 'demo' };            // t0 = 1 s
  const c = ctxAt(row, 3);
  assert.equal(F.clipTime(props({}), c, 1), 0);
  assert.equal(F.clipTime(props({}), c, 1.5), 0.5);
  assert.equal(F.clipTime(props({}), c, 0.2), 0, 'before the row: its first clip time');
  assert.equal(F.clipTime(props({ from: 0.25 }), c, 1.5), 0.75);
  assert.equal(F.clipTime(props({ speed: 2 }), c, 1.5), 1);
  assert.equal(F.clipTime(props({ speed: 2 }), c, 2.5), 2, 'clamped to the duration: holds the last frame');
  assert.equal(F.clipTime(props({ from: 1.5 }), c, 2.9), 2);
  assert.equal(F.clipTime(props({ speed: 0.5 }), c, 5), 1, 'after t1 the clip time stays where the row ended');
  assert.equal(F.clipTime(props({ from: 0.5, speed: -1 }), c, 2.9), 0, 'clamped at 0 too');
  assert.equal(F.clipTime(props({ speed: 0 }), ctxAt(row, Infinity), 9), 0, 'speed 0 on the last row is a still');
  // Row 0's ctx.t0 is -1e6 (settled); the clip still starts at the row's own beat.
  assert.equal(F.clipTime(props({}), ctxAt({ at: 0, use: 'footage', src: 'demo' }, 1, { t0: -1e6, settled: true }), 0.5), 0.5);
});

test('frame index: round(clipT x fps) + 1, clamped to [1, frames]', () => {
  assert.equal(F.frameIndex(clip, 0), 1);
  assert.equal(F.frameIndex(clip, 0.5), 16);
  assert.equal(F.frameIndex(clip, 0.51), 16);
  assert.equal(F.frameIndex(clip, 0.52), 17);
  assert.equal(F.frameIndex(clip, clip.duration), clip.frames, 'the end of the clip is its last frame, not frames + 1');
  assert.equal(F.frameIndex(clip, 99), clip.frames);
  assert.equal(F.frameIndex(clip, -1), 1);
  assert.equal(F.framePath('my clip', 7), 'footage/my%20clip/frame-00007.jpg');
});

test('continuation: the next row of the same src starts where the clip had got to, unless it sets from', () => {
  const a = { at: 0, use: 'footage', src: 'demo' }, b = { at: 2, use: 'footage', src: 'demo' };
  const end = F.endState(props({ speed: 0.5 }), ctxAt(a, 1, { t0: -1e6 }));
  assert.equal(end._clipEnd, 0.5);
  const cont = ctxAt(b, 3, { continues: true, prev: end });
  assert.equal(F.clipTime(props({}), cont, 1), 0.5);
  assert.equal(F.clipTime(props({}), cont, 1.5), 1);
  assert.equal(F.clipTime(props({ from: 0 }), { ...cont, row: { ...b, from: 0 } }, 1.5), 0.5, 'an explicit from restarts');
  assert.equal(F.clipTime(props({ src: 'other' }), { ...cont, clips: { ...clips, other: clip } }, 1.5), 0.5, 'another src starts from its own from');
});

test('step: and point: hotspots map clip pixels through cover and contain to the shape', () => {
  const c = { width: 1000, height: 500, fps: 30, frames: 30, duration: 1, mode: 'stepped', steps: [{ name: 'Pay', action: 'click', t: 0.2, box: { x: 700, y: 100, w: 100, h: 100 } }] };
  const ctx = { clips: { c } }, geo = { w: 400, h: 400 };
  // box centre (750, 150); clip centre (500, 250)
  assert.deepEqual(F.hotspot('step:Pay', props({ src: 'c' }), geo, ctx), { x: 200, y: -80 }, 'cover: scale max(400/1000, 400/500) = 0.8');
  assert.deepEqual(F.hotspot('step:Pay', props({ src: 'c', fit: 'contain' }), geo, ctx), { x: 100, y: -40 }, 'contain: scale 0.4');
  assert.deepEqual(F.hotspot('point:0.75,0.3', props({ src: 'c', fit: 'contain' }), geo, ctx), { x: 100, y: -40 });
  assert.deepEqual(F.hotspot('point:0.5,0.5', props({ src: 'c' }), geo, ctx), { x: 0, y: 0 });
  assert.equal(F.hotspot('point:2,0', props({ src: 'c' }), geo, ctx), null, 'fractions are 0..1');
  assert.equal(F.hotspot('point:a,b', props({ src: 'c' }), geo, {}), null);
  // Without a clip (validation asks with ctx = {}) a step resolves at the centre: existence never depends on ctx.
  assert.deepEqual(F.hotspot('step:Pay', props({ src: 'c' }), geo, {}), { x: 0, y: 0 });
});

test('geometry: the clip aspect, fitted inside the stage with a margin unless width is set', () => {
  const g = F.geometry(props({}), { clips, stage: { width: 1440, height: 1440 } });
  assert.equal(g.w / g.h, 16 / 9);
  assert.ok(g.w <= 1440 * 0.8 + 1e-9 && g.w >= 1100, `fits with a margin: ${g.w}`);
  const tall = F.geometry(props({}), { clips: { demo: { ...clip, width: 720, height: 1280 } }, stage: { width: 1080, height: 1920 } });
  assert.ok(tall.h <= 1920 * 0.8 + 1e-9 && tall.w <= 1080 * 0.8 + 1e-9, JSON.stringify(tall));
  assert.deepEqual([F.geometry(props({ width: 900 }), { clips }).w, F.geometry(props({ width: 900 }), { clips }).h], [900, 506]);
  const none = F.geometry(props({ src: 'nope' }), {});
  assert.ok(none.w > 0 && none.h > 0, 'no clip (validation): a fallback size, never a throw');
});

// ---- validation (the engine's rules, with the clips as data)

const song = { beat_sec: 0.5, beats: Array.from({ length: 8 }, (_, i) => ({ i, t: i * 0.5 })) };
const v = (states, cursor, c = clips, strict = false) => validate({ states, cursor: cursor ?? [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song, clips: c, strict, beatT: (b) => b * 0.5 });

test('validate: a missing clip is an error naming the path; without clips (no project) nothing is checked', () => {
  const rows = [{ at: 0, use: 'footage', src: 'checkout' }, { at: 6, use: 'footage', src: 'checkout' }];
  assert.ok(v(rows).errors.includes('footage: no clip at footage/checkout/clip.json'), v(rows).errors.join('\n'));
  assert.deepEqual(validate({ states: rows, cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song }).errors, []);
  assert.deepEqual(v([{ at: 0, use: 'footage', src: 'demo' }, { at: 6, use: 'footage', src: 'demo' }]).errors, []);
});

test('validate: step:NAME not in the clip is an error listing its steps', () => {
  const stepped = { ...clip, steps: [{ name: 'Open', action: 'click', t: 0.1, box: { x: 10, y: 10, w: 20, h: 20 } }, { name: 'Pay', action: 'click', t: 1, box: { x: 600, y: 300, w: 80, h: 40 } }] };
  const rows = [{ at: 0, use: 'footage', src: 'demo' }, { at: 6, use: 'footage', src: 'demo' }];
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 2, target: 'step:Payy' }, { at: 3, target: 'step:Pay', press: true }, { at: 6, x: 0, y: 0 }];
  const e = v(rows, cur, { demo: stepped }).errors;
  assert.equal(e.length, 1, e.join('\n'));
  assert.match(e[0], /cursor target "step:Payy" at beat 2: the clip footage\/demo has no step "Payy" \(steps: Open, Pay\)/);
});

test('validate (strict): a row longer than the clip left warns that it holds its last frame', () => {
  // beat 0..6 is 3 s; from 0.2 the 2 s clip runs out after 1.8 s: it holds for 1.2 s.
  const rows = [{ at: 0, use: 'footage', src: 'checkout', from: 0.2 }, { at: 6, use: 'footage', src: 'checkout', from: 0.2 }];
  const w = v(rows, undefined, { checkout: clip }, true).warnings;
  assert.ok(w.includes('checkout holds its last frame for 1.2 s (footage at beat 0)'), w.join('\n'));
  assert.ok(!v(rows, undefined, { checkout: clip }, false).warnings.some((x) => /holds its last frame/.test(x)), 'strict only');
  const fits = [{ at: 0, use: 'footage', src: 'checkout', speed: 0.5 }, { at: 6, use: 'footage', src: 'checkout', from: 0 }];
  assert.ok(!v(fits, undefined, { checkout: clip }, true).warnings.some((x) => /checkout holds/.test(x) && /beat 0\)/.test(x)), 'a clip that lasts the row is fine');
});

// ---- in a real page: frame-exact, whatever the seek order

// A 1280x720 shape on the 1440 stage at zoom 1 sits at (80, 360): the clip's pixels 1:1. The cursor is hidden.
const pageRows = { bars: 1,
  states: "[{ at: 0, use: 'footage', src: 'demo', width: 1280 }, { at: END - 2, use: 'footage', src: 'demo', width: 1280 }]",
  cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' };
const CROP = { x: 64, y: 544, w: 1152, h: 82 };   // testsrc's moving band (rows 540..630), clear of the shape's corners
const STAGE_CROP = { ...CROP, x: CROP.x + 80, y: CROP.y + 360 };

test('render: each sampled frame is the clip frame for t (pixel match in the moving band of the clip), continuation included', async () => {
  const s = await openScene(withClip(makeProject(pageRows)));
  try {
    // row 0: t0 = 0 s, t1 = 1 s; row 1 continues from clip time 1 s at t = 1 s.
    for (const [t, n] of [[0.1, 4], [0.5, 16], [0.9, 28], [1.5, 46], [1.9, 58]]) {
      const got = rgb(await shoot(s.page, t), STAGE_CROP);
      const d = mad(got, rgb(frameFile(n), CROP));
      const near = Math.min(mad(got, rgb(frameFile(n - 1), CROP)), mad(got, rgb(frameFile(n + 1), CROP)));
      assert.ok(d < 1, `t ${t}: frame ${n} differs by ${d.toFixed(2)}`);
      assert.ok(near > 2, `t ${t}: frames ${n - 1} and ${n + 1} must be told apart (${near.toFixed(2)} vs ${d.toFixed(2)})`);
    }
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('render: shuffled seeks give the same screenshots as in-order seeks in one page', async () => {
  const s = await openScene(withClip(makeProject(pageRows)));
  try {
    const times = [0, 0.13, 0.4, 0.41, 0.77, 1.02, 1.3, 1.66, 1.98];
    const inOrder = new Map();
    for (const t of times) inOrder.set(t, await shoot(s.page, t));
    const shuffled = [5, 0, 8, 2, 7, 1, 3, 6, 4].map((i) => times[i]);
    for (const t of shuffled) assert.ok((await shoot(s.page, t)).equals(inOrder.get(t)), `t ${t} differs after a shuffled seek`);
    // A seek nobody awaits, straight after another, never leaves a stale frame behind for the awaited one.
    await s.page.evaluate(() => { window.seek(1.9); window.seek(0.2); });
    assert.ok((await shoot(s.page, 0.77)).equals(inOrder.get(0.77)));
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('render: a frame that will not load keeps the last good frame and rejects nothing', async () => {
  const dir = withClip(makeProject(pageRows));
  writeFileSync(path.join(dir, 'footage', 'demo', 'frame-00031.jpg'), 'not a jpeg');
  const s = await openScene(dir);
  const logged = [];
  s.page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
  try {
    const before = await shoot(s.page, 0.5);
    const after = await shoot(s.page, 1.0);                               // clip time 1 s: frame 31, broken
    assert.ok(after.equals(before), 'the last good frame stays');
    assert.ok(logged.some((x) => /footage: cannot load footage\/demo\/frame-00031\.jpg/.test(x)), logged.join('\n'));
    assert.deepEqual(s.errors, [], 'no unhandled rejection');
  } finally { await s.close(); }
});

// ---- check_brief reads the project's clips

const brief = (states, cursor) => `# Motion brief\n\n## Request\nA promo.\n\n## Decisions\n- square\n\n## Moments\n1. Pay\n\n## Beat table\n\n\`\`\`js\nconst states = () => ${states};\nconst cursor = () => ${cursor};\n\`\`\`\n`;
const STILL = '[{ at: 0, x: 0, y: 600 }, { at: END - 2, x: 0, y: 600 }]';
const noFrames = async () => ({ issues: [], notes: [] });

test('check_brief: missing clip, unknown step and a held last frame', async () => {
  const dir = withClip(makeProject({ bars: 2 }));
  // a stepped copy of the clip
  cpSync(CLIP, path.join(dir, 'footage', 'shop'), { recursive: true });
  const cj = path.join(dir, 'footage', 'shop', 'clip.json');
  writeFileSync(cj, JSON.stringify({ ...JSON.parse(readFileSync(cj, 'utf8')), mode: 'stepped', steps: [
    { name: 'Open', action: 'click', t: 0.1, box: { x: 10, y: 10, w: 20, h: 20 } }, { name: 'Pay', action: 'click', t: 1, box: { x: 600, y: 300, w: 80, h: 40 } }] }));
  const run = async (states, cursor = STILL) => { writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(states, cursor)); return checkBrief(dir, { frameCheck: noFrames }); };

  const ok = await run("[{ at: 0, use: 'footage', src: 'demo' }, { at: 4, use: 'footage', src: 'shop' }, { at: END - 2, use: 'footage', src: 'demo' }]",
    "[{ at: 0, x: 0, y: 600 }, { at: 4, target: 'step:Pay' }, { at: 5, target: 'step:Pay', press: true }, { at: END - 2, x: 0, y: 600 }]");
  assert.deepEqual(ok.errors, []);

  const missing = await run("[{ at: 0, use: 'footage', src: 'checkout' }, { at: END - 2, use: 'footage', src: 'checkout' }]");
  assert.ok(missing.errors.includes('footage: no clip at footage/checkout/clip.json'), missing.errors.join('\n'));

  const step = await run("[{ at: 0, use: 'footage', src: 'shop' }, { at: END - 2, use: 'footage', src: 'shop' }]",
    "[{ at: 0, x: 0, y: 600 }, { at: 2, target: 'step:Buy', press: true }, { at: END - 2, x: 0, y: 600 }]");
  assert.match(step.errors.join('\n'), /no step "Buy" \(steps: Open, Pay\)/);

  // 6 beats at 120 BPM is 3 s; from 0.2 the 2 s clip runs out after 1.8 s.
  const held = await run("[{ at: 0, use: 'footage', src: 'demo', from: 0.2 }, { at: END - 2, use: 'footage', src: 'demo', from: 0.2 }]");
  assert.deepEqual(held.errors, []);
  assert.ok(held.warnings.includes('demo holds its last frame for 1.2 s (footage at beat 0)'), held.warnings.join('\n'));

  // a clip.json that is there but broken is an error, not a crash
  writeFileSync(path.join(dir, 'footage', 'shop', 'clip.json'), '{ nope');
  const broken = await run("[{ at: 0, use: 'footage', src: 'shop' }, { at: END - 2, use: 'footage', src: 'shop' }]");
  assert.match(broken.errors.join('\n'), /footage: clip .*shop: clip\.json is not valid JSON/);
});
