import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render } from '../scripts/render.mjs';
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
