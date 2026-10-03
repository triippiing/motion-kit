// framecheck-audit.test.mjs -- the frame check reports nothing on the five recipes (no recipe text runs past its
// shape or is cut off, and no cursor leaves the stage). The audit behind it: .superpowers/sdd/2026-10-03-hardening-f2/task-3-report.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkFrames, frameIssueText } from '../scripts/framecheck.mjs';
import { makeProject } from './harness.mjs';

// As recipes.test.mjs: each "### Title" heading's one ```js block, its tables spliced into a 7-bar, 120 BPM project.
const md = readFileSync(path.join(import.meta.dirname, '..', 'components', 'RECIPES.md'), 'utf8');
const recipes = [...md.matchAll(/^### (.+)\n[\s\S]*?```js\n([\s\S]*?)```/gm)].map((m) => ({ title: m[1], code: m[2] }));
const source = (code, name) => code.match(new RegExp(`const ${name} = \\(\\) => (\\[[\\s\\S]*?\\]);\\n(?:const|$)`))[1];

test('recipes: no frame issues', async () => {
  assert.equal(recipes.length, 5);
  for (const r of recipes) {
    const dir = makeProject({ bars: 7, bpm: 120, states: source(r.code, 'states'), cursor: source(r.code, 'cursor') });
    const got = await checkFrames(dir, {});
    assert.deepEqual(got.issues.map(frameIssueText), [], r.title);
  }
});
