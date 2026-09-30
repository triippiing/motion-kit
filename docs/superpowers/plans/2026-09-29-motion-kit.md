# motion-kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three callable Claude Code skills (motion-design, motion-video, motion-ui) plus a shared spring library that turn "code-only motion design" into a repeatable pipeline for any project's look and any output size, proven by three demo videos and documented on the wiki's Claude section.

**Architecture:** `~/motion-kit` is a git repo; `install.sh` symlinks `skills/*` into `~/.claude/skills`. One dependency-free `shared/springs.js` (closed-form springs) is used by the video template (pure `seek(t)`), by live product UI, and by the finance app. `analyze_song.py` turns a song into `song.json` (beat grid + derived rules); `render.mjs` drives Chromium via Playwright and pipes frames to ffmpeg for tmix motion blur and audio mux.

**Tech Stack:** Node 24 (node:test), Playwright 1.63.0 (Chromium 1243, already installed), ffmpeg 9.0.2 (Homebrew, `/opt/homebrew/bin`), Python 3.13 + numpy 2.5.2 (unittest; no scipy/librosa), plain HTML/CSS/JS.

**Spec:** `docs/superpowers/specs/2026-09-29-motion-kit-design.md`

## Global Constraints

- No animation frameworks (no Remotion, Lottie, GSAP, AE). Plain HTML/JS only.
- Never download copyrighted audio. Songs are user-supplied files; demos use `~/Desktop/Tints (feat. Kendrick Lamar).flac` for local viewing only.
- No publishing or posting of videos.
- Python deps: numpy only. JS deps: `playwright@1.63.0` only, inside `skills/motion-video/`.
- Every script puts `/opt/homebrew/bin:/usr/local/bin` on PATH itself (Claude's shell does not source `~/.zprofile`).
- `seek(t)` is a pure function of `t`: no CSS transitions, no timers, no state carried between frames, no `will-change` under the camera.
- Last frame == first frame (loop seam), checked by `beat_stills.mjs`.
- Output video: 60fps, H.264 yuv420p, CRF 16, AAC 256k. Stage from `project.json`: square 1440×1440 (default), vertical 1080×1920, landscape 1920×1080, or WxH (even numbers).
- Project-agnostic: the template takes its look from `theme.css`/`theme.json` (extracted from any project's CSS, or the house theme) and its size from `project.json`; STATES name theme tokens, not hex.
- Wiki (Task 12): `~/Documents/AUTOMATION/Wiki` rules apply: no em or en dashes in any copy, never hand-edit `index.html`/`nav-data.js`, never push without Jack's explicit go-ahead. Finance promo shows made-up figures only.
- Spring rule from song: `zeta = 0.85`, `settle_sec = 0.6 × beat_sec`; comfort band 100–130 BPM (warning outside, never a block).
- motion-ui: a project's existing motion spec/tokens always win; ζ ≥ 1 where the spec bans overshoot.
- Finance app work happens on branch `motion-demo` in `~/Documents/AUTOMATION/personal-finance`, never merged by us; test with `.venv/bin/python -m pytest`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Real songs with soft transients or tempo far from 120** (Tints ~109, or a 75 BPM ballad): analysis must still return a stable grid, report low confidence as a warning, and never crash. → Task 3 tests a 90 BPM track and a noisy track with a quiet beat.
2. **Song path with spaces/parentheses** ("Tints (feat. Kendrick Lamar).flac"): every script must quote paths. → Task 3 CLI test and Task 4 new_project test use a filename with spaces and parentheses.
3. **Frame count not an integer multiple of the loop** (7 bars at 109 BPM = 924.77 frames): the loop must still close without a stutter. → Task 3 asserts `frame_dt * frames == duration_sec`; Task 4 asserts the rendered frame count equals `loop.frames`.
4. **A project whose index.html is broken** (JS error, missing `seek`, font never loads): render must fail fast with a clear message, not hang or produce a black video. → Task 4 test for missing seek and for a page error.
5. **Re-running scaffolding over an existing project**: `new_project.sh` must refuse to overwrite `index.html` (hours of work). → Task 4 test.

---

## File map

```
~/motion-kit/
  package.json                          root test runner (no deps)
  install.sh                            link skills, npm install, doctor         (Task 2)
  tests/install.test.mjs                                                          (Task 2)
  shared/springs.js                     spring/track/live/fromSettle/response     (Task 1)
  shared/springs.test.mjs                                                         (Task 1)
  skills/motion-video/
    package.json                        playwright 1.63.0                         (Task 2)
    assets/springs.js -> ../../../shared/springs.js                               (Task 1)
    scripts/doctor.sh                                                             (Task 2)
    scripts/analyze_song.py                                                       (Task 3)
    tests/test_analyze_song.py                                                    (Task 3)
    template/index.html                                                           (Task 4)
    scripts/new_project.sh                                                        (Task 4, 4b)
    scripts/extract_theme.py, tests/test_extract_theme.py                         (Task 4b)
    scripts/render.mjs                                                            (Task 4)
    tests/render.test.mjs, tests/fixtures.mjs                                     (Task 4)
    scripts/beat_stills.mjs                                                       (Task 5)
    tests/beat_stills.test.mjs                                                    (Task 5)
    SKILL.md                                                                      (Task 6)
  skills/motion-design/SKILL.md, references/direction.md, references/state-plan.md (Task 6)
  skills/motion-ui/SKILL.md, references/patterns.md, assets/springs.js (link)     (Task 7)
  demos/01-reference/ 02-finance-promo/ 03-finance-inapp/                          (Tasks 8–10)
~/Documents/AUTOMATION/personal-finance (branch motion-demo)                       (Task 10)
~/Documents/AUTOMATION/Wiki: claude/motion-kit.html, assets/media/motion-kit/       (Task 12)
  web/springs.js (vendored), web/app.js, web/style.css, web/index.html, setup.py,
  tests/test_web_dock_pill_js.py, tests/test_web_app_js.py, tests/test_web_render_webkit.py
```

---

### Task 1: shared/springs.js

**Files:**
- Create: `shared/springs.js`, `shared/springs.test.mjs`, `package.json`
- Create (symlinks): `skills/motion-video/assets/springs.js`, `skills/motion-ui/assets/springs.js`

**Interfaces:**
- Produces (on `globalThis.Springs` and `module.exports`):
  - `response(tau, e0, v0, omega, zeta) -> {e, v}`: displacement from target and velocity.
  - `spring(t, {from, to, t0=0, v0=0, omega, zeta}) -> {value, velocity}`
  - `track(t, {from, changes: [{t, to, omega?, zeta?}], omega, zeta}) -> {value, velocity}`
  - `fromSettle(settleSec, zeta, tol=0.02) -> omega`
  - `live({value, omega, zeta, onUpdate?, clock?, schedule?, precision=0.01}) -> {get(), set(to), fling(value, velocity, to), jump(value), stop(), target}`
  - All throw `RangeError` for non-positive/non-finite `omega`, `zeta` or `settleSec`.

- [ ] **Step 1: Root package.json**

```json
{
  "name": "motion-kit",
  "private": true,
  "scripts": {
    "test": "node --test 'shared/*.test.mjs' 'tests/*.test.mjs' 'skills/motion-video/tests/*.test.mjs' && python3 -m unittest discover -s skills/motion-video/tests -p 'test_*.py'"
  }
}
```

- [ ] **Step 2: Write the failing tests** — `shared/springs.test.mjs`

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ~/motion-kit && node --test shared/`
Expected: FAIL — `Cannot find module './springs.js'`

- [ ] **Step 4: Implement** — `shared/springs.js`

```js
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
  const unitSettle = {};
  function fromSettle(settleSec, zeta, tol) {
    check("settleSec", settleSec); check("zeta", zeta);
    tol = tol || 0.02;
    const key = zeta + ":" + tol;
    if (unitSettle[key] == null) {
      let last = 0;
      for (let u = 0; u <= 200; u += 0.0005) if (Math.abs(response(u, 1, 0, 1, zeta).e) > tol) last = u;
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/motion-kit && node --test shared/`
Expected: all 15 tests PASS

- [ ] **Step 6: Asset symlinks**

```bash
cd ~/motion-kit
mkdir -p skills/motion-video/assets skills/motion-ui/assets
ln -s ../../../shared/springs.js skills/motion-video/assets/springs.js
ln -s ../../../shared/springs.js skills/motion-ui/assets/springs.js
node -e "require('./skills/motion-ui/assets/springs.js').fromSettle(0.2,1)" && echo ok
```
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add package.json shared skills
git commit -m "Add shared closed-form springs with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tooling — doctor.sh, install.sh, Playwright package

**Files:**
- Create: `skills/motion-video/package.json`, `skills/motion-video/scripts/doctor.sh`, `install.sh`, `tests/install.test.mjs`, `.gitignore`

**Interfaces:**
- Produces: `doctor.sh` (exit 0 when ready, 1 with `MISSING … fix: …` lines); `install.sh [--link-only]` honouring `CLAUDE_SKILLS_DIR`.

- [ ] **Step 1: package.json and .gitignore**

`skills/motion-video/package.json`:
```json
{
  "name": "motion-video",
  "private": true,
  "type": "module",
  "dependencies": { "playwright": "1.63.0" }
}
```
`.gitignore`:
```
node_modules/
__pycache__/
demos/*/out/
demos/*/clip.wav
.DS_Store
```
Run: `npm --prefix skills/motion-video install --no-audit --no-fund`
Expected: `added 2 packages` (playwright, playwright-core)

- [ ] **Step 2: Write the failing test** — `tests/install.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const run = (dest) => spawnSync(path.join(ROOT, 'install.sh'), ['--link-only'], { env: { ...process.env, CLAUDE_SKILLS_DIR: dest }, encoding: 'utf8' });

test('links every skill and is idempotent', () => {
  const dest = mkdtempSync(path.join(tmpdir(), 'skills-'));
  for (let i = 0; i < 2; i++) assert.equal(run(dest).status, 0);
  for (const name of ['motion-design', 'motion-video', 'motion-ui']) {
    const p = path.join(dest, name);
    assert.ok(lstatSync(p).isSymbolicLink(), name);
    assert.equal(realpathSync(p), realpathSync(path.join(ROOT, 'skills', name)));
  }
});

test('refuses to replace a real directory', () => {
  const dest = mkdtempSync(path.join(tmpdir(), 'skills-'));
  mkdirSync(path.join(dest, 'motion-ui'));
  const r = run(dest);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a symlink/);
});

test('doctor passes on this machine', () => {
  execFileSync(path.join(ROOT, 'skills/motion-video/scripts/doctor.sh'), { stdio: 'pipe' });
});
```
(`motion-design` and `motion-ui` need to exist as directories for the first test: `mkdir -p skills/motion-design` — motion-ui exists from Task 1.)

- [ ] **Step 3: Run to verify it fails**

Run: `mkdir -p skills/motion-design && node --test tests/`
Expected: FAIL — `install.sh` ENOENT

- [ ] **Step 4: Implement doctor.sh**

```bash
#!/usr/bin/env bash
# doctor.sh -- check everything motion-video needs; print the exact fix for anything missing.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SKILL="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
fail=0
ok()  { printf '  ok       %s\n' "$1"; }
bad() { printf '  MISSING  %s\n           fix: %s\n' "$1" "$2"; fail=1; }

if command -v brew >/dev/null; then ok "homebrew $(brew --version | head -1 | cut -d' ' -f2)"
else bad homebrew '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   (run in Terminal: needs your password)'; fi

if command -v ffmpeg >/dev/null; then
  if ffmpeg -hide_banner -filters 2>/dev/null | grep -qw tmix; then ok "ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3) (tmix)"
  else bad "ffmpeg tmix filter" "brew reinstall ffmpeg"; fi
  command -v ffprobe >/dev/null && ok ffprobe || bad ffprobe "brew install ffmpeg"
else bad ffmpeg "brew install ffmpeg"; fi

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -ge 20 ]; then ok "node $(node -v)"; else bad "node >= 20" "nvm install --lts"; fi

if python3 -c 'import numpy' 2>/dev/null; then ok "numpy $(python3 -c 'import numpy; print(numpy.__version__)')"
else bad numpy "python3 -m pip install numpy"; fi

if [ -d "$SKILL/node_modules/playwright" ]; then
  ok "playwright $(node -p "require('$SKILL/node_modules/playwright/package.json').version")"
  if (cd "$SKILL" && node -e "const {chromium}=require('playwright');require('fs').accessSync(chromium.executablePath())") 2>/dev/null
  then ok "playwright chromium"; else bad "playwright chromium" "(cd '$SKILL' && npx playwright install chromium)"; fi
else bad "playwright package" "npm --prefix '$SKILL' install"; fi

exit $fail
```
`chmod +x skills/motion-video/scripts/doctor.sh`

- [ ] **Step 5: Implement install.sh**

```bash
#!/usr/bin/env bash
# install.sh -- link motion-kit skills into ~/.claude/skills, install render deps, run doctor.
# --link-only skips npm install and doctor (used by tests).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$DEST"
for skill in "$ROOT"/skills/*/; do
  name="$(basename "$skill")"; target="$DEST/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "error: $target exists and is not a symlink; move it aside first" >&2; exit 1
  fi
  ln -sfn "${skill%/}" "$target"
  echo "linked $name -> $target"
done
[ "${1:-}" = "--link-only" ] && exit 0
npm --prefix "$ROOT/skills/motion-video" install --no-audit --no-fund
"$ROOT/skills/motion-video/scripts/doctor.sh"
```
`chmod +x install.sh`

- [ ] **Step 6: Run tests**

Run: `node --test tests/ && skills/motion-video/scripts/doctor.sh`
Expected: 3 PASS; doctor prints only `ok` lines, exit 0

- [ ] **Step 7: Commit**

```bash
git add .gitignore install.sh tests skills/motion-video/package.json skills/motion-video/package-lock.json skills/motion-video/scripts/doctor.sh
git commit -m "Add doctor and install scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: analyze_song.py

**Files:**
- Create: `skills/motion-video/scripts/analyze_song.py`, `skills/motion-video/tests/test_analyze_song.py`

**Interfaces:**
- Produces: `analyze(path, bars=7, fps=60, start_bar=None, states=None, bpb=4) -> dict` (the song.json object), `write_clip(src, start_sec, duration_sec, out_path)`, CLI `analyze_song.py SONG [--out DIR] [--bars N] [--start-bar N] [--fps N] [--states N]` writing `DIR/song.json` + `DIR/clip.wav`; exits 2 with `error: …` on bad input.
- song.json keys used later: `bpm`, `beat_sec`, `fps`, `beats_per_bar`, `loop.{start_sec,bars,duration_sec,frames,frame_dt}`, `beats[].{i,t,abs_t,frame,bar,beat_in_bar,accent,cue_t}`, `rules.{max_states,min_hold_beats,spring.{zeta,settle_sec},warnings}`.

- [ ] **Step 1: Write the failing tests** — `skills/motion-video/tests/test_analyze_song.py`

```python
import json
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import analyze_song as A  # noqa: E402

SR = 44100


def click_track(path, bpm, seconds=40.0, offset=0.37, noise=0.001, hat=0.3, seed=0):
    """Hi-hat-like click on every beat, a 55 Hz kick on each downbeat (every 4th)."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(seconds * SR))
    beat = 60.0 / bpm
    i = 0
    while offset + i * beat < seconds - 0.3:
        s = int((offset + i * beat) * SR)
        n = int(0.04 * SR)
        tt = np.arange(n) / SR
        x[s:s + n] += hat * np.exp(-tt * 120) * rng.standard_normal(n)
        if i % 4 == 0:
            m = int(0.2 * SR)
            tk = np.arange(m) / SR
            x[s:s + m] += 0.9 * np.exp(-tk * 18) * np.sin(2 * np.pi * 55 * tk)
        i += 1
    x += noise * rng.standard_normal(len(x))
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_tempo_within_half_bpm(self):
        for bpm in (90, 109, 120, 128):
            with self.subTest(bpm=bpm):
                song = A.analyze(click_track(self.tmp / f"c{bpm}.wav", bpm), bars=4)
                self.assertLessEqual(abs(song["bpm"] - bpm), 0.5, song["bpm"])

    def test_downbeat_lands_on_the_kick_within_one_frame(self):
        offset, bpm = 0.37, 120
        song = A.analyze(click_track(self.tmp / "c.wav", bpm, offset=offset), bars=4)
        bar = 4 * 60.0 / bpm
        for t in (song["downbeat_sec"], song["loop"]["start_sec"]):
            phase = (t - offset) % bar
            self.assertLess(min(phase, bar - phase), 1 / 60, t)

    def test_noisy_track_with_quiet_beat_still_analyses(self):
        path = click_track(self.tmp / "noisy.wav", 100, noise=0.05, hat=0.08, seed=3)
        song = A.analyze(path, bars=4)
        self.assertLessEqual(abs(song["bpm"] - 100), 1.0, song["bpm"])

    def test_loop_arithmetic_closes_exactly(self):
        song = A.analyze(click_track(self.tmp / "c.wav", 109), bars=7)
        loop = song["loop"]
        self.assertAlmostEqual(loop["duration_sec"], 7 * 4 * 60 / song["bpm"], places=6)
        self.assertAlmostEqual(loop["frame_dt"] * loop["frames"], loop["duration_sec"], places=9)
        self.assertEqual(len(song["beats"]), 28)
        self.assertEqual(song["beats"][0]["t"], 0.0)
        frames = [b["frame"] for b in song["beats"]]
        self.assertEqual(frames, sorted(frames))
        for b in song["beats"]:
            self.assertLessEqual(abs(b["cue_t"] - b["t"]), song["beat_sec"] / 8 + 1e-9)

    def test_rules(self):
        s120 = A.analyze(click_track(self.tmp / "a.wav", 120), bars=7, states=12)
        self.assertEqual(s120["rules"]["warnings"], [])
        self.assertEqual(s120["rules"]["min_hold_beats"], 2)
        self.assertEqual(s120["rules"]["max_states"], 14)
        self.assertAlmostEqual(s120["rules"]["spring"]["settle_sec"], 0.3, places=3)
        s90 = A.analyze(click_track(self.tmp / "b.wav", 90), bars=4)
        self.assertTrue(any("100–130" in w for w in s90["rules"]["warnings"]))
        too_many = A.analyze(click_track(self.tmp / "c.wav", 120), bars=2, states=12)
        self.assertTrue(any("states" in w for w in too_many["rules"]["warnings"]))

    def test_start_bar_override(self):
        song = A.analyze(click_track(self.tmp / "c.wav", 120, offset=0.37), bars=4, start_bar=3)
        self.assertAlmostEqual(song["loop"]["start_sec"], song["downbeat_sec"] + 3 * 2.0, delta=1 / 60)

    def _cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "analyze_song.py"), *args],
                              capture_output=True, text=True)

    def test_cli_writes_song_json_and_exact_length_clip(self):
        song_path = click_track(self.tmp / "Tints (feat. Test) copy.wav", 120)
        out = self.tmp / "proj dir"
        r = self._cli(str(song_path), "--out", str(out), "--bars", "4")
        self.assertEqual(r.returncode, 0, r.stderr)
        song = json.loads((out / "song.json").read_text())
        with wave.open(str(out / "clip.wav")) as w:
            dur = w.getnframes() / w.getframerate()
        self.assertAlmostEqual(dur, song["loop"]["duration_sec"], delta=0.005)

    def test_cli_errors_are_clear(self):
        r = self._cli(str(self.tmp / "nope.flac"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("no such file", r.stderr)
        silent = self.tmp / "silent.wav"
        with wave.open(str(silent), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes(np.zeros(SR * 5, "<i2").tobytes())
        r = self._cli(str(silent))
        self.assertEqual(r.returncode, 2)
        self.assertIn("silent", r.stderr)
        r = self._cli(str(click_track(self.tmp / "short.wav", 120, seconds=10)), "--bars", "20")
        self.assertEqual(r.returncode, 2)
        self.assertIn("shorter than", r.stderr)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/motion-kit && python3 -m unittest discover -s skills/motion-video/tests -p 'test_*.py'`
Expected: FAIL — `ModuleNotFoundError: No module named 'analyze_song'`

- [ ] **Step 3: Implement** — `skills/motion-video/scripts/analyze_song.py`

```python
#!/usr/bin/env python3
"""analyze_song.py -- measure a song's beat grid and derive motion-video project rules.

Usage: analyze_song.py SONG [--out DIR] [--bars 7] [--start-bar N] [--fps 60] [--states N]

Writes DIR/song.json (grid + rules) and DIR/clip.wav (the loop window, 10ms edge
fades). Needs ffmpeg and numpy, nothing else. Assumes 4/4 and a steady tempo,
which is true of the programmed music these videos are cut to.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 22050
N_FFT = 1024
HOP = 256
FPS_ENV = SR / HOP
# Spectral flux peaks a little after the window first contains an onset.
# Calibrated against the click-track tests (downbeat within one video frame).
ENV_TIME_OFFSET = N_FFT / SR
COMFORT = (100.0, 130.0)
SPRING_ZETA = 0.85
SETTLE_BEATS = 0.6
MIN_HOLD_SEC = 1.0


class SongError(Exception):
    pass


def ffmpeg_bin():
    for p in (shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if p and os.path.exists(p):
            return p
    raise SongError("ffmpeg not found. Install it with: brew install ffmpeg")


def decode(path, sr=SR):
    if not Path(path).is_file():
        raise SongError(f"no such file: {path}")
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr),
                        "-f", "f32le", "-"], capture_output=True)
    if r.returncode != 0:
        raise SongError(f"ffmpeg could not decode {path}: {r.stderr.decode(errors='replace').strip()[:300]}")
    x = np.frombuffer(r.stdout, np.float32).astype(np.float64)
    if x.size < sr * 2:
        raise SongError(f"{path} is shorter than 2 seconds of audio")
    if np.max(np.abs(x)) < 1e-3:
        raise SongError(f"{path} is silent")
    return x


def env_time(i):
    return i * HOP / SR + ENV_TIME_OFFSET


def envelopes(x):
    """Spectral-flux onset envelopes: full band, and a low band (<150 Hz) for kicks."""
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * np.hanning(N_FFT)
    S = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
    d = np.maximum(np.diff(S, axis=0), 0)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    full = np.concatenate([[0.0], d.sum(1)])
    low = np.concatenate([[0.0], d[:, freqs <= 150].sum(1)])
    k = np.hanning(7); k /= k.sum()
    smooth = lambda e: np.convolve(e - np.convolve(e, np.ones(43) / 43, "same"), k, "same").clip(0)
    centroid = (S[:, :] * freqs).sum(1) / (S.sum(1) + 1e-9)
    return smooth(full), smooth(low), centroid


def tempo_candidates(env, lo=60.0, hi=180.0):
    e = env - env.mean()
    n = len(e)
    f = np.fft.rfft(e, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0] + 1e-12
    lag_lo, lag_hi = int(60 * FPS_ENV / hi), int(math.ceil(60 * FPS_ENV / lo))
    out = []
    for lag in range(max(lag_lo, 2), min(lag_hi, n - 2) + 1):
        if ac[lag] >= ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0:
            y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
            den = y0 - 2 * y1 + y2
            d = 0.5 * (y0 - y2) / den if den != 0 else 0.0
            bpm = 60 * FPS_ENV / (lag + d)
            prior = math.exp(-0.5 * (math.log2(bpm / 120.0) / 1.0) ** 2)
            out.append((float(bpm), float(ac[lag]), float(ac[lag] * prior)))
    out.sort(key=lambda c: -c[2])
    return out


def fit_grid(env, bpm_guess, span=2.0, step=0.01):
    """Constant-tempo comb fit: the (bpm, phase) whose beat grid sits on most onset energy."""
    idx = np.arange(len(env))
    best = (-1.0, bpm_guess, 0.0)
    for bpm in np.arange(bpm_guess - span, bpm_guess + span + step / 2, step):
        p = 60 * FPS_ENV / bpm
        k = np.arange(int((len(env) - 1) / p))
        phases = np.arange(0, p, 0.5)
        vals = np.interp(phases[:, None] + p * k[None, :], idx, env, right=0.0)
        scores = vals.mean(1)
        j = int(scores.argmax())
        if scores[j] > best[0]:
            best = (float(scores[j]), float(bpm), float(phases[j]))
    return best[1], best[2]


def analyze(path, bars=7, fps=60, start_bar=None, states=None, bpb=4):
    x = decode(path)
    full, low, centroid = envelopes(x)
    cands = tempo_candidates(full)
    if not cands:
        raise SongError("could not find a beat in this song")
    bpm, phase = fit_grid(full, cands[0][0])
    confidence = cands[0][1]
    beat_sec = 60.0 / bpm
    p = 60 * FPS_ENV / bpm
    n_beats = int((len(full) - 1 - phase) / p) + 1
    pos = phase + p * np.arange(n_beats)
    times = np.array([env_time(q) for q in pos])

    low_at = np.interp(pos, np.arange(len(low)), low)
    j = int(np.argmax([low_at[k::bpb].mean() for k in range(bpb)]))
    downbeat_sec = float(times[j])
    n_bars = (n_beats - j) // bpb

    full_at = np.array([full[max(0, int(q) - 2):int(q) + 3].max() for q in pos])
    accent = np.clip(full_at / (np.percentile(full_at, 95) + 1e-9), 0, 1)

    thr = np.percentile(full, 90)
    peak_idx = [i for i in range(1, len(full) - 1)
                if full[i] > thr and full[i] >= full[i - 1] and full[i] >= full[i + 1]]
    peak_t = np.array([env_time(i) for i in peak_idx]) if peak_idx else np.array([])

    bar_rms, bar_cent = [], []
    for b in range(n_bars):
        t0, t1 = times[j + b * bpb], times[j + b * bpb] + bpb * beat_sec
        seg = x[int(t0 * SR):int(t1 * SR)]
        bar_rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
        f0, f1 = int(t0 * FPS_ENV), int(t1 * FPS_ENV)
        bar_cent.append(float(centroid[f0:f1].mean()) if f1 > f0 else 0.0)
    F = np.array([bar_rms, bar_cent]).T
    F = (F - F.mean(0)) / (F.std(0) + 1e-9) if n_bars > 1 else F
    novelty = np.zeros(n_bars)
    for b in range(2, n_bars - 1):
        novelty[b] = np.linalg.norm(F[b:b + 2].mean(0) - F[b - 2:b].mean(0))
    cut = novelty.mean() + novelty.std()
    sections = []
    for b in range(2, n_bars - 1):
        if novelty[b] > cut and novelty[b] >= novelty[b - 1] and novelty[b] >= novelty[b + 1] \
                and (not sections or b - sections[-1] >= 4):
            sections.append(b)

    if n_bars < bars:
        raise SongError(f"song is shorter than the requested loop: {n_bars} whole bars available, {bars} asked for")
    last_start = n_bars - bars
    if start_bar is not None:
        if not 0 <= start_bar <= last_start:
            raise SongError(f"--start-bar must be between 0 and {last_start}")
        start = start_bar
    else:
        score = lambda b: float(np.mean(bar_rms[b:b + bars]))
        preferred = [b for b in sections if b <= last_start]
        start = max(preferred or range(last_start + 1), key=score)

    total = bars * bpb
    duration = total * beat_sec
    frames = int(round(duration * fps))
    frame_dt = duration / frames
    first = j + start * bpb
    start_sec = float(times[first])
    beats = []
    for i in range(total):
        abs_t = start_sec + i * beat_sec
        t = i * beat_sec
        cue = abs_t
        if peak_t.size:
            k = int(np.argmin(np.abs(peak_t - abs_t)))
            if abs(peak_t[k] - abs_t) <= beat_sec / 8:
                cue = float(peak_t[k])
        cue_rel = cue - start_sec
        if i == 0:
            cue_rel = max(0.0, cue_rel)
        beats.append({"i": i, "t": round(t, 6), "abs_t": round(abs_t, 6),
                      "frame": int(round(t / frame_dt)), "bar": i // bpb, "beat_in_bar": i % bpb,
                      "accent": round(float(accent[min(first + i, n_beats - 1)]), 3),
                      "cue_t": round(cue_rel, 6)})

    min_hold = max(1, math.ceil(MIN_HOLD_SEC / beat_sec - 1e-9))
    max_states = total // min_hold
    warnings = []
    if not COMFORT[0] <= bpm <= COMFORT[1]:
        if bpm < COMFORT[0]:
            warnings.append(f"{bpm:.1f} BPM is below the 100–130 comfort range: keep one event per beat "
                            f"but add half-beat accents in busy sections, or treat it as double-time ({2 * bpm:.1f}).")
        else:
            warnings.append(f"{bpm:.1f} BPM is above the 100–130 comfort range: consider half-time "
                            f"({bpm / 2:.1f}) and put an event on every other beat.")
    if confidence < 0.2:
        warnings.append(f"low beat confidence ({confidence:.2f}): check the beat stills against the music by ear.")
    if states is not None and states > max_states:
        need = math.ceil(states * min_hold / bpb)
        warnings.append(f"{states} states need {states * min_hold} beats at {min_hold} beats each; "
                        f"this loop has {total}. Use --bars {need} or fewer states.")

    return {
        "source": str(path), "bpm": round(bpm, 3), "bpm_confidence": round(confidence, 3),
        "alternatives": [round(c[0], 2) for c in cands[1:4]],
        "beat_sec": beat_sec, "beats_per_bar": bpb, "downbeat_sec": round(downbeat_sec, 6), "fps": fps,
        "loop": {"start_sec": round(start_sec, 6), "start_bar": start, "bars": bars,
                 "duration_sec": duration, "frames": frames, "frame_dt": frame_dt},
        "beats": beats,
        "sections": [{"bar": b, "t": round(float(times[j + b * bpb]), 3)} for b in sections],
        "rules": {"max_states": max_states, "min_hold_beats": min_hold,
                  "spring": {"zeta": SPRING_ZETA, "settle_sec": round(SETTLE_BEATS * beat_sec, 4)},
                  "warnings": warnings},
    }


def write_clip(src, start_sec, duration_sec, out_path):
    fade = f"afade=t=in:d=0.01,afade=t=out:st={duration_sec - 0.01:.6f}:d=0.01"
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-y", "-ss", f"{start_sec:.6f}", "-i", str(src),
                        "-t", f"{duration_sec:.6f}", "-af", fade, "-ar", "48000", "-ac", "2",
                        "-c:a", "pcm_s16le", str(out_path)], capture_output=True)
    if r.returncode != 0:
        raise SongError(f"could not write clip: {r.stderr.decode(errors='replace')[:300]}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("song")
    ap.add_argument("--out", default=".")
    ap.add_argument("--bars", type=int, default=7)
    ap.add_argument("--start-bar", type=int)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--states", type=int)
    a = ap.parse_args(argv)
    try:
        song = analyze(a.song, bars=a.bars, fps=a.fps, start_bar=a.start_bar, states=a.states)
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        write_clip(a.song, song["loop"]["start_sec"], song["loop"]["duration_sec"], out / "clip.wav")
        (out / "song.json").write_text(json.dumps(song, indent=2))
    except SongError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    L = song["loop"]
    print(f"{song['bpm']:.2f} BPM (confidence {song['bpm_confidence']:.2f}; alternatives {song['alternatives']})")
    print(f"loop: bar {L['start_bar']} at {L['start_sec']:.2f}s, {L['bars']} bars = {L['duration_sec']:.3f}s, {L['frames']} frames")
    print(f"rules: <= {song['rules']['max_states']} states, >= {song['rules']['min_hold_beats']} beats each, "
          f"spring settle {song['rules']['spring']['settle_sec']}s")
    for w in song["rules"]["warnings"]:
        print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```
`chmod +x skills/motion-video/scripts/analyze_song.py`

- [ ] **Step 4: Run the tests**

Run: `python3 -m unittest discover -s skills/motion-video/tests -p 'test_*.py' -v`
Expected: 8 PASS. If only `test_downbeat_lands_on_the_kick_within_one_frame` fails with a consistent signed offset (print `(t - offset) % bar` for 90/120/128), change `ENV_TIME_OFFSET` by that measured offset and re-run; do not loosen the one-frame tolerance.

- [ ] **Step 5: Run it on Tints**

Run: `python3 skills/motion-video/scripts/analyze_song.py ~/Desktop/"Tints (feat. Kendrick Lamar).flac" --out /tmp/tints-check --bars 7 --states 12`
Expected: roughly 107–112 BPM, no comfort warning, loop ≈ 15.4s. Then listen: `afplay /tmp/tints-check/clip.wav` should start on a downbeat. Record the BPM in the commit message.

- [ ] **Step 6: Commit**

```bash
git add skills/motion-video/scripts/analyze_song.py skills/motion-video/tests/test_analyze_song.py
git commit -m "Add analyze_song: beat grid and derived project rules

Tints measures <BPM> BPM.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Template, new_project.sh, render.mjs

**Files:**
- Create: `skills/motion-video/template/index.html`, `skills/motion-video/scripts/new_project.sh`, `skills/motion-video/scripts/render.mjs`, `skills/motion-video/tests/fixtures.mjs`, `skills/motion-video/tests/render.test.mjs`

**Interfaces:**
- Consumes: `song.json` from Task 3; `Springs` from Task 1.
- Page contract (every project's index.html): `window.ready` (Promise, set synchronously), `window.STAGE = {width, height}`, `window.seek(t)` (pure; does NOT wrap t), optional `window.inspect(t) -> {cursor: {x, y}}` in stage px, optional `window.SFX = [{beat, file, gain}]`.
- Produces from render.mjs: `export FFMPEG`, `export serve(dir) -> {server, url}`, `export openProject(dir, {workers}) -> {browser, pages, stage, song, close()}`, `export shoot(page, t) -> Buffer(png)`, `export render(dir, {out, preview, sub, workers, from, to}) -> outPath`. CLI: `node render.mjs DIR [--preview] [--out F] [--sub N] [--workers N] [--from S --to S] [--serve]`.

- [ ] **Step 1: Test fixtures** — `skills/motion-video/tests/fixtures.mjs`

```js
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FFMPEG } from '../scripts/render.mjs';

// A tiny project: 64x64 stage, 1s loop, 4 beats. `body` is the seek implementation.
export function fixture({ seek = 'document.body.style.background = "#808080";', sfx = null, beats = null, name = 'fx proj (1)' } = {}) {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'mv-')), name);
  mkdirSync(path.join(dir, 'sfx'), { recursive: true });
  const song = {
    fps: 60, beat_sec: 0.25, beats_per_bar: 4,
    loop: { duration_sec: 1, frames: 60, frame_dt: 1 / 60 },
    beats: beats ?? [0, 1, 2, 3].map((i) => ({ i, t: i * 0.25, cue_t: i * 0.25, frame: i * 15, bar: 0, beat_in_bar: i })),
  };
  writeFileSync(path.join(dir, 'song.json'), JSON.stringify(song));
  writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body style="margin:0">
<script>
window.STAGE = { width: 64, height: 64 };
${sfx ? `window.SFX = ${JSON.stringify(sfx)};` : ''}
window.ready = Promise.resolve();
window.seek = function (t) { ${seek} };
window.inspect = function (t) { return { cursor: { x: 10, y: 10 } }; };
</script></body></html>`);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', path.join(dir, 'clip.wav')]);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=1000:r=48000', '-t', '0.05', path.join(dir, 'sfx', 'click.wav')]);
  return dir;
}

export function probe(file) {
  return JSON.parse(execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,nb_read_frames,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
}

export function grayFrame(file, n) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

export function audioSamples(file) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}
```

- [ ] **Step 2: Write the failing tests** — `skills/motion-video/tests/render.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render } from '../scripts/render.mjs';
import { fixture, probe, grayFrame, audioSamples } from './fixtures.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');

test('renders exactly loop.frames frames at 60fps with audio', async () => {
  const dir = fixture();
  const out = await render(dir, { workers: 2 });
  const p = probe(out);
  const v = p.streams.find((s) => s.codec_type === 'video');
  assert.equal(Number(v.nb_read_frames), 60);
  assert.equal(v.width, 64); assert.equal(v.r_frame_rate, '60/1');
  assert.ok(p.streams.some((s) => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(p.format.duration) - 1) < 0.05, p.format.duration);
});

test('subframes are centred on the frame and blended (motion blur)', async () => {
  // White for subframes after the frame time, black before: a correct centred
  // 4-subframe blend is mid gray; an off-by-one select would be all black or white.
  const dir = fixture({ seek: 'const x = t * 60; document.body.style.background = (x - Math.round(x)) > 0 ? "#fff" : "#000";' });
  const out = await render(dir, { workers: 2 });
  const g = grayFrame(out, 10);
  assert.ok(g > 100 && g < 155, `frame 10 mean ${g}`);
});

test('preview is half size and single-subframe', async () => {
  const out = await render(fixture(), { preview: true });
  assert.equal(probe(out).streams.find((s) => s.codec_type === 'video').width, 32);
});

test('SFX land at the beat cue_t', async () => {
  const beats = [0, 1, 2, 3].map((i) => ({ i, t: i * 0.25, cue_t: i * 0.25 + (i === 2 ? 0.02 : 0) }));
  const dir = fixture({ sfx: [{ beat: 2, file: 'sfx/click.wav', gain: 1 }], beats });
  const s = audioSamples(await render(dir, { preview: true }));
  const first = s.findIndex((x) => Math.abs(x) > 1000);
  assert.ok(Math.abs(first / 48000 - 0.52) < 0.01, `first sound at ${first / 48000}s`);
});

test('a page without seek fails fast with a clear message', async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, 'index.html'), '<script>window.ready = Promise.resolve(); window.STAGE = {width: 64, height: 64};</script>');
  await assert.rejects(render(dir, { preview: true }), /window\.seek/);
});

test('a page error fails the render', async () => {
  await assert.rejects(render(fixture({ seek: 'if (t > 0.5) throw new Error("boom at " + t);' }), { preview: true }), /boom/);
});

test('new_project.sh scaffolds and refuses to overwrite', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'np-'));
  const song = path.join(root, 'My Song (live).wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const proj = path.join(root, 'my proj');
  const script = path.join(SKILL, 'scripts', 'new_project.sh');
  execFileSync(script, [proj, song, '--bars', '4'], { stdio: 'pipe' });
  for (const f of ['index.html', 'springs.js', 'song.json', 'clip.wav', 'sfx/click.wav']) assert.ok(existsSync(path.join(proj, f)), f);
  assert.match(readFileSync(path.join(proj, 'springs.js'), 'utf8'), /globalThis\.Springs|root\.Springs/);
  const again = spawnSync(script, [proj, song], { encoding: 'utf8' });
  assert.equal(again.status, 1); assert.match(again.stderr, /not overwriting/);
});

test('the template renders a preview without errors', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tpl-'));
  const song = path.join(root, 's.wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const proj = path.join(root, 'p');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [proj, song, '--bars', '2'], { stdio: 'pipe' });
  const out = await render(proj, { preview: true, workers: 4 });
  const song_ = JSON.parse(readFileSync(path.join(proj, 'song.json'), 'utf8'));
  assert.equal(Number(probe(out).streams.find((s) => s.codec_type === 'video').nb_read_frames), song_.loop.frames);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test skills/motion-video/tests/render.test.mjs`
Expected: FAIL — cannot find `../scripts/render.mjs`

- [ ] **Step 4: Implement render.mjs**

```js
#!/usr/bin/env node
// render.mjs -- render a motion-video project (index.html + song.json + clip.wav) to MP4.
//
//   node render.mjs DIR [--preview] [--out FILE] [--sub 4] [--workers 4] [--from S --to S]
//   node render.mjs DIR --serve        serve DIR and print a URL (open with ?play to watch live)
//
// Full renders take `sub` subframes per output frame, centred on the frame time,
// and blend them with ffmpeg tmix for motion blur. Times wrap modulo the loop,
// so the blur across the seam is continuous. --preview is half size, 1 subframe.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

export function serve(dir, port = 0) {
  const root = path.resolve(dir);
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(root, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function openPage(browser, url, viewport, errors) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(url);
  const ok = await page.evaluate(() => typeof window.seek === 'function' && !!window.ready);
  if (!ok) throw new Error('index.html must define window.seek(t), window.ready and window.STAGE -- see motion-video/template/index.html');
  await Promise.race([
    page.evaluate(() => window.ready),
    new Promise((_, reject) => setTimeout(() => reject(new Error('window.ready did not resolve within 30s (fonts or song.json?)')), 30000)),
  ]);
  // STAGE may be set inside ready (the template reads project.json there).
  const stage = await page.evaluate(() => window.STAGE);
  if (!stage || !(stage.width > 0) || !(stage.height > 0)) throw new Error('index.html must define window.STAGE = {width, height} by the time window.ready resolves');
  return page;
}

export async function openProject(dir, { workers = 4 } = {}) {
  const root = path.resolve(dir);
  const song = JSON.parse(await readFile(path.join(root, 'song.json'), 'utf8'));
  const { server, url } = await serve(root);
  const browser = await chromium.launch();
  const errors = [];
  try {
    const probePage = await openPage(browser, url, { width: 800, height: 800 }, errors);
    const stage = await probePage.evaluate(() => window.STAGE);
    await probePage.close();
    const viewport = { width: stage.width, height: stage.height };
    const pages = await Promise.all(Array.from({ length: workers }, () => openPage(browser, url, viewport, errors)));
    return { browser, pages, stage, song, errors, url,
      async close() { await browser.close(); server.close(); } };
  } catch (e) { await browser.close(); server.close(); throw e; }
}

export async function shoot(page, t) {
  await page.evaluate((t) => window.seek(t), t);
  return page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
}

function sfxInputs(dir, song, sfx, offset, duration) {
  const inputs = [], filters = [];
  sfx.forEach((c, n) => {
    const b = song.beats?.[c.beat];
    const t = Number.isInteger(c.beat) && b ? (b.cue_t ?? b.t) : c.beat * song.beat_sec;
    const ms = Math.round((t - offset) * 1000);
    if (ms < 0 || ms > duration * 1000) return;
    inputs.push('-i', path.join(dir, c.file));
    filters.push(`[${inputs.length / 2 + 1}:a]aresample=48000,volume=${c.gain ?? 1},adelay=${ms}:all=1[s${n}]`);
  });
  return { inputs, filters, labels: filters.map((f) => f.slice(f.lastIndexOf('['))) };
}

export async function render(dir, opts = {}) {
  const root = path.resolve(dir);
  const preview = !!opts.preview;
  const proj = await openProject(root, { workers: opts.workers ?? 4 });
  try {
    const { song, pages, errors } = proj;
    const fps = song.fps, D = song.loop.duration_sec, frames = song.loop.frames;
    const dt = song.loop.frame_dt ?? D / frames;
    const sub = preview ? 1 : (opts.sub ?? 4);
    const f0 = opts.from != null ? Math.max(0, Math.floor(opts.from / dt)) : 0;
    const f1 = opts.to != null ? Math.min(frames, Math.ceil(opts.to / dt)) : frames;
    const total = (f1 - f0) * sub;
    const timeAt = (i) => {
      const f = f0 + Math.floor(i / sub), k = i % sub;
      const t = (f + (sub === 1 ? 0 : (k - (sub - 1) / 2) / sub)) * dt;
      return ((t % D) + D) % D;
    };
    const out = path.resolve(opts.out ?? path.join(root, 'out', preview ? 'preview.mp4' : 'video.mp4'));
    await mkdir(path.dirname(out), { recursive: true });

    const offset = f0 * dt, duration = (f1 - f0) * dt;
    const sfx = await pages[0].evaluate(() => window.SFX || []);
    const clip = path.join(root, 'clip.wav');
    const s = sfxInputs(root, song, sfx, offset, duration);
    const vf = [sub > 1 ? `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/${fps}/TB` : null,
      preview ? 'scale=trunc(iw/4)*2:-2' : null, 'format=yuv420p'].filter(Boolean).join(',');
    const args = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps * sub), '-c:v', 'png', '-i', '-'];
    let graph = `[0:v]${vf}[v]`;
    if (existsSync(clip)) {
      args.push('-ss', offset.toFixed(6), '-t', duration.toFixed(6), '-i', clip, ...s.inputs);
      graph += s.filters.length
        ? `;${s.filters.join(';')};[1:a]${s.labels.join('')}amix=inputs=${s.labels.length + 1}:normalize=0:duration=first[a]`
        : ';[1:a]anull[a]';
      args.push('-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '256k');
    } else {
      args.push('-filter_complex', graph, '-map', '[v]');
    }
    args.push('-r', String(fps), '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '23' : '16',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', duration.toFixed(6), out);

    const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d; });
    const done = new Promise((resolve, reject) => ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-800)}`))));

    const B = pages.length;
    for (let b = 0; b < total; b += B) {
      const n = Math.min(B, total - b);
      const shots = await Promise.all(Array.from({ length: n }, (_, k) => shoot(pages[k], timeAt(b + k))));
      if (errors.length) { ff.kill(); throw errors[0]; }
      for (const png of shots) if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
      if (process.stderr.isTTY) process.stderr.write(`\r${Math.round(((b + n) / total) * 100)}%`);
    }
    ff.stdin.end();
    await done;
    if (process.stderr.isTTY) process.stderr.write('\n');
    return out;
  } finally { await proj.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const VALUE = new Set(['out', 'sub', 'workers', 'from', 'to', 'port']);
  const o = {}; let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); o[k] = VALUE.has(k) ? argv[++i] : true; }
    else dir ??= a;
  }
  if (!dir) { console.error('usage: render.mjs DIR [--preview] [--out FILE] [--sub N] [--workers N] [--from S --to S] [--serve [--port N]]'); process.exit(2); }
  if (o.serve) {
    const { url } = await serve(dir, Number(o.port ?? 8123));
    console.log(`${url}?play   (click the page to start audio)`);
    return;
  }
  const num = (k) => (o[k] != null ? Number(o[k]) : undefined);
  const out = await render(dir, { preview: !!o.preview, out: o.out, sub: num('sub'), workers: num('workers'), from: num('from'), to: num('to') });
  console.log(out);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
```

- [ ] **Step 5: Implement new_project.sh**

```bash
#!/usr/bin/env bash
# new_project.sh DIR SONG [analyze_song args...] -- scaffold a motion-video project:
# template index.html, springs.js, a synthesised click SFX, song.json and clip.wav.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SKILL="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
if [ $# -lt 2 ]; then echo "usage: new_project.sh DIR SONG [--bars N] [--states N] [--start-bar N]" >&2; exit 2; fi
DIR="$1"; SONG="$2"; shift 2
if [ -e "$DIR/index.html" ]; then echo "error: $DIR/index.html exists; not overwriting" >&2; exit 1; fi
mkdir -p "$DIR/sfx"
python3 "$SKILL/scripts/analyze_song.py" "$SONG" --out "$DIR" "$@"
cp "$SKILL/template/index.html" "$DIR/index.html"
cp -L "$SKILL/assets/springs.js" "$DIR/springs.js"
# A short filtered-noise tick: ours, so no licensing question.
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.03:c=pink:a=0.8:seed=7" \
  -af "highpass=f=1800,lowpass=f=9000,afade=t=out:st=0.002:d=0.028" -ar 48000 "$DIR/sfx/click.wav"
echo "project ready: $DIR"
echo "  watch live:  node '$SKILL/scripts/render.mjs' '$DIR' --serve"
```
`chmod +x skills/motion-video/scripts/new_project.sh`

- [ ] **Step 6: Implement the template** — `skills/motion-video/template/index.html`

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>motion</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=block" rel="stylesheet">
<style>
  /* Pure black and white on warm gray. For one accent colour, add --accent and
     use it in STATES; never gradients, glows or particle effects. */
  :root { --canvas:#ECEAE6; --ink:#0B0B0B; --paper:#FFFFFF; --muted:#8C8883; }
  html, body { margin:0; background:var(--canvas); overflow:hidden; }
  #stage { position:relative; overflow:hidden; background:var(--canvas);
           font-family:Geist, system-ui, sans-serif; color:var(--ink);
           -webkit-font-smoothing:antialiased; }
  /* The camera scales about the stage centre. No will-change here or inside:
     text under a scaled will-change layer renders blurry. */
  #camera { position:absolute; inset:0; }
  #shape { position:absolute; box-sizing:border-box; overflow:hidden; }
  .layer { position:absolute; inset:0; display:grid; place-items:center; white-space:nowrap; opacity:0; }
  .label { font-size:34px; font-weight:500; letter-spacing:-0.01em; }
  #cursor { position:absolute; left:0; top:0; width:44px; height:44px; transform-origin:7px 4px; }
</style>
</head>
<body>
<div id="stage">
  <div id="camera">
    <div id="shape">
      <!-- One .layer per state NAME in STATES. Only content lives in layers; the
           shape's size, radius and colours come from STATES. -->
      <div class="layer" data-state="button"><span class="label">Get started</span></div>
      <div class="layer" data-state="loader">
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none"><circle id="spin" cx="22" cy="22" r="17" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="70 200"/></svg>
      </div>
      <div class="layer" data-state="check">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path id="tick" d="M12 25 L21 34 L37 15" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1"/></svg>
      </div>
    </div>
    <svg id="cursor" viewBox="0 0 44 44"><path d="M7 4 L7 33 L14.5 25.5 L20 37 L25 34.8 L19.6 23.6 L30 23.6 Z" fill="#0B0B0B" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>
  </div>
</div>
<script src="springs.js"></script>
<script type="module">
const { track, fromSettle } = window.Springs;
const STAGE = { width: 1440, height: 1440 };
window.STAGE = STAGE;
const CX = STAGE.width / 2, CY = STAGE.height / 2;
const $ = (s) => document.querySelector(s);

let song, END, SHAPE, beatT;

// ---------------- the three tables you edit ----------------
// STATES: what the one shape is from beat `at`. The last row must repeat the
// first and sit at least 2 beats before END so everything settles by the seam.
const states = () => [
  { at: 0,       name: 'button', w: 380, h: 112, r: 56, fill: '#0B0B0B', ink: '#FFFFFF' },
  { at: 2,       name: 'loader', w: 112, h: 112, r: 56, fill: '#0B0B0B', ink: '#FFFFFF' },
  { at: 4,       name: 'check',  w: 112, h: 112, r: 56, fill: '#FFFFFF', ink: '#0B0B0B' },
  { at: END - 2, name: 'button', w: 380, h: 112, r: 56, fill: '#0B0B0B', ink: '#FFFFFF' },
];
// CURSOR: where the pointer is from beat `at`, in px from the stage centre.
// press: true clicks on that beat (and plays sfx/click.wav at the beat's cue).
// First and last rows must match, the last at least 2 beats before END.
const cursor = () => [
  { at: 0,       x: 240, y: 280 },
  { at: 1.25,    x: 60,  y: 18 },
  { at: 2,       x: 60,  y: 18, press: true },
  { at: 3,       x: 200, y: 230 },
  { at: END - 2, x: 240, y: 280 },
];
// Per-state content animation, given seconds since that state began.
const content = {
  loader: (s) => { $('#spin').style.transform = `rotate(${s * 450}deg)`; $('#spin').style.transformOrigin = '22px 22px'; },
  check:  (s) => { $('#tick').style.strokeDashoffset = String(1 - Math.min(1, s / (0.8 * song.beat_sec))); },
};
// ------------------------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
let S, C, tracks, layers;

function build() {
  S = states(); C = cursor();
  const sp = song.rules?.spring ?? { zeta: 0.85, settle_sec: 0.6 * song.beat_sec };
  SHAPE = { omega: fromSettle(sp.settle_sec, sp.zeta), zeta: sp.zeta };
  const CAM = { omega: fromSettle(song.beat_sec, 1), zeta: 1 };
  const PTR = { omega: fromSettle(0.8 * song.beat_sec, 1), zeta: 1 };
  const mk = (rows, get, o) => ({ from: get(rows[0]), changes: rows.slice(1).map((r) => ({ t: beatT(r.at), to: get(r) })), ...o });
  const zoom = (s) => Math.min(2.4, Math.max(1, Math.sqrt((0.5 * STAGE.width) / Math.max(s.w, s.h))));
  tracks = {
    w: mk(S, (s) => s.w, SHAPE), h: mk(S, (s) => s.h, SHAPE), r: mk(S, (s) => s.r, SHAPE),
    fill: [0, 1, 2].map((k) => mk(S, (s) => hex(s.fill)[k], SHAPE)),
    ink: [0, 1, 2].map((k) => mk(S, (s) => hex(s.ink)[k], SHAPE)),
    zoom: mk(S, zoom, CAM),
    cx: mk(C, (c) => c.x, PTR), cy: mk(C, (c) => c.y, PTR),
    press: { from: 1, omega: fromSettle(0.15 * song.beat_sec, 1), zeta: 1,
             changes: C.filter((c) => c.press).flatMap((c) => [{ t: beatT(c.at) - 0.08 * song.beat_sec, to: 0.82 }, { t: beatT(c.at) + 0.1 * song.beat_sec, to: 1 }]) },
  };
  // Content swaps: each layer enters a beat-fraction after its state starts (so
  // the container leads) and exits fast when the next state starts.
  const enter = fromSettle(0.5 * song.beat_sec, 1), exit = fromSettle(0.2 * song.beat_sec, 1);
  layers = [...document.querySelectorAll('.layer')].map((el) => {
    const name = el.dataset.state, changes = [];
    S.forEach((s, i) => {
      if (s.name !== name || i === 0) return;
      changes.push({ t: beatT(s.at) + 0.15 * song.beat_sec, to: 1, omega: enter });
    });
    S.forEach((s, i) => {
      if (s.name === name && S[i + 1] && S[i + 1].name !== name) changes.push({ t: beatT(S[i + 1].at), to: 0, omega: exit });
    });
    return { el, name, tr: { from: S[0].name === name ? 1 : 0, changes, omega: enter, zeta: 1 } };
  });
  window.SFX = C.filter((c) => c.press).map((c) => ({ beat: c.at, file: 'sfx/click.wav', gain: 0.7 }));
}

const v = (tr, t) => track(t, tr).value;

function cursorAt(t) {
  const z = v(tracks.zoom, t);
  return { x: CX + v(tracks.cx, t) * z, y: CY + v(tracks.cy, t) * z };
}

function stateAt(t) {
  let i = 0;
  while (S[i + 1] && beatT(S[i + 1].at) <= t) i++;
  return { s: S[i], since: t - beatT(S[i].at) };
}

function seek(t) {
  const w = v(tracks.w, t), h = v(tracks.h, t), r = v(tracks.r, t), z = v(tracks.zoom, t);
  const rgb = (arr) => `rgb(${arr.map((tr) => Math.round(v(tr, t))).join(',')})`;
  $('#camera').style.transform = `translate(${CX}px,${CY}px) scale(${z}) translate(${-CX}px,${-CY}px)`;
  Object.assign($('#shape').style, { left: `${CX - w / 2}px`, top: `${CY - h / 2}px`, width: `${w}px`, height: `${h}px`,
    borderRadius: `${Math.min(r, w / 2, h / 2)}px`, background: rgb(tracks.fill), color: rgb(tracks.ink) });
  for (const L of layers) {
    const o = Math.max(0, Math.min(1, v(L.tr, t)));
    Object.assign(L.el.style, { opacity: o, filter: o > 0.999 ? 'none' : `blur(${(1 - o) * 10}px)`, transform: `scale(${0.96 + 0.04 * o})` });
  }
  const { s, since } = stateAt(t);
  content[s.name]?.(since);
  const p = v(tracks.press, t);
  const x = CX + v(tracks.cx, t), y = CY + v(tracks.cy, t);
  $('#cursor').style.transform = `translate(${x - 7}px,${y - 4}px) scale(${p / z})`;
}

window.ready = (async () => {
  song = await (await fetch('song.json')).json();
  END = song.beats.length;
  // Integer beats snap to the measured cue so picture and sound hit together.
  beatT = (b) => {
    const i = Math.floor(b), beat = song.beats[i];
    return (beat ? beat.cue_t ?? beat.t : i * song.beat_sec) + (b - i) * song.beat_sec;
  };
  Object.assign($('#stage').style, { width: `${STAGE.width}px`, height: `${STAGE.height}px` });
  await document.fonts.load('500 34px Geist');
  await document.fonts.ready;
  build();
  seek(0);
})();
window.seek = seek;
window.inspect = (t) => ({ cursor: cursorAt(t) });

// ?play: watch it live in a browser with the audio (click to start).
if (location.search.includes('play')) {
  window.ready.then(() => {
    const audio = new Audio('clip.wav'); audio.loop = true;
    document.body.addEventListener('click', () => audio.play(), { once: true });
    const D = song.loop.duration_sec;
    const tick = () => { seek(audio.paused ? 0 : audio.currentTime % D); requestAnimationFrame(tick); };
    tick();
  });
}
</script>
</body>
</html>
```

- [ ] **Step 7: Run tests**

Run: `node --test skills/motion-video/tests/render.test.mjs`
Expected: 8 PASS. The template test proves the scaffold end to end.

- [ ] **Step 8: Commit**

```bash
git add skills/motion-video/template skills/motion-video/scripts/new_project.sh skills/motion-video/scripts/render.mjs skills/motion-video/tests/fixtures.mjs skills/motion-video/tests/render.test.mjs
git commit -m "Add seek(t) template, project scaffold and Playwright/ffmpeg renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4b: Any project's look and any size — extract_theme.py, --size, --theme

**Files:**
- Create: `skills/motion-video/scripts/extract_theme.py`, `skills/motion-video/tests/test_extract_theme.py`
- Modify: `skills/motion-video/scripts/new_project.sh`, `skills/motion-video/template/index.html`, `skills/motion-video/tests/render.test.mjs`

**Interfaces:**
- Consumes: render.mjs (Task 4; `openPage` awaits `ready` before reading `STAGE`).
- Produces: `extract(css_text, overrides={}) -> (theme: dict, warnings: list[str])`, `HOUSE` dict, CLI `extract_theme.py [CSS] --out DIR [--map role=--var]...` writing `DIR/theme.css` and `DIR/theme.json`. Roles: `canvas, surface, ink, muted, accent` (colours, `#rrggbb`) and `font` (a font-family string). `new_project.sh DIR SONG [--size square|vertical|landscape|WxH] [--theme CSS] [--map role=--var] [analyze args]` also writes `DIR/project.json` = `{"stage": {"width": W, "height": H}}`.
- Template contract change: STATES `fill`/`ink` hold a theme role name (`'ink'`, `'surface'`, `'accent'`, ...) or a literal `#rrggbb`.

- [ ] **Step 1: Write the failing tests** — `skills/motion-video/tests/test_extract_theme.py`

```python
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import extract_theme as E  # noqa: E402

FINANCE_LIKE = """
/* palette */
:root{
  --bg:#eef0f3; --panel:#ffffff; --panel-2:#f6f7f9;
  --ink:#161a21; --muted:#697082;
  --accent:#0c7d74; --pos:#067647;
}
@media (prefers-color-scheme:dark){ :root{ --bg:#171a20; --ink:#eef0f4; } }
body{margin:0;font-family:-apple-system, "SF Pro Text", sans-serif}
"""


class ExtractThemeTests(unittest.TestCase):
    def test_reads_light_theme_roles_and_body_font(self):
        theme, warnings = E.extract(FINANCE_LIKE)
        self.assertEqual(theme["canvas"], "#eef0f3")
        self.assertEqual(theme["surface"], "#ffffff")
        self.assertEqual(theme["ink"], "#161a21")
        self.assertEqual(theme["muted"], "#697082")
        self.assertEqual(theme["accent"], "#0c7d74")
        self.assertIn("-apple-system", theme["font"])
        self.assertEqual(warnings, [])

    def test_resolves_var_references(self):
        theme, _ = E.extract(":root{--teal:#0C7D74;--primary:var(--teal);--background:#fff;--text:#111;}")
        self.assertEqual(theme["accent"], "#0c7d74")
        self.assertEqual(theme["canvas"], "#ffffff")
        self.assertEqual(theme["ink"], "#111111")

    def test_normalises_rgb(self):
        theme, _ = E.extract(":root{--bg: rgb(10, 20, 30); --accent: rgba(255,0,0,.5);}")
        self.assertEqual(theme["canvas"], "#0a141e")
        self.assertEqual(theme["accent"], "#ff0000")

    def test_missing_roles_fall_back_to_house_with_a_warning(self):
        theme, warnings = E.extract(":root{--accent:#123456}")
        self.assertEqual(theme["accent"], "#123456")
        self.assertEqual(theme["canvas"], E.HOUSE["canvas"])
        self.assertTrue(any("canvas" in w for w in warnings))

    def test_map_override(self):
        theme, _ = E.extract(FINANCE_LIKE, {"accent": "--pos"})
        self.assertEqual(theme["accent"], "#067647")

    def test_cli_house_theme_and_errors(self):
        out = Path(tempfile.mkdtemp())
        r = subprocess.run([sys.executable, str(SCRIPTS / "extract_theme.py"), "--out", str(out)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads((out / "theme.json").read_text()), E.HOUSE)
        self.assertIn("--accent:", (out / "theme.css").read_text())
        r = subprocess.run([sys.executable, str(SCRIPTS / "extract_theme.py"), str(out / "nope.css"), "--out", str(out)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("no such file", r.stderr)

    def test_real_finance_css_if_present(self):
        css = Path.home() / "Documents/AUTOMATION/personal-finance/web/style.css"
        if not css.exists():
            self.skipTest("finance app not on this machine")
        theme, _ = E.extract(css.read_text())
        self.assertEqual(theme["accent"], "#0c7d74")
        self.assertEqual(theme["canvas"], "#eef0f3")


if __name__ == "__main__":
    unittest.main()
```

Add to `render.test.mjs`:

```js
test('new_project.sh --size vertical --theme makes a 1080x1920 themed project', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sz-'));
  const song = path.join(root, 's.wav');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})
from test_analyze_song import click_track
click_track(${JSON.stringify(song)}, 120)`]);
  const css = path.join(root, 'app style.css');
  writeFileSync(css, ':root{--bg:#eef0f3;--panel:#fff;--ink:#161a21;--muted:#697082;--accent:#0c7d74}');
  const proj = path.join(root, 'v');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [proj, song, '--size', 'vertical', '--theme', css, '--bars', '2'], { stdio: 'pipe' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(proj, 'project.json'), 'utf8')).stage, { width: 1080, height: 1920 });
  assert.match(readFileSync(path.join(proj, 'theme.css'), 'utf8'), /--accent:#0c7d74/);
  const v = probe(await render(proj, { preview: true })).streams.find((s) => s.codec_type === 'video');
  assert.equal(v.width, 540); assert.equal(v.height, 960);
});

test('new_project.sh rejects a bad size', () => {
  const r = spawnSync(path.join(SKILL, 'scripts', 'new_project.sh'), [path.join(tmpdir(), 'x'), 'song.wav', '--size', '1081x1920'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /--size/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m unittest skills/motion-video/tests/test_extract_theme.py; node --test skills/motion-video/tests/render.test.mjs`
Expected: FAIL — no module `extract_theme`; unknown `--size`.

- [ ] **Step 3: Implement** — `skills/motion-video/scripts/extract_theme.py`

```python
#!/usr/bin/env python3
"""extract_theme.py -- pull a motion theme out of any project's CSS.

Usage: extract_theme.py [CSS] --out DIR [--map role=--var ...]

Writes DIR/theme.css (the CSS variables the template uses) and DIR/theme.json
(the same, colours normalised to #rrggbb so springs can interpolate them).
Reads the first :root block (the light theme) and body/html font-family.
Without CSS, writes the house theme: warm gray, black and white, Geist.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HOUSE = {"canvas": "#eceae6", "surface": "#ffffff", "ink": "#0b0b0b", "muted": "#8c8883",
         "accent": "#0b0b0b", "font": "Geist, system-ui, sans-serif"}
ROLES = {
    "canvas": ["--bg", "--background", "--canvas", "--color-bg", "--bg-color", "--page"],
    "surface": ["--panel", "--surface", "--card", "--paper", "--bg-elevated", "--color-surface"],
    "ink": ["--ink", "--text", "--fg", "--foreground", "--color-text", "--text-color"],
    "muted": ["--muted", "--text-muted", "--subtle", "--color-muted"],
    "accent": ["--accent", "--primary", "--brand", "--color-primary", "--color-accent"],
}
FONT_VARS = ["--font", "--font-sans", "--font-family", "--font-body"]
NAMED = {"white": "#ffffff", "black": "#000000"}


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def root_vars(css):
    m = re.search(r"(?<![\w-]):root\s*\{([^}]*)\}", css)
    if not m:
        return {}
    return {k.strip(): v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+)", m.group(1))}


def resolve(value, env, depth=0):
    if depth > 8:
        return value
    def sub(m):
        name, fallback = m.group(1), m.group(2)
        if name in env:
            return resolve(env[name], env, depth + 1)
        return fallback.strip() if fallback else m.group(0)
    return re.sub(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)", sub, value)


def to_hex(c):
    c = c.strip().lower()
    if c in NAMED:
        return NAMED[c]
    m = re.fullmatch(r"#([0-9a-f]{3,8})", c)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h[:3])
        return "#" + h[:6] if len(h) in (6, 8) else None
    m = re.fullmatch(r"rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+[\d.]+%?)?\s*\)", c)
    if m:
        return "#" + "".join(f"{min(255, int(x)):02x}" for x in m.groups())
    return None


def body_font(css):
    m = re.search(r"(?:^|[}\s,])(?:html|body)\s*(?:,[^{]*)?\{[^}]*?font-family\s*:\s*([^;}]+)", css)
    return m.group(1).strip() if m else None


def extract(css, overrides=None):
    css = strip_comments(css)
    env = root_vars(css)
    theme, warnings = dict(HOUSE), []
    for role, names in ROLES.items():
        names = [overrides[role]] if overrides and role in overrides else names
        found = next((n for n in names if n in env), None)
        if not found:
            warnings.append(f"no {role} colour found (looked for {', '.join(names)}); using the house {role}")
            continue
        hexed = to_hex(resolve(env[found], env))
        if hexed is None:
            warnings.append(f"{found} is not a plain colour ({env[found]}); using the house {role}")
            continue
        theme[role] = hexed
    font = None
    if overrides and "font" in overrides and overrides["font"] in env:
        font = resolve(env[overrides["font"]], env)
    font = font or next((resolve(env[n], env) for n in FONT_VARS if n in env), None) or body_font(css)
    if font:
        theme["font"] = font
    else:
        warnings.append("no font-family found; using the house font (Geist)")
    return theme, warnings


def write(theme, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "theme.json").write_text(json.dumps(theme, indent=2))
    (out / "theme.css").write_text(":root{" + "".join(f"--{k}:{v};" for k, v in theme.items()) + "}\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("css", nargs="?")
    ap.add_argument("--out", required=True)
    ap.add_argument("--map", action="append", default=[], help="role=--css-var, e.g. accent=--pos")
    a = ap.parse_args(argv)
    overrides = dict(m.split("=", 1) for m in a.map)
    if a.css is None:
        theme, warnings = dict(HOUSE), []
    else:
        p = Path(a.css)
        if not p.is_file():
            print(f"error: no such file: {p}", file=sys.stderr)
            return 2
        theme, warnings = extract(p.read_text(errors="replace"), overrides)
    write(theme, a.out)
    print("theme: " + ", ".join(f"{k} {v}" for k, v in theme.items()))
    for w in warnings:
        print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: new_project.sh options** — replace the argument handling with (note `${ARR[@]+...}`: macOS `/usr/bin/env bash` is 3.2, where an empty array under `set -u` is an error):

```bash
DIR="$1"; SONG="$2"; shift 2
SIZE=square; THEME=""; MAPS=(); ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --size)  SIZE="$2"; shift 2 ;;
    --theme) THEME="$2"; shift 2 ;;
    --map)   MAPS+=(--map "$2"); shift 2 ;;
    *)       ARGS+=("$1"); shift ;;
  esac
done
case "$SIZE" in
  square) W=1440; H=1440 ;;
  vertical) W=1080; H=1920 ;;
  landscape) W=1920; H=1080 ;;
  *x*) W="${SIZE%x*}"; H="${SIZE#*x}" ;;
  *) W=0; H=0 ;;
esac
if ! [[ "$W" =~ ^[0-9]+$ && "$H" =~ ^[0-9]+$ ]] || [ "$W" -lt 64 ] || [ "$H" -lt 64 ] || [ $((W % 2)) -ne 0 ] || [ $((H % 2)) -ne 0 ]; then
  echo "error: --size must be square, vertical, landscape or WxH with even numbers >= 64" >&2; exit 2
fi
if [ -e "$DIR/index.html" ]; then echo "error: $DIR/index.html exists; not overwriting" >&2; exit 1; fi
mkdir -p "$DIR/sfx"
python3 "$SKILL/scripts/analyze_song.py" "$SONG" --out "$DIR" ${ARGS[@]+"${ARGS[@]}"}
python3 "$SKILL/scripts/extract_theme.py" ${THEME:+"$THEME"} --out "$DIR" ${MAPS[@]+"${MAPS[@]}"}
printf '{"stage": {"width": %d, "height": %d}}\n' "$W" "$H" > "$DIR/project.json"
```
(The size check runs before anything is written, so a bad size leaves nothing behind. Keep the existing template/springs/SFX copy lines after this.)

- [ ] **Step 5: Template changes** — in `template/index.html`:
  1. After the Google Fonts `<link>`, add `<link rel="stylesheet" href="theme.css">`. Replace the `:root{...}` palette line with house fallbacks under the role names: `:root { --canvas:#ECEAE6; --surface:#FFFFFF; --ink:#0B0B0B; --muted:#8C8883; --accent:#0B0B0B; --font:Geist, system-ui, sans-serif; }` placed **before** the theme link (move the `<style>` above it) so theme.css wins; `#stage` uses `font-family:var(--font)`, `background:var(--canvas)`.
  2. Replace `const STAGE = { width: 1440, height: 1440 }; window.STAGE = STAGE; const CX = ..., CY = ...;` with `let STAGE, CX, CY, THEME;`.
  3. STATES rows use role names: button/loader `fill: 'ink', ink: 'surface'`; check `fill: 'surface', ink: 'ink'`. Update the table comment: "fill/ink: a theme role (canvas, surface, ink, muted, accent) or #rrggbb".
  4. Replace `const hex = ...` with
     `const hex = (c) => { const h = (THEME[c] ?? c); return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); };`
  5. In `zoom`, use `Math.min(STAGE.width, STAGE.height)` in place of `STAGE.width`.
  6. At the start of `window.ready`'s async body:
     ```js
     const [songR, projR, themeR] = await Promise.all(['song.json', 'project.json', 'theme.json'].map((f) => fetch(f)));
     song = await songR.json();
     STAGE = projR.ok ? (await projR.json()).stage : { width: 1440, height: 1440 };
     THEME = themeR.ok ? await themeR.json() : {};
     window.STAGE = STAGE; CX = STAGE.width / 2; CY = STAGE.height / 2;
     ```
     and delete the old `song = await (await fetch('song.json')).json();` line. Make the font wait generic: `await document.fonts.load(\`500 34px ${getComputedStyle(document.documentElement).getPropertyValue('--font')}\`).catch(() => {});`.

- [ ] **Step 6: Run everything**

Run: `npm test`
Expected: all PASS, including the existing template-preview test (house theme, square) and the two new size/theme tests.

- [ ] **Step 7: Commit**

```bash
git add skills/motion-video
git commit -m "Theme from any project's CSS and size presets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: beat_stills.mjs — per-beat stills, contact sheet, loop-seam check

**Files:**
- Create: `skills/motion-video/scripts/beat_stills.mjs`, `skills/motion-video/tests/beat_stills.test.mjs`

**Interfaces:**
- Consumes: `openProject`, `shoot`, `FFMPEG` from render.mjs.
- Produces: `beatStills(dir, {outDir}) -> {stills: string[], sheet: string, seam: {psnr, cursorPos, cursorVel, ok, notes: string[]}}`; CLI `node beat_stills.mjs DIR` prints the report and exits 1 when `seam.ok` is false.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beatStills } from '../scripts/beat_stills.mjs';
import { fixture } from './fixtures.mjs';

test('one still per beat plus a contact sheet', async () => {
  const r = await beatStills(fixture());
  assert.equal(r.stills.length, 4);
  for (const f of [...r.stills, r.sheet]) assert.ok(existsSync(f), f);
});

test('a looping piece passes the seam check', async () => {
  const r = await beatStills(fixture({ seek: 'const g = Math.round(128 + 100 * Math.sin(2 * Math.PI * t)); document.body.style.background = `rgb(${g},${g},${g})`;' }));
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});

test('a piece whose last frame differs from its first fails', async () => {
  const r = await beatStills(fixture({ seek: 'const g = Math.round(255 * t); document.body.style.background = `rgb(${g},${g},${g})`;' }));
  assert.equal(r.seam.ok, false);
  assert.match(r.seam.notes.join(' '), /frame/);
});

test('a cursor that is still moving at the seam fails', async () => {
  const dir = fixture();
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8')
    .replace('return { cursor: { x: 10, y: 10 } };', 'return { cursor: { x: 10 + 40 * t * t, y: 10 } };');
  writeFileSync(path.join(dir, 'index.html'), html);
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, false);
  assert.match(r.seam.notes.join(' '), /cursor/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test skills/motion-video/tests/beat_stills.test.mjs`
Expected: FAIL — cannot find `../scripts/beat_stills.mjs`

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
// beat_stills.mjs DIR -- render one still per beat and a contact sheet (one bar
// per row), then check the loop seam: frame at t=0 vs t=D, and the cursor's
// position and velocity either side. Review the sheet BEFORE a full render.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { openProject, shoot, FFMPEG } from './render.mjs';

const PSNR_MIN = 45;       // dB; identical frames report inf
const CURSOR_POS_MAX = 0.5; // px
const CURSOR_VEL_MAX = 2;   // px/s

export async function beatStills(dir, { outDir } = {}) {
  const root = path.resolve(dir);
  const out = path.resolve(outDir ?? path.join(root, 'out', 'stills'));
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const proj = await openProject(root, { workers: 4 });
  try {
    const { song, pages, errors } = proj;
    const D = song.loop.duration_sec;
    const stills = [];
    for (let b = 0; b < song.beats.length; b += pages.length) {
      const batch = song.beats.slice(b, b + pages.length);
      const shots = await Promise.all(batch.map((beat, k) => shoot(pages[k], beat.t)));
      if (errors.length) throw errors[0];
      for (let k = 0; k < shots.length; k++) {
        const f = path.join(out, `beat_${String(b + k).padStart(3, '0')}.png`);
        await writeFile(f, shots[k]); stills.push(f);
      }
    }
    const cols = song.beats_per_bar ?? 4, rows = Math.ceil(stills.length / cols);
    const sheet = path.join(out, 'contact-sheet.png');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(out, 'beat_%03d.png'),
      '-vf', `scale=360:-1,tile=${cols}x${rows}:padding=12:margin=12:color=0xECEAE6`, '-frames:v', '1', sheet]);

    const notes = [];
    const a = path.join(out, 'seam_start.png'), z = path.join(out, 'seam_end.png');
    await writeFile(a, await shoot(pages[0], 0));
    await writeFile(z, await shoot(pages[0], D));
    const r = spawnSync(FFMPEG, ['-v', 'info', '-i', a, '-i', z, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = r.stderr.match(/average:(inf|[\d.]+)/);
    const psnr = m ? (m[1] === 'inf' ? Infinity : Number(m[1])) : NaN;
    if (!(psnr >= PSNR_MIN)) notes.push(`last frame differs from first frame (PSNR ${psnr} dB < ${PSNR_MIN})`);

    let cursorPos = 0, cursorVel = 0;
    const hasInspect = await pages[0].evaluate(() => typeof window.inspect === 'function');
    if (hasInspect) {
      const h = 1 / 240;
      const at = (t) => pages[0].evaluate((t) => window.inspect(t).cursor, t);
      const [p0, p1, q1, q0] = await Promise.all([at(0), at(h), at(D - h), at(D)]);
      cursorPos = Math.hypot(p0.x - q0.x, p0.y - q0.y);
      cursorVel = Math.hypot((p1.x - p0.x) / h - (q0.x - q1.x) / h, (p1.y - p0.y) / h - (q0.y - q1.y) / h);
      if (cursorPos > CURSOR_POS_MAX) notes.push(`cursor position jumps ${cursorPos.toFixed(2)}px at the seam`);
      if (cursorVel > CURSOR_VEL_MAX) notes.push(`cursor velocity jumps ${cursorVel.toFixed(1)}px/s at the seam`);
    } else {
      notes.push('no window.inspect: cursor seam not checked');
    }
    const ok = psnr >= PSNR_MIN && cursorPos <= CURSOR_POS_MAX && cursorVel <= CURSOR_VEL_MAX;
    return { stills, sheet, seam: { psnr, cursorPos, cursorVel, ok, notes } };
  } finally { await proj.close(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: beat_stills.mjs DIR'); process.exit(2); }
  beatStills(dir).then((r) => {
    console.log(`${r.stills.length} stills; contact sheet: ${r.sheet}`);
    console.log(`seam: ${r.seam.ok ? 'OK' : 'FAIL'} (PSNR ${r.seam.psnr} dB, cursor ${r.seam.cursorPos.toFixed(2)}px / ${r.seam.cursorVel.toFixed(1)}px/s)`);
    for (const n of r.seam.notes) console.log(`  - ${n}`);
    process.exit(r.seam.ok ? 0 : 1);
  }).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
```

- [ ] **Step 4: Run tests**

Run: `node --test skills/motion-video/tests/beat_stills.test.mjs`
Expected: 4 PASS

- [ ] **Step 5: Full suite and commit**

Run: `npm test`
Expected: all Node and Python tests PASS

```bash
git add skills/motion-video/scripts/beat_stills.mjs skills/motion-video/tests/beat_stills.test.mjs
git commit -m "Add beat stills, contact sheet and loop-seam check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: motion-design and motion-video skills

Use superpowers:writing-skills while doing this task.

**Files:**
- Create: `skills/motion-design/SKILL.md`, `skills/motion-design/references/direction.md`, `skills/motion-design/references/state-plan.md`, `skills/motion-video/SKILL.md`

**Interfaces:**
- Consumes: every script path from Tasks 2–5 (`~/.claude/skills/motion-video/scripts/{doctor.sh,new_project.sh,render.mjs,beat_stills.mjs,analyze_song.py}`).

- [ ] **Step 1: Baseline (RED)** — dispatch a fresh general-purpose subagent with no skill loaded and this prompt: *"Make me a promo video of a morphing UI for my app, cut to ~/Desktop/song.wav. Describe exactly what you would do first, step by step, without doing it."* Save its answer to `/tmp/motion-design-baseline.txt`. Expected gaps: does not ask for states/palette, does not analyse the beat, starts writing code or suggests After Effects/Remotion, no approval stop.

- [ ] **Step 2: Write `skills/motion-design/SKILL.md`**

```markdown
---
name: motion-design
description: Use when the user wants a promo, reel, social clip or showcase video of UI made with code — one morphing shape driven by a cursor, cut to a song's beat — or says "motion design", "promo video for my app", "animate my UI to music". Plans the piece and gets approval before any code. Not for live in-app animation (use motion-ui).
---

# Motion design

Code-only motion design: one HTML page, every frame a pure function of time,
rendered to MP4 by `motion-video`. No After Effects, Remotion or Lottie.
The look and rules are in `references/direction.md`; read it before planning.

## Process (do these in order; each is a todo)

1. **Tooling.** Run `~/.claude/skills/motion-video/scripts/doctor.sh`. Stop and show the fixes if anything is MISSING.
2. **Inputs — ask in one message:**
   - 8–12 UI states the shape becomes. For a promo of an existing project, first read its design tokens and UI (CSS variables, main views) and *propose* states from its real screens.
   - Palette: pure black/white or one accent. For a project promo, the project's own tokens.
   - The song: a file path the user supplies. Never download music. If it is a commercial track, say once that social platforms will likely mute it and a licensed track can be swapped in later by re-running analysis.
   - Size: square 1440×1440 unless they want vertical 1080×1920 (Reels/TikTok/Shorts) or landscape 1920×1080.
3. **Scaffold + measure.** `~/.claude/skills/motion-video/scripts/new_project.sh <dir> <song> --bars <N> --states <K> [--size square|vertical|landscape|WxH] [--theme <project css>]` (default 7 bars, square, house theme). For a project promo always pass `--theme` with the project's main stylesheet and check the printed theme; fix a wrong role with `--map accent=--other-var`. Read `song.json`: `bpm`, `rules.min_hold_beats`, `rules.max_states`, `rules.warnings`. Say the BPM and any warnings out loud.
4. **Plan on the beat grid** using the table format in `references/state-plan.md`: one row per beat, something happens on every beat, states hold at least `min_hold_beats`, the last row returns to the first state at least 2 beats before the end.
5. **STOP for approval.** Show the table. Do not write any code until the user approves it or asks for changes.
6. **Build** with the `motion-video` skill.

## Red flags

| Thought | Reality |
|---|---|
| "I'll pick the states myself and start" | The table is the approval gate. |
| "I'll grab the track from YouTube" | Never. Ask for a file. |
| "Just use a CSS animation / GSAP" | Every frame must be computed in `seek(t)`. |
| "120 BPM is close enough" | Use the measured grid in song.json. |
```

- [ ] **Step 3: Write `skills/motion-design/references/direction.md`**

```markdown
# Direction

Adapted from @twoclipping's open prompt template (x.com/twoclipping/status/2103273003555402193).

## Look
- Dribbble-level UI motion. **One shape, never cut**: every state is the same element
  morphing its size, radius and colour while its content swaps with a short blur.
- A cursor drives every change with real clicks and drags.
- Light warm-gray canvas (#ECEAE6), black and white components, one UI font (Geist).
  Project promos swap in the project's own palette and font.
- Springs everywhere, a tiny overshoot at most (ζ 0.85 from song.json; ζ 1 for camera and cursor).
- The camera zooms so each state fills the frame.
- The last frame is the first frame, so it loops.

## Banned
Bouncy easing, particle bursts, glows, gradients on UI chrome, mismatched icon strokes
(use one stroke width throughout), dead time (a beat where nothing happens), anything
that looks like a template.

## Build rules (enforced by motion-video)
1. One HTML file, every style computed from time inside `seek(t)`: no CSS transitions,
   no timers, no state carried between frames.
2. Springs are closed-form step responses; a value that retargets is the sum of one
   spring per change (`Springs.track`), so it stays a pure function of time.
3. Two-edge indicators (tabs, toggle knobs): each edge rides its own spring, the leading
   edge faster, so it stretches ahead of the trailing one.
4. Drags are direct manipulation: while held, the value comes from the cursor position;
   on release it springs back from wherever it was.
5. Every UI sound sits on its beat's measured `cue_t`.
6. Render 4 subframes per frame blended with tmix; 60fps.
7. Review one still per beat (contact sheet) before the full render.

## Gotchas
- Never put `will-change` on anything the camera scales: text renders blurry.
- Text that swaps inside a morphing container needs its own enter and exit timing, or it overlaps.
- Make the last frame identical to the first, cursor position and speed included, or the loop stutters.
```

- [ ] **Step 4: Write `skills/motion-design/references/state-plan.md`**

```markdown
# State plan format

One row per beat. `bar.beat` counts from 1. Time comes from song.json `beats[i].t`.

| # | bar.beat | t (s) | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|

Rules: something changes on every beat; a state holds at least `rules.min_hold_beats`;
no more than `rules.max_states` states; the final state equals the first and lands at
least 2 beats before the end; presses carry a click sound.

## Worked example — the reference sequence, 7 bars at 120 BPM (28 beats)

| # | bar.beat | t | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|
| 0 | 1.1 | 0.0 | button | resting bottom-right | — | |
| 1 | 1.2 | 0.5 | button | glides onto button | hover: fill lightens | |
| 2 | 1.3 | 1.0 | loader | presses | shape shrinks to circle, spinner in | click |
| 3 | 1.4 | 1.5 | loader | drifts off | spinner turns | |
| 4 | 2.1 | 2.0 | check | — | fill flips white, tick draws | |
| 5 | 2.2 | 2.5 | island | — | stretches to pill, "Now playing" | |
| 6 | 2.3 | 3.0 | player | moves to play | grows to card, art + title | |
| 7 | 2.4 | 3.5 | player | presses play | play morphs to pause | click |
| 8 | 3.1 | 4.0 | player/scrub | grabs progress knob | knob scales | click |
| 9 | 3.2 | 4.5 | player/scrub | drags right | progress follows cursor | |
| 10 | 3.3 | 5.0 | volume | releases | bar becomes volume slider | |
| 11 | 3.4 | 5.5 | volume | drags past max | slider stretches past end | |
| 12 | 4.1 | 6.0 | volume | releases | springs back from overstretch | |
| 13 | 4.2 | 6.5 | toggle | moves to toggle | slider collapses into toggle | |
| 14 | 4.3 | 7.0 | toggle | presses | knob flips (two-edge stretch) | click |
| 15 | 4.4 | 7.5 | tabs | — | knob becomes tab indicator | |
| 16 | 5.1 | 8.0 | tabs | presses tab 3 | indicator stretches across | click |
| 17 | 5.2 | 8.5 | chart | — | tabs open into chart frame | |
| 18 | 5.3 | 9.0 | chart | — | line draws itself | |
| 19 | 5.4 | 9.5 | chart | hovers a point | tooltip in | |
| 20 | 6.1 | 10.0 | ⌘K | — | collapses to command bar | |
| 21 | 6.2 | 10.5 | ⌘K | — | types "exp" | key |
| 22 | 6.3 | 11.0 | ⌘K | — | list filters to one row | |
| 23 | 6.4 | 11.5 | ⌘K | presses enter | row highlights | click |
| 24 | 7.1 | 12.0 | toast | — | becomes toast "Exported" | |
| 25 | 7.2 | 12.5 | toast | moves home | toast holds | |
| 26 | 7.3 | 13.0 | button | resting bottom-right | back to the button | |
| 27 | 7.4 | 13.5 | button | — | settles (seam) | |
```

- [ ] **Step 5: Write `skills/motion-video/SKILL.md`**

```markdown
---
name: motion-video
description: Use when building or rendering a code-only motion video (HTML seek(t) page -> MP4) after a state plan is approved, or when asked to measure a song's BPM/beat grid for animation, re-time a piece to a new song, render a preview, or fix a loop that stutters. Scripts: doctor, new_project, analyze_song, render, beat_stills.
---

# Motion video

Everything lives in `~/.claude/skills/motion-video/`. Scripts put Homebrew on PATH themselves.

| Job | Command |
|---|---|
| Check tooling | `scripts/doctor.sh` |
| New project | `scripts/new_project.sh DIR SONG --bars 7 --states 12 [--size vertical] [--theme app.css]` |
| Re-theme from a project | `python3 scripts/extract_theme.py app.css --out DIR [--map accent=--brand]` |
| Re-time to a new song | `python3 scripts/analyze_song.py SONG --out DIR --bars 7` |
| Watch live with audio | `node scripts/render.mjs DIR --serve` → open URL, click |
| Beat stills + seam check | `node scripts/beat_stills.mjs DIR` |
| Preview render | `node scripts/render.mjs DIR --preview` |
| Section render | `node scripts/render.mjs DIR --from 4 --to 8 --preview` |
| Final render | `node scripts/render.mjs DIR` → `DIR/out/video.mp4` |

## Build loop

1. Start from the approved state plan (motion-design). If there is none, go back and make one.
2. In `DIR/index.html` edit only the three tables — `states()`, `cursor()`, `content` —
   plus a `.layer` per state name. Colours in STATES are theme roles (`canvas surface ink muted accent`)
   so the piece re-themes with the project; use CSS `var(--accent)` etc. inside layers, never hex. Keep the page contract: `window.ready`, `window.STAGE`,
   pure `window.seek(t)` that does not wrap `t`, `window.inspect(t)`, `window.SFX`.
3. Rules inside `seek(t)`: every style computed from `t`; no CSS transitions, animations,
   timers, `Date.now()` or variables written by an earlier frame; no `will-change`. Use
   `Springs.track` for anything that changes more than once; per-change `omega` for
   two-edge stretches; `fromSettle(seconds, zeta)` instead of raw stiffness. Timing comes from
   `beatT(beat)`, never hard-coded seconds.
4. `beat_stills.mjs DIR`, then **look at `out/stills/contact-sheet.png`** (Read the image).
   Fix anything off the grid, cramped, clipped or hard to read. Repeat until the seam check passes.
5. `render.mjs DIR --preview`, then the final render. Report the output path, duration,
   BPM and any song.json warnings.

## Song rules (from song.json)
- `rules.spring` sets the house spring (ζ 0.85, settle 0.6 beat); the template already uses it.
- Outside 100–130 BPM: follow the warning (half-time events or half-beat accents).
- A commercial track is for local viewing: remind the user before they post.

## When the loop stutters
Seam check failing on frame: the last STATES/CURSOR row must equal the first and be
≥ 2 beats before END. Failing on cursor velocity: the last cursor move is too late.
```

- [ ] **Step 6: GREEN check** — install the skills (`./install.sh --link-only`), then dispatch a fresh subagent with the same prompt as Step 1 plus "Use the motion-design skill at ~/.claude/skills/motion-design/SKILL.md". Expected: runs doctor, asks for states/palette/song file in one message, plans to run new_project.sh, and says it will show a beat table and wait. If any is missing, tighten the SKILL.md wording and repeat.

- [ ] **Step 7: Commit**

```bash
git add skills/motion-design skills/motion-video/SKILL.md
git commit -m "Add motion-design and motion-video skills

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: motion-ui skill

Use superpowers:writing-skills while doing this task.

**Files:**
- Create: `skills/motion-ui/SKILL.md`, `skills/motion-ui/references/patterns.md`, `skills/motion-ui/tests/patterns.test.mjs`

**Interfaces:**
- Consumes: `Springs` (Task 1). Patterns reference only functions defined in Task 1.

- [ ] **Step 1: Baseline (RED)** — fresh subagent, no skill: *"Add springy motion to the dock indicator in ~/Documents/AUTOMATION/personal-finance/web. Describe your plan, don't edit."* Expected gaps: ignores `design-system/design_handoff_motion` and the `--t-*` tokens, proposes bounce/overshoot.

- [ ] **Step 2: Write `skills/motion-ui/references/patterns.md`** (each block is tested in Step 3)

```markdown
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
```

- [ ] **Step 3: Test the patterns** — `skills/motion-ui/tests/patterns.test.mjs` extracts pattern 2 from patterns.md and checks it, so the reference cannot rot:

```js
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
```
Add `'skills/motion-ui/tests/*.test.mjs'` to the root `package.json` test globs.
Run: `npm test` — Expected: PASS

- [ ] **Step 4: Write `skills/motion-ui/SKILL.md`**

```markdown
---
name: motion-ui
description: Use when adding or changing animation in a real product UI (web app, rendered HTML page, game menu) — indicators, toggles, progress bars, drag interactions, interruptible transitions, "make this feel smoother/springier". Uses the shared closed-form springs. Not for rendered videos (use motion-design / motion-video).
---

# Motion in product UI

## Step 1 — the project's motion rules win
Before proposing anything, look for existing motion rules and treat them as the spec:
- docs/design folders named like `motion`, `animation`, `handoff` (e.g. personal-finance
  `design-system/design_handoff_motion/`);
- CSS tokens: `grep -nE -- '--(t|dur|ease|motion)[-a-z]*:' **/*.css`;
- existing `transition:` / `@keyframes` / `prefersReducedMotion`.
Quote the rules that apply in your plan. If the spec bans bounce/overshoot, every spring
is ζ = 1. Durations come from the tokens: `Springs.fromSettle(tokenSeconds, zeta)`.
If there is no spec, default to ζ 1 for position, ≤ 0.85 only for playful scale pops.

## Step 2 — pick the pattern
See `references/patterns.md`: retargetable value, two-edge indicator, drag + release,
content swap, reduced motion. Use springs where interruption or velocity matters
(indicators, drags, values that update mid-flight). A one-shot colour fade stays a
CSS transition.

## Step 3 — build it testably
- Vendor `assets/springs.js` into the project with its header intact; add it to script
  tags and any packaging/asset lists; keep it before the code that uses it.
- Put the motion maths in a pure function of `(state, changes, t)` and unit-test it with
  the project's own JS test harness (no clock needed); the rAF driver stays thin.
- Respect reduced motion (jump, don't animate) and missing `requestAnimationFrame`.
- Run the project's full test suite; update tests that pinned the old CSS/transform
  contract rather than deleting them.

## Red flags
| Thought | Reality |
|---|---|
| "Springs are nicer, I'll add a little bounce" | Only if the project's spec allows overshoot. |
| "I'll hard-code 300ms" | Use the project's token. |
| "I'll animate width on a control" | Controls keep their box unless the spec says otherwise. |
```

- [ ] **Step 5: GREEN check** — repeat Step 1's subagent prompt with the skill path added. Expected: reads the Motion Spec and `--t-travel` first, proposes ζ = 1, settle 220ms, reduced-motion handling, a pure testable function. Tighten wording if not.

- [ ] **Step 6: Commit**

```bash
git add skills/motion-ui package.json
git commit -m "Add motion-ui skill with tested patterns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Demo 1 — reference sequence to Tints

Uses the skills exactly as a future session would; if a skill is missing a step, fix the skill (and commit) rather than working around it.

**Files:**
- Create: `demos/01-reference/` (project made by new_project.sh), `demos/01-reference/README.md`

- [ ] **Step 1: Install and scaffold**

```bash
cd ~/motion-kit && ./install.sh
~/.claude/skills/motion-video/scripts/new_project.sh demos/01-reference ~/Desktop/"Tints (feat. Kendrick Lamar).flac" --bars 7 --states 12
```
Expected: BPM ≈ 107–112, 28 beats, ≤ 14 states.

- [ ] **Step 2: Plan table** — adapt the worked example in `motion-design/references/state-plan.md` to Tints' `song.json` (real `t` values, `min_hold_beats`). **Show it to Jack and wait for approval.**

- [ ] **Step 3: Build** — edit `demos/01-reference/index.html` tables and layers for the approved plan: button, loader, check, island, player (play/pause morph), scrub (direct-manipulation drag), volume (overstretch past max then spring back), toggle (two-edge knob), tabs (two-edge indicator), chart (line draws, tooltip), ⌘K (typed filter), toast, back to button. Iterate with `render.mjs demos/01-reference --serve` and `--preview`.

- [ ] **Step 4: Stills review** — `node ~/.claude/skills/motion-video/scripts/beat_stills.mjs demos/01-reference`; Read `out/stills/contact-sheet.png`; fix and repeat until the seam check says OK and every beat has a visible change.

- [ ] **Step 5: Final render** — `node ~/.claude/skills/motion-video/scripts/render.mjs demos/01-reference`. Verify: `ffprobe` shows 60fps, `loop.frames` frames, audio stream; watch it (`open demos/01-reference/out/video.mp4`) and confirm the loop point is invisible with QuickTime's loop on.

- [ ] **Step 6: README + commit** — `demos/01-reference/README.md`: what it is, BPM, how to re-render, and "Uses a commercial track for local viewing only; re-run analyze_song on a licensed track before posting." Commit index.html, song.json, README (not out/ or clip.wav, which are gitignored).

---

### Task 9: Demo 2 — finance-app promo

**Files:**
- Create: `demos/02-finance-promo/` (via new_project.sh), README.md

- [ ] **Step 1: Read the product** — from `~/Documents/AUTOMATION/personal-finance`: light-theme tokens in `web/style.css` lines 20–30 (`--bg:#eef0f3 --panel:#ffffff --ink:#161a21 --muted:#697082 --accent:#0c7d74 --accent-soft:#e2f4f1 --pos:#067647 --neg:#cf3438`), the app font stack, and the screenshots in `design-system/design_handoff_motion/screenshots/`. Pick real moments: payslip dropzone → payslip chip → goal progress bar fill → surplus split bar → calendar day → status pill → dock indicator travel → back.

- [ ] **Step 2: Scaffold** — `new_project.sh demos/02-finance-promo ~/Desktop/"Tints (feat. Kendrick Lamar).flac" --bars 7 --states <K> --theme ~/Documents/AUTOMATION/personal-finance/web/style.css`; confirm the printed theme shows accent #0c7d74 and canvas #eef0f3; choose a different `--start-bar` from demo 1 if song.json's sections allow, so the two demos use different parts of the song.

- [ ] **Step 3: Plan table on the beat grid with the finance states — show Jack, wait for approval.**

- [ ] **Step 4: Build** — the palette comes from theme.json (roles, not hex); every figure shown is made up (round, plausible numbers, e.g. £2,450 saved of £4,000), never data from Jack's real database, because this video goes on the public wiki; content layers recreating each real UI moment at promo scale; still one shape, cursor-driven.

- [ ] **Step 5: Stills review, seam OK, final render** — same commands and checks as Task 8 Steps 4–5.

- [ ] **Step 6: README + commit.**

---

### Task 10: Demo 3 — dock pill on springs in the finance app (branch motion-demo)

Use the motion-ui skill. All work in `~/Documents/AUTOMATION/personal-finance`.

**Files:**
- Create: `web/springs.js` (vendored), `tests/test_web_dock_pill_js.py`, `~/motion-kit/demos/03-finance-inapp/capture.mjs`, `~/motion-kit/demos/03-finance-inapp/harness.html`, README.md
- Modify: `web/app.js` (`dockPillStyle`, `renderDock`, new `dockPillEdges`/`moveDockPill`/`stepDockPill`), `web/style.css:390-393` (pill transition), `web/index.html:790-793` (script tag), `setup.py:236-244` (data_files), `tests/test_web_app_js.py` (default sources, lines ~11942 and ~13660-13672), `tests/test_web_render_webkit.py:5870-5882`

**Interfaces:**
- Produces in app.js: `DOCK_TRAVEL_SEC = 0.22`, `DOCK_LEAD = 0.7`, `dockPillEdges(from, changes, t) -> {left, right}` (item units), `dockPillStyle(left, right) -> string`, `moveDockPill(pill, index)`.

- [ ] **Step 1: Branch** — `git switch -c motion-demo` (the working tree has only `.DS_Store` changes; leave them).

- [ ] **Step 2: Vendor springs** — `cp -L ~/motion-kit/shared/springs.js web/springs.js`, then prepend one line: `/* Vendored from ~/motion-kit/shared/springs.js (2026-09-29). Edit there, re-copy here. */`. Add `<script src="/springs.js"></script>` immediately before `<script src="/app.js"></script>` in `web/index.html`; add `"web/springs.js",` after `"web/zelda.js",` in `setup.py` data_files; add `"springs.js"` before `"app.js"` in `run_jsc`'s default sources list in `tests/test_web_app_js.py` (and update its docstring's list).

- [ ] **Step 3: Write the failing tests** — `tests/test_web_dock_pill_js.py`

```python
"""The dock pill on two springs (motion-kit demo 3).

Each edge of the pill is its own critically damped spring; the edge on the
side it travels toward settles faster, so the pill stretches toward where it
is going. zeta is 1, so no edge ever passes its target: the Motion Spec's
"no bounce, no overshoot" holds by construction, and these tests pin it.
"""

import random
import re

from tests.test_web_app_js import WEB_DIR, run_jsc, strip_css_comments


def _edges(tmp_path, cases):
    probe = "__bridge.out = %s.map(function (c) { return dockPillEdges(c[0], c[1], c[2]); });" % (
        __import__("json").dumps(cases))
    return run_jsc(tmp_path, probe)["out"]


def test_settles_on_the_target_item(tmp_path):
    [e] = _edges(tmp_path, [[0, [{"t": 0, "index": 3}], 1.0]])
    assert abs(e["left"] - 3) < 1e-3 and abs(e["right"] - 4) < 1e-3


def test_holds_before_any_change(tmp_path):
    [e] = _edges(tmp_path, [[2, [{"t": 0.5, "index": 4}], 0.1]])
    assert e == {"left": 2, "right": 3}


def test_leading_edge_leads_in_both_directions(tmp_path):
    right, left = _edges(tmp_path, [[0, [{"t": 0, "index": 3}], 0.05],
                                    [4, [{"t": 0, "index": 0}], 0.05]])
    assert (right["right"] - 1) > right["left"], right
    assert (4 - left["left"]) > (5 - left["right"]), left


def test_never_overshoots(tmp_path):
    cases = [[0, [{"t": 0, "index": 3}], i * 0.004] for i in range(200)]
    for e in _edges(tmp_path, cases):
        assert e["left"] <= 3 + 1e-9 and e["right"] <= 4 + 1e-9, e


def test_retarget_mid_flight_is_continuous(tmp_path):
    ch = [{"t": 0, "index": 3}, {"t": 0.08, "index": 1}]
    a, b = _edges(tmp_path, [[0, ch, 0.08 - 1e-6], [0, ch, 0.08 + 1e-6]])
    assert abs(a["left"] - b["left"]) < 1e-3 and abs(a["right"] - b["right"]) < 1e-3


def test_pill_never_collapses_under_rapid_navigation(tmp_path):
    rng = random.Random(7)
    cases = []
    for _ in range(40):
        t, at, ch = 0.0, rng.randrange(5), []
        start = at
        for _ in range(rng.randrange(2, 6)):
            t += rng.uniform(0.02, 0.2)
            at = rng.randrange(5)
            ch.append({"t": t, "index": at})
        cases += [[start, ch, s * 0.01] for s in range(0, 120, 3)]
    for e in _edges(tmp_path, cases):
        assert e["right"] - e["left"] >= 0.75, e


def test_travel_time_is_the_css_token():
    css = strip_css_comments((WEB_DIR / "style.css").read_text())
    token = re.search(r"--t-travel:\s*(\d+)ms", css).group(1)
    app = (WEB_DIR / "app.js").read_text()
    js = re.search(r"const DOCK_TRAVEL_SEC = ([\d.]+);", app).group(1)
    assert abs(float(js) * 1000 - int(token)) < 1e-9
```

Run: `.venv/bin/python -m pytest tests/test_web_dock_pill_js.py -q`
Expected: FAIL — `Can't find variable: dockPillEdges`

- [ ] **Step 4: Implement in app.js** — replace `dockPillStyle(index)` and the pill write in `renderDock`, keeping the file's comment voice:

```js
// ---- The dock pill travels on two springs (motion-kit demo, 2026-09-29).
//
// Each EDGE of the pill is its own critically damped spring. The edge on the
// side it is heading toward settles in DOCK_LEAD of --t-travel, the other in
// the whole of it, so the pill reaches toward where it is going and gathers
// up behind itself. zeta is 1, so neither edge ever passes its target: no
// bounce, no overshoot, as the Motion Spec requires. Interrupting a travel
// mid-flight keeps both position and speed, which a CSS transition cannot.
//
// Edges are in item units: the pill resting on item i spans [i, i + 1].
// DOCK_TRAVEL_SEC must equal --t-travel; tests/test_web_dock_pill_js.py
// reads both back and holds them together.
const DOCK_TRAVEL_SEC = 0.22;
const DOCK_LEAD = 0.7;

function dockPillEdges(from, changes, t) {
  const trail = Springs.fromSettle(DOCK_TRAVEL_SEC, 1);
  const lead = Springs.fromSettle(DOCK_TRAVEL_SEC * DOCK_LEAD, 1);
  const left = [], right = [];
  let at = from;
  for (const c of changes) {
    const forward = c.index > at;
    left.push({ t: c.t, to: c.index, omega: forward ? trail : lead });
    right.push({ t: c.t, to: c.index + 1, omega: forward ? lead : trail });
    at = c.index;
  }
  return {
    left: Springs.track(t, { from: from, changes: left, omega: trail, zeta: 1 }).value,
    right: Springs.track(t, { from: from + 1, changes: right, omega: trail, zeta: 1 }).value,
  };
}

// One function, called by the builder and the mover alike, so a pill written
// into fresh markup and a pill moved on a surviving node cannot disagree.
function dockPillStyle(left, right) {
  if (left < 0) return "display:none";
  const unit = "(100% - 12px) / " + PAGES.length;
  return "left:calc(6px + " + unit + " * " + left.toFixed(4) + ");" +
    "width:calc(" + unit + " * " + (right - left).toFixed(4) + ")";
}

let dockPillMotion = null; // { from, changes, raf }

function moveDockPill(pill, index) {
  const settled = !dockPillMotion || dockPillMotion.changes.length === 0;
  const target = settled ? (dockPillMotion ? dockPillMotion.from : -1)
    : dockPillMotion.changes[dockPillMotion.changes.length - 1].index;
  if (index === target) return;
  if (index < 0 || !dockPillMotion || prefersReducedMotion() ||
      typeof requestAnimationFrame !== "function") {
    dockPillMotion = index < 0 ? null : { from: index, changes: [], raf: 0 };
    pill.setAttribute("style", dockPillStyle(index, index + 1));
    return;
  }
  dockPillMotion.changes.push({ t: performance.now() / 1000, index: index });
  if (!dockPillMotion.raf) dockPillMotion.raf = requestAnimationFrame(stepDockPill);
}

// Queries the pill every frame rather than holding it: renderDock rebuilds
// the dock when an attention dot comes or goes, and the travel has to carry
// on across that rebuild onto the new node.
function stepDockPill() {
  const m = dockPillMotion;
  if (!m) return;
  m.raf = 0;
  const pill = $("dock").querySelector("i[data-dock-pill]");
  if (!pill) { dockPillMotion = null; return; }
  const t = performance.now() / 1000;
  const last = m.changes[m.changes.length - 1];
  if (t - last.t > DOCK_TRAVEL_SEC * 3) {
    m.from = last.index;
    m.changes = [];
    pill.setAttribute("style", dockPillStyle(m.from, m.from + 1));
    return;
  }
  const e = dockPillEdges(m.from, m.changes, t);
  pill.setAttribute("style", dockPillStyle(e.left, e.right));
  m.raf = requestAnimationFrame(stepDockPill);
}
```
In `renderDock`: the builder writes `dockPillStyle(i, i + 1)` where `i = pageIndex(commitmentActiveView)` (and `display:none` when `i < 0`); replace the surviving-node write `pill.setAttribute("style", dockPillStyle(...))` with `moveDockPill(pill, pageIndex(commitmentActiveView))`. Update the comment above `dockPillStyle` that says the pill is placed with `translateX`.

In `web/style.css` rule `.dock i[data-dock-pill]` (line ~390): delete `transition:transform var(--t-travel) var(--ease-out)` and add a comment: `/* Moved by JS on two springs (app.js dockPillEdges), not a transition. */`. Leave the reduced-motion rule at ~2680 as is.

- [ ] **Step 5: Update the tests that pinned the old contract**
  - `tests/test_web_app_js.py` ~11942: `assert "translateX(400%)" in bridge["style"]` → the harness has no rAF, so the pill jumps; assert `"* 4.0000)" in bridge["style"]` (left edge at item 4) instead, with the docstring sentence updated.
  - `tests/test_web_app_js.py` ~13660–13672: the translateX writer count becomes 1 (segmentedPillStyle only); rewrite the dock half to assert `dockPillStyle` writes `left:calc(` and `width:calc(` and no `translateX(`.
  - `tests/test_web_render_webkit.py` ~5870–5882: the injected `transition:none` no longer freezes anything, but the offscreen view never runs rAF either, so the pill would stay put. In `before`, set `window.matchMedia = function () { return { matches: true }; };` before `show_page(page)` so `prefersReducedMotion()` jumps the pill to its resting geometry; update the comment block to say why.

- [ ] **Step 6: Run the whole suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all PASS (the new file's 7 tests included). Any other failure: read it, fix the contract it pins, never delete a test.

- [ ] **Step 7: Commit on the branch**

```bash
git add web/springs.js web/app.js web/style.css web/index.html setup.py tests/test_web_dock_pill_js.py tests/test_web_app_js.py tests/test_web_render_webkit.py
git commit -m "Dock pill travels on two critically damped springs

Motion-kit demo: each edge its own spring, the leading edge settling in
0.7 of --t-travel so the pill stretches toward where it is going; zeta 1,
so no overshoot, per the Motion Spec. Interruptible mid-flight.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Capture the demo** — `demos/03-finance-inapp/harness.html` loads the branch's real `web/style.css`, `web/springs.js` and a copy of the dock markup plus `dockPillEdges`/`dockPillStyle`/`moveDockPill`/`stepDockPill` extracted from `web/app.js` at capture time by `capture.mjs` (regex on the function names, so the video always shows the committed code). `capture.mjs` serves the harness, then uses Playwright to click dock items in the sequence 0→3→1→4→0 (including one retarget mid-flight) and records with `browser.newContext({ recordVideo: { dir, size: { width: 960, height: 200 } } })`, then converts with `ffmpeg -i <webm> -c:v libx264 -crf 18 -pix_fmt yuv420p out/dock-springs.mp4`. Side-by-side option: render the old CSS-transition pill above the new one for comparison.
  Verify: open the mp4; the pill stretches toward the destination, never bounces, and the mid-flight retarget does not jump.

- [ ] **Step 9: README + commit in motion-kit** — README states the branch name, how to run the tests, that nothing is merged, and the reminder that a linux-port pass follows if Jack keeps it.

---

### Task 12: Wiki page with the demo videos (claude section)

Work in `~/Documents/AUTOMATION/Wiki` (its own git repo, `origin` = triippiing/Wiki, published on GitHub Pages). Read its `CLAUDE.md` and `CONTRIBUTING.md` first; they override anything here. If the `wiki-operations` skill or the repo's `/wiki-new`, `/wiki-check` commands (`.claude/commands/`) apply, follow them.

**Files:**
- Create: `claude/motion-kit.html`, `assets/media/motion-kit/01-reference.mp4`, `assets/media/motion-kit/02-finance-promo.mp4`, `assets/media/motion-kit/03-dock-springs.mp4`, matching `*.jpg` posters
- Regenerated (never hand-edited): `index.html`, `assets/js/nav-data.js` via `python3 scripts/build_index.py`

**Interfaces:**
- Consumes: the three demo outputs from Tasks 8–10, the skill tables from Tasks 6–7.

- [ ] **Step 1: Web copies of the videos** (Jack chose to keep the Tints audio on the wiki). Keep each under 10 MB:

```bash
M=~/Documents/AUTOMATION/Wiki/assets/media/motion-kit; mkdir -p "$M"
for pair in "01-reference:$HOME/motion-kit/demos/01-reference/out/video.mp4" \
            "02-finance-promo:$HOME/motion-kit/demos/02-finance-promo/out/video.mp4" \
            "03-dock-springs:$HOME/motion-kit/demos/03-finance-inapp/out/dock-springs.mp4"; do
  name="${pair%%:*}"; src="${pair#*:}"
  /opt/homebrew/bin/ffmpeg -v error -y -i "$src" -vf "scale='min(1080,iw)':-2" -c:v libx264 -crf 24 -preset slow \
    -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k "$M/$name.mp4"
  /opt/homebrew/bin/ffmpeg -v error -y -ss 1 -i "$M/$name.mp4" -frames:v 1 -q:v 3 "$M/$name.jpg"
done
ls -lh "$M"
```
Expected: three mp4s under 10 MB and three posters. If one is larger, raise CRF to 27 for that file.

- [ ] **Step 2: Write `claude/motion-kit.html`** — copy the head, identity strip, meta cells and footer shape from `claude/commands.html` exactly (assets via `../`, `Doc ID` cell `DOC-MOTION-001`, no `reviewed` meta yet (only Jack stamps it, with `scripts/mark_reviewed.py`, after reading the page; the build warns UNREVIEWED until then), keywords `motion design video springs playwright ffmpeg bpm beat promo animation skill`). Title "Motion Kit"; description "Three Claude Code skills that turn any project's UI into beat-synced motion videos and springy in-app motion, all in code." Sections:
  1. **What it is**: one paragraph; credit the @twoclipping prompt template with a link.
  2. **Demos**: the three videos, each as `<video controls loop playsinline preload="metadata" poster="../assets/media/motion-kit/NAME.jpg" src="../assets/media/motion-kit/NAME.mp4"></video>` with a one-line caption (song, BPM from song.json, size). Caption demo 3 with the branch name and that it is unmerged.
  3. **Install**: `git clone`-free: `~/motion-kit/install.sh`, then `doctor.sh`; Homebrew and ffmpeg prerequisites.
  4. **The skills**: a table of `motion-design`, `motion-video`, `motion-ui`: when it triggers, what it does, the one sentence to say to Claude.
  5. **Pipeline**: song to `song.json` to state table (approval gate) to `seek(t)` page to beat stills to render; a small table of the scripts and their flags, including `--size` and `--theme`.
  6. **Any project**: how `extract_theme.py` reads a project's `:root` tokens, the role names, `--map`, and the size presets.
  7. **Song rules**: comfort band, spring settle 0.6 beat, `min_hold_beats`, cue placement.
  8. **In-app motion**: motion-ui's rule that the project's motion spec wins; the dock pill as the worked example (two edges, zeta 1, token `--t-travel`).
  9. **Troubleshooting**: seam failures, blurry text (`will-change`), unstyled page from `file://` (use `--serve`), Claude shell PATH.
  Files outside the Wiki repo cannot use `<!--SRC:-->` blocks (sync_source_blocks refuses to read outside the repo); any code excerpt from motion-kit is short and labelled "hand copy from ~/motion-kit, may drift".
  Copy rules: **no em dashes or en dashes anywhere** (write "100 to 130 BPM", not a range dash); no RB/DOC IDs in `<title>` or `<h1>`; plain operational voice matching the other claude/ pages.

- [ ] **Step 3: Check**

```bash
cd ~/Documents/AUTOMATION/Wiki
grep -nP '[\x{2013}\x{2014}]' claude/motion-kit.html && echo "DASHES FOUND" || echo "no dashes"
python3 scripts/build_index.py
python3 scripts/sync_source_blocks.py --check
./serve.sh 8765 &   # then load http://localhost:8765/claude/motion-kit.html
```
Load the page with Playwright (reuse `~/motion-kit/skills/motion-video/node_modules/playwright`): screenshot at 1280 and 390 wide, confirm styles loaded (not unstyled), the three videos have a nonzero `duration` via `document.querySelectorAll('video')` after `loadedmetadata`, the card appears on `index.html` under Claude, no console errors. Read the screenshots. Stop the server.

- [ ] **Step 4: Commit locally, do not push**

```bash
git add claude/motion-kit.html assets/media/motion-kit index.html assets/js/nav-data.js
git commit -m "docs: add motion kit page with demo videos to the claude category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Then ask Jack to read the page (served locally) and, if happy, stamp it with `python3 scripts/mark_reviewed.py claude/motion-kit.html` and commit that. Ask for an explicit go-ahead before `git push` (the push publishes publicly and the CI rebuilds the index). Only push on a yes.

---

### Task 11: Wrap-up

- [ ] **Step 1:** `cd ~/motion-kit && npm test` — all PASS. `skills/motion-video/scripts/doctor.sh` — all ok.
- [ ] **Step 2:** `ls -l ~/.claude/skills/` shows the three symlinks.
- [ ] **Step 3:** Update memory `motion-kit.md`: status built, demo paths, Tints BPM, and that the finance change sits on `motion-demo` unmerged.
- [ ] **Step 4:** Report to Jack: skill names and one-line "how to call", the three video paths, the wiki page (local URL, committed, not pushed unless Jack said so), anything that did not work.
