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
const registry = { a: box('a'), b: box('b', ['item:<i>'], { sfx: () => [{ beat: 3, file: 'sfx/key.wav', gain: 0.5 }] }) };
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

test('seek renders every component row every frame (purity)', () => {
  const s = make([{ at: 0, use: 'a' }, { at: 4, use: 'b' }, { at: 12, use: 'a' }], [{ at: 0, x: 0, y: 0 }, { at: 12, x: 0, y: 0 }]);
  renders.length = 0; s.seek(1.23);
  assert.deepEqual(renders.map((r) => r.name), ['a', 'b', 'a']);
  assert.ok(renders.every((r) => r.t === 1.23));
});
