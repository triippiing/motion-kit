#!/usr/bin/env node
// story_facts.mjs -- reads a source (a repo, for now) and writes its facts file, the input Claude drafts STORY.md from.
//
//   node story_facts.mjs <kind> SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out FILE
//
// <kind> picks the reader in SOURCES (repo: a local git work tree or a GitHub URL). The facts get source.command,
// the canonical command line that re-creates them (the resolved flags, without --out), are validated and written
// to FILE (see facts.mjs). Bad input exits 2, a failure while reading exits 1.
import path from 'node:path';
import { isMain } from '../../motion-video/scripts/is_main.mjs';
import { UsageError, writeFacts } from './facts.mjs';

const USAGE = 'usage: story_facts.mjs <kind> SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out FILE';

// The readers: (source, flags) => facts (or a promise of them), source.command left for the CLI to set.
export const SOURCES = {
  repo: () => { throw new UsageError('repo reader not built yet'); },
};

// The flags, in the order the canonical command lists them: true for a switch, false for one taking a value.
const FLAGS = { intro: true, release: false, pr: false };

// A shell word for s: as it is when it is plain, else single-quoted.
const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

// The command line that re-creates the facts: the script by name, the kind, SOURCE and the set flags in FLAGS order.
export function commandLine(kind, source, flags = {}) {
  const words = ['story_facts.mjs', kind, source];
  for (const [k, isSwitch] of Object.entries(FLAGS)) {
    if (isSwitch ? flags[k] === true : flags[k] != null) words.push(`--${k}`, ...(isSwitch ? [] : [String(flags[k])]));
  }
  return words.map(quote).join(' ');
}

export function parseArgs(argv) {
  const pos = [], flags = {};
  let out;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k !== 'out' && !(k in FLAGS)) throw new UsageError(`unknown option ${a}`);
    if (FLAGS[k] === true) { flags[k] = true; continue; }
    const v = argv[++i];
    if (v == null || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
    if (k === 'out') out = v; else flags[k] = v;
  }
  if (pos.length === 0) throw new UsageError(USAGE);
  const [kind, source] = pos;
  if (!Object.hasOwn(SOURCES, kind)) throw new UsageError(`unknown source kind "${kind}" (kinds: ${Object.keys(SOURCES).join(', ')})`);
  if (pos.length !== 2) throw new UsageError(USAGE);
  if (out == null) throw new UsageError('--out FILE is required');
  const story = Object.keys(FLAGS).filter((k) => flags[k] != null);
  if (story.length > 1) throw new UsageError(`pass one of ${story.map((k) => `--${k}`).join(', ')}, not ${story.length}`);
  return { kind, source, flags, out };
}

// SOURCE as the command records it: a URL as given, a local path made absolute.
const resolveSource = (s) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : path.resolve(s));

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
    if (e instanceof UsageError && !e.message.startsWith('usage:')) console.error(USAGE);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
