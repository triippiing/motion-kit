import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { briefCode, pageCode, runTables, markerNames, projectMarkerNames, TablesError } from '../scripts/tables.mjs';
import { makeProject } from './harness.mjs';

test('briefCode joins the js blocks under ## Beat table only', () => {
  const md = '## Request\n```js\nconst nope = 1;\n```\n## Beat table\n```js\nconst a = 1;\n```\ntext\n```javascript\nconst b = 2;\n```\n';
  assert.equal(briefCode(md), 'const a = 1;\n\nconst b = 2;\n');
  assert.equal(briefCode('## Beat table\nno code'), '');
});

test('runTables evaluates with END and reports code that does not run', () => {
  const ok = runTables("const states = () => [{ at: 0, use: 'button' }, { at: END - 2, use: 'button' }];\nconst cursor = () => [{ at: 0, x: 0, y: 0 }];", 8);
  assert.equal(ok.states[1].at, 6);
  assert.throws(() => runTables('const states = () => [;', 8), (e) => e instanceof TablesError && /^beat table code does not run: /.test(e.message));
  assert.throws(() => runTables('const states = () => { for (;;) {} }; const cursor = () => [];', 8), /took longer than 1 s/);
});

test('markerNames: sorted unique string ats', () => {
  assert.deepEqual(markerNames([[{ at: 'drop' }, { at: 2 }, { at: 'chorus' }], [{ at: 'drop', offset: -0.5 }], null]), ['chorus', 'drop']);
});

test('projectMarkerNames unions index.html and the brief', () => {
  const dir = makeProject({ bars: 2, states: "[{ at: 0, use: 'button' }, { at: 'drop', use: 'button', label: 'Go' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), "## Beat table\n```js\nconst states = () => [{ at: 0, use: 'button' }, { at: 'chorus', use: 'button' }, { at: END - 2, use: 'button' }];\nconst cursor = () => [{ at: 0, x: 140, y: 100 }];\n```\n");
  assert.deepEqual(projectMarkerNames(dir), ['chorus', 'drop']);
  assert.ok(pageCode(readFileSync(path.join(dir, 'index.html'), 'utf8')).includes("at: 'drop'"));
});

test('a table that throws null or undefined is a TablesError; projectMarkerNames still answers', () => {
  for (const v of ['null', 'undefined'])
    assert.throws(() => runTables(`const states = () => { throw ${v}; }; const cursor = () => [];`, 8),
      (e) => e instanceof TablesError && /^beat table code does not run: /.test(e.message));
  const dir = makeProject({ bars: 2, states: "[{ at: 0, use: 'button' }, { at: 'drop', use: 'button' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), '## Beat table\n```js\nconst states = () => { throw null; };\nconst cursor = () => [];\n```\n');
  assert.deepEqual(projectMarkerNames(dir), ['drop']);
});
