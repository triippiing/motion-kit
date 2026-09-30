// contract.test.mjs -- every registered component honours the module contract (grows with the catalog).
import test from 'node:test';
import assert from 'node:assert/strict';
import Springs from '../../../shared/springs.js';
import { registry } from '../components/index.js';
import { typeOk, validate, RESERVED } from '../components/core/validate.js';
import { collect } from '../scripts/build_catalog.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const COMP = path.join(import.meta.dirname, '..', 'components');
const ROLES = /^(canvas|surface|ink|muted|accent|pos|neg|#[0-9a-f]{6})$/i;
// Anything that makes render depend on more than t. Comments are stripped first (strings are kept,
// so a CSS 'transition: ...' string still counts).
// transition/animation as a CSS property in any spelling: 'transition: ...', style.transition =, transitionDuration.
const IMPURE = /\b(?:transition|animation)|Date\.now|new\s+Date\s*\(\s*\)|Math\.random|setTimeout|setInterval|requestAnimationFrame|performance\.now/;
const code = (src) => src.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str ?? '');

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
});

const theme = { canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b' }; // house: no pos/neg
const base = { beat_sec: 0.5, Springs, theme, stage: { width: 1440, height: 1440 }, beatT: (b) => b * 0.5, hex: () => [0, 0, 0] };
const withDefaults = (m, row) => Object.fromEntries(Object.entries(m.props).map(([k, [, d]]) => [k, k in row ? row[k] : structuredClone(d)]));
const exampleRow = (m) => Function(`return (${m.example})`)();

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
