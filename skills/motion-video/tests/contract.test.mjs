// contract.test.mjs -- every registered component honours the module contract (grows with the catalog).
import test from 'node:test';
import assert from 'node:assert/strict';
import Springs from '../../../shared/springs.js';
import { registry } from '../components/index.js';
import { typeOk, validate, RESERVED } from '../components/core/validate.js';
import { collect, catalogMd } from '../scripts/build_catalog.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const COMP = path.join(import.meta.dirname, '..', 'components');
const ROLES = /^(canvas|surface|ink|muted|accent|pos|neg|#[0-9a-f]{6})$/i;
// Anything that makes render depend on more than t. Comments are stripped first (strings are kept,
// so a CSS 'transition: ...' string still counts).
// transition/animation as a CSS property or API: 'transition: ...', style.transition =, transitionDuration,
// getAnimations; not identifiers that merely start with the word (transitionTime, animationStep).
// new Date with an argument is a fixed date; new Date, new Date; and new Date() are the clock.
const IMPURE = /\b(?:transition|animation)(?:Duration|Delay|TimingFunction|Property|Name|IterationCount|Direction|FillMode|PlayState)?\b(?!\w)|\b(?:on)?(?:transition|animation)(?:end|start|run|cancel|iteration)\b|\.animate\(|\bgetAnimations\b|Date\.now|new\s+Date\b(?!\s*\(\s*[^)\s])|Math\.random|setTimeout|setInterval|requestAnimationFrame|performance\.now/;
const code = (src) => src.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str ?? '');
// A component that really calls ctx.cursorAt (a mention in a comment does not count).
const readsCursor = (src) => /\bctx\.cursorAt\b/.test(code(src));

test('shared code and every component file read no clock and use no CSS transitions', async () => {
  const files = ['core/helpers.js', 'core/engine.js', 'modifiers.js', ...(await collect()).map((c) => c.file)];
  for (const f of files) {
    const hit = code(readFileSync(path.join(COMP, f), 'utf8')).match(IMPURE);
    assert.equal(hit, null, `${f} uses ${hit?.[0]}: render must be a pure function of t`);
  }
  assert.match(code("x = 1; // setTimeout here is fine\n/* Date.now */ y = 'transition: all'"), IMPURE, 'strings still scanned');
  assert.doesNotMatch(code('x = 1; // setTimeout in a comment\n/* Date.now */'), IMPURE, 'comments ignored');
  assert.doesNotMatch(code("d = new Date(week + 'T00:00:00Z')"), IMPURE, 'a fixed date is not the clock');
  for (const bad of ['d = new Date()', 'e.style.transition = x', 'Object.assign(e.style, { transitionDuration: 1 })', "e.style.animation = 'spin 1s'"]) assert.match(code(bad), IMPURE, bad);
  // Transition/animation events and the Web Animations API run on the clock too.
  for (const bad of ["e.addEventListener('transitionend', f)", "addEventListener('animationend', f)", 'e.ontransitionstart = f', 'el.animate([{ opacity: 0 }], 200)']) assert.match(code(bad), IMPURE, bad);
  for (const ok of ['const transitionTime = 2', 'animationStep(x)', 'let transitions = []', 'const animated = true', 'transitionEnds(x)']) assert.doesNotMatch(code(ok), IMPURE, ok);
  assert.match(code('d = new Date'), IMPURE, 'new Date without parentheses is the clock too');
  assert.match(code('d = new Date;'), IMPURE);
});

test('the cursorAt rule ignores comments', () => {
  assert.equal(readsCursor('// ctx.cursorAt is not used'), false);
  assert.equal(readsCursor('const p = ctx.cursorAt(t);'), true);
});

const theme = { canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b' }; // house: no pos/neg
const base = { beat_sec: 0.5, Springs, theme, stage: { width: 1440, height: 1440 }, beatT: (b) => b * 0.5, hex: () => [0, 0, 0] };
const withDefaults = (m, row) => Object.fromEntries(Object.entries(m.props).map(([k, [, d]]) => [k, k in row ? row[k] : structuredClone(d)]));
const exampleRow = (m) => Function(`return (${m.example})`)();
// Family hotspots ('item:<label>') without a hotspotExample naming a real member of the family.
const missingFamilyExamples = (m) => m.hotspots.filter((h) => h.includes(':<'))
  .filter((h) => { const ex = m.hotspotExample?.[h]; return typeof ex !== 'string' || !ex.startsWith(h.slice(0, h.indexOf(':<') + 1)) || ex.length <= h.indexOf(':<') + 1; });

test('a family hotspot without a hotspotExample is caught', () => {
  assert.deepEqual(missingFamilyExamples({ hotspots: ['box', 'item:<label>', 'tab:<item>'], hotspotExample: { 'tab:<item>': 'tab:Month' } }), ['item:<label>']);
  assert.deepEqual(missingFamilyExamples({ hotspots: ['tab:<item>'], hotspotExample: { 'tab:<item>': 'item:Month' } }), ['tab:<item>'], 'the example must be in the family');
});

test('the catalog lists drag hotspots only for components that have them', async () => {
  const md = catalogMd(await collect());
  const section = (n) => md.split(`### ${n}\n`)[1].split('\n### ')[0];
  assert.match(section('slider'), /\*\*Drag:\*\* `thumb`/);
  assert.doesNotMatch(section('button'), /\*\*Drag:\*\*/);
});

test('the selection components declare meta.choices', () => {
  assert.deepEqual(Object.fromEntries(['tabs', 'dropdown', 'dock', 'chip-row'].map((n) => [n, registry[n].meta.choices])),
    { tabs: { active: 'items' }, dropdown: { selected: 'items' }, dock: { active: 'items' }, 'chip-row': { selected: 'chips' } });
});

test('the typing and keyed-list components declare meta.typing and meta.unique', () => {
  assert.deepEqual(Object.fromEntries(['input', 'command'].map((n) => [n, registry[n].meta.typing])), { input: 'text', command: 'query' });
  assert.deepEqual(Object.fromEntries(['bar-chart', 'tabs', 'dropdown', 'chip-row', 'dock', 'sheet'].map((n) => [n, registry[n].meta.unique])),
    { 'bar-chart': { bars: 'label' }, tabs: { items: true }, dropdown: { items: true }, 'chip-row': { chips: true }, dock: { items: true }, sheet: { actions: true } });
});

test('the catalog row keys name the optional pos/neg roles and a badge of 0', async () => {
  const keys = catalogMd(await collect()).split('## Row keys')[1].split('\n## ')[0];
  assert.match(keys, /\| `fill` \|.*`pos`, `neg` \(when the theme defines them\)/);
  assert.match(keys, /\| `badge` \|.*0 shows none/);
  assert.match(keys, /\| `hide` \| cursor rows: .*cannot press \|/);
});

test('the registry has at least the reference component', () => {
  assert.ok(registry.button, 'button is registered');
});

for (const [name, c] of Object.entries(registry)) {
  test(`${name}: meta is complete and consistent`, () => {
    const m = c.meta;
    for (const k of ['name', 'group', 'useWhen', 'motion', 'example']) assert.ok(typeof m[k] === 'string' && m[k].length, `meta.${k}`);
    assert.ok(Array.isArray(m.hotspots) && Array.isArray(m.sounds) && Array.isArray(m.edgeCases));
    assert.match(m.example, /^\{ at: [\d.]+, use: '[a-z-]+'.*\}$/, 'example must be a single-line { at: N, use: ... } literal');
    const ex = exampleRow(m);
    assert.equal(ex.use, name);
    for (const [k, [ty, def]] of Object.entries(m.props)) assert.ok(typeOk(ty, def), `default of ${k} matches ${ty}`);
    for (const k of Object.keys(m.props)) assert.ok(!RESERVED.has(k), `prop "${k}" is a reserved row key (${[...RESERVED].join(', ')})`);
    const src = readFileSync(path.join(COMP, m.group, `${name}.js`), 'utf8');
    if (readsCursor(src)) assert.ok(m.drag, 'a component that reads ctx.cursorAt is dragged: list its drag hotspots in meta.drag');
    if (m.drag !== undefined) {
      assert.ok(Array.isArray(m.drag) && m.drag.length, 'meta.drag is a non-empty array of hotspots');
      for (const d of m.drag) assert.ok(m.hotspots.includes(d), `meta.drag entry "${d}" is one of the hotspots (${m.hotspots.join(', ')})`);
    }
    if (m.choices !== undefined) {
      assert.ok(m.choices && typeof m.choices === 'object' && Object.keys(m.choices).length, 'meta.choices is a non-empty { prop: listProp } object');
      for (const [k, list] of Object.entries(m.choices)) {
        assert.ok(['string', 'string[]'].includes(m.props[k]?.[0]), `meta.choices key "${k}" is a string or string[] prop`);
        assert.equal(m.props[list]?.[0], 'string[]', `meta.choices "${k}" picks from "${list}", a string[] prop`);
      }
    }
    if (m.typing !== undefined) {
      assert.equal(m.props[m.typing]?.[0], 'string', `meta.typing "${m.typing}" is a string prop`);
      for (const k of ['typeAt', 'perChar']) assert.equal(m.props[k]?.[0], 'number', `a typing component has a number prop ${k}`);
    }
    if (m.unique !== undefined) {
      assert.ok(m.unique && typeof m.unique === 'object' && Object.keys(m.unique).length, 'meta.unique is a non-empty { listProp: true | field } object');
      for (const [list, field] of Object.entries(m.unique)) {
        if (field === true) assert.equal(m.props[list]?.[0], 'string[]', `meta.unique "${list}": true needs a string[] prop`);
        else assert.ok(typeof field === 'string' && m.props[list]?.[0] === 'object[]', `meta.unique "${list}": '<field>' needs an object[] prop`);
      }
    }
    assert.deepEqual(missingFamilyExamples(m), [], 'every family hotspot needs a hotspotExample naming one real member (e.g. { \'tab:<item>\': \'tab:Month\' })');
    for (const f of ['geometry', 'mount', 'render', 'hotspot']) assert.equal(typeof c[f], 'function', f);
  });

  test(`${name}: geometry fits the stage for the example and every edge case`, () => {
    for (const row of [exampleRow(c.meta), ...c.meta.edgeCases]) {
      const g = c.geometry(withDefaults(c.meta, row), base);
      for (const k of ['w', 'h', 'r']) assert.ok(Number.isFinite(g[k]) && g[k] > 0, `${k} for ${JSON.stringify(row)}`);
      assert.ok(g.w <= 1400 && g.h <= 1400, `fits 1440 stage: ${g.w}x${g.h}`);
      assert.match(g.fill, ROLES, `fill for ${JSON.stringify(row)} is a theme role or #rrggbb`);
      assert.match(g.ink, ROLES, `ink for ${JSON.stringify(row)} is a theme role or #rrggbb`);
    }
  });

  test(`${name}: hotspots resolve inside the shape`, () => {
    const ex = exampleRow(c.meta), p = withDefaults(c.meta, ex), geo = c.geometry(p, base);
    const names = c.meta.hotspots.map((h) => (h.includes(':<') ? (c.meta.hotspotExample?.[h] ?? null) : h)).filter(Boolean);
    for (const h of names) {
      const pt = c.hotspot(h, p, geo, base);
      assert.ok(pt, `hotspot ${h} resolves`);
      assert.ok(c.hotspot(h, p, geo, {}), `hotspot ${h} resolves without a ctx (validation and routing call it with {})`);
      assert.ok(Math.abs(pt.x) <= geo.w / 2 && Math.abs(pt.y) <= geo.h / 2, `${h} inside ${geo.w}x${geo.h}: ${JSON.stringify(pt)}`);
    }
  });

  test(`${name}: example validates as a one-row loop`, () => {
    const ex = exampleRow(c.meta);
    const song = { beats: Array.from({ length: 8 }, (_, i) => ({ i, t: i * 0.5 })) };
    const r = validate({ states: [{ ...ex, at: 0 }, { ...ex, at: 6 }], cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song });
    assert.deepEqual(r.errors, []);
  });
}

test("demo 04's components/core is byte-identical to the library's", () => {
  const demo = path.resolve(COMP, '../../../demos/04-library-reference/components/core');
  const files = readdirSync(demo);
  assert.ok(files.length > 0);
  for (const f of files)
    assert.ok(readFileSync(path.join(demo, f)).equals(readFileSync(path.join(COMP, 'core', f))), `demos/04-library-reference/components/core/${f} differs from the library's (copy it in)`);
});
