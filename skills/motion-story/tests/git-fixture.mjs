// git-fixture.mjs -- small git repos built in temp dirs for the repo reader's tests. Every commit and tag gets a
// fixed identity and a fixed, increasing date, and the machine's git config is shut out (no global or system
// config: no signing, no default-branch surprises), so the same script builds the same history everywhere.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from '../../motion-video/tests/tmp.mjs';

const BASE = Date.UTC(2026, 0, 1) / 1000;

export function makeRepo(prefix = 'mk-story-repo-') {
  const dir = tempDir(prefix);
  let tick = 0;
  const env = () => {
    const date = `${BASE + 3600 * tick++} +0000`;
    // the caller's identity, dates and repo location must not leak in
    const base = Object.fromEntries(Object.entries(process.env)
      .filter(([k]) => !/^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$)/.test(k)));
    return {
      ...base,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    };
  };
  const git = (args, who = ['Ann Author', 'ann@example.com']) => execFileSync('git',
    ['-c', `user.name=${who[0]}`, '-c', `user.email=${who[1]}`, '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-C', dir, ...args],
    { env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q', '-b', 'main']);
  return {
    dir,
    git,
    write(file, text) { writeFileSync(path.join(dir, file), text); },
    // a commit touching file (default: a file named after the commit count), by who
    commit(subject, { file, text, body, who } = {}) {
      const f = file ?? `f${tick}.txt`;
      writeFileSync(path.join(dir, f), text ?? `${subject}\n`);
      git(['add', '--', f]);
      git(['commit', '-q', '-m', subject, ...(body ? ['-m', body] : [])], who);
    },
    tag(name, { annotated = false } = {}) { git(['tag', ...(annotated ? ['-a', '-m', name] : []), name]); },
  };
}

export const README = `<p align="center"><img src="docs/logo.png" alt="logo"></p>

# 🎬 demo

[![CI](https://github.com/o/demo/actions/workflows/ci.yml/badge.svg)](https://github.com/o/demo/actions)

Motion videos of your UI, cut to the beat.

## Features

- **Sequences**: chapters on one song
- **Footage** — real-app captures

\`\`\`bash
$ ./install.sh
\`\`\`
`;

// The story fixture: tags v1.9.0 (lightweight), v1.10.0 (annotated), v2.0.0-rc.1 (lightweight) and v2.0.0
// (annotated); a merged pull request (topic, by Cy) between rc.1 and 2.0.0; an unmerged feature-branch after 2.0.0
// whose tip is tagged v2.1.0-rc.1 (a pre-release, so latest stays v2.0.0); its commits carry trailers
// (Signed-off-by, Co-Authored-By), which never reach the facts.
export function storyRepo() {
  const r = makeRepo();
  r.commit('init', { file: 'README.md', text: README });
  r.tag('v1.9.0');
  r.commit('feat: footage');
  r.tag('v1.10.0', { annotated: true });
  r.commit('fix: typo');
  r.tag('v2.0.0-rc.1');
  r.commit('chore: deps');
  r.commit('tweak');
  r.git(['checkout', '-q', '-b', 'topic']);
  r.commit('add the sequence runner', { who: ['Cy Coder', 'cy@example.com'] });
  r.git(['checkout', '-q', 'main']);
  r.git(['merge', '-q', '--no-ff', 'topic', '-m', 'Merge pull request #7 from o/topic', '-m', 'feat(seq): sequences\n\nChapters on one song.']);
  r.commit('docs: readme');
  r.commit('fix: drift', { who: ['Bo Builder', 'bo@example.com'] });
  r.commit('refactor: tidy');
  r.tag('v2.0.0', { annotated: true });
  r.git(['checkout', '-q', '-b', 'feature-branch']);
  r.commit('feat: captions', { body: 'Burned-in captions for every chapter.\nSecond line.\n\nMore detail.\n\nSigned-off-by: Ann Author <ann@example.com>\nCo-Authored-By: Bo Builder <bo@example.com>' });
  r.commit('fix(captions): timing', { file: 'captions.txt', text: 'a\nb\nc\n', body: 'Co-Authored-By: Bo Builder <bo@example.com>' });
  r.tag('v2.1.0-rc.1');
  r.git(['checkout', '-q', 'main']);
  r.git(['remote', 'add', 'origin', 'git@github.com:o/demo.git']);
  return r;
}
