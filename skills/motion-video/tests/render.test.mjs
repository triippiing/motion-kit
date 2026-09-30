import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render, openProject, shoot } from '../scripts/render.mjs';
import { fixture, probe, grayFrame, audioSamples } from './fixtures.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');

test('renders exactly loop.frames frames at 60fps with audio', async () => {
  const dir = fixture();
  const out = await render(dir, { workers: 2 });
  const p = probe(out);
  const v = p.streams.find((s) => s.codec_type === 'video');
  assert.equal(Number(v.nb_read_frames), 60);
  assert.equal(v.width, 64); assert.equal(v.r_frame_rate, '60/1');
  assert.ok(p.streams.some((s) => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(p.format.duration) - 1) < 0.05, p.format.duration);
});

test('subframes are centred on the frame and blended (motion blur)', async () => {
  // White for subframes after the frame time, black before: a correct centred
  // 4-subframe blend is mid gray; an off-by-one select would be all black or white.
  const dir = fixture({ seek: 'const x = t * 60; document.body.style.background = (x - Math.round(x)) > 0 ? "#fff" : "#000";' });
  const out = await render(dir, { workers: 2 });
  const g = grayFrame(out, 10);
  assert.ok(g > 100 && g < 155, `frame 10 mean ${g}`);
});

test('preview is half size and single-subframe', async () => {
  const out = await render(fixture(), { preview: true });
  assert.equal(probe(out).streams.find((s) => s.codec_type === 'video').width, 32);
});

test('SFX land at the beat cue_t', async () => {
  const beats = [0, 1, 2, 3].map((i) => ({ i, t: i * 0.25, cue_t: i * 0.25 + (i === 2 ? 0.02 : 0) }));
  const dir = fixture({ sfx: [{ beat: 2, file: 'sfx/click.wav', gain: 1 }], beats });
  const s = audioSamples(await render(dir, { preview: true }));
  const first = s.findIndex((x) => Math.abs(x) > 1000);
  assert.ok(Math.abs(first / 48000 - 0.52) < 0.01, `first sound at ${first / 48000}s`);
});

test('a page without seek fails fast with a clear message', async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, 'index.html'), '<script>window.ready = Promise.resolve(); window.STAGE = {width: 64, height: 64};</script>');
  await assert.rejects(render(dir, { preview: true }), /window\.seek/);
});

test('a page error fails the render', async () => {
  await assert.rejects(render(fixture({ seek: 'if (t > 0.5) throw new Error("boom at " + t);' }), { preview: true }), /boom/);
});

test('new_project.sh scaffolds and refuses to overwrite', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'np-'));
  const song = path.join(root, 'My Song (live).wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const proj = path.join(root, 'my proj');
  const script = path.join(SKILL, 'scripts', 'new_project.sh');
  execFileSync(script, [proj, song, '--bars', '4'], { stdio: 'pipe' });
  for (const f of ['index.html', 'springs.js', 'song.json', 'clip.wav', 'sfx/click.wav', 'sfx/key.wav']) assert.ok(existsSync(path.join(proj, f)), f);
  assert.match(readFileSync(path.join(proj, 'springs.js'), 'utf8'), /globalThis\.Springs|root\.Springs/);
  const again = spawnSync(script, [proj, song], { encoding: 'utf8' });
  assert.equal(again.status, 1); assert.match(again.stderr, /not overwriting/);
});

test('the template renders a preview without errors', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tpl-'));
  const song = path.join(root, 's.wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const proj = path.join(root, 'p');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [proj, song, '--bars', '2'], { stdio: 'pipe' });
  const out = await render(proj, { preview: true, workers: 4 });
  const song_ = JSON.parse(readFileSync(path.join(proj, 'song.json'), 'utf8'));
  assert.equal(Number(probe(out).streams.find((s) => s.codec_type === 'video').nb_read_frames), song_.loop.frames);
});

test('new_project.sh --size vertical --theme makes a 1080x1920 themed project', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sz-'));
  const song = path.join(root, 's.wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const css = path.join(root, 'app style.css');
  writeFileSync(css, ':root{--bg:#eef0f3;--panel:#fff;--ink:#161a21;--muted:#697082;--accent:#0c7d74}');
  const proj = path.join(root, 'v');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [proj, song, '--size', 'vertical', '--theme', css, '--bars', '2'], { stdio: 'pipe' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(proj, 'project.json'), 'utf8')).stage, { width: 1080, height: 1920 });
  assert.match(readFileSync(path.join(proj, 'theme.css'), 'utf8'), /--accent:#0c7d74/);
  const v = probe(await render(proj, { preview: true })).streams.find((s) => s.codec_type === 'video');
  assert.equal(v.width, 540); assert.equal(v.height, 960);
});

test('new_project.sh rejects a bad size', () => {
  const r = spawnSync(path.join(SKILL, 'scripts', 'new_project.sh'), [path.join(tmpdir(), 'x'), 'song.wav', '--size', '1081x1920'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /--size/);
});

test('SFX at a fractional beat land at cue_t(floor) + frac * beat_sec', async () => {
  const beats = [0, 1, 2, 3].map((i) => ({ i, t: i * 0.25, cue_t: i * 0.25 + (i === 1 ? 0.02 : 0) }));
  const dir = fixture({ sfx: [{ beat: 1.5, file: 'sfx/click.wav', gain: 1 }], beats });
  const s = audioSamples(await render(dir, { preview: true }));
  const first = s.findIndex((x) => Math.abs(x) > 1000);
  assert.ok(Math.abs(first / 48000 - 0.395) < 0.01, `first sound at ${first / 48000}s`);
});

// Scaffold a real project from the template (2 bars at 120 bpm).
function scaffold() {
  const root = mkdtempSync(path.join(tmpdir(), 'tp-'));
  const song = path.join(root, 's.wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const proj = path.join(root, 'p');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [proj, song, '--bars', '4'], { stdio: 'pipe' });
  return proj;
}

test('template camera zoom keeps the shape centred on the stage', async () => {
  const proj = scaffold();
  const p = await openProject(proj, { workers: 1 });
  try {
    const page = p.pages[0];
    const t = p.song.beat_sec * 1.9; // button state, camera settled well above 1
    const r = await page.evaluate((t) => {
      window.seek(t);
      const b = document.querySelector('#shape').getBoundingClientRect();
      return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, W: window.STAGE.width, H: window.STAGE.height };
    }, t);
    assert.ok(r.w > 380 * 1.2, `shape not zoomed (${r.w}px wide)`);
    assert.ok(Math.abs(r.cx - r.W / 2) < 2 && Math.abs(r.cy - r.H / 2) < 2, `centre ${r.cx},${r.cy}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('template seek is pure: a frame inside an exit fade ignores prior seeks', async () => {
  const proj = scaffold();
  const p = await openProject(proj, { workers: 1 });
  try {
    const page = p.pages[0];
    const b = p.song.beat_sec;
    const t = 4 * b + 0.02 * b; // loader layer is fading out, still visible
    await shoot(page, 3 * b);
    const a = await shoot(page, t);
    await shoot(page, 2.5 * b);
    const c = await shoot(page, t);
    assert.ok(a.equals(c), 'pixels differ depending on the previous seek');
  } finally { await p.close(); }
});

test('template CURSOR supports press down/up and sound rows; EXTRA_SFX merges into SFX', async () => {
  const proj = scaffold();
  const html = readFileSync(path.join(proj, 'index.html'), 'utf8')
    .replace("{ at: 3,       x: 200, y: 230 },", "{ at: 3, x: 200, y: 230, press: 'down' },\n  { at: 3.5, x: 200, y: 230, press: 'up', sound: 'key' },")
    .replace('const extraSfx = () => [];', "const extraSfx = () => [{ beat: 5, file: 'sfx/key.wav', gain: 0.5 }];");
  writeFileSync(path.join(proj, 'index.html'), html);
  const p = await openProject(proj, { workers: 1 });
  try {
    const page = p.pages[0];
    const sfx = await page.evaluate(() => window.SFX);
    const key = (b) => sfx.find((s) => s.beat === b);
    assert.equal(key(2).file, 'sfx/click.wav');
    assert.equal(key(3).file, 'sfx/click.wav');       // 'down' clicks
    assert.equal(sfx.find((s) => s.beat === 3.5).file, 'sfx/key.wav');
    assert.equal(key(5).gain, 0.5);
    const b = p.song.beat_sec;
    const scale = async (t) => { await page.evaluate((t) => window.seek(t), t);
      return page.evaluate(() => document.querySelector('#cursor').style.transform); };
    // Effective press scale = cursor scale(p/z) * camera zoom z. Held between 'down' (3) and 'up' (3.5).
    const pressAt = async (t) => page.evaluate((t) => {
      window.seek(t);
      const sc = (id) => Number(/scale\(([^)]+)\)/.exec(document.querySelector(id).style.transform)[1]);
      return sc('#cursor') * sc('#camera');
    }, t);
    const held = await pressAt(3.3 * b), released = await pressAt(3.8 * b);
    assert.ok(Math.abs(held - 0.82) < 0.01, `held press ${held}`);
    assert.ok(Math.abs(released - 1) < 0.01, `released press ${released}`);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a misspelt colour role fails the render with the role list, not a silent NaN colour', async () => {
  const proj = scaffold();
  const f = path.join(proj, 'index.html');
  writeFileSync(f, readFileSync(f, 'utf8').replace("fill: 'ink'", "fill: 'acent'"));
  await assert.rejects(render(proj, { preview: true, workers: 1 }), /unknown colour "acent" \(theme roles: .*accent/);
});

test('a project with no theme.json falls back to the house roles', async () => {
  const proj = scaffold();
  rmSync(path.join(proj, 'theme.json'));
  const f = path.join(proj, 'index.html');
  writeFileSync(f, readFileSync(f, 'utf8').replace("fill: 'ink'", "fill: 'accent'"));
  const p = await openProject(proj, { workers: 1 });
  try {
    const bg = await p.pages[0].evaluate((t) => { window.seek(t); return getComputedStyle(document.querySelector('#shape')).backgroundColor; }, p.song.beat_sec * 2.5);
    assert.match(bg, /^rgb\(\d+, \d+, \d+\)$/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

const RENDER = path.join(SKILL, 'scripts', 'render.mjs');

test('the CLI exits promptly after a preview render (no dangling ready timeout)', () => {
  const dir = fixture();
  const t0 = Date.now();
  const r = spawnSync('node', [RENDER, dir, '--preview', '--workers', '1'], { encoding: 'utf8', timeout: 25000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
});

test('render.mjs rejects bad flags with a clear error and exit 2', () => {
  const dir = fixture();
  const bad = [[['--workers', '0'], /--workers/], [['--sub', '1.5'], /--sub/], [['--workers'], /--workers/],
    [['--from', 'abc'], /--from/], [['--from', '0.5', '--to', '0.2'], /--from.*--to/], [['--to', '99'], /--to/],
    [['--from', '-1'], /--from/], [['--bogus'], /unknown flag --bogus/]];
  for (const [args, re] of bad) {
    const r = spawnSync('node', [RENDER, dir, '--preview', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${args}: status ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /^error: /m); assert.match(r.stderr, re); assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
});

test('a failed render leaves a previous good video untouched and no .part behind', async () => {
  const dir = fixture({ seek: 'if (t > 0.98) { const e = Date.now() + 1500; while (Date.now() < e); throw new Error("boom"); }' });
  const out = path.join(dir, 'prev.mp4');
  writeFileSync(out, 'previous good video');
  await assert.rejects(render(dir, { preview: true, out, workers: 1 }), /boom/);
  assert.equal(readFileSync(out, 'utf8'), 'previous good video');
  assert.ok(!existsSync(out.replace(/\.mp4$/, '.part.mp4')), '.part.mp4 left behind');
});

test('a successful render replaces the previous video and leaves no .part', async () => {
  const dir = fixture();
  const out = path.join(dir, 'prev.mp4');
  writeFileSync(out, 'old');
  assert.equal(await render(dir, { preview: true, out }), out);
  assert.equal(probe(out).streams.find((s) => s.codec_type === 'video').nb_read_frames, '60');
  assert.ok(!existsSync(path.join(dir, 'prev.part.mp4')));
});

test('a missing SFX file is a clear error, not an unhandled rejection', async () => {
  const dir = fixture({ sfx: [{ beat: 1, file: 'sfx/nope.wav' }] });
  await assert.rejects(render(dir, { preview: true }), /SFX file not found: sfx\/nope\.wav/);
});

test('the CLI entry guard works from a path with spaces', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sp-'));
  const home = path.join(root, 'a b');
  mkdirSync(home);
  cpSync(path.join(SKILL, 'scripts'), path.join(home, 'scripts'), { recursive: true });
  symlinkSync(path.join(SKILL, 'node_modules'), path.join(home, 'node_modules'));
  for (const f of ['render.mjs', 'beat_stills.mjs']) {
    const r = spawnSync('node', [path.join(home, 'scripts', f)], { encoding: 'utf8' });   // no DIR => usage
    assert.equal(r.status, 2, `${f}: ${r.status} ${r.stderr}`); assert.match(r.stderr, /usage/);
  }
});

test('new_project.sh flags with no value are a clear error, not an unbound-variable crash', () => {
  const script = path.join(SKILL, 'scripts', 'new_project.sh');
  for (const flag of ['--size', '--theme', '--map']) {
    const r = spawnSync(script, [path.join(tmpdir(), 'never-made'), 'song.wav', flag], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${flag}: ${r.status} ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`error: ${flag} needs a value`));
  }
});

test('project.json "loop": false lets a piece end on a different state; "designScale" scales the camera', async () => {
  const { makeProject, openScene } = await import('./harness.mjs');
  const setProject = (dir, extra) => {
    const f = path.join(dir, 'project.json');
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), ...extra }));
  };
  const zoomAt = async (dir) => {
    const s = await openScene(dir);
    try {
      await s.seek(0.2);
      return { errors: s.errors, zoom: await s.page.evaluate(() => Number(document.querySelector('#camera').style.transform.match(/scale\(([\d.]+)\)/)[1])) };
    } finally { await s.close(); }
  };
  const oneOff = { bars: 2, states: "[{ at: 0, use: 'button', label: 'Go' }, { at: 4, use: 'check', label: 'Done' }]",
    cursor: '[{ at: 0, x: 240, y: 280 }, { at: 4, x: 0, y: 300 }]' };
  await assert.rejects(openScene(makeProject(oneOff)), /the last row must repeat the first/, 'a loop still insists on the seam');
  const launch = makeProject(oneOff);
  setProject(launch, { loop: false });
  const plain = await zoomAt(launch);
  assert.deepEqual(plain.errors, []);
  setProject(launch, { loop: false, designScale: 1.5 });
  const scaled = await zoomAt(launch);
  assert.deepEqual(scaled.errors, []);
  assert.ok(Math.abs(scaled.zoom - 1.5 * plain.zoom) < 1e-6, `designScale 1.5 zooms 1.5x (${plain.zoom} -> ${scaled.zoom})`);
});

test('"loop": false clamps subframe times to the piece, so frame 0 carries no ghost of the end card', async () => {
  // Black until the last tenth of the second, then white (an end card). Frame 0's early subframes sit at
  // negative t: a loop wraps them to the end (a white ghost), a one-off clamps them to 0 (pure black).
  const seek = 'document.body.style.background = t > 0.9 ? "#fff" : "#000";';
  const make = (loop) => { const d = fixture({ seek }); if (!loop) writeFileSync(path.join(d, 'project.json'), JSON.stringify({ loop: false })); return d; };
  const oneOff = make(false);
  const single = grayFrame(await render(oneOff, { sub: 1, workers: 2, out: path.join(oneOff, 'out', 'single.mp4') }), 0);
  const blended = grayFrame(await render(oneOff, { workers: 2 }), 0);
  assert.ok(Math.abs(blended - single) < 2, `one-off frame 0: blended ${blended} vs single-subframe ${single}`);
  const looped = grayFrame(await render(make(true), { workers: 2 }), 0);
  assert.ok(looped > single + 20, `a loop still blends across the seam (${looped} vs ${single})`);
  const section = grayFrame(await render(oneOff, { workers: 2, from: 0, to: 0.5, out: path.join(oneOff, 'out', 'part.mp4') }), 0);
  assert.ok(Math.abs(section - single) < 2, `--from 0 section frame 0 is clamped too (${section})`);
});
