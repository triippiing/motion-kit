#!/usr/bin/env node
// sequence.mjs -- a piece longer than one loop, built as chapters: separate projects played back to back on one song.
//
//   node sequence.mjs SEQ init --song PATH NAME... [--bars N]
//   node sequence.mjs SEQ <analyse|check|render|watch> ...
//
// SEQ/sequence.json lists the chapters in order:
//
//   {
//     "song": "/path/to/song.mp3",                      // relative paths are relative to SEQ
//     "chapters": [
//       { "dir": "intro", "bars": 2, "from_start": true }, // chapter 1 starts with the song ...
//       { "dir": "kit", "bars": 15 },                      // ... or at "start_bar": N (or where the analyser picks);
//       { "dir": "end", "bars": 2 }                        // each later one starts where the previous one ends
//     ],
//     "fade_out_sec": 2.0                                 // optional, default 0
//   }
//
// Each `dir` (relative to SEQ) is an ordinary motion-video project (new_project.sh) with "loop": false in its
// project.json. Unknown keys, missing dirs, a dir given twice, bars that are not a whole number >= 1, both
// from_start and start_bar, or a start on a later chapter are `error: ...`, exit 2.
//
// Commands:
//   init   creates SEQ/sequence.json (song from --song, one chapter per NAME, --bars N each, default 4; chapter 1
//          from_start) and runs new_project.sh for each chapter, setting "loop": false. Refuses an existing
//          sequence.json or chapter directory.
//   analyse, check, render, watch: see the sequences spec (docs/superpowers/specs/2026-10-04-sequences-design.md).
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './render.mjs';
import { isMain } from './is_main.mjs';

const HERE = import.meta.dirname;
const NEW_PROJECT = path.join(HERE, 'new_project.sh');
const TOP_KEYS = ['song', 'chapters', 'fade_out_sec'];
const CHAPTER_KEYS = ['dir', 'bars', 'from_start', 'start_bar'];
// SEQ/out holds the sequence's renders, so no chapter may be called that.
const RESERVED = ['out'];

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readable = (p) => { try { accessSync(p, constants.R_OK); return statSync(p).isFile(); } catch { return false; } };
const show = (v) => JSON.stringify(v);
const wholeAtLeast = (v, min) => Number.isInteger(v) && v >= min;

// Reads and checks SEQ/sequence.json. Returns { root, song, chapters: [{ name, dir, bars, from_start?, start_bar? }],
// fade_out_sec } with `song` and each chapter's `dir` resolved against SEQ (`name` is the dir as written). Any problem
// throws UsageError.
export function loadSequence(seqDir) {
  const root = path.resolve(seqDir), file = path.join(root, 'sequence.json');
  if (!existsSync(file)) throw new UsageError(`no sequence.json in ${root}; make one with sequence.mjs SEQ init`);
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new UsageError(`${file}: sequence.json is not valid JSON (${e.message})`); }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new UsageError(`${file}: sequence.json must be an object`);
  for (const k of Object.keys(j)) {
    if (!TOP_KEYS.includes(k)) throw new UsageError(`sequence.json: unknown key ${show(k)} (allowed: ${TOP_KEYS.join(', ')})`);
  }
  if (typeof j.song !== 'string' || j.song === '') throw new UsageError('sequence.json: "song" must be a path to the song');
  if (!Array.isArray(j.chapters) || j.chapters.length === 0) throw new UsageError('sequence.json: "chapters" must list at least one chapter');
  let fade = 0;
  if (j.fade_out_sec !== undefined) {
    if (typeof j.fade_out_sec !== 'number' || !Number.isFinite(j.fade_out_sec) || j.fade_out_sec < 0) {
      throw new UsageError(`sequence.json: "fade_out_sec" must be a number of seconds >= 0, got ${show(j.fade_out_sec)}`);
    }
    fade = j.fade_out_sec;
  }
  const seen = new Map();
  const chapters = j.chapters.map((c, i) => {
    const n = i + 1;
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new UsageError(`chapter ${n}: must be an object like {"dir": "intro", "bars": 2}`);
    if (typeof c.dir !== 'string' || c.dir === '') throw new UsageError(`chapter ${n}: "dir" must be a directory name (relative to SEQ)`);
    const at = `chapter ${n} (${c.dir})`;
    for (const k of Object.keys(c)) {
      if (!CHAPTER_KEYS.includes(k)) throw new UsageError(`${at}: unknown key ${show(k)} (allowed: ${CHAPTER_KEYS.join(', ')})`);
    }
    if (!wholeAtLeast(c.bars, 1)) throw new UsageError(`${at}: "bars" must be a whole number >= 1, got ${show(c.bars)}`);
    if (c.from_start !== undefined && typeof c.from_start !== 'boolean') throw new UsageError(`${at}: "from_start" must be true or false, got ${show(c.from_start)}`);
    if (c.start_bar !== undefined && !wholeAtLeast(c.start_bar, 0)) throw new UsageError(`${at}: "start_bar" must be a whole number >= 0, got ${show(c.start_bar)}`);
    const fromStart = c.from_start === true, hasStartBar = c.start_bar !== undefined;
    if (n === 1 && fromStart && hasStartBar) throw new UsageError(`${at}: give "from_start" or "start_bar", not both`);
    if (n > 1 && (fromStart || hasStartBar)) {
      throw new UsageError(`${at}: only chapter 1 has a start (${show(fromStart ? 'from_start' : 'start_bar')}); later chapters start where the previous one ends`);
    }
    const dir = path.resolve(root, c.dir);
    if (seen.has(dir)) throw new UsageError(`${at}: ${show(c.dir)} is already chapter ${seen.get(dir)}`);
    seen.set(dir, n);
    if (!isDir(dir)) throw new UsageError(`${at}: ${dir} is not a directory (make the project with new_project.sh, or sequence.mjs SEQ init)`);
    const out = { name: c.dir, dir, bars: c.bars };
    if (fromStart) out.from_start = true;
    if (hasStartBar) out.start_bar = c.start_bar;
    return out;
  });
  const song = path.resolve(root, j.song);
  if (!readable(song)) throw new UsageError(`${song}: no such file, or not readable`);
  return { root, song, chapters, fade_out_sec: fade };
}

// The child's message: its last `error: ...` line, else the tail of its stderr.
function childMessage(r) {
  if (r.error) return `could not run new_project.sh: ${r.error.message}`;
  const lines = (r.stderr ?? '').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(?:\S+: )?error: (.*)$/.exec(lines[i]);
    if (m) return m[1];
  }
  return (r.stderr ?? '').trim().slice(-500) || `new_project.sh exited with code ${r.status}`;
}

// Scaffolds a sequence in SEQ: one project per name (new_project.sh SONG --bars N, chapter 1 --from-start) with
// "loop": false, then SEQ/sequence.json (written last). Returns loadSequence(SEQ). Bad input throws UsageError before
// anything is made; a failing new_project.sh throws (UsageError when it exits 2) and leaves the projects made so far.
export function initSequence(seqDir, { song, names, bars = 4 } = {}) {
  const root = path.resolve(seqDir), file = path.join(root, 'sequence.json');
  if (existsSync(file)) throw new UsageError(`${file} exists; not overwriting`);
  if (typeof song !== 'string' || song === '') throw new UsageError('init needs --song PATH');
  if (!Array.isArray(names) || names.length === 0) throw new UsageError('init needs at least one chapter name');
  if (!wholeAtLeast(bars, 1)) throw new UsageError(`--bars must be a whole number >= 1, got "${bars}"`);
  const seen = new Set();
  for (const n of names) {
    if (typeof n !== 'string' || n === '' || n === '.' || n === '..' || n.includes('/') || n.includes('\\') || n.startsWith('-')) {
      throw new UsageError(`chapter name ${show(n)} must be a plain directory name`);
    }
    if (RESERVED.includes(n)) throw new UsageError(`chapter name ${show(n)} is reserved for the sequence's renders (SEQ/${n})`);
    if (seen.has(n)) throw new UsageError(`chapter name ${show(n)} given twice`);
    seen.add(n);
  }
  const songPath = path.resolve(song);
  if (!readable(songPath)) throw new UsageError(`${song}: no such file, or not readable`);
  for (const n of names) {
    if (existsSync(path.join(root, n))) throw new UsageError(`${path.join(root, n)} already exists; pick another chapter name`);
  }

  mkdirSync(root, { recursive: true });
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` };
  names.forEach((n, i) => {
    const dir = path.join(root, n);
    const args = [dir, songPath, '--bars', String(bars), ...(i === 0 ? ['--from-start'] : [])];
    const r = spawnSync(NEW_PROJECT, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) {
      const msg = `chapter ${n}: ${childMessage(r)}`;
      throw r.status === 2 ? new UsageError(msg) : new Error(msg);
    }
    const pj = path.join(dir, 'project.json');
    writeFileSync(pj, `${JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), loop: false })}\n`);
  });
  const chapters = names.map((n, i) => ({ dir: n, bars, ...(i === 0 ? { from_start: true } : {}) }));
  writeFileSync(file, `${JSON.stringify({ song: songPath, chapters, fade_out_sec: 0 }, null, 2)}\n`);
  return loadSequence(root);
}

// Splits argv into positionals and flags; `bool` flags take no value, `valued` take one.
function parseFlags(argv, { bool = [], valued = [] } = {}) {
  const o = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (bool.includes(k)) { o[k] = true; continue; }
    if (!valued.includes(k)) throw new UsageError(`unknown flag ${a}`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError(`--${k} needs a value`);
    o[k] = argv[++i];
  }
  return { o, pos };
}

const notYet = (name) => () => { throw new Error(`${name} is not implemented yet`); };

// The commands: `loads` = sequence.json is loaded (and checked) before `run(seqDir, argv, seq)`.
const COMMANDS = {
  init: {
    usage: 'init --song PATH NAME... [--bars N]',
    loads: false,
    run(seqDir, argv) {
      const { o, pos } = parseFlags(argv, { valued: ['song', 'bars'] });
      if (o.song == null) throw new UsageError('init needs --song PATH');
      let bars = 4;
      if (o.bars != null) {
        if (!/^[0-9]+$/.test(o.bars) || Number(o.bars) < 1) throw new UsageError(`--bars must be a whole number >= 1, got "${o.bars}"`);
        bars = Number(o.bars);
      }
      const seq = initSequence(seqDir, { song: o.song, names: pos, bars });
      console.log(`sequence ready: ${seq.root}`);
      for (const c of seq.chapters) console.log(`  ${c.name}: ${c.bars} bars${c.from_start ? ' (from the start of the song)' : ''}`);
      console.log(`  next: node '${path.join(HERE, 'sequence.mjs')}' '${seq.root}' analyse`);
    },
  },
  analyse: { usage: 'analyse', loads: true, run: notYet('analyse') },
  check: { usage: 'check', loads: true, run: notYet('check') },
  render: { usage: 'render [--preview]', loads: true, run: notYet('render') },
  watch: { usage: 'watch CHAPTER', loads: true, run: notYet('watch') },
};

const USAGE = `usage: sequence.mjs SEQ <${Object.keys(COMMANDS).join('|')}> ...\n${Object.values(COMMANDS).map((c) => `  sequence.mjs SEQ ${c.usage}`).join('\n')}`;

export async function main(argv = process.argv.slice(2)) {
  const [seqDir, name, ...rest] = argv;
  const cmd = Object.hasOwn(COMMANDS, name ?? '') ? COMMANDS[name] : null;
  if (!seqDir || !cmd) throw new UsageError(seqDir && name ? `unknown command ${name}` : 'give SEQ and a command');
  const seq = cmd.loads ? loadSequence(seqDir) : null;
  await cmd.run(seqDir, rest, seq);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof UsageError) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
