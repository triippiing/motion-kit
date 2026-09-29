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
function indicatorEdges(from, changes, t, settle, lead = 0.7) {
  const trail = Springs.fromSettle(settle, 1), fast = Springs.fromSettle(settle * lead, 1);
  const L = [], R = []; let at = from;
  for (const c of changes) {
    const fwd = c.index > at;
    L.push({ t: c.t, to: c.index, omega: fwd ? trail : fast });
    R.push({ t: c.t, to: c.index + 1, omega: fwd ? fast : trail });
    at = c.index;
  }
  return { left: Springs.track(t, { from, changes: L, omega: trail, zeta: 1 }).value,
           right: Springs.track(t, { from: from + 1, changes: R, omega: trail, zeta: 1 }).value };
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
