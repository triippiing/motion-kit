import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './harness.mjs';
import { checkBrief } from '../scripts/check_brief.mjs';   // async

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check_brief.mjs');
const brief = (tables, sections = true) => `# Motion brief\n\n${sections ? '## Request\nA promo.\n\n## Decisions\n- square\n\n## Moments\n1. Import -> button\n\n' : ''}## Beat table\n\n| # | bar.beat | t | component | what changes | sound |\n|---|---|---|---|---|---|\n\n\`\`\`js\n${tables}\n\`\`\`\n`;
const good = `const states = () => [\n  { at: 0, use: 'button', label: 'Go' },\n  { at: 4, use: 'check' },\n  { at: END - 2, use: 'button', label: 'Go' },\n];\nconst cursor = () => [\n  { at: 0, x: 240, y: 280 },\n  { at: 1.5, target: 'button' },\n  { at: 2, target: 'button', press: true },\n  { at: END - 2, x: 240, y: 280 },\n];`;

test('a good brief passes', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  assert.deepEqual((await checkBrief(dir)).errors, []);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 0);
});

test('bad component and missing sections are errors', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("use: 'check'", "use: 'chek'"), false));
  const r = await checkBrief(dir);
  assert.match(r.errors.join('\n'), /did you mean "check"/);
  assert.match(r.errors.join('\n'), /missing section "## Request"/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 1);
});

test('strict holds apply', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("{ at: 4, use: 'check' }", "{ at: 1, use: 'check' }")));
  assert.match((await checkBrief(dir)).errors.join('\n'), /holds 1 beat; min_hold_beats is 2/);
});

test('no brief is a usage error', () => {
  assert.equal(spawnSync('node', [SCRIPT, makeProject({ bars: 4 })]).status, 2);
});

test('the state-plan.md worked example passes strict validation on a 7-bar 120 BPM song', async () => {
  const md = readFileSync(path.resolve(import.meta.dirname, '../../motion-design/references/state-plan.md'), 'utf8');
  const blocks = [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1, 'state-plan.md has exactly one ```js block');
  const dir = makeProject({ bars: 7, bpm: 120 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(blocks[0]));
  const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  assert.equal(song.beats.length, 28);
  assert.equal(song.rules.min_hold_beats, 2);
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  const uses = new Set([...blocks[0].matchAll(/use: '([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(uses.size >= 12, `the example uses 12 library components (got ${uses.size}: ${[...uses].join(', ')})`);
});
