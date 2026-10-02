// safezones.mjs: shape and cursor boxes against each preset's safe margins (camera zoom included), the CLI,
// and guides previews (translucent bands, never in an export render).
// The checks use the real presets at the real vertical stage (1080x1920, no screenshots, so it is cheap):
// Reels margins are top 269, bottom 672, sides 65, so the bottom zone starts 288 px below the stage centre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeProject } from './harness.mjs';
import { grayFrame } from './fixtures.mjs';
import { render, stampPath } from '../scripts/render.mjs';
import { checkSafeZones, issueText, loadPresets } from '../scripts/safezones.mjs';
import { reusableRender } from '../scripts/export.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/safezones.mjs');
delete process.env.MOTION_PRESETS;   // the real presets.json
const still = '[{ at: 0, x: 0, y: 0 }, { at: END - 2, x: 0, y: 0 }]';
// A small centred row (zoomed 2.4x to 480x288) that turns tall (300x700, zoom 1: bottom edge 1310, 62 px into the
// Reels bottom zone) for one beat, from beat 3 to 4. Sampled on whole beats, it is only settled tall at beat 4.
const small = "use: 'button', label: 'Go', w: 200, h: 120";
const tallOneBeat = `[{ at: 0, ${small} }, { at: 3, use: 'check', w: 300, h: 700 }, { at: 4, ${small} }, { at: END - 2, ${small} }]`;

test('a tall row entering the bottom zone for one beat is one issue at that beat and edge', async () => {
  const dir = makeProject({ bars: 2, states: tallOneBeat, cursor: still });
  const { issues } = await checkSafeZones(dir, { presets: ['reels'], samples: 'beats' });
  assert.equal(issues.length, 1, JSON.stringify(issues));
  const [i] = issues;
  assert.deepEqual({ preset: i.preset, beat: i.beat, part: i.part, edge: i.edge }, { preset: 'reels', beat: 4, part: 'shape', edge: 'bottom' });
  assert.ok(i.px >= 62 && i.px < 80, `px ${i.px}`);
  assert.match(issueText(i, await loadPresets()), /^beat 4: shape extends \d+ px into the Instagram Reels bottom zone$/);
});

test('a small centred component raises nothing (and design-shape presets need no browser)', async () => {
  const dir = makeProject({ bars: 2, states: `[{ at: 0, ${small} }, { at: END - 2, ${small} }]`, cursor: still });
  assert.deepEqual((await checkSafeZones(dir, { presets: ['reels', 'tiktok', 'shorts'], samples: 'half' })).issues, []);
  // web, discord and x have all-zero margins: nothing to check, so no page is opened. With Playwright pointed at an
  // empty browsers dir any launch fails, yet they pass; reels in the same environment does reach for a browser.
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'no-browsers') };
  let r = spawnSync('node', [SCRIPT, dir, '--for', 'web,discord,x'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^no safe zones for web \(the whole frame is shown\)\nno safe zones for discord .*\nno safe zones for x .*\n$/);
  assert.doesNotMatch(r.stdout, /no safe-zone issues/, 'nothing was checked, so it does not claim a clean check');
  r = spawnSync('node', [SCRIPT, dir, '--for', 'reels'], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: .*Executable doesn't exist/);
});

test('camera zoom is measured: a 300x300 row zoomed 2.16x reaches the bottom zone that it would clear unzoomed', async () => {
  // Unzoomed its bottom edge would be 960 + 150 = 1110, clear of 1248; zoomed it is 960 + 324 = 1284 (36 px in).
  // The cursor tip sits 140 design px below centre: 960 + 140 * 2.16 = 1262.4 on stage. The cursor is drawn at scale
  // K = 1 whatever the zoom, and its arrow (engine/template #cursor path) reaches 33 px below the tip (y 4 to 37 in its
  // 44 px box), so its bottom is 1295.4: 47 px in (the tip alone would be 14).
  const row = "use: 'check', w: 300, h: 300";
  const dir = makeProject({ bars: 2, states: `[{ at: 0, ${row} }, { at: END - 2, ${row} }]`,
    cursor: '[{ at: 0, x: 0, y: 140 }, { at: END - 2, x: 0, y: 140 }]' });
  const { issues } = await checkSafeZones(dir, { presets: ['reels'], samples: 'half' });
  // Constant all loop: each part is one run from beat 0 to the last half beat.
  assert.deepEqual(issues.map((i) => [i.part, i.edge, i.beat, i.through, i.px]),
    [['shape', 'bottom', 0, 7.5, 36], ['cursor', 'bottom', 0, 7.5, 47]]);
  assert.match(issueText(issues[1], await loadPresets()), /^beats 0-7\.5: cursor is 47 px into the Instagram Reels bottom zone$/);
});

test('CLI: issues exit 1, unknown preset or no DIR is error: ... exit 2', () => {
  const dir = makeProject({ bars: 2, states: tallOneBeat, cursor: still });
  let r = spawnSync('node', [SCRIPT, dir, '--for', 'reels'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^beats 3\.5-4: shape extends \d+ px into the Instagram Reels bottom zone/m);
  r = spawnSync('node', [SCRIPT, dir, '--for', 'reelz'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: unknown preset "reelz" \(did you mean "reels"\?\)/);
  r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: usage: safezones\.mjs DIR --for/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/, 'no stack trace');
});

test('guides preview draws the zone bands; plain and export renders never have them', async () => {
  const dir = makeProject({ bars: 2, states: `[{ at: 0, ${small} }, { at: END - 2, ${small} }]`, cursor: still });
  const stage = [216, 384], shapes = path.join(dir, 'out', 'shapes', '216x384');
  const guided = await render(dir, { stage, guides: 'reels', preview: true, workers: 2 });
  assert.equal(guided, path.join(shapes, 'preview-guides-reels.mp4'));
  assert.ok(!existsSync(stampPath(guided)), 'a guides preview is never stamped');
  assert.ok(!existsSync(path.join(shapes, 'video.mp4')) && !existsSync(path.join(shapes, 'preview.mp4')), 'nothing export reuses is written');
  assert.equal(await reusableRender(dir, guided, stage), false);
  const plain = await render(dir, { stage, preview: true, workers: 2 });
  // Preview is half size (108x192). Reels' top band at 216x384 is 54 px, so 27 px in the preview; the bottom band is
  // 134 px (67). Sample inside each band, away from the centred shape and the cursor.
  const top = { x: 10, y: 4, w: 88, h: 18 }, bottom = { x: 10, y: 150, w: 88, h: 36 }, clear = { x: 10, y: 30, w: 20, h: 30 };
  for (const [name, box] of Object.entries({ top, bottom })) {
    const d = Math.abs(grayFrame(guided, 0, box) - grayFrame(plain, 0, box));
    assert.ok(d > 20, `${name} band differs from the unguided frame by ${d.toFixed(1)}`);
  }
  assert.ok(Math.abs(grayFrame(guided, 0, clear) - grayFrame(plain, 0, clear)) < 3, 'the safe area is untouched');
  // Guides take the preset's own shape when no stage is given.
  const auto = await render(dir, { guides: 'reels', preview: true, workers: 1, to: 0.1 });
  assert.equal(auto, path.join(dir, 'out', 'shapes', '1080x1920', 'preview-guides-reels.mp4'));
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8')).stage.width, 1440, 'project.json untouched');
});

test('the cursor arrow counts to the right: a tip 15 px left of the right zone still enters it', async () => {
  // Stage 1080 wide, Reels right zone from 1015; the small row zooms 2.4x. The arrow reaches 23 px right of its tip
  // (x 7 to 30 in the #cursor box). Tip at 985 (185.4 design px out): arrow to 1008, clear. Tip at 1000: arrow to 1023, 8 px in.
  const row = `[{ at: 0, ${small} }, { at: END - 2, ${small} }]`;
  const at = (x) => `[{ at: 0, x: ${x}, y: 0 }, { at: END - 2, x: ${x}, y: 0 }]`;
  let { issues } = await checkSafeZones(makeProject({ bars: 2, states: row, cursor: at(445 / 2.4) }), { presets: ['reels'], samples: 'beats' });
  assert.deepEqual(issues, []);
  ({ issues } = await checkSafeZones(makeProject({ bars: 2, states: row, cursor: at(460 / 2.4) }), { presets: ['reels'], samples: 'beats' }));
  assert.deepEqual(issues.map((i) => [i.part, i.edge, i.px]), [['cursor', 'right', 8]]);
});

test('a hidden cursor (inspect opacity under 0.05) is never in a zone; a visible one in the same place is', async () => {
  // The tip at 460 / 2.4 design px puts the arrow 8 px into the Reels right zone (as above).
  const row = `[{ at: 0, ${small} }, { at: END - 2, ${small} }]`, x = 460 / 2.4;
  let { issues } = await checkSafeZones(makeProject({ bars: 2, states: row,
    cursor: `[{ at: 0, x: ${x}, y: 0, hide: true }, { at: END - 2, x: ${x}, y: 0, hide: true }]` }), { presets: ['reels'], samples: 'beats' });
  assert.deepEqual(issues, [], 'hidden all loop: nothing reported');
  // Visible on beats 0 to 2, hidden from beat 2 (gone by beat 3), shown again from beat 5 (fading in from 0 there).
  ({ issues } = await checkSafeZones(makeProject({ bars: 2, states: row,
    cursor: `[{ at: 0, x: ${x}, y: 0 }, { at: 2, x: ${x}, y: 0, hide: true }, { at: 5, x: ${x}, y: 0 }, { at: END - 2, x: ${x}, y: 0 }]` }),
    { presets: ['reels'], samples: 'beats' }));
  assert.deepEqual(issues.map((i) => [i.part, i.edge, i.beat, i.through, i.px]), [['cursor', 'right', 0, 2, 8], ['cursor', 'right', 6, 7, 8]]);
});

test('a malformed song.json is error: ... exit 2', () => {
  const dir = makeProject({ bars: 2 });
  writeFileSync(path.join(dir, 'song.json'), '{ "beats": [');
  const r = spawnSync('node', [SCRIPT, dir, '--for', 'reels'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: song\.json is not valid JSON/);
});

test('render --guides never writes video.mp4 or preview.mp4', () => {
  const dir = makeProject({ bars: 2 });
  for (const name of ['video.mp4', 'preview.mp4']) {
    const r = spawnSync('node', [path.resolve(import.meta.dirname, '../scripts/render.mjs'), dir, '--guides', 'reels', '--preview',
      '--out', path.join(dir, 'out', 'shapes', '1080x1920', name)], { encoding: 'utf8' });
    assert.equal(r.status, 2, name);
    assert.match(r.stderr, /^error: --guides output must not be named video\.mp4 or preview\.mp4/);
  }
  assert.ok(!existsSync(path.join(dir, 'out')));
});

test('render --guides refuses Video.mp4 (any case) and any out path that already has a render stamp', () => {
  const dir = makeProject({ bars: 2 });
  const shapes = path.join(dir, 'out', 'shapes', '1080x1920');
  const cli = (out) => spawnSync('node', [path.resolve(import.meta.dirname, '../scripts/render.mjs'), dir, '--guides', 'reels', '--preview',
    '--out', out], { encoding: 'utf8' });
  // On a case-insensitive disk (APFS) Video.mp4 is the stamped full render.
  for (const name of ['Video.mp4', 'PREVIEW.MP4']) {
    const r = cli(path.join(shapes, name));
    assert.equal(r.status, 2, name);
    assert.match(r.stderr, /^error: --guides output must not be named video\.mp4 or preview\.mp4/, name);
  }
  mkdirSync(shapes, { recursive: true });
  const stamped = path.join(shapes, 'keep.mp4');
  writeFileSync(stampPath(stamped), '{}');
  const r = cli(stamped);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^error: --guides output .*keep\.mp4 has a render stamp/);
  assert.ok(!existsSync(stamped), 'nothing written');
});

test('render --guides with an unknown preset is error: ... exit 2', () => {
  const r = spawnSync('node', [path.resolve(import.meta.dirname, '../scripts/render.mjs'), makeProject({ bars: 2 }), '--guides', 'tiktk'],
    { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: unknown preset "tiktk" \(did you mean "tiktok"\?\)/);
});
