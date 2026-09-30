// export.mjs: stage override, shape grouping, per-preset encodes, loudness, --silent, warnings, manifest.
// Tiny test presets (MOTION_PRESETS) and small stages keep the renders and encodes quick.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeProject } from './harness.mjs';
import { fixture, probe } from './fixtures.mjs';
import { FFMPEG, render, serve } from '../scripts/render.mjs';
import { exportProject } from '../scripts/export.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const TMP = mkdtempSync(path.join(tmpdir(), 'mk-export-'));
const zero = { top: 0, bottom: 0, left: 0, right: 0 };
const preset = (o) => ({ label: o.name, group: 'test', fps: 30, maxSeconds: null, maxMB: null, video: { codec: 'h264', crf: 26, profile: 'high' },
  audio: { codec: 'aac', kbps: 96, lufs: -14, truePeak: -1 }, safe: zero, public: true, source: 'https://example.com/spec', checked: '2026-09-30',
  estimated: ['lufs', 'truePeak'], notes: 'test preset', ...o });
const PRESETS = path.join(TMP, 'presets.json');
writeFileSync(PRESETS, JSON.stringify({
  shapes: { square: [256, 256], vertical: [216, 384], landscape: [384, 216] },
  presets: {
    reels: preset({ shape: 'vertical', size: [216, 384], video: { codec: 'h264', crf: 26, maxrate: '2M', profile: 'high' } }),
    tiktok: preset({ shape: 'vertical', size: [216, 384] }),
    shorts: preset({ shape: 'vertical', size: [216, 384], fps: 60 }),
    // square is the design stage here, so it shares the design render
    x: preset({ shape: 'square' }),
    discord: preset({ shape: 'design', fps: 60, maxMB: 20, public: false }),
    web: preset({ shape: 'design', fps: 60, source: null, estimated: ['crf', 'kbps', 'lufs', 'truePeak'] }),
  },
}));
process.env.MOTION_PRESETS = PRESETS;

const streams = (f) => probe(f).streams;
const video = (f) => streams(f).find((s) => s.codec_type === 'video');
const hasAudio = (f) => streams(f).some((s) => s.codec_type === 'audio');
const duration = (f) => Number(probe(f).format.duration);
const loopSec = (dir) => JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8')).loop.duration_sec;
// Integrated loudness via ffmpeg's ebur128, independent of media.mjs.
function lufs(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  return Number(s.match(/I:\s+(-?[\d.]+) LUFS/)[1]);
}

// One project (256x256 design stage, the test square, commercial music) exported once to five presets; most tests read its manifest.
let DIR, M;
before(async () => {
  DIR = makeProject({ bars: 2, size: '256x256' });
  const pj = path.join(DIR, 'project.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), music: 'commercial' }));
  M = await exportProject(DIR, { for: ['reels', 'tiktok', 'shorts', 'x', 'discord', 'web'], log: () => {} });
});
const file = (name) => M.files.find((f) => f.preset === name);
const abs = (f) => path.join(DIR, f.path);

test('stage override does not touch project.json or out/video.mp4', async () => {
  const dir = makeProject({ bars: 2, size: '128x128' });
  const before = readFileSync(path.join(dir, 'project.json'));
  const out = await render(dir, { stage: [216, 384], out: path.join(dir, 'out', 'shapes', 'vertical', 'video.mp4'), sub: 1 });
  assert.equal(out, path.join(dir, 'out', 'shapes', 'vertical', 'video.mp4'));
  const v = video(out);
  assert.deepEqual([v.width, v.height], [216, 384]);
  assert.deepEqual(readFileSync(path.join(dir, 'project.json')), before);
  assert.ok(!existsSync(path.join(dir, 'out', 'video.mp4')), 'default render untouched');
  // The served project.json keeps the file's other keys and swaps the stage.
  const { server, url } = await serve(dir, 0, { stage: [216, 384] });
  try {
    const j = await (await fetch(`${url}project.json`)).json();
    assert.deepEqual(j.stage, { width: 216, height: 384 });
  } finally { server.close(); }
});

test('a stage override on a page that ignores project.json fails instead of rendering the wrong size', async () => {
  await assert.rejects(render(fixture(), { stage: [216, 384], preview: true }), /asked for stage 216x384 but the page set 64x64/);
});

test('render --stage must be even integers >= 64', () => {
  for (const bad of ['215x384', '32x64', 'wide', '216x']) {
    const r = spawnSync('node', [path.join(SKILL, 'scripts', 'render.mjs'), DIR, '--stage', bad], { encoding: 'utf8' });
    assert.equal(r.status, 2, bad);
    assert.match(r.stderr, /^error: --stage must be WxH with even integers >= 64/, bad);
  }
});

test('presets sharing a shape share one render', () => {
  assert.deepEqual(M.renders.map((r) => r.shape).sort(), ['design', 'vertical']);
  const v = M.renders.find((r) => r.shape === 'vertical');
  assert.equal(v.path, path.join('out', 'shapes', 'vertical', 'video.mp4'));
  assert.equal(M.renders.find((r) => r.shape === 'design').path, path.join('out', 'video.mp4'));
  assert.deepEqual([video(path.join(DIR, v.path)).width, video(path.join(DIR, v.path)).height], [216, 384]);
  assert.equal(JSON.parse(readFileSync(path.join(DIR, 'project.json'), 'utf8')).stage.width, 256, 'project.json untouched');
});

test('each export has the preset size, fps, codecs and duration', () => {
  const D = loopSec(DIR);
  const want = { reels: [216, 384, 30], tiktok: [216, 384, 30], shorts: [216, 384, 60], x: [256, 256, 30], discord: [256, 256, 60], web: [256, 256, 60] };
  for (const [name, [w, h, fps]] of Object.entries(want)) {
    const f = abs(file(name));
    assert.equal(f, path.join(DIR, 'out', 'exports', `${name}.mp4`));
    const p = probe(f), v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
    assert.deepEqual([v.width, v.height, v.r_frame_rate], [w, h, `${fps}/1`], name);
    assert.equal(Number(v.nb_read_frames), Math.round(D * fps), `${name} frames`);
    assert.ok(a, `${name} has audio`);
    assert.ok(Math.abs(Number(p.format.duration) - D) <= 0.05, `${name} duration ${p.format.duration} vs loop ${D}`);
  }
  const codecs = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_name,profile', '-of', 'csv=p=0',
    abs(file('reels'))], { encoding: 'utf8' });
  assert.match(codecs, /h264,High/); assert.match(codecs, /aac,LC/);
});

test('loudness lands within 1 LU of target; near-silent input is left alone and noted', async () => {
  const dir = makeProject({ bars: 2, size: '128x128' });
  const D = loopSec(dir);
  // Stand-in design renders (a fresh out/video.mp4 is reused): a steady tone well above and well below
  // the -14 LUFS target, and digital silence.
  const cases = { loud: 'sine=frequency=440:sample_rate=48000,volume=-3dB', quiet: 'sine=frequency=440:sample_rate=48000,volume=-24dB',
    silent: 'anullsrc=r=48000:cl=stereo' };
  for (const [name, src] of Object.entries(cases)) {
    mkdirSync(path.join(dir, 'out'), { recursive: true });
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=128x128:r=60:d=${D}`, '-f', 'lavfi', '-i', src, '-t', String(D),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', path.join(dir, 'out', 'video.mp4')]);
    const before = lufs(path.join(dir, 'out', 'video.mp4'));
    const m = await exportProject(dir, { for: ['discord'], log: () => {} });
    assert.equal(m.renders[0].reused, true, 'fresh design render reused');
    const f = m.files[0], I = lufs(path.join(dir, f.path));
    if (name === 'silent') {
      assert.ok(f.notes.includes('loudness skipped (near-silent input)'), JSON.stringify(f.notes));
      assert.ok(I < -50, `silent stays silent (${I})`);
    } else {
      assert.ok(Math.abs(before - -14) > 5, `${name} input starts far from target (${before})`);
      assert.ok(Math.abs(I - -14) <= 1, `${name}: ${I} LUFS, target -14`);
      assert.ok(Math.abs(f.lufs - I) <= 0.2, `manifest LUFS ${f.lufs} matches ${I}`);
      assert.ok(f.truePeak <= -1 + 0.5, `${name} true peak ${f.truePeak}`);
    }
  }
});

test('--silent exports have no audio stream', async () => {
  const outDir = path.join(TMP, 'silent');
  const m = await exportProject(DIR, { for: ['reels', 'discord'], silent: true, outDir, log: () => {} });
  assert.ok(m.renders.every((r) => r.reused), 'renders reused');
  for (const f of m.files) {
    const p = path.resolve(DIR, f.path);
    assert.ok(p.startsWith(outDir), p);
    assert.ok(!hasAudio(p), `${f.preset} has no audio`);
    assert.equal(f.acodec, null); assert.equal(f.lufs, null);
    assert.deepEqual(f.warnings, [], 'no commercial-music warning without audio');
  }
  assert.ok(existsSync(path.join(outDir, 'manifest.json')));
});

test('manifest lists every file with bytes, duration, size, fps, LUFS, warnings and preset source', () => {
  const onDisk = JSON.parse(readFileSync(path.join(DIR, 'out', 'exports', 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, M);
  assert.equal(M.project, path.basename(DIR));
  assert.ok(!Number.isNaN(Date.parse(M.created)));
  assert.deepEqual(M.files.map((f) => f.preset), ['reels', 'tiktok', 'shorts', 'x', 'discord', 'web']);
  for (const f of M.files) {
    assert.equal(f.bytes, statSync(abs(f)).size, f.preset);
    assert.ok(Math.abs(f.duration - duration(abs(f))) < 1e-3, f.preset);
    assert.equal(f.vcodec, 'h264'); assert.equal(f.acodec, 'aac');
    assert.ok(Number.isFinite(f.lufs) && Number.isFinite(f.truePeak), f.preset);
    assert.ok(Array.isArray(f.notes) && Array.isArray(f.warnings), f.preset);
    assert.equal(f.checked, '2026-09-30');
  }
  assert.deepEqual([file('reels').width, file('reels').height, file('reels').fps], [216, 384, 30]);
  assert.equal(file('reels').source, 'https://example.com/spec');
  assert.deepEqual(file('reels').estimated, ['lufs', 'truePeak']);
  assert.equal(file('web').source, null);
  assert.deepEqual(file('web').estimated, ['crf', 'kbps', 'lufs', 'truePeak']);
});

test('commercial music on a public preset warns', () => {
  for (const n of ['reels', 'tiktok', 'shorts', 'x', 'web']) assert.ok(file(n).warnings.some((w) => /commercial music.*--silent/.test(w)), n);
  assert.deepEqual(file('discord').warnings, [], 'discord is not public');
});

test('CLI: unknown preset -> error: ... exit 2; works through a symlinked skill dir', () => {
  const link = path.join(mkdtempSync(path.join(tmpdir(), 'mk-symlink-')), 'motion-video');
  symlinkSync(SKILL, link);
  const cli = (...args) => spawnSync('node', [path.join(link, 'scripts', 'export.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, MOTION_PRESETS: PRESETS } });
  let r = cli(DIR, '--for', 'reels,reelz');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^error: unknown preset "reelz" \(did you mean "reels"\?\)/);
  r = cli(DIR);
  assert.equal(r.status, 2); assert.match(r.stderr, /--for/);
  r = cli(path.join(TMP, 'nope'), '--for', 'web');
  assert.equal(r.status, 2); assert.match(r.stderr, /^error: .*song\.json/);
  r = cli(DIR, '--for', 'discord', '--silent');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /discord\s+256x256 60fps .* no audio/);
});
