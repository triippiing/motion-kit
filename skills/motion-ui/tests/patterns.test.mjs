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
  const mid = indicatorEdges(0, ch, 0.05, 0.22);
  assert.ok((mid.right - 1) / 3 > mid.left / 3, 'right edge leads when moving right');
  for (let t = 0; t < 1; t += 0.002) {
    const e = indicatorEdges(0, ch, t, 0.22);
    assert.ok(e.left <= 3 + 1e-9 && e.right <= 4 + 1e-9);
  }
  const end = indicatorEdges(0, ch, 2, 0.22);
  assert.ok(Math.abs(end.left - 3) < 1e-6 && Math.abs(end.right - 4) < 1e-6);
});

test('left edge leads when moving left', () => {
  const e = indicatorEdges(4, [{ t: 0, index: 0 }], 0.05, 0.22);
  assert.ok((4 - e.left) / 4 > (5 - e.right) / 4);
});
