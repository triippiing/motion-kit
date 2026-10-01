#!/usr/bin/env node
// sync.mjs -- the sync page: hear the beat grid over the song, nudge it, set tempo, meter, swing and markers, Save.
//
//   node sync.mjs DIR [--port N] [--no-open] [--song PATH]
//
// Serves DIR on 127.0.0.1 (render.mjs serve) with two routes added:
//   GET  /__sync         the page (scripts/sync-page/index.html); its own files are under /__sync/
//   POST /__sync/save    body {"sync": {...}}. Replies 200 {"song": <the new song.json>}, 400 {"error"} for
//                        invalid input or a song that has moved, 500 {"error"} when the analyser fails otherwise.
// Save writes the user's sync section into song.json and re-runs analyze_song.py on the original song (its path is
// in DIR/.source.json), so song.json and clip.wav are rebuilt with the same bars, fps and loop window. The previous
// song.json is kept as song.json.bak; on failure it is put back. --song PATH records where the song is now.
import { spawn } from 'node:child_process';
import { copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serve, inside, TYPES, UsageError } from './render.mjs';

// The analyser ran but failed for a reason other than bad input: a 500.
export class SaveError extends Error {}

const HERE = import.meta.dirname;
const ANALYSER = path.join(HERE, 'analyze_song.py');
const PAGE_DIR = path.join(HERE, 'sync-page');
const MAX_BODY = 1 << 20;
const USAGE = 'usage: sync.mjs DIR [--port N] [--no-open] [--song PATH]';

// A path as the shell needs it: quoted when it holds anything beyond plain path characters.
const shellQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

const songMessage = (root, why) => `${why}; record where the song is with: node sync.mjs ${shellQuote(root)} --song PATH`;

// The song's absolute path from DIR/.source.json (written by the analyser), or a UsageError that says how to set it.
async function sourceSong(root) {
  let src;
  try { src = JSON.parse(await readFile(path.join(root, '.source.json'), 'utf8')).path; } catch {
    throw new UsageError(songMessage(root, 'this project does not know where its song is (no readable .source.json)'));
  }
  const ok = typeof src === 'string' && await stat(src).then((s) => s.isFile(), () => false);
  if (!ok) throw new UsageError(songMessage(root, `the song is not at ${src} any more`));
  return src;
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

// Runs a command; resolves { code, stdout, stderr } (code null and `error` set when it could not start).
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (error) => resolve({ code: null, stdout, stderr, error }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// The analyser's message: its last `error: ...` line (argparse prefixes the program name), else the tail of stderr.
function analyserMessage({ code, stderr, error }) {
  if (error) return `could not run the analyser: ${error.message}`;
  const lines = stderr.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(?:\S+: )?error: (.*)$/.exec(lines[i]);
    if (m) return m[1];
  }
  return stderr.trim().slice(-500) || `the analyser exited with code ${code}`;
}

async function doSave(root, sync, python) {
  if (sync === null || typeof sync !== 'object' || Array.isArray(sync)) throw new UsageError('sync must be an object');
  const song = await sourceSong(root);
  const songFile = path.join(root, 'song.json'), bakTmp = `${songFile}.bak.tmp`;
  let current;
  try { current = JSON.parse(await readFile(songFile, 'utf8')); } catch {
    throw new UsageError(`${songFile} is missing or not valid JSON; run analyze_song.py for this project first`);
  }
  const { loop, fps } = current;
  if (!loop || !(loop.bars > 0) || !Number.isFinite(loop.start_sec) || !(fps > 0)) {
    throw new UsageError(`${songFile} has no loop window (loop.bars, loop.start_sec, fps); run analyze_song.py for this project first`);
  }
  await copyFile(songFile, bakTmp);
  try {
    await writeJsonAtomic(songFile, { ...current, sync });
    const r = await run(python, [ANALYSER, song, '--out', root, '--bars', String(loop.bars), '--fps', String(fps),
      '--start-near', String(loop.start_sec)]);
    if (r.code !== 0) {
      // the analyser writes song.json and clip.wav atomically, so on failure only our own sync write is undone
      await rename(bakTmp, songFile);
      throw r.code === 2 ? new UsageError(analyserMessage(r)) : new SaveError(analyserMessage(r));
    }
    await rename(bakTmp, `${songFile}.bak`);
    return { song: JSON.parse(await readFile(songFile, 'utf8')) };
  } catch (e) {
    // a failure of our own (not the analyser's) also puts the previous song.json back
    if (await stat(bakTmp).then(() => true, () => false)) await rename(bakTmp, songFile);
    throw e instanceof UsageError || e instanceof SaveError ? e : new SaveError(e.message);
  }
}

// One save at a time per project: each waits for the one before it, whatever its outcome.
const chains = new Map();

// Saves the user's sync section and rebuilds song.json and clip.wav from the original song. Resolves { song }.
// Validation lives in the analyser alone; its exit code decides the error: 2 (bad input: an invalid sync value, a
// loop window off the song) throws UsageError (HTTP 400), as does a missing or moved song; any other exit, or an
// analyser that cannot start, throws SaveError (HTTP 500). Either way song.json, song.json.bak and clip.wav are as
// they were. `python` is the interpreter (tests swap it).
export function saveSync(dir, sync, { python = 'python3' } = {}) {
  const root = path.resolve(dir);
  const next = (chains.get(root) ?? Promise.resolve()).then(() => doSave(root, sync, python));
  chains.set(root, next.catch(() => {}));
  return next;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new UsageError('request body is too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function servePage(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice('/__sync'.length).replace(/^\//, '');
  const file = path.join(PAGE_DIR, rel || 'index.html');
  if (!inside(PAGE_DIR, file)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}

async function saveRoute(req, res, root) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) {
    return sendJson(res, e instanceof UsageError ? 413 : 400, { error: e instanceof UsageError ? e.message : 'the body must be JSON: {"sync": {...}}' });
  }
  const sync = body?.sync;
  if (sync === null || typeof sync !== 'object' || Array.isArray(sync)) return sendJson(res, 400, { error: 'the body must be {"sync": {...}} with sync an object' });
  try {
    sendJson(res, 200, await saveSync(root, sync));
  } catch (e) {
    sendJson(res, e instanceof UsageError ? 400 : 500, { error: e.message });
  }
}

// Serves DIR with the sync routes on 127.0.0.1. `song` first records the song's path in DIR/.source.json.
export async function startSync(dir, { port = 0, song } = {}) {
  const root = path.resolve(dir);
  if (!(await stat(path.join(root, 'song.json')).then((s) => s.isFile(), () => false))) {
    throw new UsageError(`${root} is not a motion-video project (no song.json); make one with new_project.sh`);
  }
  if (song != null) {
    const abs = path.resolve(song);
    if (!(await stat(abs).then((s) => s.isFile(), () => false))) throw new UsageError(`--song ${song}: no such file`);
    await writeJsonAtomic(path.join(root, '.source.json'), { path: abs });
  }
  const routes = { 'GET /__sync': servePage, 'GET /__sync/': servePage, 'POST /__sync/save': saveRoute };
  const { server } = await serve(root, port, { routes });
  return { server, url: `http://127.0.0.1:${server.address().port}/__sync`,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }) };
}

function parseArgs(argv) {
  const o = {}; let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { dir ??= a; continue; }
    const k = a.slice(2);
    if (k === 'no-open') o.noOpen = true;
    else if (k === 'port' || k === 'song') {
      if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`--${k} needs a value`);
      o[k] = argv[++i];
    } else throw new UsageError(`unknown flag ${a}`);
  }
  if (o.port != null && (!/^[0-9]+$/.test(o.port) || Number(o.port) > 65535)) throw new UsageError(`--port must be 0 to 65535, got "${o.port}"`);
  return { dir, port: o.port == null ? 0 : Number(o.port), noOpen: !!o.noOpen, song: o.song };
}

async function main() {
  const { dir, port, noOpen, song } = parseArgs(process.argv.slice(2));
  if (!dir) throw new UsageError(USAGE);
  let started;
  try { started = await startSync(dir, { port, song }); } catch (e) {
    if (e.code === 'EADDRINUSE') throw new UsageError(`port ${port} is in use; pass another --port`);
    throw e;
  }
  console.log(`sync page: ${started.url}`);
  if (!noOpen) {
    const child = spawn('open', [started.url], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log('open the URL above in a browser'));
    child.unref();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
