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
//   analyse  the grid is chapter 1's: its song.json `sync` (set by ear with sync.mjs on chapter 1) is copied to every
//            other chapter first (a chapter whose own sync differed is warned about; with none on chapter 1, the
//            others' are removed). Then analyze_song.py runs on each chapter in order with its bars and fps: chapter 1
//            --from-start, --start-bar N or the analyser's own pick; chapter k>1 --start-bar = chapter k-1's
//            loop.start_bar + bars, so the windows abut. Prints `name: bars A-B, m:ss.s-m:ss.s` per chapter. The
//            analyser's `error:` is surfaced with the chapter's name (exit 2 when it exits 2).
//   check    each chapter's MOTION-BRIEF.md (when there is one) through check_brief, not as a loop; then that every
//            chapter is analysed with sequence.json's bars, starts where the previous one ends (within 1 ms), and has
//            chapter 1's bpm (unless a tempo map is in sync: each loop's bpm is then its own mean beat), sync and
//            fps. Errors exit 1.
//   render, watch: see the sequences spec (docs/superpowers/specs/2026-10-04-sequences-design.md).
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './render.mjs';
import { isMain } from './is_main.mjs';

const HERE = import.meta.dirname;
const NEW_PROJECT = path.join(HERE, 'new_project.sh');
const ANALYSER = path.join(HERE, 'analyze_song.py');
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
    if (RESERVED.includes(c.dir)) throw new UsageError(`${at}: chapter name ${show(c.dir)} is reserved for the sequence's renders (SEQ/${c.dir})`);
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

const childEnv = () => ({ ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` });

// The child's message: its last `error: ...` line (argparse prefixes the program name), else the tail of its stderr.
function childMessage(r, what = 'new_project.sh') {
  if (r.error) return `could not run ${what}: ${r.error.message}`;
  const lines = (r.stderr ?? '').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(?:\S+: )?error: (.*)$/.exec(lines[i]);
    if (m) return m[1];
  }
  return (r.stderr ?? '').trim().slice(-500) || `${what} exited with code ${r.status}`;
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
  const env = childEnv();
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

// A chapter's song.json, or null when it has none (or it does not parse: `bad` says why).
function readSong(dir) {
  const f = path.join(dir, 'song.json');
  if (!existsSync(f)) return { song: null, bad: null };
  try { return { song: JSON.parse(readFileSync(f, 'utf8')), bad: null }; } catch (e) { return { song: null, bad: `song.json is not valid JSON (${e.message})` }; }
}

// JSON with object keys sorted, so two sync sections compare by content.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const sameSync = (a, b) => canon(a ?? null) === canon(b ?? null);

// Seconds as m:ss.s (rounded to the tenth first, so 59.96 is 1:00.0).
export function clock(sec) {
  const tenths = Math.round(sec * 10), m = Math.floor(tenths / 600);
  return `${m}:${((tenths - m * 600) / 10).toFixed(1).padStart(4, '0')}`;
}

// Lines the chapters' loop windows up back to back on the song, on chapter 1's grid (see the header). Returns
// [{ name, start_bar, start_sec, duration_sec }] from each chapter's new song.json. `warn` gets each warning (a
// chapter's sync replaced or removed). A failing analyser throws (UsageError when it exits 2) naming the chapter; the
// chapters before it are already re-analysed.
export function analyseSequence(seq, { python = 'python3', warn = (m) => console.log(`warning: ${m}`) } = {}) {
  const [first, ...rest] = seq.chapters;
  const head = readSong(first.dir);
  if (head.bad) throw new UsageError(`${first.name}: ${head.bad}`);
  const sync = head.song?.sync;
  for (const c of rest) {
    const { song, bad } = readSong(c.dir);
    if (bad) throw new UsageError(`${c.name}: ${bad}`);
    if (song?.sync !== undefined && !sameSync(song.sync, sync)) {
      warn(sync === undefined ? `${c.name}'s sync was removed (${first.name} has none)` : `${c.name}'s sync was replaced by ${first.name}'s`);
    }
    if (song === null && sync === undefined) continue;
    const { sync: _old, ...keep } = song ?? {};
    writeFileSync(path.join(c.dir, 'song.json'), `${JSON.stringify(sync === undefined ? keep : { ...keep, sync }, null, 2)}
`);
  }
  const env = childEnv(), out = [];
  let prev = null;
  for (const c of seq.chapters) {
    const fps = readSong(c.dir).song?.fps;
    const args = [ANALYSER, seq.song, '--out', c.dir, '--bars', String(c.bars)];
    if (Number.isInteger(fps) && fps > 0) args.push('--fps', String(fps));
    if (prev) args.push('--start-bar', String(prev.start_bar + prev.bars));
    else if (c.from_start) args.push('--from-start');
    else if (c.start_bar !== undefined) args.push('--start-bar', String(c.start_bar));
    const r = spawnSync(python, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) {
      const msg = `${c.name}: ${childMessage(r, 'the analyser')}`;
      throw r.status === 2 ? new UsageError(msg) : new Error(msg);
    }
    const { loop } = JSON.parse(readFileSync(path.join(c.dir, 'song.json'), 'utf8'));
    out.push({ name: c.name, start_bar: loop.start_bar, start_sec: loop.start_sec, duration_sec: loop.duration_sec });
    prev = loop;
  }
  return out;
}

// Checks the chapters (see the header). Resolves { errors, warnings }, each line starting with the chapter's name.
// frameCheck: passed to checkBrief (tests stub it).
export async function checkSequence(seq, { frameCheck } = {}) {
  const errors = [], warnings = [];
  const { checkBrief } = await import('./check_brief.mjs');
  const songs = [];
  for (const c of seq.chapters) {
    const { song, bad } = readSong(c.dir);
    if (existsSync(path.join(c.dir, 'MOTION-BRIEF.md'))) {
      try {
        const r = await checkBrief(c.dir, { loop: false, ...(frameCheck ? { frameCheck } : {}) });
        errors.push(...r.errors.map((e) => `${c.name}: ${e}`));
        warnings.push(...r.warnings.map((w) => `${c.name}: ${w}`));
      } catch (e) { errors.push(`${c.name}: ${e.message}`); }
    }
    if (bad || !song) { errors.push(`${c.name}: ${bad ?? 'no song.json'} (run sequence.mjs SEQ analyse)`); songs.push(null); continue; }
    const L = song.loop;
    if (!L || !Number.isFinite(L.start_sec) || !Number.isFinite(L.duration_sec)) {
      errors.push(`${c.name}: song.json has no loop window (run sequence.mjs SEQ analyse)`); songs.push(null); continue;
    }
    if (L.bars !== c.bars) errors.push(`${c.name}: song.json has ${L.bars} bars, sequence.json says ${c.bars} (run sequence.mjs SEQ analyse)`);
    songs.push(song);
  }
  const [first] = seq.chapters, head = songs[0];
  for (let k = 1; k < songs.length; k++) {
    const s = songs[k], c = seq.chapters[k], p = songs[k - 1];
    if (!s) continue;
    if (p) {
      const gap = s.loop.start_sec - (p.loop.start_sec + p.loop.duration_sec);
      if (Math.abs(gap) >= 0.001) {
        errors.push(`${c.name} starts ${Math.abs(gap).toFixed(3)} s ${gap > 0 ? 'after' : 'before'} ${seq.chapters[k - 1].name} ends`);
      }
    }
    if (!head) continue;
    if (head.sync?.tempo_map == null && s.bpm !== head.bpm) errors.push(`${c.name}: bpm ${s.bpm} differs from ${first.name}'s ${head.bpm}`);
    if (!sameSync(s.sync, head.sync)) errors.push(`${c.name}: sync differs from ${first.name}'s (run sequence.mjs SEQ analyse to copy ${first.name}'s to every chapter)`);
    if (s.fps !== head.fps) errors.push(`${c.name}: fps ${s.fps} differs from ${first.name}'s ${head.fps}`);
  }
  return { errors, warnings };
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
  analyse: {
    usage: 'analyse',
    loads: true,
    run(seqDir, argv, seq) {
      parseFlags(argv);
      if (argv.length) throw new UsageError(`analyse takes no arguments, got "${argv[0]}"`);
      const chapters = analyseSequence(seq, { python: process.env.MK_ANALYSER_PYTHON || undefined });
      chapters.forEach((r, k) => {
        const bars = seq.chapters[k].bars;
        console.log(`${r.name}: bars ${r.start_bar}-${r.start_bar + bars - 1}, ${clock(r.start_sec)}-${clock(r.start_sec + r.duration_sec)}`);
      });
    },
  },
  check: {
    usage: 'check',
    loads: true,
    async run(seqDir, argv, seq) {
      parseFlags(argv);
      if (argv.length) throw new UsageError(`check takes no arguments, got "${argv[0]}"`);
      const { errors, warnings } = await checkSequence(seq);
      for (const w of warnings) console.log(`warning: ${w}`);
      for (const e of errors) console.error(`error: ${e}`);
      if (errors.length) {
        console.error(`sequence has ${errors.length} error(s)`);
        process.exitCode = 1;
        return;
      }
      const songs = seq.chapters.map((c) => readSong(c.dir).song.loop), last = songs.at(-1);
      console.log(`sequence OK: ${songs.length} chapters, ${clock(songs[0].start_sec)}-${clock(last.start_sec + last.duration_sec)}`);
    },
  },
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
