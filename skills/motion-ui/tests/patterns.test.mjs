import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Springs from '../assets/springs.js';

const md = readFileSync(path.join(import.meta.dirname, '../references/patterns.md'), 'utf8');
const src = md.match(/## 2\.[\s\S]*?```js\n([\s\S]*?)```/)[1];
const indicatorEdges = new Function('Springs', `${src}; return indicatorEdges;`)(Springs);

test('leading edge moves first, nothing overshoots, it settles', () => {
  const ch = [{ t: 0, index: 3 }];
  const mid = indicatorEdges(0, ch, 0.05, 0.22, 4);
  assert.ok((mid.right - 1) / 3 > mid.left / 3, 'right edge leads when moving right');
  for (let t = 0; t < 1; t += 0.002) {
    const e = indicatorEdges(0, ch, t, 0.22, 4);
    assert.ok(e.left <= 3 + 1e-9 && e.right <= 4 + 1e-9);
  }
  const end = indicatorEdges(0, ch, 2, 0.22, 4);
  assert.ok(Math.abs(end.left - 3) < 1e-6 && Math.abs(end.right - 4) < 1e-6);
});

test('left edge leads when moving left', () => {
  const e = indicatorEdges(4, [{ t: 0, index: 0 }], 0.05, 0.22, 5);
  assert.ok((4 - e.left) / 4 > (5 - e.right) / 4);
});

test('quick reversals never leave [0, n], invert the pill, or pass the final target', () => {
  const n = 5;
  const cases = [[0, 2, 0], [1, 4, 0], [3, 1, 3], [4, 0, 4]];
  for (const [a, b, c] of cases) for (const delay of [0.01, 0.03, 0.06, 0.1, 0.15, 0.2]) {
    const ch = [{ t: 0, index: b }, { t: delay, index: c }];
    for (let t = 0; t < 1.5; t += 0.001) {
      const e = indicatorEdges(a, ch, t, 0.22, n);
      const tag = `${a}>${b}>${c} @${delay} t=${t.toFixed(3)}`;
      assert.ok(e.left >= 0 && e.left <= e.right + 1e-9 && e.right <= n, `bounds ${tag}: ${JSON.stringify(e)}`);
      assert.ok(e.right - e.left >= 0.75, `width ${tag}: ${e.right - e.left}`);
      if (t > delay) {
        const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
        assert.ok(e.left >= lo - 1e-9 && e.right <= hi + 1 + 1e-9, `range ${tag}`);
        // after the last change no edge passes the far side of its final target
        // (only when it is heading toward it from behind)
        if (c > a) assert.ok(e.left <= c + 1e-9 && e.right <= c + 1 + 1e-9, `pass fwd ${tag}`);
        if (c < a) assert.ok(e.left >= c - 1e-9 && e.right >= c + 1 - 1e-9, `pass back ${tag}`);
      }
    }
    const end = indicatorEdges(a, ch, 3, 0.22, n);
    assert.ok(Math.abs(end.left - c) < 1e-6 && Math.abs(end.right - c - 1) < 1e-6);
  }
});
