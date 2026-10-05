import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadme } from '../scripts/sources/readme.mjs';

const FANCY = `<!-- top comment: # not a title -->
<p align="center"><img src="docs/media/logo.png" alt="motion-kit logo" width="120"></p>

# 🎬 motion-kit :sparkles:

[![CI](https://github.com/o/motion-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/o/motion-kit/actions) [![npm](https://img.shields.io/npm/v/x.svg)](https://npm.im/x)

[Docs](docs/) · [Install](#install) · [Gallery](gallery/)

Code-only **motion videos** of your UI, cut to the beat of a song 🎵. Made with [Node](https://nodejs.org).
Second line of the same paragraph.

![the launch video](docs/media/launch.gif)

## Install

\`\`\`bash
$ ./install.sh
$ npm test
\`\`\`

## ✨ Features

- **Sequences**: chapters on one song
- **Footage** — real-app captures that play in the piece
- Beat grid - measured, not guessed
  continued on the next line
- [Gallery](gallery/): every component, rendered
  - a nested bullet that is ignored
- Plain bullet with no split

## Usage

- not a feature
<img src="https://example.com/shot.png" alt="a shot">
<img alt='second' src='/abs/shot2.png'>

\`\`\`
- not a list, in a fence
![not media](inside-fence.png)
\`\`\`
`;

test('parseReadme: badges, HTML, emoji and nav links stay out of title, subtitle and items', () => {
  const r = parseReadme(FANCY);
  assert.equal(r.title, 'motion-kit');
  assert.equal(r.subtitle, 'Code-only motion videos of your UI, cut to the beat of a song. Made with Node. Second line of the same paragraph.');
  assert.deepEqual(r.items, [
    { label: 'Sequences', detail: 'chapters on one song', tag: 'feature' },
    { label: 'Footage', detail: 'real-app captures that play in the piece', tag: 'feature' },
    { label: 'Beat grid', detail: 'measured, not guessed continued on the next line', tag: 'feature' },
    { label: 'Gallery', detail: 'every component, rendered', tag: 'feature' },
    { label: 'Plain bullet with no split', tag: 'feature' },
  ]);
  assert.equal(r.install, './install.sh');
  // relative paths kept as written, absolute ones too; badges and fenced images are not media
  assert.deepEqual(r.media, [
    { path: 'docs/media/logo.png', alt: 'motion-kit logo' },
    { path: 'docs/media/launch.gif', alt: 'the launch video' },
    { path: 'https://example.com/shot.png', alt: 'a shot' },
    { path: '/abs/shot2.png', alt: 'second' },
  ]);
  for (const s of [r.title, r.subtitle, ...r.items.flatMap((i) => [i.label, i.detail ?? ''])]) {
    assert.doesNotMatch(s, /[[\]<>*`]|!\[|\p{Extended_Pictographic}|:sparkles:/u, s);
  }
});

test('parseReadme: no features section -> the first top-level list; "what it does" and "highlights" count', () => {
  const md = '# Tool\n\nDoes a thing.\n\n## Usage\n\n* one: first\n* two\n\n## More\n\n- three\n';
  assert.deepEqual(parseReadme(md).items, [
    { label: 'one', detail: 'first', tag: 'feature' },
    { label: 'two', tag: 'feature' },
  ]);
  const md2 = '# Tool\n\n- not this\n\n### What it does\n\n- this one\n\n### Next\n\n- not this either\n';
  assert.deepEqual(parseReadme(md2).items, [{ label: 'this one', tag: 'feature' }]);
  assert.deepEqual(parseReadme('# T\n\n## HIGHLIGHTS\n\n+ shiny\n').items, [{ label: 'shiny', tag: 'feature' }]);
});

test('parseReadme: no list -> items []; no heading -> no title; no fence -> no install', () => {
  const r = parseReadme('Just a paragraph.\n\nAnother one.\n');
  assert.deepEqual(r.items, []);
  assert.equal(r.title, undefined);
  assert.equal(r.subtitle, 'Just a paragraph.');
  assert.equal(r.install, undefined);
  assert.deepEqual(r.media, []);
  assert.deepEqual(parseReadme(''), { title: undefined, subtitle: undefined, items: [], install: undefined, media: [] });
});

test('parseReadme: install falls back to the first fence; comment lines and "$ " skipped; ~~~ fences', () => {
  assert.equal(parseReadme('# T\n\n```js\nimport x from "y";\n```\n').install, 'import x from "y";');
  assert.equal(parseReadme('# T\n\n```\nfirst\n```\n\n~~~console\n# set up\n$ make install\n~~~\n').install, 'make install');
  assert.equal(parseReadme('# T\n\n```sh\n\n```\n').install, undefined);
});

test('parseReadme: an HTML <h1> is a title, setext-free; title cleaned of links and code', () => {
  assert.equal(parseReadme('<h1 align="center">Fancy <code>kit</code></h1>\n\nTagline here.\n').title, 'Fancy kit');
  assert.equal(parseReadme('# [`kit`](https://x.y) ##\n').title, 'kit');
  assert.equal(parseReadme('<h1 align="center">Fancy</h1>\n\nTagline here.\n').subtitle, 'Tagline here.');
});

test('parseReadme: an HTML caption is skipped, a centred HTML tagline is kept, inline tags leave no gaps', () => {
  const md = '# Kit\n\n<p align="center"><sub>Made with (<a href="x">@me</a>), used under licence.</sub></p>\n\n'
    + '<p align="center">The <b>fast</b> kit (<a href="https://x.y">@kit</a>)</p>\n';
  assert.equal(parseReadme(md).subtitle, 'The fast kit (@kit)');
});

test('parseReadme: blockquote tagline, entities, task-list markers, duplicate media once', () => {
  const r = parseReadme('# T\n\n> A *quoted* tagline &amp; more&nbsp;here\n\n- [x] done: yes\n- [ ] todo\n\n![a](p.png)\n![b](p.png)\n');
  assert.equal(r.subtitle, 'A quoted tagline & more here');
  assert.deepEqual(r.items, [{ label: 'done', detail: 'yes', tag: 'feature' }, { label: 'todo', tag: 'feature' }]);
  assert.deepEqual(r.media, [{ path: 'p.png', alt: 'a' }]);
});

test('parseReadme: a features section of sub-headings gives label + first paragraph', () => {
  const md = '# T\n\n## Features\n\n### Fast ⚡\n\nRenders in **seconds**.\nReally.\n\nMore text.\n\n### Tiny\n\n### Typed\n\nTypes included.\n\n## Install\n\nNo.\n';
  assert.deepEqual(parseReadme(md).items, [
    { label: 'Fast', detail: 'Renders in seconds. Really.', tag: 'feature' },
    { label: 'Tiny', tag: 'feature' },
    { label: 'Typed', detail: 'Types included.', tag: 'feature' },
  ]);
});

test('parseReadme: bullets that are a link to a .md file are docs, not features', () => {
  const md = '# T\n\n- [CATALOG.md](a/CATALOG.md): every component\n- [`Guide`](docs/guide.md#start)\n\nText.\n\n- a later list is not the first list\n';
  assert.deepEqual(parseReadme(md).items, []);
  const mixed = '# T\n\n- [Guide](guide.md)\n- Real feature: yes\n';
  assert.deepEqual(parseReadme(mixed).items, [{ label: 'Real feature', detail: 'yes', tag: 'feature' }]);
});

test('parseReadme: a paragraph of linked remote images is badges: not media, not subtitle', () => {
  const md = '# T\n\n[![Build Status](https://travis-ci.org/o/r.svg?branch=master)](https://travis-ci.org/o/r)\n'
    + '<a href="https://x.y"><img src="https://coveralls.io/repos/o/r.svg"></a>\n\n'
    + '[![logo](docs/logo.png)](https://site.example)\n\nTagline.\n\n![shot](https://example.com/shot.png)\n';
  const r = parseReadme(md);
  assert.equal(r.subtitle, 'Tagline.');
  assert.deepEqual(r.media, [{ path: 'docs/logo.png', alt: 'logo' }, { path: 'https://example.com/shot.png', alt: 'shot' }]);
});

test('parseReadme: a leading bold run is the label, even with a separator inside the rest', () => {
  const md = '# T\n\n## Features\n\n- **Fast:** builds in 2: seconds\n- **Small** ships - light\n- __Typed__\n';
  assert.deepEqual(parseReadme(md).items, [
    { label: 'Fast', detail: 'builds in 2: seconds', tag: 'feature' },
    { label: 'Small', detail: 'ships - light', tag: 'feature' },
    { label: 'Typed', tag: 'feature' },
  ]);
});

test('parseReadme: a bullet that is only a link (#anchor, URL or .md), with or without a description, is navigation', () => {
  const toc = '# T\n\nTagline.\n\n## Table of contents\n\n- [Install](#install)\n- [Usage](#usage)\n  - [Flags](#flags)\n'
    + '- [Docs](https://example.com/docs): the full guide\n- [`API`](docs/api.md) — reference\n\n## Install\n\nRun it.\n';
  assert.deepEqual(parseReadme(toc).items, []);
  assert.deepEqual(parseReadme('# T\n\n## Contents\n\n1. [Why](#why)\n2. [How](#how)\n').items, []);
  // a link that is part of the words is still an item; a relative non-.md link with a description too
  const kept = '# T\n\n## Features\n\n- Works with [Node](https://nodejs.org) 20\n- [Gallery](gallery/): every component\n- [Site](https://x.y) integration: on save\n';
  assert.deepEqual(parseReadme(kept).items, [
    { label: 'Works with Node 20', tag: 'feature' },
    { label: 'Gallery', detail: 'every component', tag: 'feature' },
    { label: 'Site integration', detail: 'on save', tag: 'feature' },
  ]);
});

test('parseReadme: numbered list items count as bullets', () => {
  const md = '# T\n\n## Features\n\n1. **Fast**: renders in seconds\n2) Small - ships light\n   continued\n10. Typed\n';
  assert.deepEqual(parseReadme(md).items, [
    { label: 'Fast', detail: 'renders in seconds', tag: 'feature' },
    { label: 'Small', detail: 'ships light continued', tag: 'feature' },
    { label: 'Typed', tag: 'feature' },
  ]);
  assert.deepEqual(parseReadme('# T\n\n1. one: first\n2. two\n').items,
    [{ label: 'one', detail: 'first', tag: 'feature' }, { label: 'two', tag: 'feature' }]);
});

test('parseReadme: a features heading with nothing usable gives no items, never another section\'s list', () => {
  const empty = '# T\n\n- not this\n\n## Features\n\nComing soon.\n\n## Usage\n\n- not this either\n';
  assert.deepEqual(parseReadme(empty).items, []);
  const docs = '# T\n\n- not this\n\n## Features\n\n- [Guide](docs/guide.md)\n- [More](#more)\n\n## Usage\n\n- no\n';
  assert.deepEqual(parseReadme(docs).items, []);
});

test('parseReadme: a features section of only doc links falls back to its own sub-headings', () => {
  const md = '# T\n\n## Features\n\n- [Guide](docs/guide.md)\n- [API](#api)\n\n### Fast\n\nRenders quickly.\n\n### Tiny\n\n## Usage\n\n- no\n';
  assert.deepEqual(parseReadme(md).items, [
    { label: 'Fast', detail: 'Renders quickly.', tag: 'feature' },
    { label: 'Tiny', tag: 'feature' },
  ]);
});
