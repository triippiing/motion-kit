#!/usr/bin/env node
// story_facts.mjs -- reads a source (a repo, for now) and writes its facts file, the input Claude drafts STORY.md from.
//
//   node story_facts.mjs <kind> SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out FILE
//
// <kind> picks the reader in SOURCES (repo: a local git work tree or a GitHub URL). The facts get source.command,
// the canonical command line that re-creates them (the resolved flags, without --out; --intro, the default, is
// never written), are validated and written to FILE (see facts.mjs; missing directories are created). Bad input
// exits 2, a failure while reading exits 1. parseCommand(source.command) gives that command back as argv (no shell
// needed to run it).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain } from '../../motion-video/scripts/is_main.mjs';
import { UsageError, writeFacts } from './facts.mjs';
import { notSource, readRepo } from './sources/repo.mjs';

const USAGE = 'usage: story_facts.mjs <kind> SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out FILE';

// A mistake in the arguments themselves: the only error the usage line is printed after.
class ArgError extends UsageError {}

// The readers: (source, flags) => facts (or a promise of them), source.command left for the CLI to set.
export const SOURCES = {
  repo: (src, { release, pr }) => readRepo(src, { story: release != null ? 'release' : pr != null ? 'pr' : 'intro', release, pr }),
};

// The flags, in the order the canonical command lists them: true for a switch, false for one taking a value.
const FLAGS = { intro: true, release: false, pr: false };
const DEFAULT = 'intro'; // the story with no flag: accepted, never written into the command

// A shell word for s: as it is when it is plain, else single-quoted.
const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

// The command line that re-creates the facts: the script by name, the kind, SOURCE and the set flags in FLAGS order
// (the default story's flag left out, so the same facts always get the same command).
export function commandLine(kind, source, flags = {}) {
  const words = ['story_facts.mjs', kind, source];
  for (const [k, isSwitch] of Object.entries(FLAGS)) {
    if (k === DEFAULT) continue;
    if (isSwitch ? flags[k] === true : flags[k] != null) words.push(`--${k}`, ...(isSwitch ? [] : [String(flags[k])]));
  }
  return words.map(quote).join(' ');
}

// A command line as commandLine writes it, split back into its words: whitespace separates words, '...' is taken
// literally ('\'' is a quote inside one), a backslash outside quotes escapes the next character.
export function parseCommand(line) {
  const words = [];
  let word = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error(`unterminated quote in: ${line}`);
      word = (word ?? '') + line.slice(i + 1, end);
      i = end;
    } else if (c === '\\' && i + 1 < line.length) {
      word = (word ?? '') + line[++i];
    } else if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? '') + c;
  }
  if (word !== null) words.push(word);
  return words;
}

export function parseArgs(argv) {
  const pos = [], flags = {};
  let out;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k !== 'out' && !(k in FLAGS)) throw new ArgError(`unknown option ${a}`);
    if (FLAGS[k] === true) { flags[k] = true; continue; }
    const v = argv[++i];
    if (v == null || v.startsWith('--')) throw new ArgError(`${a} needs a value`);
    if (k === 'out') out = v; else flags[k] = v;
  }
  if (pos.length === 0) throw new ArgError(USAGE);
  const [kind, source] = pos;
  if (!Object.hasOwn(SOURCES, kind)) throw new ArgError(`unknown source kind "${kind}" (kinds: ${Object.keys(SOURCES).join(', ')})`);
  if (pos.length !== 2) throw new ArgError(USAGE);
  if (!source.trim()) throw new ArgError('SOURCE is empty: give a local path or a GitHub URL');
  if (out == null) throw new ArgError('--out FILE is required');
  const story = Object.keys(FLAGS).filter((k) => flags[k] != null);
  if (story.length > 1) throw new ArgError(`pass one of ${story.map((k) => `--${k}`).join(', ')}, not ${story.length}`);
  return { kind, source, flags, out };
}

// SOURCE as the command records it: a URL as given, a local path made absolute. A remote address without a scheme
// (git@github.com:o/r, github.com/o/r) is refused rather than read as a path, unless a path of that name exists.
export function resolveSource(s) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!existsSync(s) && (/^[\w.-]+@[\w.-]+:/.test(s) || /^(www\.)?github\.com\//i.test(s))) throw new UsageError(notSource(s));
  return path.resolve(s);
}

async function main() {
  const { kind, source, flags, out } = parseArgs(process.argv.slice(2));
  const src = resolveSource(source);
  const facts = await SOURCES[kind](src, flags);
  facts.source = { ...facts.source, command: commandLine(kind, src, flags) };
  const f = writeFacts(out, facts);
  console.log(`${out}: ${f.items.length} items (${f.source.kind}, ${f.source.story})`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    if (e instanceof ArgError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
