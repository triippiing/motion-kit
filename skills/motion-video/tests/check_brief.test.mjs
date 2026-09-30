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
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  // Intentionally sparse: its mid-piece quiet beats are reported, the settling tail (14, 15) is not.
  assert.match(r.warnings.join('\n'), /quiet beats \(nothing starts on them\): 3, 5, 6, 7, 8, 9, 10, 11, 12, 13;/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 0);
});

test('```javascript fences and CRLF line endings are read', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good).replace('```js', '```javascript').replace(/\n/g, '\r\n'));
  assert.deepEqual((await checkBrief(dir)).errors, []);
});

test('section headings must be headings on their own line', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good).replace('## Request\n', 'See ## Request above\n'));
  assert.match((await checkBrief(dir)).errors.join('\n'), /missing section "## Request"/);
});

test('beat table code that never returns times out with a readable error', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(`const states = () => { for (;;) {} };\nconst cursor = () => [];`));
  assert.match((await checkBrief(dir)).errors.join('\n'), /beat table code took longer than 1 s to run/);
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
  assert.deepEqual(r.warnings, [], 'the example has something starting on every beat and fits the state budget');
  const uses = new Set([...blocks[0].matchAll(/use: '([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(uses.size >= 12, `the example uses 12 library components (got ${uses.size}: ${[...uses].join(', ')})`);
});

// A launch video that ends on a different state than it starts: not a loop.
const oneOff = good.replace("{ at: END - 2, use: 'button', label: 'Go' }", "{ at: END - 2, use: 'check', label: 'Done' }")
  .replace("{ at: END - 2, x: 240, y: 280 }", "{ at: END - 2, x: 0, y: 300 }");

test('a non-looping brief fails as a loop, passes with --no-loop or "loop": false in project.json', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(oneOff));
  assert.match((await checkBrief(dir)).errors.join('\n'), /the last row must repeat the first/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 1);
  assert.deepEqual((await checkBrief(dir, { loop: false })).errors, []);
  const cli = spawnSync('node', [SCRIPT, dir, '--no-loop'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /brief OK \(not a loop\)/);
  const pj = path.join(dir, 'project.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), loop: false }));
  assert.deepEqual((await checkBrief(dir)).errors, []);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 0);
});

test('not a loop: quiet beats run to the end (no seam tail)', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(oneOff));
  assert.match((await checkBrief(dir, { loop: false })).warnings.join('\n'), /quiet beats \(nothing starts on them\): 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15;/);
});

test('an unknown flag is a usage error', () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  const r = spawnSync('node', [SCRIPT, dir, '--noloop'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option "--noloop"/);
});

test('a malformed project.json is a warning (checked as a loop), not silently ignored', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  writeFileSync(path.join(dir, 'project.json'), '{ "loop": false,');
  const r = await checkBrief(dir);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /project\.json is not valid JSON \(.+\); checking as a loop/);
  const cli = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(cli.stdout, /warning: project\.json is not valid JSON/);
});
