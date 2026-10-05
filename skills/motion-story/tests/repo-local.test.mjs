import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from '../../motion-video/tests/tmp.mjs';
import { UsageError } from '../scripts/facts.mjs';
import { compareVersions, githubUrl, groupCommits, readRepo } from '../scripts/sources/repo.mjs';
import { makeRepo, storyRepo } from './git-fixture.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'story_facts.mjs');
const cli = (args, opts = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });

const repo = storyRepo();
const out = tempDir('mk-story-out-');

// the facts the CLI writes for args, after asserting it succeeded
function facts(name, ...args) {
  const file = path.join(out, `${name}.json`);
  const r = cli(['repo', repo.dir, ...args, '--out', file]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('compareVersions: numeric parts, optional v, pre-releases before their release', () => {
  const sorted = ['v2.0.0', '1.2', 'v1.10.0', 'v2.0.0-rc.10', 'v1.9.0', 'v2.0.0-rc.2', 'v2.0.0-rc.1', 'v2.0.0-beta', 'v1.2.1'];
  assert.deepEqual([...sorted].sort(compareVersions),
    ['1.2', 'v1.2.1', 'v1.9.0', 'v1.10.0', 'v2.0.0-beta', 'v2.0.0-rc.1', 'v2.0.0-rc.2', 'v2.0.0-rc.10', 'v2.0.0']);
  assert.equal(compareVersions('1.2', 'v1.2.0'), 0);
  assert.equal(compareVersions('v1.2+build.5', '1.2'), 0);
});

test('githubUrl: the https URL of a GitHub remote, else undefined', () => {
  for (const r of ['git@github.com:o/demo.git', 'https://github.com/o/demo', 'https://github.com/o/demo.git/',
    'ssh://git@github.com/o/demo.git', 'https://user@github.com/o/demo.git']) {
    assert.equal(githubUrl(r), 'https://github.com/o/demo', r);
  }
  assert.equal(githubUrl('git@gitlab.com:o/demo.git'), undefined);
  assert.equal(githubUrl(''), undefined);
});

test('groupCommits: features, fixes, docs, other, then changes with chore/build/ci/test last; scope stripped', () => {
  const items = groupCommits(['chore(deps): bump', 'tweak', 'test: more', 'perf: faster', 'docs: guide',
    'fix(ui)!: crash', 'feat: one', 'FEAT: two', 'build: x']);
  assert.deepEqual(items, [
    { label: 'one', tag: 'feature' }, { label: 'two', tag: 'feature' }, { label: 'crash', tag: 'fix' },
    { label: 'guide', tag: 'docs' }, { label: 'tweak', tag: 'other' }, { label: 'faster', tag: 'change' },
    { label: 'bump', tag: 'change' }, { label: 'more', tag: 'change' }, { label: 'x', tag: 'change' },
  ]);
  assert.equal(groupCommits(Array.from({ length: 20 }, (_, i) => `c${i}`)).length, 12);
});

test('intro: README title, subtitle, features, install, media, commit count, GitHub url', () => {
  const f = facts('intro');
  assert.deepEqual(f, {
    version: 1,
    source: { kind: 'repo', ref: repo.dir, story: 'intro', command: `story_facts.mjs repo ${repo.dir}` },
    title: 'demo',
    subtitle: 'Motion videos of your UI, cut to the beat.',
    items: [
      { label: 'Sequences', detail: 'chapters on one song', tag: 'feature' },
      { label: 'Footage', detail: 'real-app captures', tag: 'feature' },
    ],
    stats: { commits: 10 },
    links: { install: './install.sh', url: 'https://github.com/o/demo' },
    media: [{ path: 'docs/logo.png', alt: 'logo' }],
  });
});

test('release latest: v2.0.0 against v2.0.0-rc.1, first-parent commits grouped, PR title from the merge body', () => {
  const f = facts('latest', '--release', 'latest');
  assert.equal(f.title, 'demo v2.0.0');
  assert.deepEqual(f.source, { kind: 'repo', ref: repo.dir, story: 'release', command: `story_facts.mjs repo ${repo.dir} --release latest` });
  assert.deepEqual(f.items, [
    { label: 'sequences', tag: 'feature' },
    { label: 'drift', tag: 'fix' },
    { label: 'readme', tag: 'docs' },
    { label: 'tweak', tag: 'other' },
    { label: 'tidy', tag: 'change' },
    { label: 'deps', tag: 'change' },
  ]);
  // stats over the full range: the merged branch's commit (by Cy) counts, the merge commit does not
  assert.deepEqual(f.stats, { commits: 6, contributors: 3 });
  assert.deepEqual(f.links, { url: 'https://github.com/o/demo' });
});

test('release by tag: v1.10.0 follows v1.9.0 (not lexical); the first tag takes every commit up to it', async () => {
  const ten = await readRepo(repo.dir, { story: 'release', release: 'v1.10.0' });
  assert.equal(ten.title, 'demo v1.10.0');
  assert.deepEqual(ten.items, [{ label: 'footage', tag: 'feature' }]);
  assert.deepEqual(ten.stats, { commits: 1, contributors: 1 });
  const rc = await readRepo(repo.dir, { story: 'release', release: 'v2.0.0-rc.1' });
  assert.deepEqual(rc.items, [{ label: 'typo', tag: 'fix' }]);
  const first = await readRepo(repo.dir, { story: 'release', release: 'v1.9.0' });
  assert.deepEqual(first.items, [{ label: 'init', tag: 'other' }]);
  assert.deepEqual(first.stats, { commits: 1, contributors: 1 });
});

test('release: latest skips pre-releases unless there are only pre-releases; a named pre-release works', async () => {
  const rc = await readRepo(repo.dir, { story: 'release', release: 'v2.1.0-rc.1' });
  assert.equal(rc.title, 'demo v2.1.0-rc.1');
  assert.deepEqual(rc.items, [{ label: 'captions', tag: 'feature' }, { label: 'timing', tag: 'fix' }]);
  const r = makeRepo();
  r.commit('a');
  r.tag('v1.0.0-rc.1');
  r.commit('b');
  r.tag('v1.0.0-rc.2');
  const only = await readRepo(r.dir, { story: 'release', release: 'latest' });
  assert.equal(only.title, `${path.basename(r.dir)} v1.0.0-rc.2`);
});

test('release: merge-button history counts every author in the range, items stay first-parent', async () => {
  const r = makeRepo();
  r.commit('init');
  r.tag('v1.0.0');
  const people = [['Ann', 'ann@x.y'], ['Bo', 'bo@x.y'], ['Cy', 'cy@x.y']];
  people.forEach(([who, email], i) => {
    r.git(['checkout', '-q', '-b', `pr${i}`]);
    r.commit(`work by ${who}`, { who: [who, email] });
    r.commit(`more by ${who}`, { who: [who, email] });
    r.git(['checkout', '-q', 'main']);
    r.git(['merge', '-q', '--no-ff', `pr${i}`, '-m', `Merge pull request #${i + 1} from o/pr${i}`, '-m', `feat: change ${i + 1}`], ['Max', 'max@x.y']);
  });
  r.tag('v1.1.0');
  const f = await readRepo(r.dir, { story: 'release', release: 'latest' });
  assert.deepEqual(f.items, [1, 2, 3].map((n) => ({ label: `change ${n}`, tag: 'feature' })));
  assert.deepEqual(f.stats, { commits: 6, contributors: 4 }); // Ann, Bo, Cy and Max (who merged)
});

test('release: non-version tags fall back to creation date order', async () => {
  const r = makeRepo();
  r.commit('docs: readme', { file: 'README.md', text: '# x\n' });
  r.tag('beta');
  r.commit('feat: a');
  r.tag('alpha', { annotated: true });
  r.commit('fix: b');
  r.tag('zulu');
  const latest = await readRepo(r.dir, { story: 'release', release: 'latest' });
  assert.equal(latest.title, `${path.basename(r.dir)} zulu`);
  assert.deepEqual(latest.items, [{ label: 'b', tag: 'fix' }]);
  const alpha = await readRepo(r.dir, { story: 'release', release: 'alpha' });
  assert.deepEqual(alpha.items, [{ label: 'a', tag: 'feature' }]);
});

test('pr BRANCH: compared with its merge base on main; first commit names it, commits are the items', () => {
  const f = facts('pr', '--pr', 'feature-branch');
  assert.equal(f.source.story, 'pr');
  assert.equal(f.source.command, `story_facts.mjs repo ${repo.dir} --pr feature-branch`);
  assert.equal(f.title, 'captions');
  assert.equal(f.subtitle, 'Burned-in captions for every chapter. Second line.');
  assert.deepEqual(f.items, [{ label: 'captions', tag: 'feature' }, { label: 'timing', tag: 'fix' }]);
  assert.deepEqual(f.stats, { additions: 4, commits: 2, contributors: 1, deletions: 0, files: 2 });
});

test('trailers never reach the facts: a trailers-only body gives no subtitle, a trailers-only merge no item', async () => {
  const r = makeRepo();
  r.commit('init', { file: 'README.md', text: '# x\n' });
  r.tag('v1.0.0');
  r.git(['checkout', '-q', '-b', 'topic']);
  r.commit('feat: one', { body: 'Co-Authored-By: Claude <noreply@example.com>' });
  r.commit('fix: two', { body: 'Signed-off-by: Ann <ann@example.com>\nReviewed-by: Bo <bo@example.com>' });
  r.git(['checkout', '-q', 'main']);
  const pr = await readRepo(r.dir, { story: 'pr', pr: 'topic' });
  // a merge whose body is only trailers lists no item; one with a PR title and then trailers lists that title
  r.git(['merge', '-q', '--no-ff', 'topic', '-m', "Merge branch 'topic'", '-m', 'Signed-off-by: Max <max@x.y>']);
  r.git(['checkout', '-q', '-b', 'second']);
  r.commit('docs: three');
  r.git(['checkout', '-q', 'main']);
  r.git(['merge', '-q', '--no-ff', 'second', '-m', 'Merge pull request #2 from o/second', '-m', 'docs: the guide', '-m', 'Co-Authored-By: Cy <cy@x.y>']);
  r.tag('v1.1.0');
  assert.equal(pr.title, 'one');
  assert.equal(pr.subtitle, undefined);
  assert.deepEqual(pr.items, [{ label: 'one', tag: 'feature' }, { label: 'two', tag: 'fix' }]);
  const rel = await readRepo(r.dir, { story: 'release', release: 'v1.1.0' });
  assert.deepEqual(rel.items, [{ label: 'the guide', tag: 'docs' }]);
  // the shared fixture: its oldest branch commit's trailers stay out of the subtitle
  const f = await readRepo(repo.dir, { story: 'pr', pr: 'feature-branch' });
  assert.equal(f.subtitle, 'Burned-in captions for every chapter.\nSecond line.');
  for (const s of [JSON.stringify(pr), JSON.stringify(rel), JSON.stringify(f)]) assert.doesNotMatch(s, /Signed-off-by|Co-Authored-By|Reviewed-by/i);
});

test('an area prefix (motion-story:, area-name:, a/b:) that is no conventional type is a scope: stripped, tag other', async () => {
  assert.deepEqual(groupCommits(['motion-story: read a repo', 'sequence: render chapters', 'ui/tabs: slide', 'feat(x): one',
    'docs: guide', 'Fix: Not an area', 'Area: kept', 'no prefix']), [
    { label: 'one', tag: 'feature' }, { label: 'guide', tag: 'docs' },
    { label: 'read a repo', tag: 'other' }, { label: 'render chapters', tag: 'other' }, { label: 'slide', tag: 'other' },
    { label: 'Not an area', tag: 'fix' }, { label: 'Area: kept', tag: 'other' }, { label: 'no prefix', tag: 'other' },
  ].sort((a, b) => ['feature', 'fix', 'docs', 'other'].indexOf(a.tag) - ['feature', 'fix', 'docs', 'other'].indexOf(b.tag)));
  const r = makeRepo();
  r.commit('init', { file: 'README.md', text: '# x\n' });
  r.git(['checkout', '-q', '-b', 'topic']);
  r.commit('motion-story: read a repo from its URL');
  r.commit('sequence: render chapters');
  const f = await readRepo(r.dir, { story: 'pr', pr: 'topic' });
  assert.equal(f.title, 'read a repo from its URL');
  assert.deepEqual(f.items, [{ label: 'read a repo from its URL', tag: 'other' }, { label: 'render chapters', tag: 'other' }]);
});

test('only trailing paragraphs of known or Capitalised-Hyphenated keys are trailers: an area merge title and a Note survive', async () => {
  const r = makeRepo();
  r.commit('init', { file: 'README.md', text: '# x\n' });
  r.tag('v1.0.0');
  r.git(['checkout', '-q', '-b', 'topic']);
  r.commit('feat: one', { body: 'Note: keep me\n\ncc: a lowercase line in the middle\n\nSigned-off-by: Ann <a@x.y>\nCC: Bo <b@x.y>\nX-Custom-Key: z' });
  r.git(['checkout', '-q', 'main']);
  const pr = await readRepo(r.dir, { story: 'pr', pr: 'topic' });
  assert.equal(pr.subtitle, 'Note: keep me');
  r.git(['merge', '-q', '--no-ff', 'topic', '-m', 'Merge pull request #3 from o/topic', '-m', 'sequence: chapters on one song', '-m', 'Signed-off-by: Max <m@x.y>']);
  r.git(['checkout', '-q', '-b', 'second']);
  r.commit('two');
  r.git(['checkout', '-q', 'main']);
  r.git(['merge', '-q', '--no-ff', 'second', '-m', 'Merge pull request #4 from o/second', '-m', 'sequence: render chapters']);
  r.tag('v1.1.0');
  const rel = await readRepo(r.dir, { story: 'release', release: 'v1.1.0' });
  assert.deepEqual(rel.items, [{ label: 'chapters on one song', tag: 'other' }, { label: 'render chapters', tag: 'other' }]);
});

test('same run twice -> byte-identical facts', () => {
  for (const args of [[], ['--release', 'latest'], ['--pr', 'feature-branch']]) {
    const a = path.join(out, 'twice-a.json'), b = path.join(out, 'twice-b.json');
    assert.equal(cli(['repo', repo.dir, ...args, '--out', a]).status, 0);
    assert.equal(cli(['repo', repo.dir, ...args, '--out', b]).status, 0);
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'), args.join(' '));
  }
});

test('--intro is the default: repo X and repo X --intro write byte-identical files', () => {
  const a = path.join(out, 'intro-a.json'), b = path.join(out, 'intro-b.json');
  assert.equal(cli(['repo', repo.dir, '--out', a]).status, 0);
  assert.equal(cli(['repo', repo.dir, '--intro', '--out', b]).status, 0);
  assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
  assert.equal(JSON.parse(readFileSync(b, 'utf8')).source.command, `story_facts.mjs repo ${repo.dir}`);
});

test('a relative SOURCE is recorded as an absolute path', () => {
  const file = path.join(out, 'rel.json');
  const r = cli(['repo', '.', '--out', file], { cwd: repo.dir });
  assert.equal(r.status, 0, r.stderr);
  // (resolved against the cwd, which the OS reports with symlinks resolved: /private/var on macOS)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).source.ref, realpathSync(repo.dir));
});

test('bad input exits 2 with one error line and no usage line or traceback', () => {
  const bare = makeRepo();
  bare.commit('only', { file: 'notes.txt' });
  const plain = tempDir('mk-story-plain-');
  mkdirSync(path.join(plain, 'github.com', 'o', 'r'), { recursive: true });
  const o = path.join(out, 'bad.json');
  const cases = [
    [[bare.dir, '--release', 'latest'], 'error: no tags: tag a release first, or use --intro'],
    // named by the work tree's top level, as git reports it (symlinks resolved)
    [[bare.dir], `error: no README in ${realpathSync(bare.dir)} (README.md, readme.md or README)`],
    [[repo.dir, '--release', 'v9.9.9'], `error: no tag "v9.9.9" in ${repo.dir}`],
    [[plain], `error: not a git work tree: ${plain}`],
    [[path.join(plain, 'nope')], `error: not a git work tree: ${path.join(plain, 'nope')}`],
    [[repo.dir, '--pr', '7'], 'error: --pr 7: pull request numbers need a GitHub URL; on a local clone pass a branch (--pr BRANCH)'],
    [[repo.dir, '--pr', 'no-such-branch'], `error: no branch "no-such-branch" in ${repo.dir}`],
    [[repo.dir, '--pr', 'main'], 'error: main has no commits that are not on main'],
    [['git@github.com:o/r'], 'error: "git@github.com:o/r" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)'],
    [['github.com/x/y'], 'error: "github.com/x/y" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)'],
    // an existing directory wins over looking like a GitHub address
    [['github.com/o/r'], `error: not a git work tree: ${path.join(realpathSync(plain), 'github.com/o/r')}`],
    [['https://github.com/o/r/tree/main'], 'error: "https://github.com/o/r/tree/main" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)'],
    [['ftp://example.com/r'], 'error: "ftp://example.com/r" is not a local path or a GitHub URL (use https://github.com/OWNER/REPO or a local clone)'],
  ];
  for (const [args, msg] of cases) {
    const r = cli(['repo', ...args, '--out', o], { cwd: plain });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stderr, `${msg}\n`, args.join(' '));
  }
  // argument errors still show the usage line
  const two = cli(['repo', repo.dir, '--intro', '--pr', 'x', '--out', o]);
  assert.equal(two.status, 2);
  assert.match(two.stderr, /^error: pass one of --intro, --pr, not 2\nusage: story_facts\.mjs/);
});

test('readRepo: errors are UsageErrors (exit 2) for bad input', async () => {
  await assert.rejects(readRepo(tempDir('mk-story-plain-'), { story: 'intro' }), UsageError);
});
