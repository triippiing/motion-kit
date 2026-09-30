// export.mjs: stage override, shape grouping, per-preset encodes, loudness, --silent, warnings, manifest,
// size caps (two-pass, step-down, errors), web outputs (mp4, webm, poster) and GIF.
// Tiny test presets (MOTION_PRESETS) and small stages keep the renders and encodes quick.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeProject } from './harness.mjs';
import { fixture, probe } from './fixtures.mjs';
import { beatTime, FFMPEG, render, renderStamp, serve, stampPath } from '../scripts/render.mjs';
import { commercialMusic, exportProject, reusableRender } from '../scripts/export.mjs';
import { AAC_LADDER, aacLadder, aacWithinPeak, capBytes, capSizes, fitToCap, loudnessMiss, targetBytes } from '../scripts/media.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const TMP = mkdtempSync(path.join(tmpdir(), 'mk-export-'));
const zero = { top: 0, bottom: 0, left: 0, right: 0 };
const preset = (o) => ({ label: o.name, group: 'test', fps: 30, maxSeconds: null, maxMB: null, video: { codec: 'h264', crf: 26, profile: 'high' },
  audio: { codec: 'aac', kbps: 96, lufs: -14, truePeak: -1 }, safe: zero, public: true, source: 'https://example.com/spec', checked: '2026-09-30',
  estimated: ['lufs', 'truePeak'], notes: 'test preset', ...o });
const PRESETS = path.join(TMP, 'presets.json');
const SHAPES = { square: [256, 256], vertical: [216, 384], landscape: [384, 216] };
writeFileSync(PRESETS, JSON.stringify({
  shapes: SHAPES,
  presets: {
    reels: preset({ shape: 'vertical', size: [216, 384], video: { codec: 'h264', crf: 26, maxrate: '2M', profile: 'high' } }),
    tiktok: preset({ shape: 'vertical', size: [216, 384] }),
    shorts: preset({ shape: 'vertical', size: [216, 384], fps: 60 }),
    // square is the design stage here, so it shares the design render
    x: preset({ shape: 'square' }),
    discord: preset({ shape: 'design', fps: 60, maxMB: 20, public: false }),
    // a true-peak ceiling (loudnorm's lowest, -9) far below what -5 LUFS needs: loudnorm cannot meet both, so the export must warn
    tight: preset({ shape: 'design', fps: 60, public: false, audio: { codec: 'aac', kbps: 96, lufs: -5, truePeak: -9 } }),
    web: preset({ shape: 'design', fps: 60, source: null, estimated: ['crf', 'kbps', 'lufs', 'truePeak'], outputs: ['mp4', 'webm', 'poster'] }),
    brief: preset({ shape: 'design', maxSeconds: 2, public: false }),
  },
}));
process.env.MOTION_PRESETS = PRESETS;

// Run fn with a different presets file (loadPresets reads $MOTION_PRESETS on every export).
let presetFiles = 0;
async function withPresets(presets, fn) {
  const f = path.join(TMP, `presets-${presetFiles++}.json`), old = process.env.MOTION_PRESETS;
  writeFileSync(f, JSON.stringify({ shapes: SHAPES, presets }));
  process.env.MOTION_PRESETS = f;
  try { return await fn(f); } finally { process.env.MOTION_PRESETS = old; }
}
const exportCli = (args, presetsFile) => spawnSync('node', [path.join(SKILL, 'scripts', 'export.mjs'), ...args], { encoding: 'utf8',
  env: { ...process.env, MOTION_PRESETS: presetsFile } });

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

// A stand-in render (made with ffmpeg, not render.mjs) gets the stamp a full export-quality render would have.
async function standInStamp(dir, file, stage) {
  const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  writeFileSync(stampPath(file), JSON.stringify(await renderStamp(dir, { stage, sub: 4, preview: false, song })));
}
function standIn(dir, file, seconds, { size = '128x128', noise = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  // noise makes every frame expensive, so a size cap really binds and two-pass has to spend its whole budget
  const src = `testsrc2=s=${size}:r=60:d=${seconds}${noise ? ',noise=alls=24:allf=t' : ''}`;
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
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
  // The render is stamped with how it was made; a 1-subframe render is not good enough for export.
  const stamp = JSON.parse(readFileSync(stampPath(out), 'utf8'));
  assert.deepEqual({ ...stamp, renderer: 'x' }, { stage: [216, 384], sub: 1, from: null, to: null, preview: false,
    loop: { duration_sec: loopSec(dir), frames: JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8')).loop.frames }, renderer: 'x' });
  assert.equal(await reusableRender(dir, out, [216, 384]), false, '--sub 1 render not reused');
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

test('presets sharing a render size share one render, never written to out/video.mp4', () => {
  assert.deepEqual(M.renders, [
    { size: '216x384', shapes: ['vertical'], path: path.join('out', 'shapes', '216x384', 'video.mp4'), reused: false },
    { size: '256x256', shapes: ['square', 'design'], path: path.join('out', 'shapes', '256x256', 'video.mp4'), reused: false },
  ]);
  const v = path.join(DIR, M.renders[0].path);
  assert.deepEqual([video(v).width, video(v).height], [216, 384]);
  assert.ok(!existsSync(path.join(DIR, 'out', 'video.mp4')), 'export never writes out/video.mp4');
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
    await standInStamp(dir, path.join(dir, 'out', 'video.mp4'), [128, 128]);
    const before = lufs(path.join(dir, 'out', 'video.mp4'));
    const m = await exportProject(dir, { for: ['discord', 'tight'], log: () => {} });
    assert.deepEqual([m.renders[0].reused, m.renders[0].path], [true, path.join('out', 'video.mp4')], 'stamped design render reused');
    const f = m.files[0], I = lufs(path.join(dir, f.path));
    if (name === 'silent') {
      assert.ok(f.notes.includes('loudness skipped (near-silent input)'), JSON.stringify(f.notes));
      assert.ok(I < -50, `silent stays silent (${I})`);
    } else {
      assert.ok(Math.abs(before - -14) > 5, `${name} input starts far from target (${before})`);
      assert.ok(Math.abs(I - -14) <= 1, `${name}: ${I} LUFS, target -14`);
      assert.ok(Math.abs(f.lufs - I) <= 0.2, `manifest LUFS ${f.lufs} matches ${I}`);
      assert.ok(f.truePeak <= -1 + 0.5, `${name} true peak ${f.truePeak}`);
      assert.deepEqual(f.warnings, [], `${name} met its target`);
      const t = m.files[1];
      assert.ok(t.warnings.some((w) => /^loudness missed its target: integrated -?[\d.]+ LUFS vs target -5/.test(w)), JSON.stringify(t.warnings));
    }
  }
});

test('a render is reused only with a matching stamp, the whole loop and nothing newer in the project', async () => {
  const dir = makeProject({ bars: 2, size: '128x128' });
  const D = loopSec(dir), song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  const f = path.join(dir, 'out', 'video.mp4');
  standIn(dir, f, D);
  assert.equal(await reusableRender(dir, f, [128, 128]), false, 'no stamp');
  const stamp = await renderStamp(dir, { stage: [128, 128], sub: 4, preview: false, song });
  const cases = { section: { from: 0, to: 1 }, sub1: { sub: 1 }, preview: { preview: true, sub: 1 }, size: { stage: [256, 256] },
    renderer: { renderer: 'an older render.mjs' }, loop: { loop: { ...stamp.loop, frames: stamp.loop.frames + 1 } } };
  for (const [name, change] of Object.entries(cases)) {
    writeFileSync(stampPath(f), JSON.stringify({ ...stamp, ...change }));
    assert.equal(await reusableRender(dir, f, [128, 128]), false, name);
  }
  writeFileSync(stampPath(f), JSON.stringify(stamp));
  assert.equal(await reusableRender(dir, f, [128, 128]), true, 'matching stamp');
  standIn(dir, f, D / 2);   // a section rendered with a forged full-loop stamp still fails on duration
  writeFileSync(stampPath(f), JSON.stringify(stamp));
  assert.equal(await reusableRender(dir, f, [128, 128]), false, 'half-length video');
  standIn(dir, f, D);
  writeFileSync(stampPath(f), JSON.stringify(stamp));
  const later = new Date(Date.now() + 5000);
  utimesSync(path.join(dir, 'index.html'), later, later);
  assert.equal(await reusableRender(dir, f, [128, 128]), false, 'project edited after the render');
  // Export then renders its own copy and leaves the user's out/video.mp4 alone.
  const bytes = readFileSync(f);
  const m = await exportProject(dir, { for: ['discord'], log: () => {} });
  assert.deepEqual(m.renders, [{ size: '128x128', shapes: ['design'], path: path.join('out', 'shapes', '128x128', 'video.mp4'), reused: false }]);
  assert.deepEqual(readFileSync(f), bytes, 'out/video.mp4 untouched');
  assert.equal(await reusableRender(dir, path.join(dir, m.renders[0].path), [128, 128]), true, "export's own render is reusable next time");
});

test('a missed loudness target is a warning naming measured vs target', () => {
  assert.equal(loudnessMiss({ I: -14.6, TP: -1.2 }, { lufs: -14, truePeak: -1 }), null);
  assert.equal(loudnessMiss({ I: -14.2, TP: -0.6 }, { lufs: -14, truePeak: -1 }), null, 'within 0.5 dB of the ceiling');
  assert.equal(loudnessMiss({ I: -16.4, TP: -1 }, { lufs: -14, truePeak: -1 }), 'loudness missed its target: integrated -16.4 LUFS vs target -14');
  assert.equal(loudnessMiss({ I: -14, TP: 0.3 }, { lufs: -14, truePeak: -1 }), 'loudness missed its target: true peak 0.3 dBTP vs ceiling -1');
});

test('AAC true peak: a miss steps down the coder ladder (aac, aac fast coder, aac_at when listed), audio only', async () => {
  // Stubs: each encode records the coder; measure returns a scripted true peak per try. Real fixtures do not overshoot.
  const ladder = async (peaks, opts = {}) => {
    const tried = [];
    const r = await aacWithinPeak('in.mp4', 'out.m4a', { af: ['-af', 'x'], kbps: 192, truePeak: -1, coders: AAC_LADDER,
      encodeAudio: async (input, output, o) => { tried.push(o.args.join(' ')); assert.deepEqual([input, output, o.kbps, o.af], ['in.mp4', 'out.m4a', 192, ['-af', 'x']]); },
      measure: async () => ({ I: -14, TP: peaks[tried.length - 1] }), ...opts });
    return { ...r, tried };
  };
  assert.deepEqual(await ladder([-1.5]), { coder: 'aac', TP: -1.5, missed: false, tried: ['-c:a aac'] });
  assert.deepEqual(await ladder([-0.5]), { coder: 'aac', TP: -0.5, missed: false, tried: ['-c:a aac'] }, 'within 0.5 dB is a hit');
  assert.deepEqual(await ladder([1.2, -1.4]), { coder: 'aac -aac_coder fast', TP: -1.4, missed: false, tried: ['-c:a aac', '-c:a aac -aac_coder fast'] });
  assert.deepEqual(await ladder([1.2, 0.3, -2.1]), { coder: 'aac_at', TP: -2.1, missed: false,
    tried: ['-c:a aac', '-c:a aac -aac_coder fast', '-c:a aac_at'] });
  assert.deepEqual(await ladder([1.2, 0.3, 0.1]), { coder: 'aac_at', TP: 0.1, missed: true,
    tried: ['-c:a aac', '-c:a aac -aac_coder fast', '-c:a aac_at'] }, 'every coder missed: the last try stands, and export warns');
  assert.deepEqual(await ladder([1.2], { truePeak: null }), { coder: 'aac', TP: 1.2, missed: false, tried: ['-c:a aac'] }, 'no target: one try');
  // aac_at is on the ladder only when ffmpeg lists it (macOS builds).
  const listing = ' A....D aac                  AAC (Advanced Audio Coding)\n A..... aac_at               aac (AudioToolbox) (codec aac)\n';
  assert.deepEqual(aacLadder(listing).map((c) => c.coder), ['aac', 'aac -aac_coder fast', 'aac_at']);
  assert.deepEqual(aacLadder(listing.split('\n')[0]).map((c) => c.coder), ['aac', 'aac -aac_coder fast']);
  const two = await ladder([1.2, 0.9], { coders: aacLadder('') });
  assert.deepEqual([two.coder, two.missed, two.tried.length], ['aac -aac_coder fast', true, 2]);
});

test('--silent exports have no audio stream', async () => {
  const outDir = path.join(TMP, 'silent');
  const m = await exportProject(DIR, { for: ['reels', 'discord'], silent: true, outDir, log: () => {} });
  assert.ok(m.renders.every((r) => r.reused), 'renders reused');
  for (const f of m.files) {
    const p = f.path;
    assert.ok(path.isAbsolute(p) && p.startsWith(outDir), `outside the project, paths are absolute: ${p}`);
    assert.ok(!hasAudio(p), `${f.preset} has no audio`);
    assert.equal(f.acodec, null); assert.equal(f.lufs, null); assert.equal(f.audioCoder, null);
    assert.deepEqual(f.warnings, [], 'no commercial-music warning without audio');
  }
  assert.ok(existsSync(path.join(outDir, 'manifest.json')));
});

test('manifest lists every file with bytes, duration, size, fps, LUFS, warnings and preset source', () => {
  const onDisk = JSON.parse(readFileSync(path.join(DIR, 'out', 'exports', 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, M);
  assert.equal(M.project, path.basename(DIR));
  assert.ok(!Number.isNaN(Date.parse(M.created)));
  assert.deepEqual(M.files.map((f) => [f.preset, f.format]), [['reels', 'mp4'], ['tiktok', 'mp4'], ['shorts', 'mp4'], ['x', 'mp4'],
    ['discord', 'mp4'], ['web', 'mp4'], ['web', 'webm'], ['web', 'jpg']]);
  for (const f of M.files) {
    assert.equal(f.bytes, statSync(abs(f)).size, f.preset);
    assert.equal(f.stepDown, null, `${f.preset} fits without a step-down`);
    if (f.format !== 'mp4') continue;
    assert.ok(Math.abs(f.duration - duration(abs(f))) < 1e-3, f.preset);
    assert.equal(f.vcodec, 'h264'); assert.equal(f.acodec, 'aac');
    assert.ok(['aac', 'aac -aac_coder fast', 'aac_at'].includes(f.audioCoder), `${f.preset} audioCoder ${f.audioCoder}`);
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

test('a second export merges into the manifest: same presets replaced, others kept while their files exist', async () => {
  const outDir = path.join(TMP, 'merge'), read = () => JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  await exportProject(DIR, { for: ['x'], silent: true, outDir, log: () => {} });
  const m = await exportProject(DIR, { for: ['discord'], outDir, log: () => {} });
  assert.deepEqual(read(), m, 'the returned manifest is the one written');
  assert.deepEqual(m.files.map((f) => [f.preset, f.acodec]), [['x', null], ['discord', 'aac']]);
  assert.deepEqual(m.renders.map((r) => r.size), ['256x256'], 'renders are merged by size');
  // Exporting x again (with audio) replaces its entry; a kept entry whose file is gone is dropped.
  rmSync(path.join(outDir, 'discord.mp4'));
  const again = await exportProject(DIR, { for: ['x'], outDir, log: () => {} });
  assert.deepEqual(again.files.map((f) => [f.preset, f.acodec]), [['x', 'aac']]);
});

test('commercial music on a public preset warns', () => {
  for (const n of ['reels', 'tiktok', 'shorts', 'x', 'web']) assert.ok(file(n).warnings.some((w) => /commercial music.*--silent/.test(w)), n);
  // discord is not public, so no commercial warning; its one warning is the loudness miss. The fixture's audio is a click
  // track: about -24.5 LUFS with -2.2 dBTP peaks, a 22 dB peak-to-loudness ratio. Reaching -14 LUFS linearly would put the
  // peaks near +8 dBTP, so loudnorm falls back to dynamic mode, which cannot limit clicks that hard: it lands near -20 LUFS
  // with peaks near 0 dBTP, and AAC adds overshoot on the clicks that no coder on the ladder removes (the file keeps the
  // last coder's try, and a note says so). The same audio looped to 22 s misses the same way, so this is the signal,
  // not the fixture's length; the export reports it honestly rather than shipping a silent miss.
  assert.equal(file('discord').warnings.length, 1, JSON.stringify(file('discord').warnings));
  assert.ok(file('discord').notes.some((n) => /^audio coder \S+: every AAC coder tried overshot the -1 dBTP ceiling$/.test(n)), JSON.stringify(file('discord').notes));
  assert.match(file('discord').warnings[0], /^loudness missed its target: integrated -?[\d.]+ LUFS vs target -14; true peak -?[\d.]+ dBTP vs ceiling -1$/);
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
  assert.match(r.stdout, /^discord\s+256x256 60fps .* no audio  out\/exports\/discord\.mp4, 2 estimated values\nmanifest: /);
});

// ---- size caps, web outputs, GIF ----

const psnr = (a, b) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/average:(inf|[\d.]+)/);
  return m[1] === 'inf' ? Infinity : Number(m[1]);
};
const noStaging = (dir) => readdirSync(dir).filter((n) => n.startsWith('.'));
const passlogs = () => readdirSync(tmpdir()).filter((n) => n.startsWith('mk-2pass-'));

test('capSizes steps the preset size down to 1080/720/540 short side, never up; fitToCap picks the largest size over its floor', () => {
  assert.deepEqual(capSizes([1080, 1920]), [[1080, 1920], [720, 1280], [540, 960]]);
  assert.deepEqual(capSizes([1440, 1440]), [[1440, 1440], [1080, 1080], [720, 720], [540, 540]]);
  assert.deepEqual(capSizes([720, 720]), [[720, 720], [540, 540]]);
  assert.deepEqual(capSizes([256, 256]), [[256, 256]]);
  const sizes = capSizes([1080, 1920]), D = 30, audioKbps = 128;
  // maxMB is decimal megabytes: the budget is 97% of maxMB x 10^6 bytes over the duration, less the audio.
  const kbps = (maxMB) => Math.floor(targetBytes(maxMB) * 8 / 1000 / D - audioKbps);
  assert.equal(targetBytes(10), 9700000);
  assert.deepEqual(fitToCap({ duration: D, maxMB: 10, audioKbps, sizes }), { size: [1080, 1920], videoKbps: kbps(10) });
  assert.ok(kbps(10) >= 1500);
  assert.deepEqual(fitToCap({ duration: D, maxMB: 5, audioKbps, sizes }), { size: [720, 1280], videoKbps: kbps(5) });
  assert.ok(kbps(5) < 1500 && kbps(5) >= 800);
  assert.deepEqual(fitToCap({ duration: D, maxMB: 3, audioKbps, sizes }), { size: [540, 960], videoKbps: kbps(3) });
  const e = fitToCap({ duration: D, maxMB: 1.5, audioKbps, sizes });
  assert.deepEqual(Object.keys(e), ['error']);
  assert.match(e.error, /1\.5 MB .*30\.00 s.*540x960 needs at least 450 kbps/);
  // the retry aims lower
  assert.equal(fitToCap({ duration: D, maxMB: 10, audioKbps, sizes, headroom: 0.93 }).videoKbps, Math.floor(10e6 * 0.93 * 8 / 1000 / D - audioKbps));
});

// A 720x720 project whose (stand-in, stamped) render is noise, so the CRF encode is far over the small caps below.
let capDir;
async function capProject() {
  if (capDir) return capDir;
  capDir = makeProject({ bars: 2, size: '720x720' });
  const f = path.join(capDir, 'out', 'video.mp4');
  standIn(capDir, f, loopSec(capDir), { size: '720x720', noise: true });
  await standInStamp(capDir, f, [720, 720]);
  return capDir;
}
// maxMB that leaves `videoKbps` for video after `audioKbps` of audio over the project's loop.
const maxMBFor = (dir, videoKbps, audioKbps = 96) => Math.ceil(((videoKbps + audioKbps + 1) * 1000 * loopSec(dir) / 8 / 0.97)) / 1e6;

let capM;
async function capRun() {
  if (capM) return capM;
  const dir = await capProject();
  capM = await withPresets({
    fits: preset({ shape: 'design', public: false, maxMB: maxMBFor(dir, 1200) }),   // 1200 kbps >= the 720 floor (800)
    steps: preset({ shape: 'design', public: false, maxMB: maxMBFor(dir, 600) }),   // under 800 at 720, over 450 at 540
  }, () => exportProject(dir, { for: ['fits', 'steps'], log: () => {} }));
  return capM;
}

test('over a cap, two-pass bitrate lands just under maxMB', async () => {
  const m = await capRun(), f = m.files.find((x) => x.preset === 'fits'), cap = capBytes(maxMBFor(capDir, 1200));
  assert.ok(f.bytes <= cap && f.bytes >= 0.8 * cap, `${f.bytes} bytes vs cap ${cap}`);
  assert.equal(f.bytes, statSync(path.join(capDir, f.path)).size);
  assert.deepEqual([f.width, f.height, f.fps, f.vcodec, f.acodec], [720, 720, 30, 'h264', 'aac']);
  assert.equal(f.stepDown, null);
  assert.ok(f.notes.some((n) => /^over [\d.]+ MB at CRF 26 \([\d.]+ MB\): two-pass at \d+ kbps$/.test(n)), JSON.stringify(f.notes));
  assert.deepEqual(passlogs(), [], 'passlog files cleaned up');
});

test('when full size cannot meet the floor, resolution steps down and the manifest says so', async () => {
  const m = await capRun(), f = m.files.find((x) => x.preset === 'steps'), cap = capBytes(maxMBFor(capDir, 600));
  assert.deepEqual([f.width, f.height], [540, 540]);
  assert.deepEqual([video(path.join(capDir, f.path)).width, video(path.join(capDir, f.path)).height], [540, 540]);
  assert.ok(f.bytes <= cap, `${f.bytes} bytes vs cap ${cap}`);
  assert.deepEqual(f.stepDown, { from: [720, 720], to: [540, 540], videoKbps: 600 });
  assert.deepEqual(JSON.parse(readFileSync(path.join(capDir, 'out', 'exports', 'manifest.json'), 'utf8')), m, 'manifest on disk');
});

test('when even the smallest size cannot meet the floor, the export stops with a clear error and writes no file', async () => {
  const dir = await capProject(), exportsDir = path.join(dir, 'out', 'exports');
  await capRun();
  const manifest = readFileSync(path.join(exportsDir, 'manifest.json'));
  await withPresets({
    ok: preset({ shape: 'design', public: false }),
    tiny: preset({ shape: 'design', public: false, maxMB: maxMBFor(dir, 300) }),   // 300 kbps is under 540's floor (450)
  }, (presetsFile) => {
    const r = exportCli([dir, '--for', 'ok,tiny'], presetsFile);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^error: tiny: cannot fit [\d.]+ MB in 4\.00 s: .*540x540 needs at least 450 kbps/);
    assert.doesNotMatch(r.stderr, /usage:/, 'a cap that cannot be met is not a usage error');
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  });
  assert.ok(!existsSync(path.join(exportsDir, 'tiny.mp4')), 'no file for the preset that failed');
  assert.ok(!existsSync(path.join(exportsDir, 'ok.mp4')), 'nothing from a failed export lands in out/exports');
  assert.deepEqual(noStaging(exportsDir), [], 'staging cleaned up');
  assert.deepEqual(readFileSync(path.join(exportsDir, 'manifest.json')), manifest, 'the previous manifest is untouched');
  assert.deepEqual(passlogs(), [], 'passlog files cleaned up');
});

test('web writes mp4 (faststart), webm (vp9/opus) and a poster jpg from a settled frame', () => {
  const D = loopSec(DIR), song = JSON.parse(readFileSync(path.join(DIR, 'song.json'), 'utf8'));
  const [mp4, webm, jpg] = M.files.filter((f) => f.preset === 'web');
  assert.deepEqual([mp4.path, webm.path, jpg.path], ['mp4', 'webm', 'jpg'].map((e) => path.join('out', 'exports', `web.${e}`)));
  // faststart: the moov atom comes before the media data
  const buf = readFileSync(abs(mp4));
  assert.ok(buf.indexOf('moov') > 0 && buf.indexOf('moov') < buf.indexOf('mdat'), 'moov before mdat');
  const p = probe(abs(webm)), v = p.streams.find((s) => s.codec_type === 'video');
  const codecs = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', abs(webm)], { encoding: 'utf8' });
  assert.deepEqual(codecs.trim().split('\n'), ['vp9', 'opus']);
  assert.deepEqual([webm.vcodec, webm.acodec, webm.width, webm.height, webm.fps], ['vp9', 'opus', 256, 256, 60]);
  assert.deepEqual([v.width, v.height, v.r_frame_rate], [256, 256, '60/1']);
  assert.ok(Math.abs(Number(p.format.duration) - D) <= 0.05, `webm duration ${p.format.duration}`);
  assert.ok(Number.isFinite(webm.lufs), 'webm loudness measured');
  assert.ok(webm.warnings.some((w) => /commercial music/.test(w)), 'webm carries the audio, so the commercial warning');
  // poster: beat 1 + half a beat, from the song's beat times (cue_t when present)
  const t = (song.beats[1].cue_t ?? song.beats[1].t) + 0.5 * song.beat_sec;
  assert.equal(beatTime(song, 1.5), t);
  assert.deepEqual([jpg.vcodec, jpg.acodec, jpg.width, jpg.height, jpg.fps, jpg.duration, jpg.lufs], ['mjpeg', null, 256, 256, null, null, null]);
  assert.equal(jpg.posterAt, Math.round(t * 1000) / 1000);
  assert.deepEqual(jpg.warnings, [], 'a still has no audio or length to warn about');
  const frame = path.join(TMP, 'frame.png');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', path.join(DIR, M.renders[1].path), '-frames:v', '1', '-update', '1', frame]);
  assert.ok(psnr(abs(jpg), frame) > 30, `poster matches the render at ${t}s`);
});

test('gif stays under its cap, stepping width down if needed', async () => {
  const gifPreset = (maxMB) => preset({ shape: 'design', fps: 60, public: false, audio: { codec: null, kbps: 0, lufs: -14, truePeak: -1 },
    gif: { width: 720, fps: 15, maxMB } });
  const run = (maxMB, outDir) => withPresets({ gif: gifPreset(maxMB) }, () => exportProject(DIR, { for: ['gif'], outDir, log: () => {} }));
  // Under a generous cap: the render's own width (never upscaled to 720), 15 fps, no audio.
  const full = (await run(50, path.join(TMP, 'gif-full'))).files[0];
  assert.deepEqual([full.format, full.vcodec, full.acodec, full.width, full.height, full.fps, full.stepDown], ['gif', 'gif', null, 256, 256, 15, null]);
  assert.ok(full.path.endsWith('gif.gif') && existsSync(full.path));
  assert.ok(Math.abs(full.duration - loopSec(DIR)) <= 0.1, `gif duration ${full.duration}`);
  // A cap just under the full-size GIF: one step down (width x 0.8) fits.
  const cap = Math.floor(full.bytes * 0.85) / 1e6;
  const m = await run(cap, path.join(TMP, 'gif-capped')), g = m.files[0];
  assert.ok(g.bytes <= capBytes(cap), `${g.bytes} vs ${capBytes(cap)}`);
  assert.ok(g.width < 256, `width stepped down to ${g.width}`);
  assert.deepEqual(g.stepDown, { from: [256, 256], to: [g.width, g.height] });
  assert.equal(video(g.path).width, g.width);
  // A cap no width in four tries can meet: an error, and no GIF.
  const outDir = path.join(TMP, 'gif-tiny');
  await assert.rejects(run(full.bytes * 0.05 / 1e6, outDir), /^Error: gif: GIF still [\d.]+ MB at width \d+ after 4 tries; cap is [\d.]+ MB/);
  assert.ok(!existsSync(path.join(outDir, 'gif.gif')));
  assert.deepEqual(noStaging(outDir), []);
});

test('over maxSeconds warns (not an error)', async () => {
  const outDir = path.join(TMP, 'brief');
  const m = await exportProject(DIR, { for: ['brief'], outDir, log: () => {} });
  const f = m.files[0];
  assert.ok(existsSync(f.path), 'the file is still written');
  assert.ok(f.warnings.includes(`over the 2 s maximum length for brief (${f.duration.toFixed(2)} s): the platform may reject or trim it`), JSON.stringify(f.warnings));
});

// ---- guides previews and the brief's music decision ----

test('--guides renders a guides preview per preset with safe zones and exports nothing', async () => {
  const dir = makeProject({ bars: 2, size: '256x256' });
  await withPresets({ reels: preset({ shape: 'vertical', size: [216, 384], safe: { top: 54, bottom: 134, left: 13, right: 13 } }),
    web: preset({ shape: 'design' }) }, (f) => {
    const r = exportCli([dir, '--for', 'reels,web', '--guides'], f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^reels\s+out\/shapes\/216x384\/preview-guides-reels\.mp4\nweb\s+no safe zones/);
  });
  const g = path.join(dir, 'out', 'shapes', '216x384', 'preview-guides-reels.mp4');
  assert.deepEqual([video(g).width, video(g).height], [108, 192]);
  assert.ok(!existsSync(path.join(dir, 'out', 'exports')), 'no exports');
  assert.ok(!existsSync(stampPath(g)) && !existsSync(path.join(dir, 'out', 'shapes', '216x384', 'video.mp4')), 'nothing an export would reuse');
});

test('commercial music: project.json "music" or a brief Decisions line that calls the track commercial', async () => {
  const dir = makeProject({ bars: 2 });
  assert.equal(await commercialMusic(dir), false);
  const brief = (line) => writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), `# Motion brief\n\n## Decisions\n- ${line}\n\n## Moments\n- commercial break\n`);
  brief('**Song:** "Tints", my own copy: a commercial track, so social platforms would likely mute it.');
  assert.equal(await commercialMusic(dir), true);
  brief('**Song:** a licensed library track (not commercial).');
  assert.equal(await commercialMusic(dir), false, 'negated, and "commercial" outside Decisions does not count');
  brief('**Music:** commercial');
  assert.equal(await commercialMusic(dir), true);
});

test('a licensed track in the brief gets no commercial warning in the manifest; a commercial one does', async () => {
  const dir = makeProject({ bars: 2, size: '128x128' });
  const briefFile = path.join(dir, 'MOTION-BRIEF.md');
  const brief = (line) => {
    writeFileSync(briefFile, `# Motion brief\n\n## Decisions\n- ${line}\n- **Exports:** pub\n`);
    const past = new Date(Date.now() - 60000);
    utimesSync(briefFile, past, past);   // older than the stand-in render, so it stays reusable
  };
  brief('**Music:** licensed for commercial use, royalty-free');
  const f = path.join(dir, 'out', 'video.mp4');
  standIn(dir, f, loopSec(dir));
  await standInStamp(dir, f, [128, 128]);
  await withPresets({ pub: preset({ shape: 'design' }) }, async () => {
    const commercial = async () => {
      const m = await exportProject(dir, { for: ['pub'], log: () => {} });
      assert.equal(m.renders[0].reused, true, 'the stand-in render is reused');
      return m.files[0].warnings.filter((w) => /commercial/.test(w));
    };
    assert.deepEqual(await commercial(), []);
    brief('**Song:** "Tints", a commercial track, so social platforms would likely mute it.');
    assert.equal((await commercial()).length, 1);
  });
});
