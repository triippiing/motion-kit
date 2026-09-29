import test from 'node:test';
import assert from 'node:assert/strict';
import Springs from './springs.js';

const { spring, track, live, fromSettle } = Springs;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const ZETAS = [0.5, 0.85, 1, 2];

test('spring starts at from with zero velocity and settles at to', () => {
  for (const zeta of ZETAS) {
    const o = { from: 10, to: -5, t0: 1, omega: 20, zeta };
    const a = spring(1, o);
    close(a.value, 10); close(a.velocity, 0);
    close(spring(11, o).value, -5, 1e-4);
  }
});

test('before t0 the value holds at from', () => {
  const r = spring(0.2, { from: 3, to: 9, t0: 0.5, omega: 10, zeta: 1 });
  assert.deepEqual(r, { value: 3, velocity: 0 });
});

test('velocity matches a finite difference of value', () => {
  for (const zeta of ZETAS) {
    const o = { from: 0, to: 1, omega: 15, zeta, v0: 4 };
    for (const t of [0.01, 0.05, 0.2, 0.5]) {
      const h = 1e-6;
      const fd = (spring(t + h, o).value - spring(t - h, o).value) / (2 * h);
      close(spring(t, o).velocity, fd, 1e-4 * Math.max(1, Math.abs(fd)));
    }
  }
});

test('zeta >= 1 never overshoots', () => {
  for (const zeta of [1, 1.5]) {
    for (let t = 0; t <= 2; t += 0.001) {
      assert.ok(spring(t, { from: 0, to: 1, omega: 25, zeta }).value <= 1 + 1e-9);
    }
  }
});

test('zeta 0.85 overshoots a little (about 0.6%), not a bounce', () => {
  let max = 0;
  for (let t = 0; t <= 2; t += 0.0005) max = Math.max(max, spring(t, { from: 0, to: 1, omega: 25, zeta: 0.85 }).value);
  assert.ok(max > 1.003 && max < 1.01, `max ${max}`);
});

test('fromSettle hits the requested 2% settle time', () => {
  for (const zeta of [0.85, 1]) {
    const settle = 0.3, omega = fromSettle(settle, zeta);
    let last = 0;
    for (let t = 0; t <= 3; t += 1e-4) {
      if (Math.abs(spring(t, { from: 1, to: 0, omega, zeta }).value) > 0.02) last = t;
    }
    assert.ok(last > settle - 0.01 && last <= settle + 1e-3, `zeta ${zeta}: last excursion at ${last}`);
  }
});

test('fromSettle rejects zeta above 10', () => {
  assert.throws(() => fromSettle(0.3, 11), RangeError);
});

test('fromSettle works at zeta 10 boundary', () => {
  const settle = 0.3, omega = fromSettle(settle, 10);
  let last = 0;
  for (let t = 0; t <= 3; t += 1e-4) {
    if (Math.abs(spring(t, { from: 1, to: 0, omega, zeta: 10 }).value) > 0.02) last = t;
  }
  assert.ok(last > settle - 0.01 && last <= settle + 1e-3, `last excursion at ${last}`);
});

test('invalid parameters throw RangeError', () => {
  assert.throws(() => spring(0, { from: 0, to: 1, omega: 0, zeta: 1 }), RangeError);
  assert.throws(() => spring(0, { from: 0, to: 1, omega: 10, zeta: -1 }), RangeError);
  assert.throws(() => spring(0, { from: 0, to: 1, omega: NaN, zeta: 1 }), RangeError);
  assert.throws(() => fromSettle(0, 1), RangeError);
});

test('track holds from before the first change', () => {
  close(track(0.1, { from: 5, changes: [{ t: 0.5, to: 9 }], omega: 20, zeta: 1 }).value, 5);
});

test('track is continuous in value and velocity at every change', () => {
  const o = { from: 0, omega: 30, zeta: 0.85, changes: [{ t: 0.2, to: 1 }, { t: 0.35, to: -0.5 }, { t: 0.36, to: 2 }] };
  for (const c of o.changes) {
    const a = track(c.t - 1e-7, o), b = track(c.t + 1e-7, o);
    close(a.value, b.value, 1e-4); close(a.velocity, b.velocity, 1e-2);
  }
  close(track(5, o).value, 2, 1e-6);
});

test('track does not depend on the order changes are listed in', () => {
  const changes = [{ t: 0.2, to: 1 }, { t: 0.1, to: 3 }];
  const a = track(0.25, { from: 0, changes, omega: 20, zeta: 1 });
  const b = track(0.25, { from: 0, changes: [...changes].reverse(), omega: 20, zeta: 1 });
  close(a.value, b.value);
});

test('track honours a per-change omega', () => {
  const slow = track(0.1, { from: 0, changes: [{ t: 0, to: 1 }], omega: 5, zeta: 1 }).value;
  const fast = track(0.1, { from: 0, changes: [{ t: 0, to: 1, omega: 50 }], omega: 5, zeta: 1 }).value;
  assert.ok(fast > slow);
});

function fakeClock() {
  const q = []; let now = 0;
  return { q, clock: () => now, schedule: (fn) => q.push(fn), advance(dt) { now += dt; } };
}

test('live retarget keeps value and velocity continuous', () => {
  const c = fakeClock();
  const l = live({ value: 0, omega: 30, zeta: 1, clock: c.clock, schedule: c.schedule });
  l.set(100); c.advance(0.05);
  const before = l.get(); l.set(-50); const after = l.get();
  close(before.value, after.value); close(before.velocity, after.velocity);
  assert.equal(l.target, -50);
});

test('live settles exactly on target and stops scheduling', () => {
  const c = fakeClock(); const seen = [];
  const l = live({ value: 0, omega: 30, zeta: 1, clock: c.clock, schedule: c.schedule, onUpdate: (v, vel) => seen.push([v, vel]) });
  l.set(10);
  for (let i = 0; i < 600 && c.q.length; i++) { c.advance(1 / 60); c.q.shift()(); }
  assert.equal(c.q.length, 0);
  assert.deepEqual(seen.at(-1), [10, 0]);
});

test('live fling hands over a release velocity', () => {
  const c = fakeClock();
  const l = live({ value: 0, omega: 20, zeta: 1, clock: c.clock, schedule: c.schedule });
  l.fling(50, 800, 0);
  const s = l.get(); close(s.value, 50); close(s.velocity, 800);
  c.advance(0.02); assert.ok(l.get().value > 50, 'keeps moving the way it was thrown');
});

test('live jump sets value instantly with no motion', () => {
  const c = fakeClock(); const seen = [];
  const l = live({ value: 0, omega: 20, zeta: 1, clock: c.clock, schedule: c.schedule, onUpdate: (v) => seen.push(v) });
  l.jump(7);
  assert.deepEqual(seen, [7]); close(l.get().value, 7); close(l.get().velocity, 0);
});
