// helpers.test.mjs -- unit tests for the pure helpers components share.
import test from 'node:test';
import assert from 'node:assert/strict';
import Springs from '../../../shared/springs.js';
import { edges, fmt, role, cssRole, icon, pressDepth, prog, fade } from '../components/core/helpers.js';

const ctx = { Springs, beat_sec: 0.5, theme: { canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0c7d74', pos: 'oops' } };

test('edges: leading edge moves first, nothing overshoots, it settles', () => {
  const ch = [{ t: 0, index: 3 }];
  const mid = edges(ctx, 0, ch, 0.05, 0.22, 4);
  assert.ok((mid.right - 1) / 3 > mid.left / 3, 'right edge leads when moving right');
  for (let t = 0; t < 1; t += 0.002) {
    const e = edges(ctx, 0, ch, t, 0.22, 4);
    assert.ok(e.left <= 3 + 1e-9 && e.right <= 4 + 1e-9);
  }
  const end = edges(ctx, 0, ch, 2, 0.22, 4);
  assert.ok(Math.abs(end.left - 3) < 1e-6 && Math.abs(end.right - 4) < 1e-6);
  const back = edges(ctx, 4, [{ t: 0, index: 0 }], 0.05, 0.22, 5);
  assert.ok((4 - back.left) / 4 > (5 - back.right) / 4, 'left edge leads when moving left');
});

test('edges: quick reversals never leave [0, n], invert, or pass the final target', () => {
  const n = 5;
  for (const [a, b, c] of [[0, 2, 0], [1, 4, 0], [3, 1, 3], [4, 0, 4]]) for (const delay of [0.01, 0.03, 0.06, 0.1, 0.15, 0.2]) {
    const ch = [{ t: 0, index: b }, { t: delay, index: c }];
    for (let t = 0; t < 1.5; t += 0.002) {
      const e = edges(ctx, a, ch, t, 0.22, n);
      const tag = `${a}>${b}>${c} @${delay} t=${t.toFixed(3)}`;
      assert.ok(e.left >= 0 && e.left <= e.right + 1e-9 && e.right <= n, `bounds ${tag}: ${JSON.stringify(e)}`);
      if (t > delay) {
        if (c > a) assert.ok(e.left <= c + 1e-9 && e.right <= c + 1 + 1e-9, `pass fwd ${tag}`);
        if (c < a) assert.ok(e.left >= c - 1e-9 && e.right >= c + 1 - 1e-9, `pass back ${tag}`);
      }
    }
    const end = edges(ctx, a, ch, 3, 0.22, n);
    assert.ok(Math.abs(end.left - c) < 1e-6 && Math.abs(end.right - c - 1) < 1e-6);
  }
});

test('fmt: grouping, decimals, prefix/suffix, and no "-0"', () => {
  assert.equal(fmt(1234.5, { decimals: 1, prefix: '£' }), '£1,234.5');
  assert.equal(fmt(-1234, { prefix: '£' }), '-£1,234');
  assert.equal(fmt(12, { suffix: '%' }), '12%');
  assert.equal(fmt(-0.4), '0');
  assert.equal(fmt(-0.04, { decimals: 1 }), '0.0');
  assert.equal(fmt(-0.6), '-1');
});

test('role: a theme colour or the fallback', () => {
  assert.equal(role(ctx, 'accent', 'ink'), 'accent');
  assert.equal(role(ctx, 'neg', 'ink'), 'ink');      // missing
  assert.equal(role(ctx, 'pos', 'accent'), 'accent'); // not a colour
  assert.equal(cssRole(ctx, 'neg', 'ink'), 'var(--ink)');
});

test('icon: an unknown name is a clear error', () => {
  const node = () => ({ setAttribute() {}, appendChild(c) { return c; } });
  globalThis.document = { createElementNS: node, createElement: node };
  try {
    assert.ok(icon(node(), 'check'));
    assert.throws(() => icon(node(), 'chek'), /unknown icon "chek".*check/);
  } finally { delete globalThis.document; }
});

test('pressDepth: true dips and recovers, down holds until up', () => {
  const bs = ctx.beat_sec, c = (presses) => ({ ...ctx, presses });
  const tap = c([{ t: 1, kind: true, hotspot: 'button' }]);
  assert.equal(pressDepth(tap, 0.5), 0);
  assert.ok(pressDepth(tap, 1 + 0.05 * bs) > 0.5, 'dipped at the press');
  assert.ok(pressDepth(tap, 2) < 0.01, 'recovered a beat later');
  const hold = c([{ t: 1, kind: 'down', hotspot: 'button' }, { t: 3, kind: 'up', hotspot: 'button' }]);
  for (const t of [1.5, 2, 2.9]) assert.ok(pressDepth(hold, t) > 0.99, `held at ${t}`);
  assert.ok(pressDepth(hold, 4) < 0.01, 'released after up');
});

test('prog/fade: a start of -Infinity means already in, never NaN', () => {
  assert.equal(prog(ctx, 0, -Infinity), 1);
  assert.deepEqual(fade(ctx, 0, -Infinity), { o: 1, y: 0, blur: 0 });
  assert.ok(fade(ctx, 1.05, -Infinity, 1).o < 1, 'still exits at tOut');
});
