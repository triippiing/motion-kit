import test from 'node:test';
import assert from 'node:assert/strict';
import Springs from '../../../shared/springs.js';
import { createScene } from '../components/core/engine.js';

// Minimal DOM: enough for createScene with component rows (mount only appends children).
function node() {
  return { style: {}, children: [], dataset: {}, attrs: {}, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, querySelectorAll() { return []; }, set textContent(v) { this.text = v; } };
}
globalThis.document = { createElement: () => node(), createElementNS: () => node() };

const renders = [];
const box = (name, hotspots = ['box'], extra = {}) => ({
  meta: { name, props: { label: ['string', 'x'] }, hotspots, sounds: [] },
  geometry: () => ({ w: 200, h: 100, r: 20, fill: 'surface', ink: 'ink' }),
  mount() {}, render(el, props, ctx, t) { renders.push({ name, t, presses: ctx.presses.length }); },
  hotspot: (h) => (h === 'box' || h.startsWith('item:') ? { x: 10, y: -5 } : null), ...extra,
});
const seen = [];
const registry = { a: box('a'), b: box('b', ['item:<i>'], { sfx: () => [{ beat: 3, file: 'sfx/key.wav', gain: 0.5 }] }),
  // e: its end state counts its presses; its hotspot records the ctx it was given.
  e: box('e', ['box'], { endState: (p, ctx) => ({ ...p, label: `${p.label}+${ctx.presses.length}` }),
    hotspot: (h, p, geo, ctx) => { seen.push({ label: p.label, prev: ctx.prev, settled: ctx.settled }); return { x: 0, y: 0 }; } }) };
const song = { beat_sec: 0.5, beats: Array.from({ length: 16 }, (_, i) => ({ i, t: i * 0.5 })), rules: { spring: { zeta: 0.85, settle_sec: 0.3 } } };
const theme = { canvas: '#eeeeee', surface: '#ffffff', ink: '#111111', muted: '#888888', accent: '#0c7d74' };
const make = (states, cursor, extra = {}) => createScene({ states, cursor, song, stage: { width: 1440, height: 1440 }, theme,
  beatT: (b) => b * 0.5, Springs, registry, dom: { camera: node(), shape: node(), cursor: node() }, ...extra });

test('validation errors throw one readable error', () => {
  assert.throws(() => make([{ at: 0, use: 'nope' }], [{ at: 0, x: 0, y: 0 }]), /motion-kit: .*unknown component "nope"/s);
});

test('cursor targets resolve to hotspot + offset', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 2, target: 'box', dx: 5 }, { at: 12, x: 0, y: 0 }]);
  assert.deepEqual(s.cursorRows[1], { at: 2, target: 'box', dx: 5, x: 15, y: -5 });
});

test('a press on the beat a row starts reaches that row', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 4, target: 'item:2', press: true }, { at: 12, x: 0, y: 0 }]);
  assert.equal(s.rows[1].ctx.presses.length, 1);
  assert.equal(s.rows[1].ctx.presses[0].hotspot, 'item:2');
  assert.equal(s.rows[0].ctx.presses.length, 0);
});

test('row 0 is settled; later rows start at their beat', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }], [{ at: 0, x: 0, y: 0 }, { at: 12, x: 0, y: 0 }]);
  assert.equal(s.rows[0].ctx.t0, -1e6);
  assert.equal(s.rows[1].ctx.t0, 2);
  assert.equal(s.rows[1].ctx.t1, 6);
});

test('sfx merges presses, key rows, component sounds and extras', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 2, x: 0, y: 0, press: true, sound: 'key' }, { at: 12, x: 0, y: 0 }],
    { extraSfx: [{ beat: 9, file: 'sfx/x.wav', gain: 1 }] });
  const files = s.sfx.map((x) => `${x.beat}:${x.file}`).sort();
  assert.deepEqual(files, ['2:sfx/click.wav', '2:sfx/key.wav', '3:sfx/key.wav', '9:sfx/x.wav']);
});

test('seek renders every component row every frame at the given t', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }], [{ at: 0, x: 0, y: 0 }, { at: 12, x: 0, y: 0 }]);
  renders.length = 0; s.seek(1.23);
  assert.deepEqual(renders.map((r) => r.name), ['a', 'b', 'a']);
  assert.ok(renders.every((r) => r.t === 1.23));
});

const fakeDom = () => ({ camera: node(), shape: node(), cursor: node() });
const snapshot = (dom) => JSON.stringify([dom.camera.style, dom.shape.style, dom.cursor.style, dom.shape.children.map((c) => c.style)]);

test('seek is pure: seek(a), seek(b), seek(a) leaves identical styles', () => {
  const dom = fakeDom();
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 3, x: 80, y: 40, press: true }, { at: 12, x: 0, y: 0 }], { dom });
  s.seek(2.1); const first = snapshot(dom);
  s.seek(5.7); assert.notEqual(snapshot(dom), first);
  s.seek(2.1); assert.equal(snapshot(dom), first);
});

test('a press just before a row starts reaches that row via look-ahead', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 3.5, target: 'item:1', press: true }, { at: 12, x: 0, y: 0 }]);
  assert.equal(s.rows[1].ctx.presses.length, 1);
  assert.equal(s.rows[1].ctx.presses[0].hotspot, 'item:1');
  assert.equal(s.rows[0].ctx.presses.length, 0);
});

test('consecutive rows with the same component are continuations, not crossfades', () => {
  const dom = fakeDom();
  const s = make([{ at: 0, use: 'a', label: 'p' }, { at: 4, use: 'a', label: 'q' }, { at: 8, use: 'b' }, { at: 12, use: 'a', label: 'p' }],
    [{ at: 0, x: 0, y: 0 }, { at: 12, x: 0, y: 0 }], { dom });
  assert.equal(s.rows[0].ctx.continues, false); assert.equal(s.rows[0].ctx.prev, null);
  assert.equal(s.rows[1].ctx.continues, true); assert.deepEqual(s.rows[1].ctx.prev, { label: 'p' });
  assert.equal(s.rows[2].ctx.continues, false); assert.equal(s.rows[2].ctx.prev, null);
  const op = (i) => dom.shape.children[i].style.opacity;
  s.seek(0.5 * 4.01); // continuation: row 1 is fully in and row 0 fully out, no delayed entrance
  assert.ok(op(1) > 0.999, `row 1 opacity ${op(1)}`);
  assert.ok(op(0) < 0.001, `row 0 opacity ${op(0)}`);
  s.seek(0.5 * 8.01); // different component: still the delayed crossfade
  assert.ok(op(2) < 0.01, `row 2 opacity ${op(2)}`);
  assert.ok(op(1) > 0.5, `row 1 opacity ${op(1)}`);
});

test('a continuation starts from the previous row\'s endState; hotspots get the row\'s own ctx; row 0 is settled', () => {
  seen.length = 0;
  const s = make([{ at: 0, use: 'a' }, { at: 2, use: 'e', label: 'p' }, { at: 6, use: 'e', label: 'q' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 3, target: 'box', press: true }, { at: 4, target: 'box', press: true }, { at: 7, target: 'box' }, { at: 12, x: 0, y: 0 }]);
  assert.deepEqual(s.rows[2].ctx.prev, { label: 'p+2' }, 'prev is endState of row 1 after its two presses');
  assert.deepEqual(s.rows[1].ctx.prev, null);
  assert.deepEqual(seen.at(-1), { label: 'q', prev: { label: 'p+2' }, settled: false }, 'hotspot on row 2 sees its ctx');
  assert.deepEqual(s.rows.map((r) => r.ctx.settled), [true, false, false, false]);
  // Without endState, prev stays the previous row's props.
  const t = make([{ at: 0, use: 'a', label: 'p' }, { at: 4, use: 'a', label: 'q' }, { at: 12, use: 'a', label: 'p' }],
    [{ at: 0, x: 0, y: 0 }, { at: 2, target: 'box', press: true }, { at: 12, x: 0, y: 0 }]);
  assert.deepEqual(t.rows[1].ctx.prev, { label: 'p' });
});

test('ctx.targets: each row sees the cursor rows aimed at it, and other cursor rows in its window as null', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 2, target: 'box' }, { at: 5, target: 'item:3' }, { at: 6, target: 'item:3', press: true }, { at: 7, x: 40, y: 0 }, { at: 12, x: 0, y: 0 }]);
  assert.deepEqual(s.rows[1].ctx.targets, [{ t: 2.5, target: 'item:3', press: null }, { t: 3, target: 'item:3', press: true }, { t: 3.5, target: null, press: null }]);
  assert.deepEqual(s.rows[0].ctx.targets, [{ t: 0, target: null, press: null }, { t: 1, target: 'box', press: null }]);
  assert.deepEqual(s.rows[2].ctx.targets, [{ t: 6, target: null, press: null }]);
});

test('ctx.targets: a continuation starts with the previous row\'s latest aim, re-timed to its t0', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 8, use: 'b' }, { at: 10, use: 'a' }, { at: 12, use: 'a' }],
    [{ at: 0, x: 0, y: 0 }, { at: 5, target: 'item:3' }, { at: 6, target: 'item:3', press: true }, { at: 9, target: 'item:1' }, { at: 12, x: 0, y: 0 }]);
  assert.deepEqual(s.rows[2].ctx.targets, [{ t: 4, target: 'item:3', press: null, carried: true }, { t: 4.5, target: 'item:1', press: null }]);
  // Not a continuation: nothing carried.
  assert.deepEqual(s.rows[1].ctx.targets.filter((e) => e.carried), []);
  // A continuation whose predecessor saw no cursor row carries nothing.
  assert.deepEqual(s.rows[4].ctx.targets, [{ t: 6, target: null, press: null }]);
});
