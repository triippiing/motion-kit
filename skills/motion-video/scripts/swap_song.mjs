#!/usr/bin/env node
// swap_song.mjs -- one step to put a new song on a project: back up, clear the old sync, re-analyse, report.
//
//   node swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B | --start-near SEC | --from-start] [--no-open] [--port N]
//
// Copies song.json, clip.wav and .source.json (those present) to DIR/.swap-backup/<YYYYMMDD-HHMMSS>/, lists the
// marker names the tables use (they still need placing on the new song), removes `sync` from song.json (its nudge,
// tempo, meter, swing and markers were set by ear against the old song) and runs analyze_song.py on NEWSONG with the
// project's bars (or --bars) and fps (and --start-bar, --start-near or --from-start), which rewrites song.json, clip.wav and .source.json. If the analyser fails the
// backup is put back and the project is as it was. The tables are never edited.
// Then it prints the report (tempo, loop, the loop window's start bar and how to keep the old one, names to place)
// and, unless --no-open, runs `node sync.mjs DIR [--port N]` in the foreground (its own output, browser opening and
// Ctrl+C handling) so the names can be placed.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { access, constants, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './render.mjs';
import { isMain } from './is_main.mjs';
import { briefCode, pageCode, projectMarkerNames, runTables, TablesError } from './tables.mjs';

const HERE = import.meta.dirname;
const ANALYSER = path.join(HERE, 'analyze_song.py');
const SYNC = path.join(HERE, 'sync.mjs');
const FILES = ['song.json', 'clip.wav', '.source.json'];
const USAGE = 'usage: swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B | --start-near SEC | --from-start] [--no-open] [--port N]';

// A swap whose analyser has not finished ({ root, backup, pgid }), so the CLI can stop the analyser and put the
// backup back when it is interrupted.
let inFlight = null;

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

// Local time as YYYYMMDD-HHMMSS.
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// A fresh backup directory under DIR/.swap-backup (a second swap in the same second gets a -2 suffix, and so on).
async function backupDir(root) {
  const base = path.join(root, '.swap-backup', stamp());
  await mkdir(path.dirname(base), { recursive: true });
  for (let n = 1; ; n++) {
    const d = n === 1 ? base : `${base}-${n}`;
    try { await mkdir(d); return d; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

// Puts the backed-up files back (synchronous, so it can run on exit); a file the backup lacks was not there before.
function restore(root, backup) {
  for (const f of FILES) {
    const src = path.join(backup, f), dst = path.join(root, f);
    if (existsSync(src)) copyFileSync(src, dst); else rmSync(dst, { force: true });
  }
}

// Runs the analyser in its own process group (recorded in inFlight, so the CLI can stop all of it); resolves
// { code, stderr, error } (code null and `error` set when it could not start).
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` } });
    if (inFlight && child.pid) inFlight.pgid = child.pid;
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (error) => resolve({ code: null, stderr, error }));
    child.on('close', (code) => resolve({ code, stderr }));
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

// The state budget against the new song: index.html's tables, else the brief's, when they run; null when within it.
function budget(root, song) {
  const read = (f) => { try { return readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
  const html = read('index.html'), md = read('MOTION-BRIEF.md');
  for (const code of [html == null ? null : pageCode(html), md == null ? null : briefCode(md)]) {
    if (!code?.trim()) continue;
    let states;
    try { ({ states } = runTables(code, song.beats.length)); } catch (e) { if (e instanceof TablesError) continue; throw e; }
    if (!Array.isArray(states)) continue;
    const n = states.length - 1, max = song.rules?.max_states;
    return max && n > max ? `the tables have ${n} states; the new song allows ${max} (shorten the table or pass --bars)` : null;
  }
  return null;
}

// Puts SONG on the project in DIR. Resolves { before: { bpm, duration, startBar }, after: { bpm, confidence, duration,
// bars, startBar },
// toPlace, budget, backup }. Bad input (no project, no song, both start options, the analyser's exit 2) throws
// UsageError; any other analyser failure throws Error. On either the project is as it was.
export async function swapSong(dir, song, { bars, startBar, startNear, fromStart = false, python = 'python3' } = {}) {
  const root = path.resolve(dir), songFile = path.join(root, 'song.json');
  if (!(await stat(songFile).then((s) => s.isFile(), () => false))) {
    throw new UsageError(`${root} is not a motion-video project (no song.json); make one with new_project.sh`);
  }
  const abs = path.resolve(song ?? '');
  const readable = song != null && await stat(abs).then((s) => s.isFile(), () => false) && await access(abs, constants.R_OK).then(() => true, () => false);
  if (!readable) throw new UsageError(`${song}: no such file, or not readable`);
  if (startBar != null && startNear != null) throw new UsageError('pass --start-bar or --start-near, not both');
  if (fromStart && (startBar != null || startNear != null)) throw new UsageError('pass --from-start, --start-bar or --start-near, not two of them');
  let current;
  try { current = JSON.parse(await readFile(songFile, 'utf8')); } catch {
    throw new UsageError(`${songFile} is not valid JSON; run analyze_song.py for this project first`);
  }
  const n = bars ?? current.loop?.bars;
  if (!(n > 0)) throw new UsageError(`${songFile} has no loop.bars; pass --bars`);
  const before = { bpm: current.bpm, duration: current.loop?.duration_sec, startBar: current.loop?.start_bar };
  // from the tables, which the swap does not change; read before song.json loses its beats
  const toPlace = projectMarkerNames(root);

  const backup = await backupDir(root);
  for (const f of FILES) {
    if (existsSync(path.join(root, f))) await copyFile(path.join(root, f), path.join(backup, f));
  }
  inFlight = { root, backup };
  try {
    const { sync, markers, ...rest } = current;
    await writeJsonAtomic(songFile, rest);
    const args = [ANALYSER, abs, '--out', root, '--bars', String(n)];
    if (current.fps > 0) args.push('--fps', String(current.fps));
    if (startBar != null) args.push('--start-bar', String(startBar));
    if (startNear != null) args.push('--start-near', String(startNear));
    if (fromStart) args.push('--from-start');
    const r = await run(python, args);
    if (r.code !== 0) throw r.code === 2 ? new UsageError(analyserMessage(r)) : new Error(analyserMessage(r));
  } catch (e) {
    try { restore(root, backup); } catch (r) {
      throw new Error(`${e.message}; then putting the backup back failed (${r.message}): the old files are in ${backup}`);
    }
    // the project is as it was, so this backup holds nothing new
    await rm(backup, { recursive: true, force: true });
    throw e;
  } finally { inFlight = null; }

  const next = JSON.parse(await readFile(songFile, 'utf8'));
  return {
    before,
    after: { bpm: next.bpm, confidence: next.bpm_confidence, duration: next.loop.duration_sec, bars: next.loop.bars, startBar: next.loop.start_bar },
    toPlace, budget: budget(root, next), backup,
  };
}

function parseArgs(argv) {
  const o = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k === 'no-open') { o.noOpen = true; continue; }
    if (k === 'from-start') { o.fromStart = true; continue; }
    if (!['bars', 'start-bar', 'start-near', 'port'].includes(k)) throw new UsageError(`unknown flag ${a}`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`--${k} needs a value`);
    o[k] = argv[++i];
  }
  if (pos.length !== 2) throw new UsageError(USAGE);
  const int = (k, min, max = Infinity) => {
    if (o[k] == null) return undefined;
    if (!/^-?[0-9]+$/.test(o[k]) || Number(o[k]) < min || Number(o[k]) > max) throw new UsageError(`--${k} must be a whole number from ${min}${max < Infinity ? ` to ${max}` : ''}, got "${o[k]}"`);
    return Number(o[k]);
  };
  const startNear = o['start-near'] == null ? undefined : Number(o['start-near']);
  if (startNear !== undefined && (!Number.isFinite(startNear) || o['start-near'].trim() === '')) throw new UsageError(`--start-near must be a number of seconds, got "${o['start-near']}"`);
  return { dir: pos[0], song: pos[1], bars: int('bars', 1), startBar: int('start-bar', 0), startNear, port: int('port', 0, 65535), noOpen: !!o.noOpen, fromStart: !!o.fromStart };
}

const fixed = (x) => (Number.isFinite(x) ? x.toFixed(2) : '?');

// The report's line for the loop window: where it starts now, and the flag that keeps the old start when it moved.
export function windowLine(was, now) {
  if (!Number.isInteger(was)) return `window: bar ${now}`;
  return was === now ? `window: bar ${now} (unchanged)` : `window: bar ${was} -> ${now} (pass --start-bar ${was} to keep it)`;
}

async function main() {
  const { dir, song, bars, startBar, startNear, fromStart, port, noOpen } = parseArgs(process.argv.slice(2));
  const r = await swapSong(dir, song, { bars, startBar, startNear, fromStart, python: process.env.MK_ANALYSER_PYTHON || undefined });
  console.log(`tempo: ${fixed(r.before.bpm)} -> ${fixed(r.after.bpm)} BPM (confidence ${fixed(r.after.confidence)})`);
  console.log(`loop: ${r.after.bars} bars = ${fixed(r.after.duration)} s (was ${fixed(r.before.duration)} s)`);
  console.log(windowLine(r.before.startBar, r.after.startBar));
  console.log(r.toPlace.length ? `to place: ${r.toPlace.join(', ')}` : 'no markers to place');
  if (r.budget) console.log(`warning: ${r.budget}`);
  if (existsSync(path.join(dir, 'MOTION-BRIEF.md'))) console.log("reminder: update the brief's Song/Music line if the licence changed");
  console.log(`backup: ${r.backup}`);
  if (noOpen) return;
  // sync.mjs in the foreground: it prints the URL, opens it and owns Ctrl+C (stopping a Save's analyser); this
  // process waits for it and exits with its code.
  syncChild = spawn(process.execPath, [SYNC, dir, ...(port == null ? [] : ['--port', String(port)])], { stdio: 'inherit' });
  syncChild.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGINT' ? 130 : 143)));
}

// The foreground sync.mjs, once it runs.
let syncChild = null;

if (isMain(import.meta.url)) {
  // a handler replaces the default exit on these signals, so exit with the shell's code for them. While the analyser
  // runs (in its own process group, which a signal to this process alone does not reach), stop it first so it cannot
  // write over the restored files, then put the backup back and keep it; once sync.mjs runs, pass the signal on and
  // exit with it.
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => {
    if (syncChild) { try { syncChild.kill(sig); } catch { /* already gone */ } return; }
    if (inFlight) {
      if (inFlight.pgid) { try { process.kill(-inFlight.pgid, 'SIGTERM'); } catch { /* already gone */ } }
      try { restore(inFlight.root, inFlight.backup); } catch { /* best effort: the backup below has the old files */ }
      console.error(`backup kept at ${inFlight.backup}`);
    }
    process.exit(code);
  });
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
