# motion-ui patterns

Vendor `~/.claude/skills/motion-ui/assets/springs.js` into the project (`<script src>` before
the code that uses it; add it to any packaging list). It defines `Springs`.

## 1. Retargetable value (interrupt without a jump)
```js
const w = Springs.live({ value: 0, omega: Springs.fromSettle(0.24, 1), zeta: 1,
  onUpdate: (v) => bar.style.width = v + '%' });
w.set(62);          // later: w.set(80) mid-flight keeps position AND velocity
```

## 2. Two-edge indicator (stretch toward travel, no overshoot)
Pure, so it is unit-testable and drivable from requestAnimationFrame.
```js
// Edges are in item units: resting on item i spans [i, i + 1]; n = item count.
// Each edge carries its own value AND velocity from change to change (a fresh
// closed-form segment per change) and is held between where it was at the last
// change and its target, so a quick reversal cannot pass the item it heads for.
// (Summing one Springs.track spring per change does overshoot on reversals.)
function indicatorEdges(from, changes, t, settle, n, lead = 0.7) {
  const trail = Springs.fromSettle(settle, 1), fast = Springs.fromSettle(settle * lead, 1);
  const hold = (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b));
  const edges = [{ x0: from, v0: 0, t0: 0, to: from, omega: trail },
                 { x0: from + 1, v0: 0, t0: 0, to: from + 1, omega: trail }];
  const at = (e, when) => {
    const r = Springs.response(when - e.t0, e.x0 - e.to, e.v0, e.omega, 1);
    const x = hold(e.to + r.e, e.x0, e.to);
    return { x, v: x === e.to + r.e ? r.v : 0 };   // a held edge is still
  };
  for (const c of changes) {
    if (t < c.t) break;
    const now = edges.map((e) => at(e, c.t));
    const fwd = c.index + 0.5 > (now[0].x + now[1].x) / 2;   // from where it IS
    const omegas = fwd ? [trail, fast] : [fast, trail];
    edges.forEach((e, k) => Object.assign(e, { x0: now[k].x, v0: now[k].v, t0: c.t, to: c.index + k, omega: omegas[k] }));
  }
  return { left: hold(at(edges[0], t).x, 0, n), right: hold(at(edges[1], t).x, 0, n) };
}
```

## 3. Drag, then release with the throw
```js
const x = Springs.live({ value: 0, omega: Springs.fromSettle(0.3, 1), zeta: 1, onUpdate: (v) => knob.style.transform = `translateX(${v}px)` });
let last = null;
knob.onpointermove = (e) => { if (!e.buttons) return; x.stop(); x.jump(e.clientX - originX); last = { x: e.clientX, t: e.timeStamp }; };
knob.onpointerup = (e) => {
  const v = last ? (e.clientX - last.x) / Math.max(1e-3, (e.timeStamp - last.t) / 1000) : 0;
  x.fling(e.clientX - originX, v, snapTarget(e.clientX - originX));
};
```

## 4. Content swap inside a morphing container
Exit fast (≈0.4× the container's settle), enter after the container has started
(delay ≈0.15× settle), blur ≤ 8px while opacity < 1. Never cross-fade two labels at
full size in the same box at the same time.

## 5. Reduced motion
If `matchMedia('(prefers-reduced-motion: reduce)').matches`, or there is no
`requestAnimationFrame`, call `jump(target)` instead of `set(target)`. Reuse the
project's own helper when it has one (e.g. personal-finance `prefersReducedMotion()`).
