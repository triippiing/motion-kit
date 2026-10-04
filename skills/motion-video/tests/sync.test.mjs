import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import { makeProject } from './harness.mjs';
import { analyserTimeout, saveSync, startSync, SaveError } from '../scripts/sync.mjs';
import { tempDir } from './tmp.mjs';
import { UsageError } from '../scripts/render.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(SKILL, 'scripts', 'sync.mjs');
const servers = [];   // temp dirs are tempDir's (removed at exit, kept with MK_KEEP_TMP=1); servers are closed here
after(async () => { for (const s of servers) await s.close(); });

// A 4-bar project (20 s click track at 120 BPM, beside it as ../beat.wav) whose loop starts at bar 2, so a nudge
// keeps the window inside the song. The analyser has written .source.json. `opts` go to makeProject (states, cursor).
function project(opts = {}) {
  const dir = makeProject({ bars: 4, ...opts });
  execFileSync('python3', [path.join(SKILL, 'scripts', 'analyze_song.py'), path.join(path.dirname(dir), 'beat.wav'),
    '--out', dir, '--bars', '4', '--start-bar', '2'], { stdio: 'pipe' });
  return dir;
}

const read = (dir, f) => readFileSync(path.join(dir, f));
const song = (dir) => JSON.parse(read(dir, 'song.json'));

async function serveProject(dir) {
  const s = await startSync(dir, {});
  servers.push(s);
  return s;
}

// A raw request: the path goes out exactly as given (fetch would normalise "..").
function raw(url, method, reqPath, body, headers = {}) {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: reqPath, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, type: res.headers['content-type'], text, json });
      });
    });
    req.on('error', reject);
    req.end(body == null ? undefined : body);
  });
}
const post = (url, sync) => raw(url, 'POST', '/__sync/save', JSON.stringify({ sync }));

test('Save round trip: 200 with the new song, .bak holds the old song.json, clip.wav re-cut', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  const before = read(dir, 'song.json'), clipMtime = statSync(path.join(dir, 'clip.wav')).mtimeMs;
  const t = song(dir).loop.start_sec + 1;
  const r = await post(url, { nudge_ms: -10, markers: [{ name: 'drop', t }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.song.sync.nudge_ms, -10);
  const drop = r.json.song.markers.find((m) => m.name === 'drop');
  assert.ok(drop && drop.in_loop, JSON.stringify(r.json.song.markers));
  assert.deepEqual(song(dir), r.json.song);
  assert.deepEqual(read(dir, 'song.json.bak'), before);
  assert.ok(!existsSync(path.join(dir, 'song.json.bak.tmp')));
  assert.notEqual(statSync(path.join(dir, 'clip.wav')).mtimeMs, clipMtime);
});

test('an invalid sync is a 400 with the analyser\'s message, and nothing changes', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  assert.equal((await post(url, { nudge_ms: -10 })).status, 200);
  const before = read(dir, 'song.json'), bak = read(dir, 'song.json.bak'), clip = read(dir, 'clip.wav');
  const r = await post(url, { swing: 0.9 });
  assert.equal(r.status, 400, r.text);
  assert.match(r.json.error, /sync swing must be a number from 0\.5 to 0\.75, got 0\.9/);
  assert.doesNotMatch(r.json.error, /^error:/);
  assert.deepEqual(read(dir, 'song.json'), before);
  assert.deepEqual(read(dir, 'song.json.bak'), bak);
  assert.deepEqual(read(dir, 'clip.wav'), clip);
  assert.ok(!existsSync(path.join(dir, 'song.json.bak.tmp')));
});

// A states table with a row at the 'drop' marker (between beats 0 and 2); the cursor rests clear of the component.
const DROP_TABLES = { states: "[{ at: 0, use: 'button' }, { at: 'drop', use: 'button' }, { at: 2, use: 'button' }, { at: END - 2, use: 'button' }]",
  cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' };

test('GET /__sync/needed: the marker names the tables use that song.json has not placed', async () => {
  const dir = project(DROP_TABLES);
  const { url } = await serveProject(dir);
  const needed = () => raw(url, 'GET', '/__sync/needed');
  let r = await needed();
  assert.equal(r.status, 200, r.text);
  assert.match(r.type, /^application\/json/);
  assert.deepEqual(r.json, { names: ['drop'] });
  await saveSync(dir, { markers: [{ name: 'drop', t: song(dir).loop.start_sec + 0.5 }] });
  r = await needed();
  assert.deepEqual(r.json, { names: [] });
  // a project whose tables use no markers has nothing to place
  const plain = await serveProject(project());
  assert.deepEqual((await raw(plain.url, 'GET', '/__sync/needed')).json, { names: [] });
});

test('a body without a sync object is a 400', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  for (const body of ['not json', '[]', '{}', '{"sync": [1]}', '{"sync": null}', '{"sync": "x"}']) {
    const r = await raw(url, 'POST', '/__sync/save', body);
    assert.equal(r.status, 400, body);
    assert.equal(typeof r.json.error, 'string');
  }
  assert.ok(!existsSync(path.join(dir, 'song.json.bak')));
});

test('a moved song is a 400 that says how to record it, and nothing changes', async () => {
  const proj = project(), root = path.dirname(proj);
  const dir = path.join(root, 'my proj');
  renameSync(proj, dir);
  renameSync(path.join(root, 'beat.wav'), path.join(root, 'moved.wav'));
  const { url } = await serveProject(dir);
  const before = read(dir, 'song.json'), clip = read(dir, 'clip.wav');
  const r = await post(url, { nudge_ms: -10 });
  assert.equal(r.status, 400, r.text);
  assert.ok(r.json.error.includes(`sync.mjs '${dir}' --song PATH`), r.json.error);
  assert.deepEqual(read(dir, 'song.json'), before);
  assert.deepEqual(read(dir, 'clip.wav'), clip);
  for (const f of ['song.json.bak', 'song.json.bak.tmp']) assert.ok(!existsSync(path.join(dir, f)), f);
  // a missing .source.json says the same
  rmSync(path.join(dir, '.source.json'));
  await assert.rejects(saveSync(dir, { nudge_ms: -10 }), (e) => e instanceof UsageError && e.message.includes('--song PATH'));
});

test('a window off the song is refused with the analyser\'s message; song.json and clip.wav are restored', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  const before = read(dir, 'song.json'), clip = read(dir, 'clip.wav');
  const r = await post(url, { nudge_ms: -30000 });
  // the analyser exits 2 for a window error, so this is a 400 (bad input), not a 500
  assert.equal(r.status, 400, r.text);
  assert.match(r.json.error, /the loop window would start before the song/);
  assert.deepEqual(read(dir, 'song.json'), before);
  assert.deepEqual(read(dir, 'clip.wav'), clip);
  for (const f of ['song.json.bak', 'song.json.bak.tmp']) assert.ok(!existsSync(path.join(dir, f)), f);
});

test('an analyser that fails for another reason is a SaveError (500); song.json is restored', async () => {
  const dir = project();
  const before = read(dir, 'song.json'), clip = read(dir, 'clip.wav');
  // node cannot run a Python script: a non-2 exit, as from a crash
  const e = await saveSync(dir, { nudge_ms: -10 }, { python: process.execPath }).catch((x) => x);
  assert.ok(e instanceof SaveError, String(e));
  assert.ok(!(e instanceof UsageError));
  assert.deepEqual(read(dir, 'song.json'), before);
  assert.deepEqual(read(dir, 'clip.wav'), clip);
  assert.ok(!existsSync(path.join(dir, 'song.json.bak.tmp')));
  const missing = await saveSync(dir, { nudge_ms: -10 }, { python: '/nope/python3' }).catch((x) => x);
  assert.ok(missing instanceof SaveError, String(missing));
  assert.deepEqual(read(dir, 'song.json'), before);
});

test('two concurrent saves run one at a time', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  const [a, b] = await Promise.all([post(url, { nudge_ms: -10 }), post(url, { nudge_ms: -20 })]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.equal(a.json.song.sync.nudge_ms, -10);
  assert.equal(b.json.song.sync.nudge_ms, -20);
  assert.deepEqual(song(dir), b.json.song);
  assert.deepEqual(JSON.parse(read(dir, 'song.json.bak')), a.json.song);
});

test('path safety: nothing outside DIR, POST only to the save route', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'secret');
  for (const p of ['/__sync/../song.json', '/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/__sync/..%2f..%2fsecret.txt',
    '/..%2fp2%2fsecret.txt']) {
    const r = await raw(url, 'GET', p);
    assert.equal(r.status, 403, p);
  }
  for (const p of ['/index.html', '/__sync', '/__sync/', '/__sync/nope', '/song.json']) {
    const r = await raw(url, 'POST', p, '{}');
    assert.equal(r.status, 404, p);
  }
  assert.equal((await raw(url, 'GET', '/song.json')).status, 200);
  assert.equal((await raw(url, 'GET', '/__sync/nope.js')).status, 404);
});

test('path safety: a sibling directory that shares the prefix is outside DIR', async () => {
  const dir = project();
  const sib = `${dir}2`;
  execFileSync('mkdir', [sib]);
  writeFileSync(path.join(sib, 'secret.txt'), 'secret');
  const { url } = await serveProject(dir);
  const r = await raw(url, 'GET', `/..%2f${path.basename(sib)}%2fsecret.txt`);
  assert.equal(r.status, 403);
});

test('GET /__sync serves the sync page; the server binds 127.0.0.1', async () => {
  const dir = project();
  const s = await serveProject(dir);
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/__sync$/);
  assert.equal(s.server.address().address, '127.0.0.1');
  const r = await raw(s.url, 'GET', '/__sync');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.text, /<title>/);
});

test('startSync --song records the song in .source.json and refuses a missing file', async () => {
  const dir = project(), song = path.join(path.dirname(dir), 'beat.wav');
  rmSync(path.join(dir, '.source.json'));
  await assert.rejects(startSync(dir, { song: '/nope.wav' }), (e) => e instanceof UsageError && /\/nope\.wav/.test(e.message));
  const s = await startSync(dir, { song });
  servers.push(s);
  assert.deepEqual(JSON.parse(read(dir, '.source.json')), { path: song });
  const r = await post(s.url, { nudge_ms: -10 });
  assert.equal(r.status, 200, r.text);
});

test('CLI: usage errors exit 2', () => {
  let r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error: usage: sync\.mjs DIR/);
  const dir = project();
  r = spawnSync('node', [SCRIPT, dir, '--no-open', '--song', '/nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: .*\/nope/m);
  r = spawnSync('node', [SCRIPT, path.join(dir, 'nope'), '--no-open'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^error: /m);
  r = spawnSync('node', [SCRIPT, dir, '--no-open', '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error: unknown flag --bogus/);
});

test('CLI: prints the sync page URL and serves it', async () => {
  const dir = project();
  const child = spawn('node', [SCRIPT, dir, '--no-open', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const line = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (c) => { out += c; const m = /sync page: (http:\/\/127\.0\.0\.1:\d+\/__sync)\n/.exec(out); if (m) resolve(m[1]); });
      child.on('exit', (code) => reject(new Error(`exited ${code}`)));
    });
    const r = await raw(line, 'GET', '/__sync');
    assert.equal(r.status, 200);
  } finally { child.kill(); }
});

test('path safety: symlinks inside DIR that point outside it are refused', async () => {
  const dir = project(), outside = path.join(path.dirname(dir), 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
  symlinkSync(outside, path.join(dir, 'linkdir'));
  const { url } = await serveProject(dir);
  assert.equal((await raw(url, 'GET', '/link.txt')).status, 403);
  assert.equal((await raw(url, 'GET', '/linkdir/secret.txt')).status, 403);
  assert.equal((await raw(url, 'GET', '/song.json')).status, 200);
  assert.equal((await raw(url, 'GET', '/nope.json')).status, 404);
});

test('cross-site requests are refused: Host, Origin and content type', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  const { port } = new URL(url);
  const before = read(dir, 'song.json'), clip = read(dir, 'clip.wav');
  const body = JSON.stringify({ sync: { nudge_ms: -10 } });
  let r = await raw(url, 'POST', '/__sync/save', body, { host: `evil.example:${port}` });
  assert.equal(r.status, 403, 'rebound Host');
  r = await raw(url, 'GET', '/__sync', null, { host: `evil.example:${port}` });
  assert.equal(r.status, 403, 'rebound Host on a GET');
  r = await raw(url, 'POST', '/__sync/save', body, { origin: 'https://evil.example' });
  assert.equal(r.status, 403, 'foreign Origin');
  r = await raw(url, 'POST', '/__sync/save', body, { 'content-type': 'text/plain' });
  assert.equal(r.status, 415, 'text/plain');
  assert.match(r.json.error, /application\/json/);
  r = await raw(url, 'POST', '/__sync/save', body, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415, 'form');
  assert.deepEqual(read(dir, 'song.json'), before);
  assert.deepEqual(read(dir, 'clip.wav'), clip);
  // the page's own requests: same origin, by either name
  r = await raw(url, 'GET', '/__sync', null, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
  assert.equal(r.status, 200);
  r = await raw(url, 'HEAD', '/__sync');
  assert.equal(r.status, 200, 'HEAD answers like GET');
  r = await raw(url, 'POST', '/__sync/save', body, { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json; charset=utf-8' });
  assert.equal(r.status, 200, r.text);
});

test('an oversized body gets a 413', async () => {
  const dir = project();
  const { url } = await serveProject(dir);
  const big = JSON.stringify({ sync: { pad: 'x'.repeat(2 << 20) } });
  const r = await raw(url, 'POST', '/__sync/save', big);
  assert.equal(r.status, 413);
  assert.match(r.json.error, /over/);
  assert.ok(!existsSync(path.join(dir, 'song.json.bak')));
});

test('a save whose backup cannot be kept keeps the new song and says so', async () => {
  const dir = project();
  mkdirSync(path.join(dir, 'song.json.bak'));
  writeFileSync(path.join(dir, 'song.json.bak', 'x'), 'x');
  const clipMtime = statSync(path.join(dir, 'clip.wav')).mtimeMs;
  const e = await saveSync(dir, { nudge_ms: -10 }).catch((x) => x);
  assert.ok(e instanceof SaveError, String(e));
  assert.match(e.message, /song\.json\.bak/);
  assert.equal(song(dir).sync.nudge_ms, -10);
  assert.notEqual(statSync(path.join(dir, 'clip.wav')).mtimeMs, clipMtime);
  assert.ok(!existsSync(path.join(dir, 'song.json.bak.tmp')));
});

test('checked_by_ear: a carried-over date is dropped when the grid changes; a new date is kept', async () => {
  const dir = project();
  let r = await saveSync(dir, { checked_by_ear: '2026-09-30' });
  assert.equal(r.song.sync.checked_by_ear, '2026-09-30');
  // markers or swing alone are not the grid: the check stays
  r = await saveSync(dir, { swing: 0.6, checked_by_ear: '2026-09-30' });
  assert.equal(r.song.sync.checked_by_ear, '2026-09-30');
  // a nudge with the old date carried over: dropped
  r = await saveSync(dir, { swing: 0.6, nudge_ms: -10, checked_by_ear: '2026-09-30' });
  assert.ok(!('checked_by_ear' in r.song.sync), JSON.stringify(r.song.sync));
  // a nudge pressed "Sounds right" again (a new date): kept
  r = await saveSync(dir, { swing: 0.6, nudge_ms: -20, checked_by_ear: '2026-10-01' });
  assert.equal(r.song.sync.checked_by_ear, '2026-10-01');
  // a meter or bpm change with the stored date: dropped
  r = await saveSync(dir, { swing: 0.6, nudge_ms: -20, meter: '3/4', checked_by_ear: '2026-10-01' });
  assert.ok(!('checked_by_ear' in r.song.sync));
});

// A stand-in for python3 that runs a shell body instead of the analyser.
function fakePython(body) {
  const f = path.join(tempDir('mk-fakepy-'), 'python3');
  writeFileSync(f, `#!/bin/sh\n${body}\n`);
  chmodSync(f, 0o755);
  return f;
}

test('Save: a hung analyser is stopped after the timeout; song.json is unchanged and the next Save runs', async () => {
  const dir = project();
  const before = read(dir, 'song.json');
  const e = await saveSync(dir, { nudge_ms: -10 }, { python: fakePython('sleep 30'), timeoutMs: 300 }).catch((x) => x);
  assert.ok(e instanceof SaveError, String(e));
  assert.equal(e.message, 'the analyser took longer than 0.3 s and was stopped; song.json is unchanged');
  assert.deepEqual(read(dir, 'song.json'), before);
  const { song: next } = await saveSync(dir, { nudge_ms: -10 });
  assert.equal(next.sync.nudge_ms, -10);
});

test('Save: an analyser that ignores SIGTERM is killed', async () => {
  const dir = project();
  const before = read(dir, 'song.json');
  const t0 = Date.now();
  const e = await saveSync(dir, { nudge_ms: -10 }, { python: fakePython("trap '' TERM\nsleep 30"), timeoutMs: 300 }).catch((x) => x);
  assert.ok(e instanceof SaveError, String(e));
  assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
  assert.match(e.message, /^the analyser took longer than 0\.3 s and was stopped; song\.json is unchanged$/);
  assert.deepEqual(read(dir, 'song.json'), before);
});

// Ctrl+C on the server stops an analyser still running (it runs in its own process group, so the signal alone
// would not reach it) and puts the previous song.json back. The fake analyser's argv carries a marker so pgrep
// finds only this test's process.
test('CLI: SIGINT stops a running analyser; song.json is unchanged', { timeout: 30_000 }, async () => {
  const dir = project();
  const before = read(dir, 'song.json');
  const marker = `mk-orphan-${process.pid}-${Date.now()}`;
  const python = fakePython(`exec python3 -c 'import time; time.sleep(30)' ${marker}`);
  const running = () => spawnSync('pgrep', ['-f', marker]).status === 0;
  const until = async (ok, ms) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return true; return ok(); };
  const child = spawn('node', [SCRIPT, dir, '--no-open', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MK_ANALYSER_PYTHON: python, MK_ANALYSER_TIMEOUT: '60000' } });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (c) => { out += c; const m = /sync page: (http:\/\/127\.0\.0\.1:\d+\/__sync)\n/.exec(out); if (m) resolve(m[1]); });
      child.on('exit', (code) => reject(new Error(`exited ${code}`)));
    });
    post(url, { nudge_ms: -10 }).catch(() => {});   // the server goes away mid-request
    assert.ok(await until(running, 10_000), 'the fake analyser started');
    const code = await new Promise((resolve) => { child.on('exit', (c) => resolve(c)); child.kill('SIGINT'); });
    assert.equal(code, 130);
    assert.ok(await until(() => !running(), 3000), 'the analyser is still running after the server exited');
    assert.deepEqual(read(dir, 'song.json'), before);
    assert.ok(!existsSync(path.join(dir, 'song.json.bak.tmp')), 'song.json.bak.tmp is left behind');
  } finally {
    child.kill('SIGKILL');
    spawnSync('pkill', ['-KILL', '-f', marker]);
  }
});

test('analyserTimeout: MK_ANALYSER_TIMEOUT in ms, else 120 s', () => {
  assert.equal(analyserTimeout({}), 120_000);
  assert.equal(analyserTimeout({ MK_ANALYSER_TIMEOUT: '5000' }), 5000);
  for (const bad of ['abc', '0', '-1', '']) assert.equal(analyserTimeout({ MK_ANALYSER_TIMEOUT: bad }), 120_000, bad);
  // past 2**31-1 ms Node fires setTimeout after 1 ms, so the value is capped there
  assert.equal(analyserTimeout({ MK_ANALYSER_TIMEOUT: '1e12' }), 2 ** 31 - 1);
});
