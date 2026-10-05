import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tempDir } from '../../motion-video/tests/tmp.mjs';
import { UsageError } from '../scripts/facts.mjs';
import { api, pages, parseGithubUrl } from '../scripts/sources/github.mjs';
import { readRepo } from '../scripts/sources/repo.mjs';
import { README, storyRepo } from './git-fixture.mjs';
import { apiCommits, compareJson, sha, startFake } from './fake-github.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'story_facts.mjs');
const out = tempDir('mk-story-gh-');
const repo = storyRepo();

// The same history the local tests read, served as GitHub would: o/demo has releases, o/bare has none.
const TAGS = ['v2.1.0-rc.1', 'v2.0.0', 'v2.0.0-rc.1', 'v1.10.0', 'v1.9.0']; // the API lists the newest first
const tagJson = (names) => names.map((name) => ({ name, commit: { sha: sha(repo.dir, name) } }));
const NOTES = `## Features
- **Sequences**: chapters on one song (#7)

## Fixed
* drift in the beat grid by @bo in https://github.com/o/demo/pull/9

## Changed
- tidy the runner

## Docs
- readme

## New Contributors
- @cy made their first contribution in https://github.com/o/demo/pull/7

**Full Changelog**: https://github.com/o/demo/compare/v2.0.0-rc.1...v2.0.0
`;
const AUTO = `## What's Changed
* feat(seq): footage capture by @ann in https://github.com/o/demo/pull/3
* Bump deps by @dependabot in https://github.com/o/demo/pull/4
`;

function repoRoutes(name, { releases = {}, description = 'Motion videos from code.', readme = README, readmePath = 'README.md' } = {}) {
  const r = `/repos/o/${name}`;
  const routes = {
    [r]: { name, full_name: `o/${name}`, html_url: `https://github.com/o/${name}`, description, stargazers_count: 41, forks_count: 3 },
    [`${r}/tags?per_page=100`]: {
      status: 200,
      // an absolute next link on the real host, as GitHub sends it: the reader must ask the fake for it
      headers: { link: `<https://api.github.com/repositories/1/tags?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/tags?per_page=100&page=2>; rel="last"` },
      body: tagJson(TAGS.slice(0, 3)),
    },
    '/repositories/1/tags?per_page=100&page=2': tagJson(TAGS.slice(3)),
    [`${r}/compare/v2.0.0-rc.1...v2.0.0`]: compareJson(repo.dir, 'v2.0.0-rc.1', 'v2.0.0'),
    [`${r}/compare/v1.9.0...v1.10.0`]: compareJson(repo.dir, 'v1.9.0', 'v1.10.0'),
    [`${r}/compare/v2.0.0...v2.1.0-rc.1`]: compareJson(repo.dir, 'v2.0.0', 'v2.1.0-rc.1'),
    [`${r}/commits?sha=v1.9.0&per_page=100`]: apiCommits(repo.dir, 'v1.9.0').reverse(), // newest first, like the API
  };
  if (readme != null) routes[`${r}/readme`] = { name: readmePath.split('/').at(-1), path: readmePath, encoding: 'base64', content: Buffer.from(readme).toString('base64').replace(/.{60}/g, '$&\n') };
  for (const [tag, body] of Object.entries(releases)) routes[`${r}/releases/tags/${tag}`] = { tag_name: tag, name: tag, body };
  return routes;
}

const PR_COMMITS = apiCommits(repo.dir, 'v2.0.0..feature-branch');
const ROUTES = {
  ...repoRoutes('demo', { releases: { 'v2.0.0': NOTES, 'v1.10.0': AUTO, 'v2.1.0-rc.1': '' } }),
  ...repoRoutes('bare'),
  ...repoRoutes('terse', { readme: '# terse\n\n- one\n- two\n', description: 'A terse tool.' }),
  ...repoRoutes('noreadme', { readme: null }),
  ...repoRoutes('docsreadme', { readmePath: 'docs/README.md' }),
  ...repoRoutes('rstreadme', { readmePath: 'README.rst' }),
  ...repoRoutes('emptyreadme', { readme: '  \n' }),
  ...repoRoutes('lowerreadme', { readmePath: 'Readme.md' }),
  ...repoRoutes('fancydesc', { readme: '# fancy\n', description: ':rocket: A **fast** <b>tool</b> &amp; more 🚀' }),
  '/repos/o/demo/pulls/7': {
    number: 7, title: 'feat: captions', body: '<!-- template -->\nBurned-in captions.\nFor every chapter.\n\n## Changes\n- add the caption track\n- fix: timing drift\n  - a nested note\n',
    labels: [{ name: 'enhancement' }], changed_files: 2, additions: 4, deletions: 1,
  },
  '/repos/o/demo/pulls/7/commits?per_page=100': PR_COMMITS,
  '/repos/o/demo/pulls/8': { number: 8, title: 'Quick fixes', body: null, labels: [{ name: 'bug' }], changed_files: 1, additions: 2, deletions: 2 },
  '/repos/o/demo/pulls/8/commits?per_page=100': [
    { sha: 'a1', commit: { author: { name: 'Ann' }, message: 'docs: note' }, parents: [{ sha: 'a0' }] },
    { sha: 'a2', commit: { author: { name: 'Bo' }, message: 'tweak the grid\n\nbody' }, parents: [{ sha: 'a1' }] },
    { sha: 'a3', commit: { author: { name: 'Ann' }, message: "Merge branch 'main' into fixes" }, parents: [{ sha: 'a2' }, { sha: 'm' }] },
  ],
  '/repos/o/limited': { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded for 1.2.3.4.' } },
  '/repos/o/busy': { status: 429, headers: { 'retry-after': '60' }, body: { message: 'Too many requests' } },
  '/repos/o/broken': { status: 500, body: 'oops' },
};

const fake = await startFake(ROUTES);
test.after(() => fake.close());

// the env for the CLI: the fake as the API, no token unless asked for
const env = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GITHUB_TOKEN' && k !== 'MK_GITHUB_API')),
  MK_GITHUB_API: fake.base, ...extra,
});
process.env.MK_GITHUB_API = fake.base;
delete process.env.GITHUB_TOKEN;

// the CLI, run without blocking (the fake answers from this process)
function cli(args, extraEnv) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: env(extraEnv) });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// the facts the CLI writes for the URL and args (asserting it succeeded) and the requests it made
async function facts(url, args = [], extraEnv) {
  const file = path.join(out, 'f.json');
  const from = fake.log.length;
  const r = await cli(['repo', url, ...args, '--out', file], extraEnv);
  assert.equal(r.status, 0, r.stderr);
  return { f: JSON.parse(readFileSync(file, 'utf8')), text: readFileSync(file, 'utf8'), log: fake.log.slice(from) };
}

const local = (opts) => readRepo(repo.dir, opts);

test('parseGithubUrl: https://github.com/O/R with optional www., .git and trailing slash; nothing else', () => {
  for (const u of ['https://github.com/o/demo', 'https://www.github.com/o/demo.git/', 'HTTPS://GitHub.com/o/demo/', 'https://github.com/o/demo.git']) {
    assert.deepEqual(parseGithubUrl(u), { owner: 'o', repo: 'demo' }, u);
  }
  for (const u of ['https://github.com/o/demo/tree/main', 'https://github.com/o', 'http://github.com/o/demo',
    'https://gitlab.com/o/demo', 'https://github.com/o/demo?tab=readme', 'https://github.com/o/demo#top', 'https://user@github.com/o/demo',
    'https://github.com/o/.', 'https://github.com/../demo']) {
    assert.equal(parseGithubUrl(u), null, u);
  }
});

test('intro: README via the API, stars and forks, links.url; GETs only to the fake base, no token', async () => {
  const { f, log } = await facts('https://www.github.com/o/demo.git/');
  assert.deepEqual(f, {
    version: 1,
    source: { kind: 'repo', ref: 'https://www.github.com/o/demo.git/', story: 'intro', command: 'story_facts.mjs repo https://www.github.com/o/demo.git/' },
    title: 'demo',
    subtitle: 'Motion videos of your UI, cut to the beat.',
    items: [
      { label: 'Sequences', detail: 'chapters on one song', tag: 'feature' },
      { label: 'Footage', detail: 'real-app captures', tag: 'feature' },
    ],
    stats: { forks: 3, stars: 41 },
    links: { install: './install.sh', url: 'https://github.com/o/demo' },
    media: [{ path: 'docs/logo.png', alt: 'logo' }],
  });
  assert.deepEqual(log.map((l) => `${l.method} ${l.url}`), ['GET /repos/o/demo', 'GET /repos/o/demo/readme']);
  for (const l of log) {
    assert.equal(l.auth, null);
    assert.equal(l.accept, 'application/vnd.github+json');
    assert.equal(l.agent, 'motion-kit');
  }
});

test('intro over a URL: the same items, subtitle and media as a local clone of the same repo', async () => {
  const { f } = await facts('https://github.com/o/demo');
  const l = await local({ story: 'intro' });
  assert.deepEqual([f.title, f.subtitle, f.items, f.media, f.links.install], [l.title, l.subtitle, l.items, l.media, l.links.install]);
  // a root README the local reader takes under another case is read too
  assert.equal((await facts('https://github.com/o/lowerreadme')).f.subtitle, l.subtitle);
});

test('intro: the description stand-in is cleaned like README text (emoji, Markdown, HTML, entities)', async () => {
  const { f } = await facts('https://github.com/o/fancydesc');
  assert.equal(f.subtitle, 'A fast tool & more');
});

test('intro: the repo description stands in for a missing README subtitle', async () => {
  const { f } = await facts('https://github.com/o/terse');
  assert.equal(f.title, 'terse');
  assert.equal(f.subtitle, 'A terse tool.');
  assert.deepEqual(f.items, [{ label: 'one', tag: 'feature' }, { label: 'two', tag: 'feature' }]);
});

test('GITHUB_TOKEN set: every request carries Bearer TOKEN', async () => {
  const { log } = await facts('https://github.com/o/demo', ['--release', 'latest'], { GITHUB_TOKEN: 'x' });
  assert.ok(log.length >= 4);
  for (const l of log) assert.equal(l.auth, 'Bearer x');
});

test('release latest: the newest release tag from the tags (paginated); its GitHub release body is the items', async () => {
  const { f, log } = await facts('https://github.com/o/demo', ['--release', 'latest']);
  assert.equal(f.title, 'demo v2.0.0');
  assert.deepEqual(f.items, [
    { label: 'Sequences', detail: 'chapters on one song', tag: 'feature' },
    { label: 'drift in the beat grid', tag: 'fix' },
    { label: 'readme', tag: 'docs' },
    { label: 'tidy the runner', tag: 'change' },
  ]);
  // stats from compare, as the local reader counts them for the same range
  assert.deepEqual(f.stats, (await local({ story: 'release', release: 'v2.0.0' })).stats);
  assert.deepEqual(f.stats, { commits: 6, contributors: 3 });
  assert.deepEqual(f.links, { url: 'https://github.com/o/demo' });
  assert.deepEqual(log.map((l) => `${l.method} ${l.url}`), [
    'GET /repos/o/demo',
    'GET /repos/o/demo/tags?per_page=100',
    'GET /repositories/1/tags?per_page=100&page=2',
    'GET /repos/o/demo/releases/tags/v2.0.0',
    'GET /repos/o/demo/compare/v2.0.0-rc.1...v2.0.0',
  ]);
});

test('release: auto-generated notes ("What\'s Changed") take each bullet\'s conventional prefix, credits stripped', async () => {
  const { f } = await facts('https://github.com/o/demo', ['--release', 'v1.10.0']);
  assert.deepEqual(f.items, [{ label: 'footage capture', tag: 'feature' }, { label: 'Bump deps', tag: 'other' }]);
});

test('release with no GitHub release (or an empty body): compare commits, first-parent, the same facts as a local clone', async () => {
  for (const tag of ['v2.0.0', 'v1.10.0']) {
    const { f } = await facts('https://github.com/o/bare', ['--release', tag]);
    const l = await local({ story: 'release', release: tag });
    assert.equal(f.title, `bare ${tag}`);
    assert.deepEqual(f.items, l.items, tag);
    assert.deepEqual(f.stats, l.stats, tag);
  }
  const { f: latest } = await facts('https://github.com/o/bare', ['--release', 'latest']);
  assert.deepEqual(latest.items, [
    { label: 'sequences', tag: 'feature' }, { label: 'drift', tag: 'fix' }, { label: 'readme', tag: 'docs' },
    { label: 'tweak', tag: 'other' }, { label: 'tidy', tag: 'change' }, { label: 'deps', tag: 'change' },
  ]);
  // an empty release body is no release
  const { f: rc } = await facts('https://github.com/o/demo', ['--release', 'v2.1.0-rc.1']);
  assert.deepEqual(rc.items, (await local({ story: 'release', release: 'v2.1.0-rc.1' })).items);
});

test('release: the first tag has no predecessor, so its commits come from the commits endpoint', async () => {
  const { f, log } = await facts('https://github.com/o/bare', ['--release', 'v1.9.0']);
  const l = await local({ story: 'release', release: 'v1.9.0' });
  assert.deepEqual([f.items, f.stats], [l.items, l.stats]);
  assert.equal(log.at(-1).url, '/repos/o/bare/commits?sha=v1.9.0&per_page=100');
});

test('pr N: title, body paragraph and bullets, labels as tag hints, diff stats from the PR', async () => {
  const { f, log } = await facts('https://github.com/o/demo', ['--pr', '7']);
  assert.equal(f.source.command, 'story_facts.mjs repo https://github.com/o/demo --pr 7');
  assert.equal(f.title, 'captions');
  assert.equal(f.subtitle, 'Burned-in captions. For every chapter.');
  assert.deepEqual(f.items, [{ label: 'add the caption track', tag: 'feature' }, { label: 'timing drift', tag: 'fix' }]);
  assert.deepEqual(f.stats, { additions: 4, commits: 2, contributors: 1, deletions: 1, files: 2 });
  assert.deepEqual(log.map((l) => l.url), ['/repos/o/demo', '/repos/o/demo/pulls/7', '/repos/o/demo/pulls/7/commits?per_page=100']);
});

test('pr N without bullets: the commit subjects are the items, the label hint tags the plain ones', async () => {
  const { f } = await facts('https://github.com/o/demo', ['--pr', '#8']);
  assert.equal(f.title, 'Quick fixes');
  assert.equal(f.subtitle, undefined);
  assert.deepEqual(f.items, [{ label: 'tweak the grid', tag: 'fix' }, { label: 'note', tag: 'docs' }]);
  assert.deepEqual(f.stats, { additions: 2, commits: 2, contributors: 2, deletions: 2, files: 1 });
});

test('same run twice -> byte-identical facts', async () => {
  for (const args of [[], ['--release', 'latest'], ['--release', 'v2.0.0'], ['--pr', '7']]) {
    for (const name of ['demo', 'bare']) {
      if (name === 'bare' && args[0] === '--pr') continue;
      const a = (await facts(`https://github.com/o/${name}`, args)).text;
      const b = (await facts(`https://github.com/o/${name}`, args)).text;
      assert.equal(a, b, `${name} ${args.join(' ')}`);
    }
  }
});

test('errors: bad URLs and inputs exit 2, rate limits and failures exit 1, one error line, no request for a bad URL', async () => {
  const o = path.join(out, 'bad.json');
  const cases = [
    [['https://github.com/o/demo/tree/main'], 2, 'error: "https://github.com/o/demo/tree/main" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)'],
    [['https://github.com/o'], 2, 'error: "https://github.com/o" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)'],
    [['https://github.com/o/demo', '--pr', 'feature-branch'], 2, 'error: --pr feature-branch: a GitHub URL takes a pull request number (--pr N); for a branch use a local clone'],
    [['https://github.com/o/missing'], 2, 'error: not found (private repos: use a local clone)'],
    [['https://github.com/o/demo', '--pr', '99'], 2, 'error: no pull request #99 in o/demo'],
    [['https://github.com/o/noreadme'], 2, 'error: no README in https://github.com/o/noreadme (README.md, readme.md or README)'],
    // a README the local reader would not take (not at the root, another format, empty) is no README
    [['https://github.com/o/docsreadme'], 2, 'error: no README in https://github.com/o/docsreadme (README.md, readme.md or README)'],
    [['https://github.com/o/rstreadme'], 2, 'error: no README in https://github.com/o/rstreadme (README.md, readme.md or README)'],
    [['https://github.com/o/emptyreadme'], 2, 'error: no README in https://github.com/o/emptyreadme (README.md, readme.md or README)'],
    [['https://github.com/o/demo', '--release', 'v9.9.9'], 2, 'error: no tag "v9.9.9" in https://github.com/o/demo'],
    [['https://github.com/o/limited'], 1, 'error: rate limited by GitHub: set GITHUB_TOKEN or try later'],
    [['https://github.com/o/busy'], 1, 'error: rate limited by GitHub: set GITHUB_TOKEN or try later'],
    [['https://github.com/o/broken'], 1, 'error: GitHub API: HTTP 500 for /repos/o/broken'],
  ];
  for (const [args, code, msg] of cases) {
    const from = fake.log.length;
    const r = await cli(['repo', ...args, '--out', o]);
    assert.equal(r.status, code, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stderr, `${msg}\n`, args.join(' '));
    if (args[0].includes('/tree/') || args[0] === 'https://github.com/o' || args[2] === 'feature-branch') {
      assert.equal(fake.log.length, from, `no request for ${args.join(' ')}`);
    }
  }
});

test('api: GETs MK_GITHUB_API + path; an unreachable API is an Error, not a traceback', async () => {
  const f2 = await startFake({
    '/repos/o/x': { name: 'x' },
    '/repos/o/x/tags?per_page=100': [],
    '/p?per_page=100': { status: 200, headers: { link: '</p?per_page=100&page=2>; rel="next"' }, body: [1] },
    '/p?per_page=100&page=2': { status: 200, headers: { link: '<https://elsewhere.example/p?page=3>; rel="next"' }, body: [2] },
    '/p?page=3': [3],
    '/repos/o/old': { status: 301, headers: { location: '/repos/o/x' }, body: { message: 'Moved Permanently' } },
    '/repos/o/away': { status: 301, headers: { location: 'https://elsewhere.example/repos/o/x' }, body: {} },
  });
  const saved = process.env.MK_GITHUB_API;
  try {
    process.env.MK_GITHUB_API = f2.base;
    assert.deepEqual(await api('/repos/o/x'), { name: 'x' });
    // a next link on any host is asked of the configured base, by its path
    assert.deepEqual(await pages('/p?per_page=100'), [1, 2, 3]);
    await assert.rejects(readRepo('https://github.com/o/x', { story: 'release', release: 'latest' }),
      (e) => e instanceof UsageError && e.message === 'no tags: tag a release first, or use --intro');
    assert.deepEqual(f2.log.map((l) => `${l.method} ${l.url}`), ['GET /repos/o/x', 'GET /p?per_page=100', 'GET /p?per_page=100&page=2',
      'GET /p?page=3', 'GET /repos/o/x', 'GET /repos/o/x/tags?per_page=100']);
    // a renamed repo's redirect is followed on the same host; one to anywhere else is refused
    assert.deepEqual(await api('/repos/o/old'), { name: 'x' });
    await assert.rejects(api('/repos/o/away'), (e) => !(e instanceof UsageError) && /^GitHub API: a redirect away from/.test(e.message));
    process.env.MK_GITHUB_API = 'http://127.0.0.1:9'; // nothing listens on the discard port
    await assert.rejects(api('/repos/o/x'), (e) => !(e instanceof UsageError) && /^cannot reach the GitHub API/.test(e.message));
  } finally {
    process.env.MK_GITHUB_API = saved;
    await f2.close();
  }
});

test('release: a lower tag that compare says is not an ancestor is skipped; a cut-short compare warns', async () => {
  const c = (sha, parents, message, name = 'Ann') => ({ sha, commit: { author: { name }, message }, parents: parents.map((p) => ({ sha: p })) });
  const tags = [['v2.0.0', 'c3'], ['v1.1.0', 'b1'], ['v1.0.0', 'c1']].map(([name, s]) => ({ name, commit: { sha: s } }));
  const f2 = await startFake({
    '/repos/o/d': { name: 'd', html_url: 'https://github.com/o/d' },
    '/repos/o/d/tags?per_page=100': tags,
    '/repos/o/d/compare/v1.1.0...v2.0.0': { status: 'diverged', total_commits: 2, commits: [] },
    '/repos/o/d/compare/v1.0.0...v2.0.0': { status: 'ahead', total_commits: 300, commits: [c('c2', ['c1'], 'feat: two'), c('c3', ['c2'], 'fix: three', 'Bo')] },
  });
  const saved = process.env.MK_GITHUB_API;
  const file = path.join(out, 'd.json');
  try {
    process.env.MK_GITHUB_API = f2.base;
    const r = await cli(['repo', 'https://github.com/o/d', '--release', 'v2.0.0', '--out', file], { MK_GITHUB_API: f2.base });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "warning: GitHub's compare lists 2 of the 300 commits in v1.0.0...v2.0.0: items and stats cover only those (a local clone reads them all)\n");
    const f = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(f.items, [{ label: 'two', tag: 'feature' }, { label: 'three', tag: 'fix' }]);
    assert.deepEqual(f.stats, { commits: 2, contributors: 2 });
  } finally {
    process.env.MK_GITHUB_API = saved;
    await f2.close();
  }
});

test('release: a non-version tag\'s predecessor is the tag listed just after it (created just before it)', async () => {
  const c = (sha, parents, message) => ({ sha, commit: { author: { name: 'Ann' }, message }, parents: parents.map((p) => ({ sha: p })) });
  const f2 = await startFake({
    '/repos/o/n': { name: 'n', html_url: 'https://github.com/o/n' },
    // newest first: zulu, alpha, beta
    '/repos/o/n/tags?per_page=100': [['zulu', 'z'], ['alpha', 'a'], ['beta', 'b']].map(([name, s]) => ({ name, commit: { sha: s } })),
    '/repos/o/n/compare/beta...alpha': { status: 'ahead', total_commits: 1, commits: [c('a', ['b'], 'feat: a')] },
    '/repos/o/n/compare/alpha...zulu': { status: 'ahead', total_commits: 1, commits: [c('z', ['a'], 'fix: z')] },
  });
  const saved = process.env.MK_GITHUB_API;
  try {
    process.env.MK_GITHUB_API = f2.base;
    const alpha = await readRepo('https://github.com/o/n', { story: 'release', release: 'alpha' });
    assert.deepEqual(alpha.items, [{ label: 'a', tag: 'feature' }]);
    const latest = await readRepo('https://github.com/o/n', { story: 'release', release: 'latest' });
    assert.equal(latest.title, 'n zulu');
    assert.deepEqual(latest.items, [{ label: 'z', tag: 'fix' }]);
    assert.deepEqual(f2.log.filter((l) => l.url.includes('/compare/')).map((l) => l.url),
      ['/repos/o/n/compare/beta...alpha', '/repos/o/n/compare/alpha...zulu']);
  } finally {
    process.env.MK_GITHUB_API = saved;
    await f2.close();
  }
});

test('release: when every tried predecessor is off the tag\'s history, a warning and every commit up to the tag', async () => {
  const c = (sha, parents, message) => ({ sha, commit: { author: { name: 'Ann' }, message }, parents: parents.map((p) => ({ sha: p })) });
  const names = ['v2.0.0', 'v1.5.0', 'v1.4.0', 'v1.3.0', 'v1.2.0', 'v1.1.0', 'v1.0.0'];
  const routes = {
    '/repos/o/w': { name: 'w', html_url: 'https://github.com/o/w' },
    '/repos/o/w/tags?per_page=100': names.map((name) => ({ name, commit: { sha: name === 'v2.0.0' ? 'h' : name } })),
    '/repos/o/w/commits?sha=v2.0.0&per_page=100': [c('h', ['g'], 'feat: head'), c('g', [], 'init')],
  };
  for (const n of names.slice(1)) routes[`/repos/o/w/compare/${n}...v2.0.0`] = { status: 'diverged', total_commits: 0, commits: [] };
  const f2 = await startFake(routes);
  const file = path.join(out, 'w.json');
  try {
    const r = await cli(['repo', 'https://github.com/o/w', '--release', 'v2.0.0', '--out', file], { MK_GITHUB_API: f2.base });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, 'warning: none of the 5 tags before v2.0.0 that compare tried is an ancestor of it: reading every commit up to it (a local clone finds its predecessor)\n');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).items, [{ label: 'head', tag: 'feature' }, { label: 'init', tag: 'other' }]);
    assert.equal(f2.log.filter((l) => l.url.includes('/compare/')).length, 5);
  } finally { await f2.close(); }
});

test('release: a compare GitHub cannot answer (404) names the range, not a private repo', async () => {
  const f2 = await startFake({
    '/repos/o/c': { name: 'c', html_url: 'https://github.com/o/c' },
    '/repos/o/c/tags?per_page=100': [['v2.0.0', 'b'], ['v1.0.0', 'a']].map(([name, s]) => ({ name, commit: { sha: s } })),
  });
  const file = path.join(out, 'c.json');
  try {
    const r = await cli(['repo', 'https://github.com/o/c', '--release', 'v2.0.0', '--out', file], { MK_GITHUB_API: f2.base });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stderr, 'error: cannot compare v1.0.0...v2.0.0 in o/c\n');
  } finally { await f2.close(); }
});

test('pages: a list cut at 10 pages with a next link left warns', async () => {
  const routes = { '/repos/o/many': { name: 'many', html_url: 'https://github.com/o/many' } };
  for (let i = 1; i <= 11; i++) {
    const at = i === 1 ? '/repos/o/many/tags?per_page=100' : `/repos/o/many/tags?per_page=100&page=${i}`;
    routes[at] = { status: 200, headers: { link: `</repos/o/many/tags?per_page=100&page=${i + 1}>; rel="next"` }, body: [{ name: `t${i}`, commit: { sha: `s${i}` } }] };
  }
  const f2 = await startFake(routes);
  const file = path.join(out, 'many.json');
  try {
    const r = await cli(['repo', 'https://github.com/o/many', '--release', 'nope', '--out', file], { MK_GITHUB_API: f2.base });
    assert.equal(r.status, 2);
    assert.equal(r.stderr, 'warning: GitHub lists more than 10 pages for /repos/o/many/tags: only the first 10 were read (a local clone reads them all)\n'
      + 'error: no tag "nope" in https://github.com/o/many\n');
    assert.equal(f2.log.filter((l) => l.url.includes('/tags')).length, 10);
  } finally { await f2.close(); }
});

test('api: a body that stalls past the timeout is the same sentence as a request that does', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"na'); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const saved = [process.env.MK_GITHUB_API, process.env.MK_GITHUB_TIMEOUT_MS];
  try {
    process.env.MK_GITHUB_API = `http://127.0.0.1:${server.address().port}`;
    process.env.MK_GITHUB_TIMEOUT_MS = '300';
    await assert.rejects(api('/repos/o/x'), (e) => !(e instanceof UsageError) && e.message === 'the GitHub API did not answer in 0.3 s');
  } finally {
    [process.env.MK_GITHUB_API, process.env.MK_GITHUB_TIMEOUT_MS] = saved;
    if (saved[1] === undefined) delete process.env.MK_GITHUB_TIMEOUT_MS;
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
});

test('trailers stay out over a URL too: merge bodies, PR bodies and PR commits', async () => {
  const c = (sha, parents, message) => ({ sha, commit: { author: { name: 'Ann' }, message }, parents: parents.map((p) => ({ sha: p })) });
  const f2 = await startFake({
    '/repos/o/t': { name: 't', html_url: 'https://github.com/o/t' },
    '/repos/o/t/tags?per_page=100': [['v2.0.0', 'm2'], ['v1.0.0', 'a']].map(([name, s]) => ({ name, commit: { sha: s } })),
    '/repos/o/t/compare/v1.0.0...v2.0.0': { status: 'ahead', total_commits: 4, commits: [
      c('b', ['a'], 'work\n\nSigned-off-by: Ann <a@x.y>'),
      c('m1', ['a', 'b'], "Merge branch 'b'\n\nSigned-off-by: Max <m@x.y>"),
      c('d', ['m1'], 'more'),
      c('m2', ['m1', 'd'], 'Merge pull request #2 from o/d\n\nfeat: the thing\n\nCo-Authored-By: Cy <c@x.y>'),
    ] },
    '/repos/o/t/pulls/3': { number: 3, title: 'fix: a bug', body: 'What it fixes.\n\nSigned-off-by: Ann <a@x.y>\n', labels: [] },
    '/repos/o/t/pulls/4': { number: 4, title: 'sequence: chapters', body: 'Note: keep me\n\n## Changes\n- one\n', labels: [] },
    '/repos/o/t/pulls/4/commits?per_page=100': [c('q', ['a'], 'sequence: chapters')],
    '/repos/o/t/pulls/3/commits?per_page=100': [c('p', ['a'], 'fix: a bug\n\nCo-Authored-By: Cy <c@x.y>')],
  });
  const saved = process.env.MK_GITHUB_API;
  try {
    process.env.MK_GITHUB_API = f2.base;
    const rel = await readRepo('https://github.com/o/t', { story: 'release', release: 'v2.0.0' });
    assert.deepEqual(rel.items, [{ label: 'the thing', tag: 'feature' }]);
    const pr4 = await readRepo('https://github.com/o/t', { story: 'pr', pr: '4' });
    assert.deepEqual([pr4.title, pr4.subtitle], ['chapters', 'Note: keep me']);
    const pr = await readRepo('https://github.com/o/t', { story: 'pr', pr: '3' });
    assert.equal(pr.subtitle, 'What it fixes.');
    assert.deepEqual(pr.items, [{ label: 'a bug', tag: 'fix' }]);
  } finally {
    process.env.MK_GITHUB_API = saved;
    await f2.close();
  }
});

test('over a URL a merge whose body is an area-prefixed PR title keeps its item', async () => {
  const c = (sha, parents, message) => ({ sha, commit: { author: { name: 'Ann' }, message }, parents: parents.map((p) => ({ sha: p })) });
  const f2 = await startFake({
    '/repos/o/a': { name: 'a', html_url: 'https://github.com/o/a' },
    '/repos/o/a/tags?per_page=100': [['v2.0.0', 'm'], ['v1.0.0', 'a']].map(([name, s]) => ({ name, commit: { sha: s } })),
    '/repos/o/a/compare/v1.0.0...v2.0.0': { status: 'ahead', total_commits: 2, commits: [
      c('b', ['a'], 'work'),
      c('m', ['a', 'b'], 'Merge pull request #5 from o/b\n\nsequence: chapters on one song\n\nSigned-off-by: Max <m@x.y>'),
    ] },
  });
  const saved = process.env.MK_GITHUB_API;
  try {
    process.env.MK_GITHUB_API = f2.base;
    const rel = await readRepo('https://github.com/o/a', { story: 'release', release: 'v2.0.0' });
    assert.deepEqual(rel.items, [{ label: 'chapters on one song', tag: 'other' }]);
  } finally {
    process.env.MK_GITHUB_API = saved;
    await f2.close();
  }
});
