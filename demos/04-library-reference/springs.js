/* springs.js -- closed-form damped springs for motion-kit.
 *
 * One implementation shared by rendered video (pure seek(t)), live product UI
 * and the finance app. A classic script: it defines globalThis.Springs and,
 * under Node, module.exports, so it loads via <script src>, a Node import and
 * JavaScriptCore alike. No dependencies.
 *
 * Source of truth: ~/motion-kit/shared/springs.js. Vendored copies say so.
 */
(function (root) {
  "use strict";

  function check(name, x) {
    if (!(x > 0) || !isFinite(x)) throw new RangeError(name + " must be a positive finite number, got " + x);
  }

  // Displacement e from the target and velocity v, tau seconds after a spring
  // is released at displacement e0 with velocity v0. e -> 0 as tau grows.
  function response(tau, e0, v0, omega, zeta) {
    check("omega", omega); check("zeta", zeta);
    if (zeta < 1 - 1e-6) {
      const a = zeta * omega, wd = omega * Math.sqrt(1 - zeta * zeta);
      const A = e0, B = (v0 + a * e0) / wd;
      const k = Math.exp(-a * tau), c = Math.cos(wd * tau), s = Math.sin(wd * tau);
      return { e: k * (A * c + B * s), v: k * ((B * wd - a * A) * c - (a * B + A * wd) * s) };
    }
    if (zeta <= 1 + 1e-6) {
      const B = v0 + omega * e0, k = Math.exp(-omega * tau);
      return { e: (e0 + B * tau) * k, v: (B - omega * (e0 + B * tau)) * k };
    }
    const q = Math.sqrt(zeta * zeta - 1);
    const r1 = -omega * (zeta - q), r2 = -omega * (zeta + q);
    const C2 = (v0 - r1 * e0) / (r2 - r1), C1 = e0 - C2;
    const k1 = Math.exp(r1 * tau), k2 = Math.exp(r2 * tau);
    return { e: C1 * k1 + C2 * k2, v: r1 * C1 * k1 + r2 * C2 * k2 };
  }

  function spring(t, o) {
    const t0 = o.t0 || 0;
    check("omega", o.omega); check("zeta", o.zeta);
    if (t < t0) return { value: o.from, velocity: 0 };
    const r = response(t - t0, o.from - o.to, o.v0 || 0, o.omega, o.zeta);
    return { value: o.to + r.e, velocity: r.v };
  }

  // A value that retargets many times, as a pure function of t: `from` plus one
  // spring per change, each animating only that change's delta. A spring that
  // starts at its change time adds zero displacement and zero velocity at that
  // instant, so the sum is continuous in both -- no state between frames.
  function track(t, o) {
    const changes = o.changes.slice().sort(function (a, b) { return a.t - b.t; });
    let prev = o.from, value = o.from, velocity = 0;
    for (const c of changes) {
      if (t < c.t) break;
      const omega = c.omega != null ? c.omega : o.omega;
      const zeta = c.zeta != null ? c.zeta : o.zeta;
      const r = response(t - c.t, prev - c.to, 0, omega, zeta);
      value += (c.to - prev) + r.e;
      velocity += r.v;
      prev = c.to;
    }
    return { value: value, velocity: velocity };
  }

  // Omega for a spring that stays within tol (2%) of its move after settleSec.
  // The response scales with omega*tau, so the unit-omega settle time is found
  // once per (zeta, tol) by scanning, then divided by the requested duration.
  // Only supports zeta <= 10 (useful range for UI motion).
  const unitSettle = {};
  function fromSettle(settleSec, zeta, tol) {
    check("settleSec", settleSec); check("zeta", zeta);
    if (zeta > 10) throw new RangeError("zeta must be <= 10, got " + zeta);
    tol = tol || 0.02;
    const key = zeta + ":" + tol;
    if (unitSettle[key] == null) {
      let last = 0;
      for (let u = 0; u <= 200; u += 0.0005) if (Math.abs(response(u, 1, 0, 1, zeta).e) > tol) last = u;
      if (Math.abs(response(200, 1, 0, 1, zeta).e) > tol) {
        throw new RangeError("settle scan hit limit (zeta " + zeta + ", tol " + tol + "); increase scan range");
      }
      unitSettle[key] = last;
    }
    return unitSettle[key] / settleSec;
  }

  // Live driver for product UI. get() is computed from the clock, so it is
  // exact whenever it is read; the scheduled frames only push it to onUpdate.
  function live(o) {
    check("omega", o.omega); check("zeta", o.zeta);
    const clock = o.clock || function () { return performance.now() / 1000; };
    const schedule = o.schedule || function (fn) { requestAnimationFrame(fn); };
    const precision = o.precision != null ? o.precision : 0.01;
    let seg = { t0: clock(), from: o.value, to: o.value, v0: 0 };
    let running = false, stopped = false;

    function get() {
      const r = response(clock() - seg.t0, seg.from - seg.to, seg.v0, o.omega, o.zeta);
      return { value: seg.to + r.e, velocity: r.v };
    }
    function frame() {
      if (stopped) { running = false; return; }
      let s = get();
      if (Math.abs(s.value - seg.to) < precision && Math.abs(s.velocity) < precision * 10) {
        s = { value: seg.to, velocity: 0 };
        seg = { t0: clock(), from: seg.to, to: seg.to, v0: 0 };
        running = false;
      }
      if (o.onUpdate) o.onUpdate(s.value, s.velocity);
      if (running) schedule(frame);
    }
    function start(from, v0, to) {
      seg = { t0: clock(), from: from, to: to, v0: v0 };
      stopped = false;
      if (!running) { running = true; schedule(frame); }
    }
    return {
      get: get,
      set: function (to) { const s = get(); start(s.value, s.velocity, to); },
      fling: function (value, velocity, to) { start(value, velocity, to); },
      jump: function (value) {
        seg = { t0: clock(), from: value, to: value, v0: 0 };
        if (o.onUpdate) o.onUpdate(value, 0);
      },
      stop: function () { stopped = true; },
      get target() { return seg.to; },
    };
  }

  const Springs = { response: response, spring: spring, track: track, fromSettle: fromSettle, live: live };
  root.Springs = Springs;
  if (typeof module !== "undefined" && module.exports) module.exports = Springs;
})(typeof globalThis !== "undefined" ? globalThis : this);
