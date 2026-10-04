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
//   analyse  the grid is chapter 1's: its song.json `sync` grid (nudge, tempo, meter, swing, pickup...; set by ear with
//            sync.mjs on chapter 1) is copied to every other chapter first, and the markers (song time) placed on any
//            chapter's sync page are merged by name into every chapter's (a name with two times keeps chapter 1's,
//            else the earlier chapter's, with a warning). A chapter whose sync changes keeps its old song.json as
//            song.json.bak; one whose own grid differed is warned about (with none on chapter 1, it is removed). Then analyze_song.py runs on each chapter in order with its bars and fps: chapter 1
//            --from-start, --start-bar N or the analyser's own pick; chapter k>1 --start-bar = chapter k-1's
//            loop.start_bar + bars, so the windows abut. Prints `name: bars A-B, m:ss.s-m:ss.s` per chapter. The
//            analyser's `error:` is surfaced with the chapter's name (exit 2 when it exits 2).
//   check    each chapter's MOTION-BRIEF.md (when there is one) through check_brief, not as a loop; then that every
//            chapter is analysed with sequence.json's bars, starts where the previous one ends (within 1 ms), and has
//            chapter 1's bpm (unless a tempo map is in sync: each loop's bpm is then its own mean beat) and fps, and
//            the sequence's sync (chapter 1's grid, every chapter's markers, as analyse writes it). Errors exit 1.
//   render [--preview] [--stage WxH]
//            first checks that every chapter is analysed, starts where the previous one ends and shares chapter 1's
//            fps and stage size (project.json's; --stage overrides them all), exit 2 otherwise; then renders each
//            chapter whose render is stale (render.mjs; its .render.json stamp decides, as export does) and joins:
//            the chapter videos concatenated (stream copy), over ONE cut of the song from chapter 1's start for the
//            whole length (analyze_song's clip writer: 10 ms fades at the very ends only, plus fade_out_sec at the
//            end), mixed with each chapter's sounds (window.SFX) at its offset. Writes SEQ/out/sequence.mp4 (or
//            SEQ/out/shapes/WxH/sequence.mp4) and a stamp beside it listing each chapter's stamp. Prints
//            `name: rendered|reused` per chapter, then the output path.
//   watch: see the sequences spec (docs/superpowers/specs/2026-10-04-sequences-design.md).
import { execFile, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { FFMPEG, UsageError, newestSource, openProject, parseStage, render, renderStamp, rendererId, sfxInputs, stampPath } from './render.mjs';
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
// The sequence's sync from each chapter's ({ name, sync }, in order): the grid fields (everything but markers) are
// chapter 1's; markers (song time) are merged by name across the chapters, in chapter order. A name with two times
// keeps the first (chapter 1's, else the earlier chapter's) and warns. Returns { sync (undefined when there is
// nothing), warnings }.
export function mergeSync(chapters) {
  const warnings = [], markers = [], by = new Map();
  for (const { name, sync } of chapters) {
    for (const m of sync?.markers ?? []) {
      const had = by.get(m.name);
      if (!had) { by.set(m.name, { from: name, m }); markers.push(m); continue; }
      if (Math.abs(had.m.t - m.t) >= 1e-6) {
        warnings.push(`marker ${show(m.name)}: ${had.from} has it at ${had.m.t.toFixed(3)} s, ${name} at ${m.t.toFixed(3)} s; keeping ${had.from}'s`);
      }
    }
  }
  const { markers: _m, ...grid } = chapters[0]?.sync ?? {};
  const sync = markers.length ? { ...grid, markers } : grid;
  return { sync: Object.keys(sync).length || chapters[0]?.sync !== undefined ? sync : undefined, warnings };
}

const gridOf = (sync) => { const { markers: _m, ...g } = sync ?? {}; return g; };

// Lines the chapters' loop windows up back to back on the song, on chapter 1's grid (see the header). Returns
// [{ name, start_bar, start_sec, duration_sec }] from each chapter's new song.json. `warn` gets each warning (a
// chapter's grid replaced or removed, a marker clash). A chapter whose sync changes keeps its old song.json as
// song.json.bak (as sync.mjs Save does). A failing analyser throws (UsageError when it exits 2) naming the chapter;
// the chapters before it are already re-analysed.
export function analyseSequence(seq, { python = 'python3', warn = (m) => console.log(`warning: ${m}`) } = {}) {
  const [first] = seq.chapters;
  const songs = seq.chapters.map((c) => {
    const { song, bad } = readSong(c.dir);
    if (bad) throw new UsageError(`${c.name}: ${bad}`);
    return song;
  });
  const { sync, warnings } = mergeSync(seq.chapters.map((c, k) => ({ name: c.name, sync: songs[k]?.sync })));
  seq.chapters.forEach((c, k) => {
    const song = songs[k];
    if (sameSync(song?.sync, sync)) return;
    const file = path.join(c.dir, 'song.json'), bak = `${file}.bak`;
    if (song) writeFileSync(bak, readFileSync(file));
    if (k > 0 && song?.sync !== undefined && !sameSync(gridOf(song.sync), gridOf(sync))) {
      const what = Object.keys(gridOf(songs[0]?.sync)).length ? `was replaced by ${first.name}'s` : `was removed (${first.name} has none)`;
      warn(`${c.name}'s sync ${what} (old song.json kept as ${bak})`);
    }
    const { sync: _old, ...keep } = song ?? {};
    writeFileSync(file, `${JSON.stringify(sync === undefined ? keep : { ...keep, sync }, null, 2)}\n`);
  });
  for (const w of warnings) warn(w);
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
  const merged = mergeSync(seq.chapters.map((c, k) => ({ name: c.name, sync: songs[k]?.sync })));
  warnings.push(...merged.warnings);
  seq.chapters.forEach((c, k) => {
    if (songs[k] && !sameSync(songs[k].sync, merged.sync)) {
      errors.push(`${c.name}: sync differs from the sequence's (${first.name}'s grid, every chapter's markers): run sequence.mjs SEQ analyse`);
    }
  });
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
    if (s.fps !== head.fps) errors.push(`${c.name}: fps ${s.fps} differs from ${first.name}'s ${head.fps}`);
  }
  return { errors, warnings };
}

// ---- render ----

const run = promisify(execFile);
async function ffmpeg(args, what) {
  try { await run(FFMPEG, args, { maxBuffer: 64 << 20 }); } catch (e) {
    throw new Error(`${what}: ffmpeg ${String(e.stderr || e.message).trim().slice(-800)}`);
  }
}
const sameStamp = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A chapter's stage: `stage` when given, else its project.json's (the template's 1440x1440 when it has none).
function chapterStage(dir, stage) {
  if (stage) return stage;
  let proj = {};
  try { proj = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') throw new UsageError(`${path.basename(dir)}: project.json is not valid JSON (${e.message})`);
  }
  const s = proj.stage ?? { width: 1440, height: 1440 };
  return [s.width, s.height];
}

// The chapter render's file (render.mjs's default output) and whether its stamp says it is current: made by this
// renderer with these settings, from sources no older than the chapter's files now (export.mjs's reusableRender rule,
// for previews too).
async function chapterRender(dir, song, { stage, preview, override }) {
  const base = override ? path.join(dir, 'out', 'shapes', override.join('x')) : path.join(dir, 'out');
  const file = path.join(base, preview ? 'preview.mp4' : 'video.mp4');
  if (!existsSync(file) || !existsSync(stampPath(file))) return { file, fresh: false };
  let stamp;
  try { stamp = JSON.parse(await readFile(stampPath(file), 'utf8')); } catch { return { file, fresh: false }; }
  const { sources, ...made } = stamp ?? {};
  const { sources: _s, ...want } = await renderStamp(dir, { stage, sub: preview ? 1 : 4, preview, song });
  return { file, fresh: sameStamp(made, want) && Number(sources) >= await newestSource(dir) };
}

// Everything render needs to know before it renders anything: each chapter's song.json, stage and fps agree, and the
// windows abut. Throws UsageError naming the chapter.
function preflight(seq, override) {
  const [first] = seq.chapters;
  const out = seq.chapters.map((c) => {
    const { song, bad } = readSong(c.dir);
    if (bad || !song) throw new UsageError(`${c.name}: ${bad ?? 'no song.json'} (run sequence.mjs SEQ analyse)`);
    const L = song.loop;
    if (!L || !Number.isFinite(L.start_sec) || !Number.isFinite(L.duration_sec) || !(L.frames > 0)) {
      throw new UsageError(`${c.name}: song.json has no loop window (run sequence.mjs SEQ analyse)`);
    }
    return { ...c, song, stage: chapterStage(c.dir, override) };
  });
  out.forEach((c, k) => {
    if (k === 0) return;
    const h = out[0], p = out[k - 1];
    if (c.stage.join('x') !== h.stage.join('x')) throw new UsageError(`${c.name}: stage ${c.stage.join('x')} differs from ${first.name}'s ${h.stage.join('x')}`);
    if (c.song.fps !== h.song.fps) throw new UsageError(`${c.name}: fps ${c.song.fps} differs from ${first.name}'s ${h.song.fps}`);
    const gap = c.song.loop.start_sec - (p.song.loop.start_sec + p.song.loop.duration_sec);
    if (Math.abs(gap) >= 0.001) {
      throw new UsageError(`${c.name} starts ${Math.abs(gap).toFixed(3)} s ${gap > 0 ? 'after' : 'before'} ${p.name} ends (run sequence.mjs SEQ analyse)`);
    }
  });
  return out;
}

// A chapter's sound cues (window.SFX), read from its page.
async function chapterSfx(c, override) {
  const proj = await openProject(c.dir, { workers: 1, stage: override });
  try {
    const sfx = await proj.pages[0].evaluate(() => window.SFX || []);
    if (proj.errors.length) throw proj.errors[0];
    for (const x of sfx) if (!existsSync(path.join(c.dir, x.file))) throw new Error(`${c.name}: SFX file not found: ${x.file} (listed in window.SFX)`);
    return sfx;
  } finally { await proj.close(); }
}

const concatLine = (f) => `file '${f.replace(/'/g, "'\\''")}'`;

// Renders the sequence (see the header) and returns the joined file. `stage` [w, h] renders every chapter at that size
// (render.mjs --stage) into SEQ/out/shapes/WxH/. `log` gets `name: rendered|reused` per chapter.
export async function renderSequence(seq, { preview = false, stage, workers, log = console.log } = {}) {
  const chapters = preflight(seq, stage);
  const fps = chapters[0].song.fps, size = chapters[0].stage;
  for (const c of chapters) {
    const r = await chapterRender(c.dir, c.song, { stage: c.stage, preview, override: stage });
    if (r.fresh) c.file = r.file;
    else c.file = await render(c.dir, { preview, stage, ...(workers ? { workers } : {}) });
    c.stamp = JSON.parse(await readFile(stampPath(c.file), 'utf8'));
    log(`${c.name}: ${r.fresh ? 'reused' : 'rendered'}`);
  }

  // The song cut: from chapter 1's start to the last chapter's end (song time); each chapter's sounds at its start.
  const start = chapters[0].song.loop.start_sec, last = chapters.at(-1).song.loop;
  const T = last.start_sec + last.duration_sec - start;
  const fade = Math.min(seq.fade_out_sec, T);
  const af = [`apad=whole_dur=${T.toFixed(6)}`, 'afade=t=in:d=0.01', `afade=t=out:st=${(T - 0.01).toFixed(6)}:d=0.01`,
    ...(fade > 0 ? [`afade=t=out:st=${(T - fade).toFixed(6)}:d=${fade.toFixed(6)}`] : []), 'aresample=48000', 'aformat=channel_layouts=stereo'];
  const inputs = [], filters = [], labels = [];
  for (const [k, c] of chapters.entries()) {
    const sfx = await chapterSfx(c, stage);
    const s = sfxInputs(c.dir, c.song, sfx, 0, c.song.loop.duration_sec, { at: c.song.loop.start_sec - start, first: 2 + inputs.length / 2, tag: `c${k}s` });
    inputs.push(...s.inputs); filters.push(...s.filters); labels.push(...s.labels);
  }

  const outDir = stage ? path.join(seq.root, 'out', 'shapes', stage.join('x')) : path.join(seq.root, 'out');
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, 'sequence.mp4'), part = path.join(outDir, 'sequence.part.mp4');
  const tmp = await mkdtemp(path.join(outDir, '.join-'));
  try {
    // Each chapter's video stream alone (stream copy: the concat demuxer would otherwise start the video late by
    // the AAC priming of the chapter's audio), back to back; `duration` is its frames at fps.
    const parts = [];
    for (const [k, c] of chapters.entries()) {
      const v = path.join(tmp, `${k}.mp4`);
      await ffmpeg(['-y', '-v', 'error', '-i', c.file, '-map', '0:v', '-c', 'copy', v], `could not read ${c.name}'s render`);
      parts.push(`${concatLine(v)}\nduration ${(c.song.loop.frames / fps).toFixed(6)}\n`);
    }
    const list = path.join(tmp, 'chapters.txt');
    await writeFile(list, parts.join(''));
    const graph = `[1:a]${af.join(',')}[song];${filters.length ? `${filters.join(';')};[song]${labels.join('')}amix=inputs=${labels.length + 1}:normalize=0:duration=first[a]` : '[song]anull[a]'}`;
    const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-ss', start.toFixed(6), '-t', T.toFixed(6), '-i', seq.song, ...inputs,
      '-filter_complex', graph, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
      '-movflags', '+faststart', part];
    await ffmpeg(args, 'could not join the chapters');
    await rm(stampPath(out), { force: true });
    await rename(part, out);
    const stamp = { preview, stage: size, fps, fade_out_sec: seq.fade_out_sec, song: seq.song,
      cut: { start_sec: start, duration_sec: T }, frames: chapters.reduce((a, c) => a + c.song.loop.frames, 0),
      renderer: await rendererId(seq.root),
      chapters: chapters.map((c) => ({ name: c.name, file: path.relative(seq.root, c.file), stamp: c.stamp })) };
    await writeFile(stampPath(out), `${JSON.stringify(stamp, null, 2)}\n`);
    return out;
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await rm(part, { force: true });
  }
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
  render: {
    usage: 'render [--preview] [--stage WxH]',
    loads: true,
    async run(seqDir, argv, seq) {
      const { o, pos } = parseFlags(argv, { bool: ['preview'], valued: ['stage'] });
      if (pos.length) throw new UsageError(`render takes no arguments, got "${pos[0]}"`);
      console.log(await renderSequence(seq, { preview: !!o.preview, stage: o.stage == null ? undefined : parseStage(o.stage) }));
    },
  },
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
