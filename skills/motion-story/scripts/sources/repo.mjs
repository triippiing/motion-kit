// repo.mjs -- the repo reader: a git work tree or a GitHub URL to facts.
//
//   readRepo(source, { story: 'intro'|'release'|'pr', release?: TAG|'latest', pr?: BRANCH|N }) -> facts (no source.command)
//
// intro: the README (parseReadme), the commit count on HEAD and the GitHub url of origin. release: the commits
// between TAG and its predecessor, first parent only, grouped by their conventional prefix (stats count every
// commit in the range). pr: a branch's commits that are not on the default branch (origin/HEAD, else main, else
// master), with its diff stats.
// Git runs as `git -C PATH ...` through execFile (never a shell) with the caller's GIT_DIR and friends removed.
// Bad input (not a work tree, no README, no tags, an unknown tag or branch) is a UsageError; a git failure an Error.
//
// A GitHub URL (https://github.com/OWNER/REPO, see github.mjs; any other URL is bad input) is read through the API
// with read-only GETs, aiming at the facts a local clone of the same repo gives:
// - intro: the readme endpoint's README; stats.stars and stats.forks (no commit count); the repo description when
//   the README has no subtitle; links.url the repo's html_url.
// - release: the tags endpoint (100 a page, up to 10 pages; listed newest first, which stands in for creation
//   order when there are no version tags). latest is picked as locally (never GitHub's releases/latest). The
//   predecessor is the highest lower version among all the tags whose compare says it is an ancestor of TAG
//   (status ahead or identical; up to 5 tried), as the local reader takes it among the tags reachable from TAG.
//   When a GitHub release for TAG has bullets, they are the items: a bullet's tag comes from its heading
//   (Features/Added/New -> feature, Fixes/Fixed -> fix, Changed -> change, Docs -> docs; not "What's Changed"),
//   else its conventional prefix, else other; credit sections (New Contributors) are skipped. Otherwise the items
//   are compare's commits, walked first-parent from the tag's commit (exactly git log --first-parent prev..TAG),
//   merges giving their PR titles. Stats always come from compare: commits = the non-merge commits, contributors =
//   the distinct author names (mergers included). Compare lists at most 250 commits: past that, items and stats
//   cover only the listed ones (a warning says so; a local clone reads them all). With no predecessor the commits
//   endpoint (sha=TAG, up to 1000 commits) stands in for compare.
// - pr N (a number, optionally #N; a branch needs a local clone): the PR's title (conventional prefix stripped)
//   and its body's first paragraph; items are the body's top-level bullets, else the PR's non-merge commit
//   subjects; tag: the bullet's heading, else its conventional prefix, else the labels' hint (bug -> fix,
//   enhancement/feature -> feature), else other. stats: files, additions, deletions from the PR, commits and
//   contributors from its commits (as for a release).
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_ITEMS, UsageError } from '../facts.mjs';
import { api, pages, parseGithubUrl } from './github.mjs';
import { bulletItem, parseNotes, parseReadme } from './readme.mjs';

const run = promisify(execFile);

export const notSource = (s) => `"${s}" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)`;
export const NO_TAGS = 'no tags: tag a release first, or use --intro';
const README_NAMES = ['README.md', 'readme.md', 'README'];
const noReadme = (where) => `no README in ${where} (${README_NAMES.slice(0, -1).join(', ')} or ${README_NAMES.at(-1)})`;

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

// latest: the highest release version tag (pre-releases skipped, as GitHub's releases/latest does, unless every
// version tag is one); with no version tags, the newest by creation date. byDate is oldest first.
export function latestTag(byDate) {
  const versions = byDate.filter(isVersion);
  const releases = versions.filter((t) => !parseVersion(t).pre);
  return versions.length ? highest(releases.length ? releases : versions) : byDate.at(-1);
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
const RANK = { feature: 0, fix: 1, docs: 2, other: 3, change: 4 }; // a tag set by anything but a prefix
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:\s*(\S.*)$/;

// A known conventional prefix's [type, rest] (scope and "!" included), else null.
function prefix(text) {
  const m = CONVENTIONAL.exec(text.trim());
  return m && Object.hasOwn(TYPES, m[1].toLowerCase()) ? [TYPES[m[1].toLowerCase()], m[2]] : null;
}

// A subject's item: a known conventional prefix sets the tag and is stripped.
function commitItem(subject) {
  const p = prefix(subject);
  return p ? { label: p[1].trim(), tag: p[0][0], rank: p[0][1] } : { label: subject.trim(), tag: OTHER[0], rank: OTHER[1] };
}

// Ranked items (in source order) grouped by rank, order kept within a group, at most MAX_ITEMS.
const group = (items) => items.filter((it) => it.label)
  .sort((a, b) => a.rank - b.rank).slice(0, MAX_ITEMS).map(({ label, detail, tag }) => (detail ? { label, detail, tag } : { label, tag }));

// Subjects (oldest first) to items: grouped by rank, commit order kept within a group, at most MAX_ITEMS.
export const groupCommits = (subjects) => group(subjects.map(commitItem));

// The subject a commit lists as its item: a merge's is its body's first line (see commits()).
const itemSubject = (subject, body, merge) => (merge ? body.split('\n').map((l) => l.trim()).find(Boolean) ?? '' : subject);

// The commits git log lists for args, oldest first: { author, subject, body }. A merge's subject is its body's first
// line: a GitHub "Merge pull request #N from x/y" carries the PR title there; a merge with no body (Merge branch
// 'x') gets an empty subject, so it lists no item but still counts.
async function commits(dir, args) {
  const out = await git(dir, ['log', '--reverse', '--format=%an%x1f%P%x1f%s%x1f%b%x1e', ...args, '--']);
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [author, parents, subject, body] = r.split('\x1f');
    return { author, body, subject: itemSubject(subject, body, parents.trim().split(' ').length > 1) };
  });
}

// --- the stories ----------------------------------------------------------------------------------------------

async function intro(dir, top, name) {
  const names = readdirSync(top).filter((n) => { try { return statSync(path.join(top, n)).isFile(); } catch { return false; } }).sort();
  const file = README_NAMES.find((n) => names.includes(n)) ?? names.find((n) => /^readme(\.md)?$/i.test(n));
  if (!file) throw new UsageError(noReadme(top));
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
  const range = prev ? `refs/tags/${prev}..refs/tags/${tag}` : `refs/tags/${tag}`;
  const list = await commits(dir, ['--first-parent', range]);
  return {
    title: `${name} ${tag}`,
    items: groupCommits(list.map((c) => c.subject)),
    stats: await rangeStats(dir, range),
  };
}

// The range's stats over every commit in it (merged branches too), as GitHub's compare reports them: commits =
// the non-merge commits, contributors = the distinct author names (whoever merged included).
async function rangeStats(dir, range) {
  const count = Number((await git(dir, ['rev-list', '--count', '--no-merges', range, '--'])).trim());
  const authors = (await git(dir, ['log', '--format=%an', range, '--'])).split('\n').filter(Boolean);
  return { commits: count, contributors: new Set(authors).size };
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
  // fixed diff options, so no diff.external, textconv, relative or rename setting in the user's config changes them
  const numstat = await git(dir, ['diff', '--numstat', '--no-ext-diff', '--no-textconv', '--no-relative', '-M', '--no-color',
    `${base[0]}...${ref}`, '--']);
  const stats = { ...(await rangeStats(dir, `${base[0]}..${ref}`)), files: 0, additions: 0, deletions: 0 };
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
    const gh = parseGithubUrl(source); // before any request: a bad URL asks nothing
    if (!gh) throw new UsageError(notSource(source));
    return { version: 1, source: { kind: 'repo', ref: source, story }, ...await readGithub(gh, story, rel, branch) };
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

// --- a GitHub URL ---------------------------------------------------------------------------------------------

const enc = encodeURIComponent;

// The API's commits (oldest first) as { subject, body, merge, author }.
const apiCommit = (c) => {
  const msg = String(c.commit?.message ?? '').replace(/\r\n?/g, '\n');
  const nl = msg.indexOf('\n');
  const subject = nl < 0 ? msg : msg.slice(0, nl), body = nl < 0 ? '' : msg.slice(nl + 1);
  const merge = (c.parents?.length ?? 0) > 1;
  return { subject: itemSubject(subject, body, merge), merge, author: c.commit?.author?.name };
};

// Stats over every commit listed, as rangeStats counts them locally.
function apiStats(list) {
  const cs = list.map(apiCommit);
  return { commits: cs.filter((c) => !c.merge).length, contributors: new Set(cs.map((c) => c.author).filter(Boolean)).size };
}

// The first-parent chain of list (oldest first) from head (the last listed commit when head is not listed), oldest
// first: within the range, exactly what git log --first-parent gives.
function firstParent(list, head) {
  const bySha = new Map(list.map((c) => [c.sha, c]));
  const chain = [];
  for (let sha = bySha.has(head) ? head : list.at(-1)?.sha; bySha.has(sha) && chain.length < list.length; sha = bySha.get(sha).parents?.[0]?.sha) {
    chain.push(bySha.get(sha));
  }
  return chain.reverse();
}

const HEADING_SKIP = /contributors|thanks|credits|acknowledg/i;
const HEADING_TAGS = [[/\b(features?|added|new)\b/i, 'feature'], [/\b(fix|fixes|fixed|bug ?fixes)\b/i, 'fix'],
  [/\bchanged\b/i, 'change'], [/\b(docs|documentation)\b/i, 'docs']];
const headingTag = (h) => (/what'?s changed/i.test(h) ? undefined : HEADING_TAGS.find(([re]) => re.test(h))?.[1]);

// A release or PR body's bullets as ranked items: the heading's tag, else the conventional prefix's, else hint's,
// else other. Bullets under a credits heading are skipped.
function notesItems(bullets, hint) {
  return bullets.filter((b) => !HEADING_SKIP.test(b.heading)).map((b) => {
    const p = prefix(b.text);
    const it = bulletItem(p ? p[1] : b.text);
    if (!it) return null;
    const tag = headingTag(b.heading) ?? (p ? p[0][0] : hint ?? OTHER[0]);
    const rank = !headingTag(b.heading) && p ? p[0][1] : RANK[tag];
    return { label: it.label, detail: it.detail, tag, rank };
  }).filter(Boolean);
}

async function readGithub({ owner, repo }, story, rel, pr) {
  const num = story === 'pr' ? /^#?(\d+)$/.exec(String(pr))?.[1] : undefined;
  if (story === 'pr' && !num) throw new UsageError(`--pr ${pr}: a GitHub URL takes a pull request number (--pr N); for a branch use a local clone`);
  const r = `/repos/${enc(owner)}/${enc(repo)}`;
  const info = await api(r);
  const url = parseGithubUrl(info.html_url) ? info.html_url : `https://github.com/${owner}/${repo}`;
  const name = typeof info.name === 'string' && info.name ? info.name : repo;
  const facts = story === 'release' ? await ghRelease(r, url, name, rel)
    : story === 'pr' ? await ghPr(r, num)
    : await ghIntro(r, url, name, info);
  facts.links = { ...facts.links, url };
  return facts;
}

async function ghIntro(r, url, name, info) {
  const readme = await api(`${r}/readme`, { optional: true });
  if (!readme) throw new UsageError(noReadme(url));
  const text = Buffer.from(String(readme.content ?? ''), readme.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  const p = parseReadme(text);
  const stats = {};
  if (Number.isFinite(info.stargazers_count)) stats.stars = info.stargazers_count;
  if (Number.isFinite(info.forks_count)) stats.forks = info.forks_count;
  return {
    title: p.title || name,
    subtitle: p.subtitle ?? (typeof info.description === 'string' && info.description.trim() ? info.description : undefined),
    items: p.items.slice(0, MAX_ITEMS),
    stats,
    links: p.install ? { install: p.install } : {},
    media: p.media.length ? p.media : undefined,
  };
}

const MAX_TRIES = 5; // predecessors tried for one that is an ancestor of the tag

async function ghRelease(r, url, name, want) {
  const tagList = (await pages(`${r}/tags?per_page=100`)).filter((t) => typeof t?.name === 'string');
  const all = tagList.map((t) => t.name).reverse(); // the API lists the newest first
  if (!all.length) throw new UsageError(NO_TAGS);
  const tag = want === 'latest' ? latestTag(all) : want;
  if (!all.includes(tag)) throw new UsageError(`no tag "${tag}" in ${url}`);
  const head = tagList.find((t) => t.name === tag)?.commit?.sha;
  const release = await api(`${r}/releases/tags/${enc(tag)}`, { optional: true });

  // the predecessor: the nearest earlier tag that compare shows is an ancestor of tag
  let list, others = all.filter((t) => t !== tag);
  for (let i = 0; i < MAX_TRIES; i++) {
    const prev = predecessor(tag, [...others, tag]);
    if (prev === undefined) break;
    const cmp = await api(`${r}/compare/${enc(prev)}...${enc(tag)}`);
    if (cmp.status === 'ahead' || cmp.status === 'identical') {
      list = Array.isArray(cmp.commits) ? cmp.commits : [];
      if (Number(cmp.total_commits) > list.length) {
        process.stderr.write(`warning: GitHub's compare lists ${list.length} of the ${cmp.total_commits} commits in ${prev}...${tag}: `
          + 'items and stats cover only those (a local clone reads them all)\n');
      }
      break;
    }
    others = others.filter((t) => t !== prev);
  }
  list ??= (await pages(`${r}/commits?sha=${enc(tag)}&per_page=100`)).reverse();

  const notes = release?.body ? notesItems(parseNotes(release.body).bullets) : [];
  return {
    title: `${name} ${tag}`,
    items: notes.length ? group(notes) : groupCommits(firstParent(list, head).map((c) => apiCommit(c).subject)),
    stats: apiStats(list),
  };
}

const LABEL_HINTS = { bug: 'fix', enhancement: 'feature', feature: 'feature' };

async function ghPr(r, num) {
  const p = await api(`${r}/pulls/${num}`);
  const list = await pages(`${r}/pulls/${num}/commits?per_page=100`);
  const hint = (p.labels ?? []).map((l) => LABEL_HINTS[String(l?.name ?? '').toLowerCase()]).find(Boolean);
  const notes = parseNotes(typeof p.body === 'string' ? p.body : '');
  let items = notesItems(notes.bullets, hint);
  if (!items.length) {
    items = list.map(apiCommit).filter((c) => !c.merge).map((c) => commitItem(c.subject))
      .map((it) => (it.tag === OTHER[0] && hint ? { ...it, tag: hint, rank: RANK[hint] } : it));
  }
  const stats = apiStats(list);
  for (const [k, v] of [['files', p.changed_files], ['additions', p.additions], ['deletions', p.deletions]]) {
    if (Number.isFinite(v)) stats[k] = v;
  }
  return {
    title: commitItem(String(p.title ?? '')).label || `#${num}`,
    subtitle: notes.paragraph,
    items: group(items),
    stats,
  };
}
