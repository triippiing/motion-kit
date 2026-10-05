// repo.mjs -- the repo reader: a git work tree (a GitHub URL comes in Task 3) to facts.
//
//   readRepo(source, { story: 'intro'|'release'|'pr', release?: TAG|'latest', pr?: BRANCH }) -> facts (no source.command)
//
// intro: the README (parseReadme), the commit count on HEAD and the GitHub url of origin. release: the commits
// between TAG and its predecessor, first parent only, grouped by their conventional prefix. pr: a branch's commits
// that are not on the default branch (origin/HEAD, else main, else master), with its diff stats.
// Git runs as `git -C PATH ...` through execFile (never a shell) with the caller's GIT_DIR and friends removed.
// Bad input (not a work tree, no README, no tags, an unknown tag or branch) is a UsageError; a git failure an Error.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_ITEMS, UsageError } from '../facts.mjs';
import { parseReadme } from './readme.mjs';

const run = promisify(execFile);

export const notSource = (s) => `"${s}" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)`;
export const NO_TAGS = 'no tags: tag a release first, or use --intro';
const README_NAMES = ['README.md', 'readme.md', 'README'];

// env vars that would point git somewhere other than -C PATH
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/.test(k)));

// git's stdout for args run in dir; null when it fails and quiet is set, else an Error with git's first line.
async function git(dir, args, { quiet = false } = {}) {
  try {
    const { stdout } = await run('git', ['-c', 'core.quotepath=off', '-c', 'log.showSignature=false',
      '-c', 'i18n.logOutputEncoding=UTF-8', '-C', dir, ...args], { env, encoding: 'utf8', maxBuffer: 256 << 20 });
    return stdout;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('git not found: install git');
    if (quiet) return null;
    throw new Error(`git ${args[0]} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}

// The https URL of a GitHub remote (https, ssh or scp-like), else undefined.
export function githubUrl(remote) {
  const m = /^(?:(?:https?|git):\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remote ?? '');
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

// --- versions -------------------------------------------------------------------------------------------------

const VERSION = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i;
const parseVersion = (tag) => {
  const m = VERSION.exec(tag);
  return m && { nums: m[1].split('.').map(Number), pre: m[2] ? m[2].split('.') : null };
};
export const isVersion = (tag) => VERSION.test(tag);

// Orders version tags: an optional leading v, dot-separated numbers compared as numbers (1.2 = 1.2.0), and a
// pre-release (-rc.1) before its release, its parts compared as semver does (numbers numerically, before words).
// Both must be versions: callers filter with isVersion first.
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (!x.pre || !y.pre) return (x.pre ? -1 : 0) + (y.pre ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q)); continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// The highest of tags by version (ties by name), so the pick never depends on the input order.
const highest = (tags) => [...tags].sort((a, b) => compareVersions(a, b) || (a < b ? -1 : a > b ? 1 : 0)).at(-1);

// latest: the highest version tag; with no version tags, the newest by creation date. byDate is oldest first.
export function latestTag(byDate) {
  const versions = byDate.filter(isVersion);
  return versions.length ? highest(versions) : byDate.at(-1);
}

// The tag before tag among merged (the tags reachable from it, oldest first): for a version tag the highest
// lower version (other tags ignored); for any other tag the one created just before it. undefined when none.
export function predecessor(tag, merged) {
  if (isVersion(tag)) return highest(merged.filter((t) => isVersion(t) && compareVersions(t, tag) < 0));
  const before = merged.slice(0, Math.max(0, merged.indexOf(tag))).filter((t) => t !== tag);
  return before.at(-1);
}

// --- commits --------------------------------------------------------------------------------------------------

// conventional type -> [tag, rank]; items are ordered by rank (features, fixes, docs, other, changes, chores)
const TYPES = {
  feat: ['feature', 0], feature: ['feature', 0], fix: ['fix', 1], docs: ['docs', 2], doc: ['docs', 2],
  refactor: ['change', 4], perf: ['change', 4], chore: ['change', 5], build: ['change', 5], ci: ['change', 5], test: ['change', 5],
};
const OTHER = ['other', 3];
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:\s*(\S.*)$/;

// A subject's item: a known conventional prefix (scope and "!" included) sets the tag and is stripped.
function commitItem(subject) {
  const m = CONVENTIONAL.exec(subject.trim());
  const type = m && Object.hasOwn(TYPES, m[1].toLowerCase()) ? TYPES[m[1].toLowerCase()] : null;
  return type ? { label: m[2].trim(), tag: type[0], rank: type[1] } : { label: subject.trim(), tag: OTHER[0], rank: OTHER[1] };
}

// Subjects (oldest first) to items: grouped by rank, commit order kept within a group, at most MAX_ITEMS.
export function groupCommits(subjects) {
  return subjects.map(commitItem).filter((it) => it.label)
    .sort((a, b) => a.rank - b.rank).slice(0, MAX_ITEMS).map(({ label, tag }) => ({ label, tag }));
}

// The commits git log lists for args, oldest first: { author, subject, body }. A merge's subject is its body's first
// line: a GitHub "Merge pull request #N from x/y" carries the PR title there; a merge with no body (Merge branch
// 'x') gets an empty subject, so it lists no item but still counts.
async function commits(dir, args) {
  const out = await git(dir, ['log', '--reverse', '--format=%an%x1f%P%x1f%s%x1f%b%x1e', ...args, '--']);
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [author, parents, subject, body] = r.split('\x1f');
    const first = body.split('\n').map((l) => l.trim()).find(Boolean);
    const merge = parents.trim().split(' ').length > 1;
    return { author, body, subject: merge ? first ?? '' : subject };
  });
}

// --- the stories ----------------------------------------------------------------------------------------------

async function intro(dir, top, name) {
  const names = readdirSync(top).filter((n) => { try { return statSync(path.join(top, n)).isFile(); } catch { return false; } }).sort();
  const file = README_NAMES.find((n) => names.includes(n)) ?? names.find((n) => /^readme(\.md)?$/i.test(n));
  if (!file) throw new UsageError(`no README in ${top} (${README_NAMES.slice(0, -1).join(', ')} or ${README_NAMES.at(-1)})`);
  const r = parseReadme(readFileSync(path.join(top, file), 'utf8'));
  const head = await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], { quiet: true });
  const count = head ? Number((await git(dir, ['rev-list', '--count', 'HEAD'])).trim()) : 0;
  return {
    title: r.title || name,
    subtitle: r.subtitle,
    items: r.items.slice(0, MAX_ITEMS),
    stats: { commits: count },
    links: r.install ? { install: r.install } : {},
    media: r.media.length ? r.media : undefined,
  };
}

// The tags, oldest first by creation date (ties by name), optionally only those reachable from a ref.
async function tags(dir, merged) {
  const out = await git(dir, ['for-each-ref', '--sort=refname', '--sort=creatordate', '--format=%(refname)',
    ...(merged ? [`--merged=${merged}`] : []), 'refs/tags']);
  return out.split('\n').filter(Boolean).map((r) => r.slice('refs/tags/'.length));
}

async function release(dir, name, want) {
  const all = await tags(dir);
  if (!all.length) throw new UsageError(NO_TAGS);
  const tag = want === 'latest' ? latestTag(all) : want;
  if (!all.includes(tag)) throw new UsageError(`no tag "${tag}" in ${dir}`);
  const prev = predecessor(tag, await tags(dir, `refs/tags/${tag}`));
  const list = await commits(dir, ['--first-parent', prev ? `refs/tags/${prev}..refs/tags/${tag}` : `refs/tags/${tag}`]);
  return {
    title: `${name} ${tag}`,
    items: groupCommits(list.map((c) => c.subject)),
    stats: { commits: list.length, contributors: new Set(list.map((c) => c.author)).size },
  };
}

const exists = async (dir, ref) => (await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { quiet: true })) != null;

// The default branch to compare with: origin/HEAD, else main, else master, as [ref, short name].
async function defaultBranch(dir) {
  const origin = (await git(dir, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { quiet: true }))?.trim();
  if (origin && await exists(dir, origin)) return [origin, origin.replace(/^refs\/remotes\//, '')];
  for (const b of ['main', 'master']) if (await exists(dir, `refs/heads/${b}`)) return [`refs/heads/${b}`, b];
  return null;
}

async function pr(dir, want) {
  const v = String(want);
  let ref;
  if (await exists(dir, `refs/heads/${v}`)) ref = `refs/heads/${v}`;
  else if (/^#?\d+$/.test(v)) throw new UsageError(`--pr ${v}: pull request numbers need a GitHub URL; on a local clone pass a branch (--pr BRANCH)`);
  else if (!v.startsWith('-') && await exists(dir, v)) ref = v;
  else throw new UsageError(`no branch "${v}" in ${dir}`);
  const base = await defaultBranch(dir);
  if (!base) throw new UsageError(`no default branch to compare ${v} with (no origin/HEAD, main or master)`);
  const list = await commits(dir, ['--no-merges', `${base[0]}..${ref}`]);
  if (!list.length) throw new UsageError(`${v} has no commits that are not on ${base[1]}`);
  const numstat = await git(dir, ['diff', '--numstat', `${base[0]}...${ref}`]);
  const stats = { commits: list.length, files: 0, additions: 0, deletions: 0 };
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d] = line.split('\t');
    stats.files++;
    stats.additions += Number(a) || 0; // a binary file shows "-"
    stats.deletions += Number(d) || 0;
  }
  const para = list[0].body.split(/\n\s*\n/).map((p) => p.trim()).find(Boolean);
  return {
    title: commitItem(list[0].subject).label,
    subtitle: para,
    items: groupCommits(list.map((c) => c.subject)),
    stats,
  };
}

export async function readRepo(source, { story = 'intro', release: rel, pr: branch } = {}) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    if (/^https:\/\/(www\.)?github\.com\//i.test(source)) throw new UsageError('GitHub URLs: not built yet');
    throw new UsageError(notSource(source));
  }
  const top = (await git(source, ['rev-parse', '--show-toplevel'], { quiet: true }))?.trim();
  if (!top) throw new UsageError(`not a git work tree: ${source}`);
  const remote = (await git(source, ['config', '--get', 'remote.origin.url'], { quiet: true }))?.trim();
  const url = githubUrl(remote);
  const name = url ? url.split('/').at(-1) : path.basename(top);
  const facts = story === 'release' ? await release(source, name, rel)
    : story === 'pr' ? await pr(source, branch)
    : await intro(source, top, name);
  if (url) facts.links = { ...facts.links, url };
  if (facts.links && !Object.keys(facts.links).length) delete facts.links;
  return { version: 1, source: { kind: 'repo', ref: source, story }, ...facts };
}
