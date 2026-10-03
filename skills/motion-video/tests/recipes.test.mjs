// recipes.test.mjs -- every recipe in components/RECIPES.md is a working, warning-free 7-bar loop at 120 BPM,
// and the template component in components/WRITING-A-COMPONENT.md honours the module contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Springs from '../../../shared/springs.js';
import path from 'node:path';
import vm from 'node:vm';
import { validate, typeOk, RESERVED } from '../components/core/validate.js';
import { registry } from '../components/index.js';
import { render } from '../scripts/render.mjs';
import { makeProject, openScene } from './harness.mjs';
import { probe } from './fixtures.mjs';
import { tempDir } from './tmp.mjs';

const md = readFileSync(path.join(import.meta.dirname, '..', 'components', 'RECIPES.md'), 'utf8');
// Each recipe: a "### Title" heading, then its one ```js block.
const recipes = [...md.matchAll(/^### (.+)\n[\s\S]*?```js\n([\s\S]*?)```/gm)].map((m) => ({ title: m[1], code: m[2] }));
const END = 28;
const song = { beat_sec: 0.5, beats: Array.from({ length: END }, (_, i) => ({ i, t: i * 0.5 })), rules: { min_hold_beats: 2, max_states: 14 } };
const tables = (code) => vm.runInContext(`${code}\n;({ states: states(), cursor: cursor() })`, vm.createContext({ END }));
// The array expressions, for splicing into a real project's index.html.
const source = (code, name) => code.match(new RegExp(`const ${name} = \\(\\) => (\\[[\\s\\S]*?\\]);\\n(?:const|$)`))[1];

test('RECIPES.md has the five recipes, one ```js block each', () => {
  assert.deepEqual(recipes.map((r) => r.title), ['Onboarding', 'Checkout', 'Dashboard tour', 'AI assistant reply', 'Settings change']);
  assert.equal([...md.matchAll(/```js\n/g)].length, recipes.length, 'no stray ```js blocks');
});

for (const r of recipes) {
  test(`${r.title}: validates strictly with no errors and no warnings`, () => {
    const { states, cursor } = tables(r.code);
    const v = validate({ states, cursor, registry, song, strict: true });
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, [], 'something starts on every beat and the states fit max_states');
    assert.ok(states.length - 1 <= song.rules.max_states);
    states.forEach((row, i) => assert.ok((states[i + 1]?.at ?? END) - row.at >= 2, `row at beat ${row.at} holds at least 2 beats`));
  });

  test(`${r.title}: runs in the browser (every beat seeks with no page errors)`, async () => {
    const s = await openScene(makeProject({ bars: 7, bpm: 120, states: source(r.code, 'states'), cursor: source(r.code, 'cursor') }));
    try {
      for (let b = 0; b < END; b++) await s.seek(b * 0.5 + 0.25);
      assert.deepEqual(s.errors, []);
    } finally { await s.close(); }
  });
}

test('the first recipe renders its first bar to video', async () => {
  const r = recipes[0];
  const dir = makeProject({ bars: 7, bpm: 120, states: source(r.code, 'states'), cursor: source(r.code, 'cursor') });
  const out = await render(dir, { preview: true, from: 0, to: 2, workers: 2 });
  const frames = Number(probe(out).streams.find((s) => s.codec_type === 'video').nb_read_frames);
  assert.ok(frames >= 110 && frames <= 125, `about 2 s at 60 fps (got ${frames} frames)`);
});

test('the WRITING-A-COMPONENT.md template is a working component (meta, geometry, hotspot, endState, example)', async () => {
  const guide = readFileSync(path.join(import.meta.dirname, '..', 'components', 'WRITING-A-COMPONENT.md'), 'utf8');
  const blocks = [...guide.matchAll(/```js\n(\/\/ tag\.js[\s\S]*?)```/g)];
  assert.equal(blocks.length, 1, 'one ```js block starting "// tag.js"');
  const helpers = pathToFileURL(path.join(import.meta.dirname, '..', 'components', 'core', 'helpers.js')).href;
  const f = path.join(tempDir('tag-'), 'tag.js');
  writeFileSync(f, blocks[0][1].replace("'../core/helpers.js'", `'${helpers}'`));
  const c = await import(pathToFileURL(f).href), m = c.meta;
  for (const k of ['name', 'group', 'useWhen', 'motion', 'example']) assert.ok(typeof m[k] === 'string' && m[k].length, `meta.${k}`);
  assert.match(m.example, /^\{ at: [\d.]+, use: 'tag'.*\}$/);
  for (const [k, [ty, def]] of Object.entries(m.props)) { assert.ok(typeOk(ty, def), k); assert.ok(!RESERVED.has(k), k); }
  const ctx = { beat_sec: 0.5, Springs, theme: {}, stage: { width: 1440, height: 1440 }, beatT: (b) => b * 0.5, continues: false, prev: null, t0: 2, presses: [] };
  const props = (row) => Object.fromEntries(Object.entries(m.props).map(([k, [, d]]) => [k, k in row ? row[k] : d]));
  const ex = Function(`return (${m.example})`)();
  for (const row of [ex, ...m.edgeCases]) {
    const g = c.geometry(props(row), ctx);
    assert.ok(g.w > 0 && g.w <= 1400 && g.h > 0 && g.h <= 1400, JSON.stringify(g));
  }
  const p = props(ex), geo = c.geometry(p, ctx), pt = c.hotspot('tag', p, geo, ctx);
  assert.ok(Math.abs(pt.x) <= geo.w / 2 && Math.abs(pt.y) <= geo.h / 2, 'hotspot inside the shape');
  assert.equal(c.endState(p, { ...ctx, presses: [{ t: 3, kind: true, hotspot: 'tag' }] }).selected, !p.selected, 'a press flips it');
  const r = validate({ states: [{ ...ex, at: 0 }, { ...ex, at: 6 }], cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry: { tag: c }, song: { beats: Array(8).fill(0) } });
  assert.deepEqual(r.errors, []);
});
