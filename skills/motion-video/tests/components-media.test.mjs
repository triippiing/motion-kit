// components-media.test.mjs -- the footage component: clip time and frame index as pure functions of t (from, speed,
// clamp, continuation), step:/point: hotspots through cover and contain, frame-exact rendering in a real page against
// the clip's own JPEGs, seek order not mattering, and the brief checks (missing clip, unknown step, a held last frame).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './tmp.mjs';
import { makeProject, openScene } from './harness.mjs';
import { FFMPEG, shoot } from '../scripts/render.mjs';
import { footage as makeClip } from '../scripts/footage.mjs';
import { checkBrief } from '../scripts/check_brief.mjs';
import { checkFrames } from '../scripts/framecheck.mjs';
import { startWatch } from '../scripts/watch.mjs';
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
  // the last row of a loop continues a clip that has run out: the hint says how to fix the seam
  const plain = [{ at: 0, use: 'footage', src: 'checkout' }, { at: 6, use: 'footage', src: 'checkout' }];
  const w2 = v(plain, undefined, { checkout: clip }, true).warnings;
  assert.ok(w2.includes('checkout holds its last frame for 1 s (footage at beat 6) (at the loop seam: set from, or end on a non-footage row)'), w2.join('\n'));
  const once = validate({ states: plain, cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song, clips: { checkout: clip }, strict: true, loop: false, beatT: (b) => b * 0.5 }).warnings;
  assert.ok(!once.some((x) => /loop seam/.test(x)), 'no seam hint for a one-off piece');
  assert.ok(!v(rows, undefined, { checkout: clip }, false).warnings.some((x) => /holds its last frame/.test(x)), 'strict only');
  const fits = [{ at: 0, use: 'footage', src: 'checkout', speed: 0.5 }, { at: 6, use: 'footage', src: 'checkout', from: 0 }];
  assert.ok(!v(fits, undefined, { checkout: clip }, true).warnings.some((x) => /checkout holds/.test(x) && /beat 0\)/.test(x)), 'a clip that lasts the row is fine');
});

test('validate: a footage row must set src itself (no silent demo), with or without clips', () => {
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }];
  const rows = [{ at: 0, use: 'footage' }, { at: 6, use: 'footage' }];
  const e = v(rows).errors;
  assert.deepEqual(e, ['footage needs src'], e.join('\n'));
  assert.deepEqual(validate({ states: rows, cursor: cur, registry, song }).errors, ['footage needs src'], 'no clips (no project): still an error');
  assert.deepEqual(v([{ at: 0, use: 'footage', src: '' }, { at: 6, use: 'footage', src: '' }]).errors, ['footage needs src']);
});

test('validate: a src with ".." segments or an absolute path is an error (Node never reads outside footage/)', () => {
  for (const src of ['../outside', 'a/../../b', '..', '/etc/x', 'a\\..\\b', 'C:\\x']) {
    const rows = [{ at: 0, use: 'footage', src }, { at: 6, use: 'footage', src }];
    const want = `footage: src ${JSON.stringify(src)} must be a folder inside footage/ (no ".." segments, not an absolute path)`;
    assert.deepEqual(v(rows).errors, [want], src);
    assert.deepEqual(validate({ states: rows, cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song }).errors, [want], `${src} without clips`);
  }
  assert.deepEqual(v([{ at: 0, use: 'footage', src: 'demo' }, { at: 6, use: 'footage', src: 'demo' }], undefined, { demo: clip }).errors, []);
  assert.ok(!v([{ at: 0, use: 'footage', src: 'a..b/c' }, { at: 6, use: 'footage', src: 'a..b/c' }]).errors.some((x) => /must be a folder/.test(x)), '".." inside a name is fine');
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

test('render: a frame that will not load keeps the last good frame, resolves the seek, and is a page error naming it', async () => {
  const dir = withClip(makeProject(pageRows));
  writeFileSync(path.join(dir, 'footage', 'demo', 'frame-00031.jpg'), 'not a jpeg');
  const s = await openScene(dir);
  try {
    const before = await shoot(s.page, 0.5);
    const after = await shoot(s.page, 1.0);                               // clip time 1 s: frame 31, broken; the seek resolved
    assert.ok(after.equals(before), 'the last good frame stays');
    // Row 1 (the continuation) starts on frame 31, so every page that ran ready (the probe and the worker) tried it.
    assert.ok(s.errors.length >= 1);
    for (const e of s.errors) {
      assert.match(e.message, /^footage: cannot load footage\/demo\/frame-00031\.jpg/);
      assert.doesNotMatch(e.message, /Uncaught \(in promise\)/, 'reported, not an unhandled rejection');
    }
  } finally { await s.close(); }
});

test('render.mjs on a project with a deleted frame exits 1 with an error naming it', () => {
  const dir = withClip(makeProject(pageRows));
  rmSync(path.join(dir, 'footage', 'demo', 'frame-00031.jpg'));
  const r = spawnSync('node', [path.join(import.meta.dirname, '..', 'scripts', 'render.mjs'), dir, '--preview', '--workers', '1', '--from', '0.9', '--to', '1.1'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^error: .*footage: cannot load footage\/demo\/frame-00031\.jpg/m);
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

test('in the page the cursor aims at a step through the real clip (not the no-clip centre)', async () => {
  const dir = makeProject({ bars: 1,
    states: "[{ at: 0, use: 'footage', src: 'shop', width: 1280 }, { at: END - 2, use: 'footage', src: 'shop', width: 1280 }]",
    cursor: "[{ at: 0, target: 'step:Pay' }, { at: END - 2, target: 'step:Pay' }]" });
  cpSync(CLIP, path.join(dir, 'footage', 'shop'), { recursive: true });
  const cj = path.join(dir, 'footage', 'shop', 'clip.json');
  writeFileSync(cj, JSON.stringify({ ...JSON.parse(readFileSync(cj, 'utf8')), mode: 'stepped',
    steps: [{ name: 'Pay', action: 'click', t: 0.5, box: { x: 900, y: 500, w: 100, h: 40 } }] }));
  const s = await openScene(dir);
  try {
    // box centre (950, 520) is (310, 160) from the clip centre; the shape shows the clip 1:1 at zoom 1
    const c = await s.page.evaluate(() => window.inspect(0.5).cursor);
    assert.ok(Math.abs(c.x - (720 + 310)) < 0.5 && Math.abs(c.y - (720 + 160)) < 0.5, JSON.stringify(c));
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('check_brief: a project whose components/ copy predates footage is told to copy a fresh one', async () => {
  const dir = withClip(makeProject({ bars: 2 }));
  rmSync(path.join(dir, 'components', 'media'), { recursive: true });
  const idx = path.join(dir, 'components', 'index.js');
  writeFileSync(idx, readFileSync(idx, 'utf8').split('\n').filter((l) => !/footage/i.test(l)).join('\n'));
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief("[{ at: 0, use: 'footage', src: 'demo' }, { at: END - 2, use: 'footage', src: 'demo' }]", STILL));
  const r = await checkBrief(dir, { frameCheck: noFrames });
  assert.deepEqual(r.errors, ["the project's components/ copy predates footage; copy a fresh components/ in (see SKILL.md, Older projects)"]);
});

test('check_brief: a src outside footage/ is never read (the validator names it)', async () => {
  const dir = withClip(makeProject({ bars: 2 }));
  cpSync(CLIP, path.join(dir, 'outside'), { recursive: true });   // a valid clip at DIR/outside, reached by ../outside
  writeFileSync(path.join(dir, 'outside', 'clip.json'), '{ nope');   // read it and it would be a "not valid JSON" error
  const { projectClips } = await import('../scripts/tables.mjs');
  assert.deepEqual(await projectClips(dir, [{ at: 0, use: 'footage', src: '../outside' }]), { clips: {}, errors: [] });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief("[{ at: 0, use: 'footage', src: '../outside' }, { at: END - 2, use: 'footage', src: '../outside' }]", STILL));
  const r = await checkBrief(dir, { frameCheck: noFrames });
  assert.deepEqual(r.errors, ['footage: src "../outside" must be a folder inside footage/ (no ".." segments, not an absolute path)']);
});

test('check_brief: a project whose index.html predates footage (no loadClips) is told to copy it from the template', async () => {
  const dir = withClip(makeProject({ bars: 2 }));
  const page = path.join(dir, 'index.html');
  // an index.html from before footage: no loadClips(), no CLIPS
  writeFileSync(page, readFileSync(page, 'utf8').replace(/\n\/\/ Each footage row's clip\.json[\s\S]*?\n}\n/, '\n')
    .replace('  CLIPS = await loadClips();\n', '').replace(', clips: CLIPS', ''));
  assert.doesNotMatch(readFileSync(page, 'utf8'), /loadClips/);
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief("[{ at: 0, use: 'footage', src: 'demo' }, { at: END - 2, use: 'footage', src: 'demo' }]", STILL));
  const r = await checkBrief(dir, { frameCheck: noFrames });
  assert.deepEqual(r.errors, ["the project's index.html predates footage; copy loadClips() and its CLIPS wiring in from the template (see SKILL.md, Older projects and footage)"]);
  // no footage row: an older page is fine
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief("[{ at: 0, use: 'check' }, { at: END - 2, use: 'check' }]", STILL));
  assert.deepEqual((await checkBrief(dir, { frameCheck: noFrames })).errors, []);
});

test('watch: a footage row whose clip is missing is held back with the error', async () => {
  const dir = makeProject({ bars: 2, states: "[{ at: 0, use: 'footage', src: 'checkout' }, { at: END - 2, use: 'footage', src: 'checkout' }]", cursor: STILL });
  const w = await startWatch(dir, { quiet: true });
  try {
    assert.ok(w.status().errors.includes('footage: no clip at footage/checkout/clip.json'), w.status().errors.join('\n'));
  } finally { await w.close(); }
});

// ---- zoom, focus and the browser window

const Springs = (await import('../../../shared/springs.js')).default;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const G = { w: 1280, h: 720 };                                     // the shape showing the 1280x720 clip 1:1

test('zoom/focus: the settled view puts focus at the centre, clamped so the clip never leaves an empty edge', () => {
  assert.deepEqual(F.settledView(props({}), G, clip), { zoom: 1, x: 640, y: 360 }, 'defaults: the whole frame, centred');
  assert.deepEqual(F.settledView(props({ zoom: 3, focus: [0.25, 0.5] }), G, clip), { zoom: 3, x: 320, y: 360 });
  // zoom 2 shows 640x360 clip px: a centre closer than 320/180 to an edge is pulled in
  assert.deepEqual(F.settledView(props({ zoom: 2, focus: [0, 0] }), G, clip), { zoom: 2, x: 320, y: 180 }, 'clamped to the corner');
  assert.deepEqual(F.settledView(props({ zoom: 2, focus: [1, 1] }), G, clip), { zoom: 2, x: 960, y: 540 });
  assert.deepEqual(F.settledView(props({ zoom: 1, focus: [0.1, 0.9] }), G, clip), { zoom: 1, x: 640, y: 360 }, 'zoom 1 on a matching shape: no room to move');
  // contain in a square shape: the clip is letterboxed top and bottom, so y stays centred until the zoom fills it
  const sq = { w: 900, h: 900 };
  const l = F.settledView(props({ fit: 'contain', zoom: 1.2, focus: [0.3, 0.2] }), sq, clip);
  assert.ok(l.y === 360 && near(l.x, 1280 / 2 - (1280 - 900 / (0.703125 * 1.2)) / 2), `y letterboxed, x clamped: ${JSON.stringify(l)}`);
  // at zoom 2 (scale 0.703 x 2) 900 px show 640 clip px: y now clamps at 320
  const v = F.settledView(props({ fit: 'contain', zoom: 2, focus: [0.3, 0.2] }), sq, clip);
  assert.ok(near(v.y, 320) && near(v.x, 384), JSON.stringify(v));
});

test('zoom/focus: the content box in shape px (what the page lays out) shows focus at the centre', () => {
  const b = F.contentBox(F.settledView(props({ zoom: 3, focus: [0.25, 0.5] }), G, clip), G, F.windowSize(clip, ''), 'cover');
  assert.deepEqual(b, { left: 640 - 320 * 3, top: 360 - 360 * 3, width: 3840, height: 2160, scale: 3 });
  assert.deepEqual(F.contentBox(F.settledView(props({}), G, clip), G, F.windowSize(clip, ''), 'cover'), { left: 0, top: 0, width: 1280, height: 720, scale: 1 });
});

test('browser: a title bar on top of the clip; zoom 1 fits the whole window, and the shape follows its aspect', () => {
  const bar = F.barHeight(clip, 'example.com/sync');
  assert.equal(bar, Math.round(Math.max(0.04 * 720, 1280 / 32)));
  assert.equal(F.barHeight(clip, ''), 0);
  assert.deepEqual(F.windowSize(clip, 'example.com'), { W: 1280, H: 720 + bar, bar });
  const g = F.geometry(props({ browser: 'example.com', width: 1280 }), { clips });
  assert.deepEqual([g.w, g.h], [1280, 720 + bar], 'the shape is the window');
  const plain = F.geometry(props({ width: 1280 }), { clips });
  assert.deepEqual([plain.w, plain.h], [1280, 720], 'no browser: as before');
  const geo = { w: g.w, h: g.h };
  assert.deepEqual(F.settledView(props({ browser: 'example.com' }), geo, clip), { zoom: 1, x: 640, y: (720 + bar) / 2 }, 'the whole window');
  // zoomed in on the page, the bar is off the shape: focus is still a fraction of the clip's frame
  const v = F.settledView(props({ browser: 'example.com', zoom: 4, focus: [0.5, 0.5] }), geo, clip);
  assert.deepEqual(v, { zoom: 4, x: 640, y: bar + 360 });
  // focus at the top of the frame clamps to the window, so the bar is in view
  const top = F.settledView(props({ browser: 'example.com', zoom: 2, focus: [0.5, 0] }), geo, clip);
  assert.ok(near(top.y, (720 + bar) / 4), JSON.stringify(top));
});

test('continuation: zoom and focus glide on a spring from the previous row to this one; row 0 shows its own', () => {
  const bs = 0.5, a = { at: 0, use: 'footage', src: 'demo' }, b = { at: 2, use: 'footage', src: 'demo' };
  const base = { clips, beatT: (x) => x * bs, beat_sec: bs, Springs, geo: G };
  const A = props({ zoom: 4, focus: [0.25, 0.75] }), B = props({});
  const ctxA = { ...base, row: a, t0: -1e6, t1: 1, continues: false, prev: null, settled: true };
  assert.deepEqual(F.viewAt(A, ctxA, 0), F.settledView(A, G, clip), 'row 0: its own framing at t = 0');
  const end = F.endState(A, ctxA);
  const ctxB = { ...base, row: b, t0: 1, t1: Infinity, continues: true, prev: end, settled: false };
  const from = F.settledView(A, G, clip), to = F.settledView(B, G, clip);
  assert.deepEqual(F.viewAt(B, ctxB, 1), from, 'at t0: exactly where row A left off');
  const mid = F.viewAt(B, ctxB, 1 + 0.15);
  assert.ok(mid.zoom < 4 && mid.zoom > 1, `mid-spring zoom between: ${mid.zoom}`);
  assert.ok(mid.x > from.x && mid.x < to.x && mid.y < from.y && mid.y > to.y, `mid-spring focus between: ${JSON.stringify(mid)}`);
  const late = F.viewAt(B, ctxB, 1 + 0.3);
  assert.ok(late.zoom < mid.zoom, 'still moving the same way');
  const settled = F.viewAt(B, ctxB, 1 + 3);
  assert.ok(near(settled.zoom, 1, 1e-3) && near(settled.x, 640, 0.5) && near(settled.y, 360, 0.5), JSON.stringify(settled));
  // the glide never shows an empty edge: every sample is inside the clamp
  for (let t = 1; t < 2; t += 0.01) {
    const v = F.viewAt(B, ctxB, t);
    assert.ok(v.zoom >= 1, `zoom ${v.zoom}`);
    const hw = 640 / v.zoom, hh = 360 / v.zoom;
    assert.ok(v.x >= hw - 1e-6 && v.x <= 1280 - hw + 1e-6 && v.y >= hh - 1e-6 && v.y <= 720 - hh + 1e-6, `t ${t}: ${JSON.stringify(v)}`);
  }
  // another src does not glide (nor does its clip time carry)
  assert.deepEqual(F.viewAt(props({ src: 'other' }), { ...ctxB, clips: { ...clips, other: clip } }, 1.1), F.settledView(B, G, clip));
  // pure in t: the same t gives the same view whatever was asked before
  assert.deepEqual(F.viewAt(B, ctxB, 1.15), mid);
});

test('hotspots map through the row\'s own settled zoom/focus (and the bar), unchanged at zoom 1', () => {
  const c = { width: 1000, height: 500, fps: 30, frames: 30, duration: 1, mode: 'stepped', steps: [{ name: 'Pay', action: 'click', t: 0.2, box: { x: 700, y: 100, w: 100, h: 100 } }] };
  const ctx = { clips: { c } }, geo = { w: 1000, h: 500 };
  // zoom 2 on focus (0.75, 0.3) = clip px (750, 150): the step's centre (750, 150) is at the shape's centre
  assert.deepEqual(F.hotspot('step:Pay', props({ src: 'c', zoom: 2, focus: [0.75, 0.3] }), geo, ctx), { x: 0, y: 0 });
  assert.deepEqual(F.hotspot('point:0.8,0.3', props({ src: 'c', zoom: 2, focus: [0.75, 0.3] }), geo, ctx), { x: 100, y: 0 });
  // zoom 2 at focus (0, 0) clamps to centre (250, 125): point (0.5, 0.5) = (500, 250) is (250, 125) x 2 off it
  assert.deepEqual(F.hotspot('point:0.5,0.5', props({ src: 'c', zoom: 2, focus: [0, 0] }), geo, ctx), { x: 500, y: 250 });
  // the browser bar pushes the page down inside the window
  const bar = F.barHeight(c, 'example.com'), win = { w: 1000, h: 500 + bar };
  assert.deepEqual(F.hotspot('point:0.5,0.5', props({ src: 'c', browser: 'example.com' }), win, ctx), { x: 0, y: bar / 2 });
  // validation's ctx = {}: same null-ness as before
  assert.equal(F.hotspot('point:2,0', props({ src: 'c', zoom: 3 }), geo, {}), null);
  assert.deepEqual(F.hotspot('step:Pay', props({ src: 'c', zoom: 3 }), geo, {}), { x: 0, y: 0 });
});

test('validate: zoom under 1, a non-number zoom, and a focus that is not two fractions are errors', () => {
  const two = (extra) => [{ at: 0, use: 'footage', src: 'demo', ...extra }, { at: 6, use: 'footage', src: 'demo', ...extra }];
  assert.deepEqual(v(two({ zoom: 0.5 })).errors, ['footage: zoom must be 1 or more (1 shows the whole frame), got 0.5']);
  // a non-finite zoom is already the prop type error (validate's number type is finite)
  assert.deepEqual(v(two({ zoom: Infinity })).errors, ['prop "zoom" of footage should be number, got null']);
  assert.deepEqual(v(two({ zoom: 'big' })).errors, ['prop "zoom" of footage should be number, got "big"']);
  for (const focus of [[0.5], [0.5, 0.5, 0.5], [1.2, 0.5], [0.5, -0.1]])
    assert.deepEqual(v(two({ focus })).errors, [`footage: focus must be [x, y], two fractions of the frame from 0 to 1, got ${JSON.stringify(focus)}`], JSON.stringify(focus));
  assert.deepEqual(v(two({ focus: ['a', 1] })).errors, ['prop "focus" of footage should be number[], got ["a",1]']);
  assert.deepEqual(v(two({ browser: 7 })).errors, ['prop "browser" of footage should be string, got 7']);
  assert.deepEqual(v(two({ zoom: 3, focus: [0, 1], browser: 'example.com/sync' })).errors, []);
  // no clips (no project): still checked
  const none = validate({ states: two({ zoom: 0.9 }), cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song }).errors;
  assert.deepEqual(none, ['footage: zoom must be 1 or more (1 shows the whole frame), got 0.9']);
});

// A 1200x720 clip: at zoom 3 the shape shows exactly 400x240 clip px.
const CLIP12 = path.join(TMP, 'clip12');
{
  const vid = path.join(TMP, 'testsrc12.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1200x720:rate=30', '-t', '1', '-pix_fmt', 'yuv420p', vid]);
  await makeClip(vid, CLIP12, { fps: 30, maxWidth: 1280 });
}

test('render: zoom 3 on a known region shows that region of the frame, 3x (pixel match), sharp', async () => {
  // focus (0.375, 0.75) = clip px (450, 540): the shape shows clip x 250..650, y 420..660. Shape 1200x720 at (120, 360).
  const dir = makeProject({ bars: 1,
    states: "[{ at: 0, use: 'footage', src: 'z', width: 1200, speed: 0, zoom: 3, focus: [0.375, 0.75] }, { at: END - 2, use: 'footage', src: 'z', width: 1200, speed: 0, zoom: 3, focus: [0.375, 0.75] }]",
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' });
  cpSync(CLIP12, path.join(dir, 'footage', 'z'), { recursive: true });
  const s = await openScene(dir);
  try {
    const shot = await shoot(s.page, 0.3);
    const R = { x: 120 + 96, y: 360 + 48, w: 1008, h: 624 };        // inside the shape, clear of its rounded corners
    const got = rgb(shot, R);
    const expect = (x0, y0) => execFileSync(FFMPEG, ['-v', 'error', '-i', path.join(CLIP12, 'frame-00001.jpg'),
      '-vf', `crop=400:240:${x0}:${y0},scale=1200:720:flags=bicubic,crop=${R.w}:${R.h}:96:48`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 64 << 20 });
    const d = mad(got, expect(250, 420)), off = mad(got, expect(262, 420));
    assert.ok(d < 2, `zoomed region differs by ${d.toFixed(2)}`);
    assert.ok(off > 3 * d, `a 12 px shift must be told apart (${off.toFixed(2)} vs ${d.toFixed(2)})`);
    // the image is laid out at its zoomed size, never scaled by a transform (crisp), and nothing has will-change
    const st = await s.page.evaluate(() => {
      const img = document.querySelector('.c-footage .ft-frame');
      const chain = []; for (let e = img; e && e.id !== 'shape'; e = e.parentElement) chain.push(getComputedStyle(e).willChange);
      return { w: img.getBoundingClientRect().width, tf: getComputedStyle(img).transform, chain };
    });
    assert.ok(Math.abs(st.w - 3600) < 1, `img drawn at 3x: ${st.w}`);
    assert.equal(st.tf, 'none');
    assert.ok(st.chain.every((w) => w === 'auto'), JSON.stringify(st.chain));
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('render: zoom 1 / no browser is the old footage (same DOM and pixels), and a glide back to zoom 1 lands on it', async () => {
  const plain = withClip(makeProject(pageRows));
  const explicit = withClip(makeProject({ ...pageRows,
    states: "[{ at: 0, use: 'footage', src: 'demo', width: 1280, zoom: 1, focus: [0.5, 0.5], browser: '' }, { at: END - 2, use: 'footage', src: 'demo', width: 1280, zoom: 1, focus: [0.5, 0.5], browser: '' }]" }));
  const glide = withClip(makeProject({ ...pageRows,
    states: "[{ at: 0, use: 'footage', src: 'demo', width: 1280, zoom: 3, focus: [0.3, 0.6] }, { at: 0.5, use: 'footage', src: 'demo', width: 1280 }, { at: END - 2, use: 'footage', src: 'demo', width: 1280, zoom: 3, focus: [0.3, 0.6] }]" }));
  const shots = async (dir, ts) => { const s = await openScene(dir); try { const o = []; for (const t of ts) o.push({ png: await shoot(s.page, t), dom: await s.snap('#shape') }); assert.deepEqual(s.errors, []); return o; } finally { await s.close(); } };
  const ts = [0.1, 0.9, 1.5];
  const [a, b, g] = [await shots(plain, ts), await shots(explicit, ts), await shots(glide, [0.9])];
  for (let i = 0; i < ts.length; i++) {
    assert.ok(a[i].png.equals(b[i].png), `t ${ts[i]}: explicit defaults render byte-identically`);
    assert.equal(a[i].dom, b[i].dom);
    assert.doesNotMatch(a[i].dom, /ft-view|ft-bar/, 'the old DOM: no zoom wrapper');
  }
  assert.doesNotMatch(g[0].dom, /ft-mask/, 'a zoom/focus glide without crop keeps its own layout (no rect mask)');
  // t 0.9: the continuation (from beat 0.5 = 0.25 s) has settled at zoom 1; same frame as the plain piece
  const d = mad(rgb(g[0].png, STAGE_CROP), rgb(a[1].png, STAGE_CROP));
  assert.ok(d < 1, `settled at zoom 1 through the zoom path: differs by ${d.toFixed(2)}`);
});

test('render: the browser window draws a bar with its URL as real text, and passes the frame check zoomed in and out', async () => {
  const dir = withClip(makeProject({ bars: 2,
    states: "[{ at: 0, use: 'footage', src: 'demo', browser: 'example.com/sync' }, { at: 2, use: 'footage', src: 'demo', browser: 'example.com/sync', zoom: 4, focus: [0.5, 0.6] }, { at: 4, use: 'footage', src: 'demo', browser: 'example.com/sync' }, { at: END - 2, use: 'footage', src: 'demo', browser: 'example.com/sync' }]",
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' }));
  const s = await openScene(dir);
  try {
    await s.seek(0.2);
    const r = await s.page.evaluate(() => {
      const sh = document.querySelector('#shape').getBoundingClientRect();
      const q = (sel) => document.querySelector(`.c-footage[data-row="0"] ${sel}`);
      const t = q('.ft-url-text'), bar = q('.ft-bar').getBoundingClientRect(), u = t.getBoundingClientRect();
      return { text: t.textContent, dots: document.querySelectorAll('.c-footage[data-row="0"] .ft-dot').length,
        barTop: bar.top - sh.top, barW: bar.width, shW: sh.width, urlMid: (u.left + u.right) / 2 - (sh.left + sh.right) / 2, over: t.hasAttribute('data-overhang') };
    });
    assert.equal(r.text, 'example.com/sync');
    assert.equal(r.dots, 3);
    assert.ok(Math.abs(r.barTop) < 1 && Math.abs(r.barW - r.shW) < 1, `the bar spans the top of the shape: ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.urlMid) < 2, 'the URL is centred');
    assert.equal(r.over, false, 'in view: measured by the frame check');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
  const fc = await checkFrames(dir, {});
  assert.deepEqual(fc.issues.filter((i) => i.kind === 'text'), []);
});

// ---- review fixes: a glide across a browser toggle, screen-space pull-backs, hotspots off the shape, errors together

// The geometry each row really gets (width 0: the window's aspect inside the 1440 stage), so the rows differ by the bar.
const rowCtx = (p, row, extra) => ({ clips, beatT: (x) => x * 0.5, beat_sec: 0.5, Springs, row, geo: F.geometry(p, { clips }), ...extra });

test('glide across a browser toggle: a waveform close-up pulls back onto the window, continuously, and settles on it', () => {
  for (const fitB of ['cover', 'contain']) {   // contain: the fit-scale ratio is not 1, so the zoom conversion is exercised
    const A = props({ zoom: 3, focus: [0.5, 0.8] }), B = props({ browser: 'example.com/sync', fit: fitB });
    const ctxA = rowCtx(A, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: 1, continues: false, prev: null, settled: true });
    const ctxB = rowCtx(B, { at: 2, use: 'footage', src: 'demo' }, { t0: 1, t1: Infinity, continues: true, prev: F.endState(A, ctxA), settled: false });
    const winA = F.windowSize(clip, ''), winB = F.windowSize(clip, B.browser), bar = winB.bar;
    // screen px per window px and the screen offset of the clip's own point (cx, cy) from the shape's centre, on the
    // shape that is live at t0 (row A's: the morph starts there)
    const fit = (f, g, w) => (f === 'contain' ? Math.min : Math.max)(g.w / w.W, g.h / w.H);
    const screen = (v, f, win) => { const s = fit(f, ctxA.geo, win) * v.zoom; return { s, x: (640 - v.x) * s, y: (360 + win.bar - v.y) * s }; };
    const end = F.viewAt(A, ctxA, 1), start = F.viewAt(B, ctxB, 1);
    const a = screen(end, 'cover', winA), b = screen(start, fitB, winB);
    assert.ok(near(a.s, b.s, 1e-9) && near(a.x, b.x, 1e-6) && near(a.y, b.y, 1e-6), `${fitB}: at t0 the clip is where row A left it: ${JSON.stringify({ a, b })}`);
    assert.ok(near(start.y, end.y + bar, 1e-9), 'the same clip point, moved down by the bar in window space');
    let last = start;
    for (let t = 1; t <= 1.6 + 1e-9; t += 1 / 60) {
      const v = F.viewAt(B, ctxB, t);
      assert.ok(Math.abs(Math.log(v.zoom / last.zoom)) < 0.2 && Math.abs(v.x - last.x) < 40 && Math.abs(v.y - last.y) < 40,
        `${fitB} t ${t.toFixed(3)}: no jump from ${JSON.stringify(last)} to ${JSON.stringify(v)}`);
      last = v;
    }
    const to = F.settledView(B, ctxB.geo, clip), done = F.viewAt(B, ctxB, 3);
    assert.ok(near(done.zoom, to.zoom, 1e-3) && near(done.x, to.x, 0.5) && near(done.y, to.y, 0.5), `${fitB}: settles on the window ${JSON.stringify(done)}`);
    if (fitB === 'cover') assert.deepEqual(to, { zoom: 1, x: 640, y: (720 + bar) / 2 }, 'the whole window');
  }
  // and back: a window row into a page close-up without the bar glides too (the bar's px come off the y)
  const W = props({ browser: 'example.com/sync' }), P = props({ zoom: 2, focus: [0.5, 0.5] });
  const ctxW = rowCtx(W, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: 1, continues: false, prev: null, settled: true });
  const ctxP = rowCtx(P, { at: 2, use: 'footage', src: 'demo' }, { t0: 1, t1: Infinity, continues: true, prev: F.endState(W, ctxW), settled: false });
  const z0 = F.viewAt(P, ctxP, 1);
  assert.ok(z0.zoom < 1.2, `starts from the whole window's scale, not a cut to zoom 2: ${JSON.stringify(z0)}`);
});

test('pull-back: the screen offset of the view moves as one zoom about a fixed point, so the clamp never bends it', () => {
  const bs = 0.5, base = { clips, beatT: (x) => x * bs, beat_sec: bs, Springs, geo: G };
  const A = props({ zoom: 4, focus: [0.95, 0.1] }), B = props({ focus: [0.5, 0.5] });
  const ctxA = { ...base, row: { at: 0, use: 'footage', src: 'demo' }, t0: -1e6, t1: 1, continues: false, prev: null, settled: true };
  const ctxB = { ...base, row: { at: 2, use: 'footage', src: 'demo' }, t0: 1, t1: Infinity, continues: true, prev: F.endState(A, ctxA), settled: false };
  const win = F.windowSize(clip, '');
  const pts = [];
  for (let t = 1; t < 1.6; t += 1 / 60) {
    const v = F.viewAt(B, ctxB, t);
    assert.deepEqual(F.clampView(v, G, win, 'cover'), v, `t ${t.toFixed(3)}: already inside the clamp`);
    pts.push([v.zoom, (v.x - 640) * v.zoom, (v.y - 360) * v.zoom]);
  }
  // (x - cx) * zoom is affine in zoom along the whole glide (a straight line through the first and last samples)
  const [p0, p1] = [pts[0], pts.at(-1)];
  for (const p of pts) {
    const k = (p[0] - p0[0]) / (p1[0] - p0[0]);
    assert.ok(near(p[1], p0[1] + (p1[1] - p0[1]) * k, 1e-6) && near(p[2], p0[2] + (p1[2] - p0[2]) * k, 1e-6), `affine at zoom ${p[0]}`);
  }
  // pure: the same t gives the same view
  assert.deepEqual(F.viewAt(B, ctxB, 1.2), F.viewAt(B, ctxB, 1.2));
});

test('validate (strict): a step:/point: target outside the shape at the row\'s settled framing warns', () => {
  const stepped = { ...clip, steps: [{ name: 'mark', action: 'click', t: 0.1, box: { x: 40, y: 40, w: 20, h: 20 } }, { name: 'mid', action: 'click', t: 0.2, box: { x: 620, y: 340, w: 40, h: 40 } }] };
  const rows = [{ at: 0, use: 'footage', src: 'demo', zoom: 4 }, { at: 6, use: 'footage', src: 'demo', zoom: 4 }];
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'step:mark' }, { at: 2, target: 'step:mid' }, { at: 3, target: 'point:0.1,0.9' }, { at: 6, x: 0, y: 0 }];
  const r = v(rows, cur, { demo: stepped }, true);
  assert.deepEqual(r.errors, []);
  const off = r.warnings.filter((w) => /outside the shape/.test(w));
  assert.deepEqual(off, ['footage at beat 0: step:mark is outside the shape at zoom 4', 'footage at beat 0: point:0.1,0.9 is outside the shape at zoom 4']);
  assert.ok(!v(rows, cur, { demo: stepped }, false).warnings.some((w) => /outside the shape/.test(w)), 'strict only');
  const whole = [{ at: 0, use: 'footage', src: 'demo' }, { at: 6, use: 'footage', src: 'demo' }];
  assert.ok(!v(whole, cur, { demo: stepped }, true).warnings.some((w) => /outside the shape/.test(w)), 'zoom 1: every point is on the shape');
});

test('validate: zoom/focus errors are reported together with a missing clip', () => {
  const row = { use: 'footage', src: 'gone', zoom: 0.5, focus: [2, 0] }, rows = [{ at: 0, ...row }, { at: 6, ...row }];
  const e = v(rows).errors;
  for (const want of ['footage: zoom must be 1 or more (1 shows the whole frame), got 0.5', 'footage: focus must be [x, y], two fractions of the frame from 0 to 1, got [2,0]', 'footage: no clip at footage/gone/clip.json'])
    assert.ok(e.includes(want), `${want}\n in: ${e.join('\n')}`);
});

test('render: a close-up with no browser pulls back onto the browser window with no jump at the row change', async () => {
  const close = "use: 'footage', src: 'demo', width: 1280, zoom: 3, focus: [0.5, 0.8]";
  const dir = withClip(makeProject({ bars: 2,
    states: `[{ at: 0, ${close} }, { at: 2, use: 'footage', src: 'demo', width: 1280, browser: 'example.com/sync' }, { at: END - 2, ${close} }]`,
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' }));
  const s = await openScene(dir);
  try {
    // the clip's own area on screen, in the layer that is showing (row 0 before t0 = 1 s, row 1 from it)
    const page = async (t) => { await s.seek(t); return s.page.evaluate((row) => {
      const r = document.querySelector(`.c-footage[data-row="${row}"] .ft-page`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    }, t < 1 ? 0 : 1); };
    let last = await page(1 - 4 / 60);
    for (let i = -3; i <= 40; i++) {
      const t = 1 + i / 60, r = await page(t);
      const jump = Math.max(Math.abs(Math.log(r.w / last.w)), Math.abs(r.x - last.x) / last.w, Math.abs(r.y - last.y) / last.w);
      // the glide itself moves up to ~13% of the width a frame at its fastest; the row change (i = 0) must not move it
      assert.ok(jump < (i === 0 ? 0.01 : 0.25), `t ${t.toFixed(3)}: the clip jumps ${jump.toFixed(3)} (${JSON.stringify(last)} -> ${JSON.stringify(r)})`);
      last = r;
    }
    // settled: the whole window fills the shape, its bar along the top
    await s.seek(2.5);
    const end = await s.page.evaluate(() => {
      const sh = document.querySelector('#shape').getBoundingClientRect(), w = document.querySelector('.c-footage[data-row="1"] .ft-win').getBoundingClientRect();
      return [w.left - sh.left, w.top - sh.top, w.width - sh.width, w.height - sh.height];
    });
    assert.ok(end.every((d) => Math.abs(d) < 1), `the window fills the shape: ${end}`);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

// ---- crop: a rect of the clip's frame, pinned to the live shape

// The live shape the engine would morph between two rows' geometries at t0 (its SHAPE spring: zeta 0.85, 0.6 beat).
const shapeSpring = (ga, gb, t0, bs = 0.5) => {
  const o = { omega: Springs.fromSettle(0.6 * bs, 0.85), zeta: 0.85 };
  const tr = (a) => ({ from: ga[a], changes: [{ t: t0, to: gb[a] }], ...o });
  return (t) => ({ w: Springs.track(t, tr('w')).value, h: Springs.track(t, tr('h')).value });
};
// Where clip point (px, py) shows in a live shape box { w, h } for rect R (contain, centred), from the shape's top-left.
const shown = (R, box, px, py) => {
  const k = Math.min(box.w / R.w, box.h / R.h);
  return { x: (box.w - R.w * k) / 2 + (px - R.x) * k, y: (box.h - R.h * k) / 2 + (py - R.y) * k, k };
};
const cropCtx = (p, row, extra) => ({ clips, beatT: (x) => x * 0.5, beat_sec: 0.5, Springs, row, geo: F.geometry(p, { clips }), ...extra });

test('crop: the shape takes the crop\'s aspect (width or the stage fit); the settled rect is the crop in clip px', () => {
  const p = props({ crop: [0.25, 0.5, 0.5, 0.25] });              // 640 x 180 clip px
  const g = F.geometry(p, { clips });
  assert.deepEqual([g.w, g.h], [1152, 324], 'fitted inside the stage less the margin, at the crop\'s aspect');
  const w = F.geometry(props({ crop: [0.25, 0.5, 0.5, 0.25], width: 960 }), { clips });
  assert.deepEqual([w.w, w.h], [960, 270]);
  assert.deepEqual(F.settledRect(p, g, clip), { x: 320, y: 360, w: 640, h: 180 });
  // a row without crop: its settled framing's visible region (the window's bar, if any, above y 0)
  assert.deepEqual(F.settledRect(props({}), G, clip), { x: 0, y: 0, w: 1280, h: 720 });
  assert.deepEqual(F.settledRect(props({ zoom: 2, focus: [0.25, 0.25] }), G, clip), { x: 0, y: 0, w: 640, h: 360 });
  const bar = F.barHeight(clip, 'x.com'), gb = F.geometry(props({ browser: 'x.com' }), { clips });
  const rb = F.settledRect(props({ browser: 'x.com' }), gb, clip);
  assert.ok(near(rb.x, 0) && near(rb.y, -bar) && near(rb.w, 1280) && near(rb.h, 720 + bar), JSON.stringify(rb));
  // a row's own settled crop on its own shape: the crop fills it exactly
  assert.deepEqual(F.rectAt(p, cropCtx(p, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: Infinity, continues: false, prev: null, settled: true }), 0),
    { x: 320, y: 360, w: 640, h: 180 });
});

test('crop: a strip grows up into strip + waveform with the page pinned to the shape\'s bottom edge', () => {
  const A = props({ crop: [0.59, 0.52, 0.40, 0.06] }), B = props({ crop: [0.59, 0.05, 0.40, 0.53] });
  const gA = F.geometry(A, { clips }), gB = F.geometry(B, { clips });
  assert.equal(gA.w, gB.w, 'same width: only the height morphs');
  const shapeAt = shapeSpring(gA, gB, 1);
  const ctxA = cropCtx(A, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: 1, continues: false, prev: null, settled: true, shapeAt });
  const ctxB = cropCtx(B, { at: 2, use: 'footage', src: 'demo' }, { t0: 1, t1: Infinity, continues: true, prev: F.endState(A, ctxA), settled: false, shapeAt });
  const px = 0.79 * 1280, py = 0.55 * 720;                                   // inside both rects
  const bottom = (R, t) => { const box = shapeAt(t), s = shown(R, box, px, py); return { d: box.h - s.y, x: s.x }; };
  const at0 = bottom(F.rectAt(A, ctxA, 0.99), 0.99);
  let overshoot = false;
  for (let t = 1; t <= 1.6 + 1e-9; t += 1 / 120) {
    const R = F.rectAt(B, ctxB, t), b = bottom(R, t);
    assert.ok(Math.abs(b.d - at0.d) < 0.5 && Math.abs(b.x - at0.x) < 0.5, `t ${t.toFixed(3)}: the point drifts from the bottom edge: ${JSON.stringify({ b, at0, R })}`);
    assert.ok(R.y >= 0 && R.y + R.h <= 720 + 1e-9, `clamped to the clip: ${JSON.stringify(R)}`);
    if (shapeAt(t).h > gB.h) overshoot = true;
  }
  assert.ok(overshoot, 'the samples cover the spring\'s overshoot');
  const end = F.rectAt(B, ctxB, 5);
  assert.ok(near(end.y, 0.05 * 720, 0.01) && near(end.h, 0.53 * 720, 0.01), `settles on its own crop: ${JSON.stringify(end)}`);
  assert.deepEqual(F.rectAt(B, ctxB, 1.1), F.rectAt(B, ctxB, 1.1), 'pure');
});

test('crop: neither axis changing is no glide; one axis still is, from the other\'s progress', () => {
  const A = props({ crop: [0, 0, 0.5, 0.5] }), B = props({ crop: [0.5, 0.5, 0.5, 0.5] });
  const g = F.geometry(A, { clips }), shapeAt = shapeSpring(g, g, 1);
  const ctxA = cropCtx(A, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: 1, continues: false, prev: null, settled: true, shapeAt });
  const ctxB = cropCtx(B, { at: 2, use: 'footage', src: 'demo' }, { t0: 1, t1: Infinity, continues: true, prev: F.endState(A, ctxA), settled: false, shapeAt });
  assert.deepEqual(F.rectAt(B, ctxB, 1), { x: 640, y: 360, w: 640, h: 360 }, 'the same shape: this row\'s own crop from t0');
});

test('crop -> browser window (and back): glides from the crop to the whole window with no cut, and settles on it', () => {
  const A = props({ crop: [0.59, 0.52, 0.40, 0.06] }), B = props({ browser: 'example.com/sync' });
  const gA = F.geometry(A, { clips }), gB = F.geometry(B, { clips }), shapeAt = shapeSpring(gA, gB, 1);
  const ctxA = cropCtx(A, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: 1, continues: false, prev: null, settled: true, shapeAt });
  const ctxB = cropCtx(B, { at: 2, use: 'footage', src: 'demo' }, { t0: 1, t1: Infinity, continues: true, prev: F.endState(A, ctxA), settled: false, shapeAt });
  const a = F.rectAt(A, ctxA, 1);
  const b0 = F.rectAt(B, ctxB, 1);
  assert.ok(['x', 'y', 'w', 'h'].every((k) => near(b0[k], a[k], 1e-9)), `at t0: exactly the crop ${JSON.stringify([a, b0])}`);
  let last = a;
  for (let t = 1; t <= 1.6 + 1e-9; t += 1 / 120) {
    const R = F.rectAt(B, ctxB, t);
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(R[k] - last[k]) < 90, `t ${t.toFixed(3)}: ${k} jumps ${JSON.stringify(last)} -> ${JSON.stringify(R)}`);
    last = R;
  }
  const bar = F.barHeight(clip, B.browser), end = F.rectAt(B, ctxB, 5);
  assert.ok(near(end.x, 0, 0.01) && near(end.y, -bar, 0.01) && near(end.w, 1280, 0.01) && near(end.h, 720 + bar, 0.01), JSON.stringify(end));
  // and back: the window row's whole window is where a following crop row starts
  const ctxW = cropCtx(B, { at: 0, use: 'footage', src: 'demo' }, { t0: -1e6, t1: 1, continues: false, prev: null, settled: true, shapeAt: shapeSpring(gB, gA, 1) });
  const ctxC = cropCtx(A, { at: 2, use: 'footage', src: 'demo' }, { t0: 1, t1: Infinity, continues: true, prev: F.endState(B, ctxW), settled: false, shapeAt: shapeSpring(gB, gA, 1) });
  const w0 = F.rectAt(A, ctxC, 1);
  assert.ok(near(w0.y, -bar, 0.01) && near(w0.h, 720 + bar, 0.01), `starts on the window: ${JSON.stringify(w0)}`);
  // zoom/focus rows without crop keep their own glide (no rect)
  assert.equal(F.usesRect(props({ zoom: 3 }), { continues: true, prev: { ...props({}), _rect: {} } }), false);
  assert.equal(F.usesRect(B, ctxB), true);
});

test('crop: hotspots map through the settled crop; one off the crop warns (strict)', () => {
  const c = { width: 1000, height: 500, fps: 30, frames: 30, duration: 1, mode: 'stepped', steps: [{ name: 'Pay', action: 'click', t: 0.2, box: { x: 700, y: 100, w: 100, h: 100 } }] };
  const ctx = { clips: { c } }, p = props({ src: 'c', crop: [0.6, 0.1, 0.4, 0.4] });   // 400 x 200 clip px at (600, 50)
  const geo = { w: 800, h: 400 };                                                       // 2x
  assert.deepEqual(F.hotspot('step:Pay', p, geo, ctx), { x: -100, y: 0 });              // (750, 150) vs centre (800, 150)
  assert.deepEqual(F.hotspot('point:0.6,0.1', p, geo, ctx), { x: -400, y: -200 });
  const rows = [{ at: 0, use: 'footage', src: 'demo', crop: [0.5, 0.5, 0.25, 0.25] }, { at: 6, use: 'footage', src: 'demo', crop: [0.5, 0.5, 0.25, 0.25] }];
  const cur = [{ at: 0, x: 0, y: 0 }, { at: 1, target: 'point:0.1,0.1' }, { at: 2, target: 'point:0.6,0.6' }, { at: 6, x: 0, y: 0 }];
  const r = v(rows, cur, { demo: clip }, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.filter((w) => /outside the shape/.test(w)), ['footage at beat 0: point:0.1,0.1 is outside the shape at crop [0.5,0.5,0.25,0.25]']);
});

test('validate: crop must be four fractions inside the frame with w, h over 0, and not with zoom/focus', () => {
  const two = (extra) => [{ at: 0, use: 'footage', src: 'demo', ...extra }, { at: 6, use: 'footage', src: 'demo', ...extra }];
  assert.deepEqual(v(two({ crop: [0.1, 0.1, 0.5, 0.5] })).errors, []);
  assert.deepEqual(v(two({ crop: null })).errors, [], 'null: off');
  for (const crop of ['wide', [0.1, 0.1, 0.5], [0.1, 0.1, 0.5, 0.5, 1], [0.1, 'a', 0.5, 0.5], { x: 0 }])
    assert.deepEqual(v(two({ crop })).errors, [`footage: crop must be [x, y, w, h], four fractions of the frame, got ${JSON.stringify(crop)}`], JSON.stringify(crop));
  for (const crop of [[0.1, 0.1, 0, 0.5], [0.1, 0.1, 0.5, -0.2]])
    assert.deepEqual(v(two({ crop })).errors, [`footage: crop's w and h must be more than 0, got ${JSON.stringify(crop)}`], JSON.stringify(crop));
  for (const crop of [[0.6, 0.1, 0.5, 0.5], [0.1, 0.6, 0.5, 0.5], [-0.1, 0, 0.5, 0.5]])
    assert.deepEqual(v(two({ crop })).errors, [`footage: crop must lie inside the frame (x, y from 0; x + w and y + h at most 1), got ${JSON.stringify(crop)}`], JSON.stringify(crop));
  const both = 'footage: crop and zoom/focus cannot both be set on one row (crop frames the clip on its own)';
  assert.deepEqual(v(two({ crop: [0, 0, 0.5, 0.5], zoom: 2 })).errors, [both]);
  assert.deepEqual(v(two({ crop: [0, 0, 0.5, 0.5], focus: [0.5, 0.5] })).errors, [both]);
  // no clips (no project): still checked
  const none = validate({ states: two({ crop: [0, 0, 2, 0.5] }), cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song }).errors;
  assert.deepEqual(none, ['footage: crop must lie inside the frame (x, y from 0; x + w and y + h at most 1), got [0,0,2,0.5]']);
});

test('render: a settled crop shows exactly the crop rect of the frame (pixel match), masked, sharp, no will-change', async () => {
  // crop [0.25, 0.5, 0.5, 0.25] of the 1200x720 clip = clip px 300..900 x 360..540; width 1200: shape 1200x360 at (120, 540), 2x.
  const row = "use: 'footage', src: 'z', width: 1200, speed: 0, crop: [0.25, 0.5, 0.5, 0.25]";
  const dir = makeProject({ bars: 1, states: `[{ at: 0, ${row} }, { at: END - 2, ${row} }]`,
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' });
  cpSync(CLIP12, path.join(dir, 'footage', 'z'), { recursive: true });
  const s = await openScene(dir);
  try {
    const shot = await shoot(s.page, 0.3);
    const R = { x: 120 + 40, y: 540 + 40, w: 1120, h: 280 };          // inside the shape, clear of its rounded corners
    const expect = (x0, y0) => execFileSync(FFMPEG, ['-v', 'error', '-i', path.join(CLIP12, 'frame-00001.jpg'),
      '-vf', `crop=600:180:${x0}:${y0},scale=1200:360:flags=bicubic,crop=${R.w}:${R.h}:40:40`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 64 << 20 });
    const got = rgb(shot, R), d = mad(got, expect(300, 360)), off = mad(got, expect(306, 360));
    assert.ok(d < 2, `the crop differs by ${d.toFixed(2)}`);
    assert.ok(off > 3 * d, `a 6 px shift must be told apart (${off.toFixed(2)} vs ${d.toFixed(2)})`);
    const st = await s.page.evaluate(() => {
      const sh = document.querySelector('#shape').getBoundingClientRect(), m = document.querySelector('.c-footage .ft-mask');
      const r = m.getBoundingClientRect(), img = document.querySelector('.c-footage .ft-frame');
      const chain = []; for (let e = img; e && e.id !== 'shape'; e = e.parentElement) chain.push(getComputedStyle(e).willChange);
      return { box: [r.left - sh.left, r.top - sh.top, r.width - sh.width, r.height - sh.height], overflow: getComputedStyle(m).overflow,
        w: img.getBoundingClientRect().width, tf: getComputedStyle(img).transform, chain };
    });
    assert.ok(st.box.every((x) => Math.abs(x) < 0.5), `the mask is the shape: ${st.box}`);
    assert.equal(st.overflow, 'hidden');
    assert.ok(Math.abs(st.w - 2400) < 1, `img drawn at 2x: ${st.w}`);
    assert.equal(st.tf, 'none');
    assert.ok(st.chain.every((w) => w === 'auto'), JSON.stringify(st.chain));
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('render: strip -> strip + waveform keeps the strip on the shape\'s bottom edge; -> browser window with no cut', async () => {
  const A = "use: 'footage', src: 'demo', crop: [0.59, 0.52, 0.40, 0.06]";
  const dir = withClip(makeProject({ bars: 2,
    states: `[{ at: 0, ${A} }, { at: 2, use: 'footage', src: 'demo', crop: [0.59, 0.05, 0.40, 0.53] }, { at: 4, use: 'footage', src: 'demo', browser: 'example.com/sync' }, { at: END - 2, ${A} }]`,
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' }));
  const s = await openScene(dir);
  try {
    // clip point (0.79, 0.55) on screen, from the shape's bottom edge, in shape widths (the camera zoom divides out)
    const at = async (t) => { await s.seek(t); return s.page.evaluate((row) => {
      const sh = document.querySelector('#shape').getBoundingClientRect(), pg = document.querySelector(`.c-footage[data-row="${row}"] .ft-page`).getBoundingClientRect();
      return { dy: (sh.bottom - (pg.top + 0.55 * pg.height)) / sh.width, dx: (pg.left + 0.79 * pg.width - sh.left) / sh.width, w: pg.width / sh.width, h: sh.height };
    }, t < 1 ? 0 : t < 2 ? 1 : 2); };
    const a = await at(0.95);
    const hs = [];
    for (let i = 0; i <= 36; i++) {
      const r = await at(1 + i / 60);
      hs.push(r.h);
      assert.ok(Math.abs(r.dy - a.dy) < 0.6 / 1152 && Math.abs(r.dx - a.dx) < 0.6 / 1152 && Math.abs(r.w / a.w - 1) < 4e-3,
        `t ${(1 + i / 60).toFixed(3)}: the strip leaves the bottom edge: ${JSON.stringify({ a, r })}`);
    }
    assert.ok(hs.at(-1) > 5 * hs[0], 'the shape grew up');
    // into the browser window: the clip's own area does not jump at the row change, and settles filling the window
    let last = await at(2 - 2 / 60);
    for (let i = -1; i <= 30; i++) {
      const t = 2 + i / 60, r = await at(t);
      assert.ok(Math.abs(Math.log(r.w / last.w)) < (i === 0 ? 0.01 : 0.2), `t ${t.toFixed(3)}: the clip jumps ${JSON.stringify([last, r])}`);
      last = r;
    }
    await s.seek(2.9);
    const end = await s.page.evaluate(() => {
      const sh = document.querySelector('#shape').getBoundingClientRect(), w = document.querySelector('.c-footage[data-row="2"] .ft-win').getBoundingClientRect();
      return [w.left - sh.left, w.top - sh.top, w.width - sh.width, w.height - sh.height];
    });
    assert.ok(end.every((d) => Math.abs(d) < 1), `the window fills the shape: ${end}`);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('render: the first row after a cut shows only its crop, letterboxed in the shape\'s fill, while the outline morphs', async () => {
  // a tall crop (256x576 clip px: shape 512x1152) after a button: mid-morph the shape is wider than the crop's aspect
  const dir = withClip(makeProject({ bars: 2,
    states: "[{ at: 0, use: 'button', label: 'Go' }, { at: 2, use: 'footage', src: 'demo', crop: [0.4, 0.1, 0.2, 0.8] }, { at: END - 2, use: 'button', label: 'Go' }]",
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' }));
  const s = await openScene(dir);
  try {
    let checked = 0;
    for (const beat of [2.2, 2.25, 2.3, 2.35, 2.4]) {
      const png = await shoot(s.page, beat * 0.5);
      const r = await s.page.evaluate(() => {
        const sh = document.querySelector('#shape'), b = sh.getBoundingClientRect(), m = document.querySelector('.c-footage .ft-mask').getBoundingClientRect();
        const layer = document.querySelector('.c-footage'), dpr = window.devicePixelRatio;
        return { sh: [b.left, b.top, b.width, b.height], m: [m.left, m.top, m.width, m.height], bg: getComputedStyle(sh).backgroundColor,
          op: +getComputedStyle(layer).opacity, overflow: getComputedStyle(document.querySelector('.c-footage .ft-mask')).overflow, dpr };
      });
      assert.equal(r.overflow, 'hidden');
      assert.ok(Math.abs(r.m[2] / r.m[3] - 256 / 576) < 0.01, `the mask has the crop's aspect: ${JSON.stringify(r)}`);
      assert.ok(Math.abs(r.m[1] + r.m[3] / 2 - (r.sh[1] + r.sh[3] / 2)) < 1 && Math.abs(r.m[0] + r.m[2] / 2 - (r.sh[0] + r.sh[2] / 2)) < 1, 'centred');
      const band = (r.m[0] - r.sh[0]);
      if (band < 30 || r.op < 0.15) continue;                                  // no band yet, or the layer barely in
      // mid-band, left and right of the mask, at the shape's middle: the shape's own fill, no clip pixels
      const bg = r.bg.match(/\d+/g).map(Number), cy = Math.round(r.sh[1] + r.sh[3] / 2);
      for (const x of [Math.round(r.sh[0] + band / 2), Math.round(r.m[0] + r.m[2] + band / 2)]) {
        const px = rgb(png, { x: x - 2, y: cy - 2, w: 4, h: 4 }), mean = [0, 1, 2].map((k) => px.filter((_, i) => i % 3 === k).reduce((a, b) => a + b) / 16);
        assert.ok(mean.every((c, k) => Math.abs(c - bg[k]) < 4), `beat ${beat} x ${x}: rgb(${mean.map(Math.round)}) is not the fill ${r.bg} (${JSON.stringify(r)})`);
      }
      checked++;
    }
    assert.ok(checked >= 2, `sampled the morph with a band ${checked} times`);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('render: a crop glide that changes the content scale (panel -> whole page) covers the live shape: no fill bands mid-glide', async () => {
  // panel [0.5903, 0.0556, 0.4056, 0.9378] (tall) into the whole page (wide): the lerped rect's aspect lags the live
  // shape's, so a contain fit would leave fill bands top and bottom mid-glide. Cover fills the shape.
  const P = "use: 'footage', src: 'demo', speed: 0, crop: [0.5903, 0.0556, 0.4056, 0.9378]";
  const dir = withClip(makeProject({ bars: 2,
    states: `[{ at: 0, ${P} }, { at: 2, use: 'footage', src: 'demo', speed: 0 }, { at: END - 2, ${P} }]`,
    cursor: '[{ at: 0, x: 0, y: 600, hide: true }, { at: END - 2, x: 0, y: 600, hide: true }]' }));
  const s = await openScene(dir);
  try {
    let mid = 0;
    for (const t of [1.04, 1.07, 1.1, 1.14, 1.18, 1.22]) {
      const png = await shoot(s.page, t);
      const r = await s.page.evaluate(() => {
        const sh = document.querySelector('#shape'), b = sh.getBoundingClientRect(), m = document.querySelector('.c-footage[data-row="1"] .ft-mask').getBoundingClientRect();
        return { sh: [b.left, b.top, b.right, b.bottom], m: [m.left, m.top, m.right, m.bottom], bg: getComputedStyle(sh).backgroundColor };
      });
      const [L, T, Rr, B] = r.sh, w = Rr - L, h = B - T;
      assert.ok(r.m[0] <= L + 0.5 && r.m[1] <= T + 0.5 && r.m[2] >= Rr - 0.5 && r.m[3] >= B - 0.5, `t ${t}: the mask does not cover the shape: ${JSON.stringify(r)}`);
      // a strip a few px inside each edge, over its middle third: clip pixels, not the shape's fill (a band reads the
      // fill within ~1; the clip's black reads ~11 off it)
      const bg = r.bg.match(/\d+/g).map(Number);
      const strips = { top: { x: L + w / 3, y: T + 3, w: w / 3, h: 3 }, bottom: { x: L + w / 3, y: B - 6, w: w / 3, h: 3 },
        left: { x: L + 3, y: T + h / 3, w: 3, h: h / 3 }, right: { x: Rr - 6, y: T + h / 3, w: 3, h: h / 3 } };
      for (const [edge, q] of Object.entries(strips)) {
        const box = { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.w), h: Math.round(q.h) }, px = rgb(png, box), n = px.length / 3;
        const mean = [0, 1, 2].map((k) => px.filter((_, i) => i % 3 === k).reduce((a, c) => a + c, 0) / n);
        assert.ok(Math.max(...mean.map((c, k) => Math.abs(c - bg[k]))) > 6, `t ${t} ${edge}: rgb(${mean.map(Math.round)}) is the fill ${r.bg}: a band (${JSON.stringify(r)})`);
      }
      if (w / h > 0.9 && w / h < 1.7) mid++;                                    // between the panel's aspect (0.77) and the page's (1.78)
    }
    assert.ok(mid >= 3, `sampled mid-glide ${mid} times`);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
