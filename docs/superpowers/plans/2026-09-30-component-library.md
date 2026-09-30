# Component Library + Planner (sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library of 28 `seek(t)`-pure UI components a promo names in its `states()` table (`use:`), a cursor that aims at named hotspots (`target:`), generated docs with pictures, and `motion-design` rebuilt as a Superpowers-style planner that proposes components and writes a validated `MOTION-BRIEF.md`.

**Architecture:** A small engine (`components/core/engine.js`) takes over the template's `build()`/`seek()` core: it resolves `use` rows through a registry of component modules (each exports `meta`, `geometry`, `mount`, `render`, `hotspot`, optional `sfx`), keeps custom `name` rows working exactly as today, resolves cursor `target`s to design-px positions once at load, and hands presses to components as static timed data. A shared validator powers runtime errors and `check_brief.mjs`. `build_catalog.mjs` generates `components/index.js` and `CATALOG.md` from the components' `meta`.

**Tech Stack:** Plain ES modules in the browser (no bundler), Node 24 `node:test` + Playwright 1.63 (Chromium) for browser tests, existing `shared/springs.js`, Python 3 click tracks from `test_analyze_song.click_track`.

**Spec:** `docs/superpowers/specs/2026-09-30-component-library-design.md`

## Global Constraints

- Every component's `render` is a pure function of `t`: no CSS transitions/animations, timers, `Date.now()`, `Math.random()`, or state written by an earlier frame. `mount` builds DOM once; `render` only sets styles/attributes/text from `t`.
- Colours are theme roles (`canvas surface ink muted accent`, optional `pos neg`) or `var(--role)` / `color-mix(in srgb, var(--role) N%, transparent)` in CSS. Components that want `pos`/`neg` fall back to `accent`/`ink` when the theme lacks them (`role(ctx, 'pos', 'accent')`).
- Design pixels at a 1440 stage. Type scale: label 34/500, body 28/400, small 22/500, caption 18/500 (uppercase, letter-spacing .08em), figure 72/600 with `font-variant-numeric: tabular-nums`. Icons: 24-unit viewBox, `stroke-width 2`, round caps/joins, `fill none`, `currentColor` (one stroke weight everywhere).
- Motion: springs only, via `ctx.Springs` and helpers; house spring `ctx.spring` (zeta from song, <= 0.85 overshoot); position/size zeta 1. No gradients, glows, particles, bouncy easing.
- Row 0 of a looping piece is shown **settled** (its entrance already finished) so the last row, which repeats it, matches it at the seam.
- Rows without `use` behave exactly as today (existing tests must keep passing, unmodified except where this plan says).
- No em dashes or en dashes in any wiki copy (Task 10). Never copy transitions.dev code; name matches are fine.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `library` in `~/motion-kit`. Do not push; the controller pushes at the end with Jack's go-ahead.
- Test command: `npm test` from the repo root (it runs all node:test globs and the Python suite).

## Review Focus

1. **A press on the exact beat a new row starts** (`{ at: 12, target: 'tab:Month', press: true }` while a `tabs` row starts at 12) must reach the row that owns that hotspot. Test in Task 1 (`targetRow` prefers the active row, falls back to the next row within 1 beat).
2. **Loop seam with entrance motion**: a piece that starts and ends on `check` (tick draws on) must seam cleanly. Test: the gallery's seam check (Task 2) plus a dedicated seam test with `check` first/last (Task 4).
3. **Typos** in `use`, prop names, prop types and hotspot names give one readable error each, with "did you mean". Tests in Task 1.
4. **Unusual props**: very long labels, empty `items`, a single tab, `to` smaller than `from`, zero values. Geometry must stay inside the stage and nothing may throw. Contract test in Task 2 runs each component with its `meta.edgeCases` examples.
5. **House theme without `pos`/`neg`**: components that prefer `pos` (goal met, status ok, check) must render with the fallback, not throw. Test in Task 2's contract suite runs every example under the house theme.

---

## File map

```
skills/motion-video/components/
  core/engine.js        createScene: rows, geometry tracks, layers, targets, presses, sfx, seek   (T1)
  core/validate.js      validate(): structural + strict checks, did-you-mean                        (T1)
  core/helpers.js       pure helpers: el, textW, settle, fade, drawOn, roll, role, icons            (T2)
  modifiers.js          shake offset, badge mount/render                                            (T2)
  index.js              GENERATED registry (build_catalog.mjs)                                     (T2)
  controls/button.js    reference component, full code                                              (T2)
  controls/*.js feedback/*.js data/*.js chrome/*.js                                               (T3-T6)
  CATALOG.md            GENERATED                                                                    (T2+)
  docs-images/*.png     GENERATED gallery thumbnails                                                 (T2+)
  RECIPES.md, WRITING-A-COMPONENT.md                                                                  (T8)
skills/motion-video/scripts/
  build_catalog.mjs     index.js + CATALOG.md (+ --check)                                            (T2)
  gallery.mjs           scaffold a project that plays every component; --stills writes docs-images (T2)
  check_brief.mjs       validate a project's MOTION-BRIEF.md tables                                  (T7)
  new_project.sh        also copies components/ into the project                                     (T1)
skills/motion-video/template/index.html   delegates to createScene                                   (T1)
skills/motion-video/tests/
  engine.test.mjs, validate.test.mjs (T1); harness.mjs, contract.test.mjs, gallery.test.mjs (T2);
  components-controls.test.mjs (T3), -feedback (T4), -data (T5), -chrome (T6); check_brief.test.mjs (T7); recipes.test.mjs (T8)
skills/motion-design/SKILL.md, references/planner.md                                                  (T7)
demos/04-library-reference/                                                                          (T9)
```

---

### Task 1: Engine, validator, template integration

**Files:**
- Create: `skills/motion-video/components/core/engine.js`, `skills/motion-video/components/core/validate.js`, `skills/motion-video/tests/validate.test.mjs`, `skills/motion-video/tests/engine.test.mjs`
- Create (temporary stubs, replaced in T2/T4): `skills/motion-video/components/index.js`, `components/core/helpers.js` (only `RESERVED` and `el` for now), `components/modifiers.js` (no-op `shakeOffset` returning 0, `mountBadge`/`renderBadge` no-ops)
- Modify: `skills/motion-video/template/index.html`, `skills/motion-video/scripts/new_project.sh`

**Interfaces:**
- Produces: `validate({ states, cursor, registry, song, loop = true, strict = false }) -> { errors: string[], warnings: string[] }`; `lev(a, b)`; `didYouMean(x, list)`; `typeOk(spec, value)`; `matchHotspot(patterns, target)`; `targetRow(rows, cursorRow, beatT)` (rows = `[{ row, comp, t0 }]`).
- Produces: `createScene({ states, cursor, extraSfx, content, song, stage, theme, beatT, Springs, dom: { camera, shape, cursor }, registry }) -> { seek(t), inspect(t), since(name, t), sfx, rows }`. Throws `Error('motion-kit: ...')` listing every validation error.
- Component module contract (used by every later task):
  - `meta = { name, group, useWhen, motion, example, props: { key: [typeSpec, default] }, hotspots: [..], sounds: [..], edgeCases: [rowObjects] }`
  - `geometry(props, ctx) -> { w, h, r, fill, ink }` (design px; fill/ink theme roles)
  - `mount(el, props, ctx)`; `render(el, props, ctx, t)`; `hotspot(name, props, geo, ctx) -> { x, y } | null` (offset from shape centre, design px)
  - optional `sfx(props, ctx) -> [{ beat, file, gain }]`
  - `ctx` = `{ beatT, beat_sec, Springs, spring, theme, hex, stage, t0, t1, presses, cursorAt, geo, row }`; `t0` is `-1e6` for row 0; `presses` = `[{ t, kind: true|'down'|'up', hotspot: string|null }]`; `cursorAt(t) -> { x, y }` in shape-centre design px.
- Type specs: `'string' 'number' 'boolean' 'string[]' 'number[]' 'object' 'object[]' 'any' 'enum:a|b|c'`.

- [ ] **Step 1: Branch**

```bash
cd ~/motion-kit && git switch -c library
```

- [ ] **Step 2: Write the failing validator tests** — `skills/motion-video/tests/validate.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, didYouMean, typeOk, matchHotspot } from '../components/core/validate.js';

const fake = (name, props = {}, hotspots = []) => ({ meta: { name, props, hotspots } });
const registry = {
  toast: fake('toast', { text: ['string', 'Saved'], icon: ['enum:check|none', 'check'] }, ['toast', 'action']),
  tabs: fake('tabs', { items: ['string[]', ['A', 'B']], active: ['string', 'A'] }, ['tab:<item>']),
  button: fake('button', { label: ['string', 'Go'] }, ['button']),
};
const song = { beats: Array.from({ length: 16 }, (_, i) => ({ i, t: i * 0.5 })), beat_sec: 0.5, rules: { min_hold_beats: 2, max_states: 8 } };
const loopOk = (rows) => [...rows, { ...rows[0], at: 14 }];
const run = (states, cursor = [{ at: 0, x: 0, y: 0 }, { at: 14, x: 0, y: 0 }], o = {}) => validate({ states, cursor, registry, song, ...o });

test('a valid table has no errors', () => {
  const r = run(loopOk([{ at: 0, use: 'button', label: 'Hi' }, { at: 4, use: 'toast', text: 'Done' }]));
  assert.deepEqual(r.errors, []);
});

test('unknown component suggests the closest name', () => {
  const r = run(loopOk([{ at: 0, use: 'tost' }]));
  assert.match(r.errors.join('\n'), /unknown component "tost".*did you mean "toast"/);
});

test('unknown prop lists the valid props', () => {
  const r = run(loopOk([{ at: 0, use: 'toast', txt: 'x' }]));
  assert.match(r.errors.join('\n'), /unknown prop "txt" for toast \(props: text, icon\)/);
});

test('wrong prop type is reported with the expected type', () => {
  const r = run(loopOk([{ at: 0, use: 'toast', icon: 'star' }]));
  assert.match(r.errors.join('\n'), /prop "icon" of toast should be enum:check\|none/);
});

test('custom rows need name, w, h, r', () => {
  const r = run(loopOk([{ at: 0, name: 'x', w: 10 }]));
  assert.match(r.errors.join('\n'), /custom row at beat 0 needs numeric w, h and r/);
  assert.match(run(loopOk([{ at: 0 }])).errors.join('\n'), /needs `use`.*or `name`/);
});

test('rows must start at 0 and ascend', () => {
  assert.match(run([{ at: 1, use: 'button' }]).errors.join('\n'), /first row must be at beat 0/);
  assert.match(run(loopOk([{ at: 0, use: 'button' }, { at: 6, use: 'toast' }, { at: 4, use: 'toast' }])).errors.join('\n'), /ascending/);
});

test('looping piece: last row must repeat the first at least 2 beats before the end', () => {
  const r = run([{ at: 0, use: 'button' }, { at: 15, use: 'button' }]);
  assert.match(r.errors.join('\n'), /at least 2 beats before the end/);
  const r2 = run([{ at: 0, use: 'button', label: 'A' }, { at: 14, use: 'button', label: 'B' }]);
  assert.match(r2.errors.join('\n'), /last row must repeat the first/);
  assert.deepEqual(run([{ at: 0, use: 'button' }, { at: 15, use: 'toast' }], undefined, { loop: false }).errors, []);
});

test('cursor targets must exist on the active or next row', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'tabs', items: ['Day', 'Month'] }]);
  const ok = run(states, [{ at: 0, x: 0, y: 0 }, { at: 3.5, target: 'tab:Month', press: true }, { at: 5, target: 'tab:Day' }, { at: 14, x: 0, y: 0 }]);
  assert.deepEqual(ok.errors, []);
  const bad = run(states, [{ at: 0, x: 0, y: 0 }, { at: 5, target: 'tab-Month' }, { at: 14, x: 0, y: 0 }]);
  assert.match(bad.errors.join('\n'), /hotspot "tab-Month" is not on tabs at beat 5 \(hotspots: tab:<item>\)/);
});

test('press down must be followed by an up', () => {
  const states = loopOk([{ at: 0, use: 'button' }]);
  const r = run(states, [{ at: 0, x: 0, y: 0 }, { at: 1, x: 0, y: 0, press: 'down' }, { at: 14, x: 0, y: 0 }]);
  assert.match(r.errors.join('\n'), /press 'down' at beat 1 has no matching 'up'/);
});

test('strict mode: holds and budget', () => {
  const r = run(loopOk([{ at: 0, use: 'button' }, { at: 1, use: 'toast' }]), undefined, { strict: true });
  assert.match(r.errors.join('\n'), /holds 1 beat; min_hold_beats is 2/);
  assert.ok(r.warnings.some((w) => /quiet beats/.test(w)));
});

test('helpers', () => {
  assert.equal(didYouMean('tost', ['toast', 'tabs']), 'toast');
  assert.equal(didYouMean('zzzzzz', ['toast']), null);
  assert.ok(typeOk('enum:a|b', 'b') && !typeOk('enum:a|b', 'c'));
  assert.ok(typeOk('string[]', ['a']) && !typeOk('string[]', [1]));
  assert.ok(matchHotspot(['tab:<item>'], 'tab:Month') && !matchHotspot(['tab:<item>'], 'tab:') && matchHotspot(['toast'], 'toast'));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test skills/motion-video/tests/validate.test.mjs`
Expected: FAIL — cannot find `../components/core/validate.js`

- [ ] **Step 4: Implement** — `skills/motion-video/components/core/validate.js`

```js
// validate.js -- one set of rules for runtime errors (engine) and brief checks (check_brief.mjs).
export const RESERVED = new Set(['at', 'use', 'name', 'w', 'h', 'r', 'fill', 'ink', 'shake', 'badge']);
const CURSOR_KEYS = new Set(['at', 'x', 'y', 'target', 'dx', 'dy', 'press', 'sound']);

export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function didYouMean(x, list) {
  let best = null, bestD = Math.max(2, Math.ceil(String(x).length / 3)) + 1;
  for (const c of list) { const k = lev(String(x), c); if (k < bestD) { bestD = k; best = c; } }
  return best;
}

export function typeOk(spec, v) {
  if (spec === 'any') return true;
  if (spec.startsWith('enum:')) return spec.slice(5).split('|').includes(v);
  switch (spec) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'string[]': return Array.isArray(v) && v.every((x) => typeof x === 'string');
    case 'number[]': return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'object[]': return Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && !Array.isArray(x));
    default: return false;
  }
}

export function matchHotspot(patterns, target) {
  return patterns.some((p) => {
    const i = p.indexOf(':<');
    return i < 0 ? p === target : target.startsWith(p.slice(0, i + 1)) && target.length > i + 1;
  });
}

// The row a cursor row aims at: the row active at its beat if it has the hotspot,
// otherwise the next row if it starts within one beat and has it (a press landing
// on the beat a state starts). rows: [{ row, comp }] in order.
export function targetRow(rows, c) {
  let k = 0;
  rows.forEach((r, i) => { if (r.row.at <= c.at + 1e-9) k = i; });
  for (const i of [k, k + 1]) {
    const r = rows[i];
    if (r && r.comp && (i === k || r.row.at - c.at <= 1 + 1e-9) && matchHotspot(r.comp.meta.hotspots, c.target)) return r;
  }
  return null;
}

const same = (a, b) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

export function validate({ states, cursor, registry, song, loop = true, strict = false }) {
  const errors = [], warnings = [];
  const END = song?.beats?.length;
  if (!Array.isArray(states) || !states.length) return { errors: ['states() must return at least one row'], warnings };
  if (states[0].at !== 0) errors.push('first row must be at beat 0');
  states.forEach((row, i) => {
    if (i && !(row.at > states[i - 1].at)) errors.push(`rows must be in ascending beat order (beat ${row.at} after ${states[i - 1].at})`);
    if (row.use) {
      const comp = registry[row.use];
      if (!comp) {
        const s = didYouMean(row.use, Object.keys(registry));
        errors.push(`unknown component "${row.use}" at beat ${row.at}${s ? `: did you mean "${s}"?` : ''} (see components/CATALOG.md)`);
        return;
      }
      const props = comp.meta.props;
      for (const [k, v] of Object.entries(row)) {
        if (RESERVED.has(k)) continue;
        if (!(k in props)) { errors.push(`unknown prop "${k}" for ${row.use} (props: ${Object.keys(props).join(', ') || 'none'})`); continue; }
        if (!typeOk(props[k][0], v)) errors.push(`prop "${k}" of ${row.use} should be ${props[k][0]}, got ${JSON.stringify(v)}`);
      }
    } else if (row.name) {
      if (![row.w, row.h, row.r].every((x) => typeof x === 'number')) errors.push(`custom row at beat ${row.at} needs numeric w, h and r`);
    } else {
      errors.push(`row at beat ${row.at} needs \`use\` (a component) or \`name\` (a custom state)`);
    }
    if ('shake' in row && typeof row.shake !== 'boolean') errors.push(`shake at beat ${row.at} should be true or false`);
    if ('badge' in row && !(typeof row.badge === 'number' && row.badge >= 0)) errors.push(`badge at beat ${row.at} should be a number >= 0`);
  });
  if (loop && END != null && states.length > 1) {
    const last = states.at(-1);
    if (last.at > END - 2) errors.push(`the last row (beat ${last.at}) must sit at least 2 beats before the end (beat ${END}) so the loop settles`);
    if (!same(last, states[0])) errors.push('the last row must repeat the first (same component and props) so the loop is seamless');
  }
  const rows = states.map((row) => ({ row, comp: row.use ? registry[row.use] : null }));
  if (!Array.isArray(cursor) || !cursor.length) errors.push('cursor() must return at least one row');
  else {
    if (cursor[0].at !== 0) errors.push('the first cursor row must be at beat 0');
    let open = null;
    cursor.forEach((c, i) => {
      if (i && c.at < cursor[i - 1].at) errors.push(`cursor rows must be in ascending beat order (beat ${c.at})`);
      for (const k of Object.keys(c)) if (!CURSOR_KEYS.has(k)) errors.push(`unknown cursor key "${k}" at beat ${c.at} (keys: ${[...CURSOR_KEYS].join(', ')})`);
      if (!c.target && !(typeof c.x === 'number' && typeof c.y === 'number')) errors.push(`cursor row at beat ${c.at} needs target or x and y`);
      if (c.press !== undefined && ![true, 'down', 'up'].includes(c.press)) errors.push(`press at beat ${c.at} should be true, 'down' or 'up'`);
      if (c.sound !== undefined && c.sound !== 'key') errors.push(`sound at beat ${c.at} should be 'key'`);
      if (c.press === 'down') { if (open !== null) errors.push(`press 'down' at beat ${open} has no matching 'up'`); open = c.at; }
      if (c.press === 'up') { if (open === null) errors.push(`press 'up' at beat ${c.at} has no 'down' before it`); open = null; }
      if (c.press === true && open !== null) errors.push(`press 'down' at beat ${open} has no matching 'up'`);
      if (c.target) {
        if (!targetRow(rows, c)) {
          let k = 0; rows.forEach((r, j) => { if (r.row.at <= c.at + 1e-9) k = j; });
          const r = rows[k];
          errors.push(r.comp
            ? `hotspot "${c.target}" is not on ${r.row.use} at beat ${c.at} (hotspots: ${r.comp.meta.hotspots.join(', ')})`
            : `cursor target "${c.target}" at beat ${c.at} points at a custom row, which has no hotspots; use x and y`);
        }
      }
    });
    if (open !== null) errors.push(`press 'down' at beat ${open} has no matching 'up'`);
    if (loop && cursor.length > 1 && !same(cursor.at(-1), cursor[0])) errors.push('the last cursor row must repeat the first so the loop is seamless');
  }
  if (strict && song?.rules) {
    const hold = song.rules.min_hold_beats ?? 1;
    states.forEach((row, i) => {
      const next = states[i + 1]?.at ?? END;
      if (next != null && next - row.at < hold) errors.push(`row at beat ${row.at} (${row.use ?? row.name}) holds ${next - row.at} beat${next - row.at === 1 ? '' : 's'}; min_hold_beats is ${hold}`);
    });
    if (song.rules.max_states && states.length - 1 > song.rules.max_states) warnings.push(`${states.length - 1} states exceeds the song's max_states (${song.rules.max_states})`);
    if (END != null) {
      const busy = new Set([...states, ...(cursor ?? [])].map((r) => Math.floor(r.at)));
      const quiet = []; for (let b = 0; b < END; b++) if (!busy.has(b)) quiet.push(b);
      if (quiet.length) warnings.push(`quiet beats (nothing starts on them): ${quiet.join(', ')}; make sure a component animates there`);
    }
  }
  return { errors, warnings };
}
```

- [ ] **Step 5: Run validator tests** — `node --test skills/motion-video/tests/validate.test.mjs` → all PASS.

- [ ] **Step 6: Temporary stubs** so the engine can import them (T2 replaces helpers/modifiers/index fully):

`components/core/helpers.js`:
```js
export { RESERVED } from './validate.js';
export function el(parent, tag, attrs = {}, text) {
  const e = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}
```
`components/modifiers.js`:
```js
export const shakeOffset = () => 0;
export function mountBadges() { return []; }
export function renderBadges() {}
```
`components/index.js`:
```js
// GENERATED by scripts/build_catalog.mjs -- do not edit.
export { createScene } from './core/engine.js';
export const registry = {};
```

- [ ] **Step 7: Write the failing engine tests** — `skills/motion-video/tests/engine.test.mjs`. Pure parts are tested in Node with a fake component and a minimal DOM stub; browser behaviour is covered by the template tests and Task 2's harness.

```js
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
```

- [ ] **Step 8: Run to verify failure** — `node --test skills/motion-video/tests/engine.test.mjs` → FAIL (engine.js missing).

- [ ] **Step 9: Implement** — `skills/motion-video/components/core/engine.js`

```js
// engine.js -- turns the states/cursor tables into a scene whose seek(t) is pure.
// Rows with `use` are library components; rows with `name` are custom states whose
// content lives in `.layer[data-state=name]` and the page's `content` functions,
// exactly as before the library existed.
import { validate, targetRow } from './validate.js';
import { el } from './helpers.js';
import { shakeOffset, mountBadges, renderBadges } from '../modifiers.js';

export function createScene(o) {
  const { states, cursor, extraSfx = [], content = {}, song, stage, theme, beatT, Springs, dom, registry, loop = true } = o;
  const { errors } = validate({ states, cursor, registry, song, loop });
  if (errors.length) throw new Error('motion-kit: ' + errors.join('\n  - '));
  const { track, fromSettle } = Springs;
  const bs = song.beat_sec;
  const sp = song.rules?.spring ?? { zeta: 0.85, settle_sec: 0.6 * bs };
  const SHAPE = { omega: fromSettle(sp.settle_sec, sp.zeta), zeta: sp.zeta };
  const CAM = { omega: fromSettle(bs, 1), zeta: 1 };
  const PTR = { omega: fromSettle(0.8 * bs, 1), zeta: 1 };
  const v = (tr, t) => track(t, tr).value;
  const HEX = /^#[0-9a-f]{6}$/i;
  const hex = (c) => {
    const h = theme[c] ?? c;
    if (!HEX.test(h)) throw new Error(`unknown colour "${c}" (theme roles: ${Object.keys(theme).filter((k) => HEX.test(theme[k])).join(', ')}; or #rrggbb)`);
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const CX = stage.width / 2, CY = stage.height / 2;
  const base = { beatT, beat_sec: bs, Springs, spring: SHAPE, theme, hex, stage };

  // ---- rows: props with defaults, geometry, time window
  const rows = states.map((row, i) => {
    const comp = row.use ? registry[row.use] : null;
    let props = null;
    if (comp) {
      props = {};
      for (const [k, [, def]] of Object.entries(comp.meta.props)) props[k] = k in row ? row[k] : structuredClone(def);
    }
    return { i, row, comp, props, t0: beatT(row.at) };
  });
  rows.forEach((r, i) => { r.t1 = rows[i + 1] ? rows[i + 1].t0 : Infinity; });
  for (const r of rows) {
    const g = r.comp ? r.comp.geometry(r.props, base) : {};
    r.geo = { w: r.row.w ?? g.w, h: r.row.h ?? g.h, r: r.row.r ?? g.r, fill: r.row.fill ?? g.fill ?? 'surface', ink: r.row.ink ?? g.ink ?? 'ink' };
  }

  // ---- cursor: resolve targets to shape-centre design px, once
  const C = cursor.map((c) => {
    if (!c.target) return c;
    const r = targetRow(rows, c);
    const p = r.comp.hotspot(c.target, r.props, r.geo, base);
    if (!p) throw new Error(`motion-kit: hotspot "${c.target}" did not resolve on ${r.row.use} at beat ${r.row.at}`);
    return { ...c, x: p.x + (c.dx ?? 0), y: p.y + (c.dy ?? 0) };
  });
  for (const r of rows) r.presses = [];
  for (const c of C) {
    if (c.press === undefined) continue;
    let r = c.target ? targetRow(rows, c) : null;
    if (!r) { let k = 0; rows.forEach((q, j) => { if (q.row.at <= c.at + 1e-9) k = j; }); r = rows[k]; }
    r.presses.push({ t: beatT(c.at), kind: c.press, hotspot: c.target ?? null });
  }

  // ---- tracks (same maths as the pre-library template)
  const down = (c) => ({ t: beatT(c.at) - 0.08 * bs, to: 0.82 });
  const up = (c, d = 0) => ({ t: beatT(c.at) + d * bs, to: 1 });
  const mk = (list, get, opts) => ({ from: get(list[0]), changes: list.slice(1).map((x) => ({ t: beatT(x.at ?? x.row.at), to: get(x) })), ...opts });
  const G = rows.map((r) => ({ ...r.geo, at: r.row.at }));
  const zoom = (s) => Math.min(2.4, Math.max(1, (0.6 * Math.min(stage.width, stage.height)) / Math.max(s.w, s.h)));
  const tracks = {
    w: mk(G, (s) => s.w, SHAPE), h: mk(G, (s) => s.h, SHAPE), r: mk(G, (s) => s.r, SHAPE),
    fill: [0, 1, 2].map((k) => mk(G, (s) => hex(s.fill)[k], SHAPE)),
    ink: [0, 1, 2].map((k) => mk(G, (s) => hex(s.ink)[k], SHAPE)),
    zoom: mk(G, zoom, CAM),
    cx: mk(C, (c) => c.x, PTR), cy: mk(C, (c) => c.y, PTR),
    press: { from: 1, omega: fromSettle(0.15 * bs, 1), zeta: 1,
      changes: C.filter((c) => c.press).flatMap((c) => (c.press === 'down' ? [down(c)] : c.press === 'up' ? [up(c)] : [down(c), up(c, 0.1)])) },
  };
  const cursorLocal = (t) => ({ x: v(tracks.cx, t), y: v(tracks.cy, t) });
  for (const r of rows) r.ctx = { ...base, t0: r.i === 0 ? -1e6 : r.t0, t1: r.t1, presses: r.presses, cursorAt: cursorLocal, geo: r.geo, row: r.row };

  // ---- layers: one per component row; custom layers grouped by state name as before
  const enter = fromSettle(0.5 * bs, 1), exit = fromSettle(0.2 * bs, 1);
  const layers = [];
  rows.forEach((r, i) => {
    if (!r.comp) return;
    const e = el(dom.shape, 'div', { class: `layer c-${r.row.use}`, 'data-row': String(i) });
    r.comp.mount(e, r.props, r.ctx);
    const changes = [];
    if (i > 0) changes.push({ t: r.t0 + 0.15 * bs, to: 1, omega: enter });
    if (rows[i + 1]) changes.push({ t: r.t1, to: 0, omega: exit });
    layers.push({ el: e, r, tr: { from: i === 0 ? 1 : 0, changes, omega: enter, zeta: 1 } });
  });
  for (const e of dom.shape.querySelectorAll('.layer[data-state]')) {
    const name = e.dataset.state, changes = [];
    rows.forEach((r, i) => { if (r.row.name === name && i > 0) changes.push({ t: r.t0 + 0.15 * bs, to: 1, omega: enter }); });
    rows.forEach((r, i) => { if (r.row.name === name && rows[i + 1] && rows[i + 1].row.name !== name) changes.push({ t: rows[i + 1].t0, to: 0, omega: exit }); });
    layers.push({ el: e, r: null, tr: { from: rows[0].row.name === name ? 1 : 0, changes, omega: enter, zeta: 1 } });
  }
  const badges = mountBadges(dom.camera, rows, base);

  // ---- sounds
  const sfx = [
    ...C.filter((c) => c.press === true || c.press === 'down').map((c) => ({ beat: c.at, file: 'sfx/click.wav', gain: 0.7 })),
    ...C.filter((c) => c.sound === 'key').map((c) => ({ beat: c.at, file: 'sfx/key.wav', gain: 0.6 })),
    ...rows.flatMap((r) => (r.comp?.sfx ? r.comp.sfx(r.props, r.ctx) : [])),
    ...extraSfx,
  ];

  function since(name, t) {
    let start = null;
    for (const r of rows) if (r.row.name === name && r.t0 <= t) start = r.t0;
    return start === null ? 0 : t - start;
  }

  function seek(t) {
    const w = v(tracks.w, t), h = v(tracks.h, t), rr = v(tracks.r, t), z = v(tracks.zoom, t);
    const dx = shakeOffset(rows, t, base);
    const rgb = (arr) => `rgb(${arr.map((tr) => Math.round(v(tr, t))).join(',')})`;
    dom.camera.style.transform = `translate(${CX}px,${CY}px) scale(${z}) translate(${-CX}px,${-CY}px)`;
    Object.assign(dom.shape.style, { left: `${CX - w / 2 + dx}px`, top: `${CY - h / 2}px`, width: `${w}px`, height: `${h}px`,
      borderRadius: `${Math.min(rr, w / 2, h / 2)}px`, background: rgb(tracks.fill), color: rgb(tracks.ink) });
    for (const L of layers) {
      const op = Math.max(0, Math.min(1, v(L.tr, t)));
      Object.assign(L.el.style, { opacity: op, filter: op > 0.999 ? 'none' : `blur(${(1 - op) * 10}px)`, transform: `scale(${0.96 + 0.04 * op})` });
      if (L.r) L.r.comp.render(L.el, L.r.props, L.r.ctx, t);
    }
    for (const name in content) content[name](t);
    renderBadges(badges, t, { w, h, dx, CX, CY, base });
    const p = v(tracks.press, t);
    const x = CX + v(tracks.cx, t), y = CY + v(tracks.cy, t);
    dom.cursor.style.transform = `translate(${x - 7}px,${y - 4}px) scale(${p / z})`;
  }

  const inspect = (t) => { const z = v(tracks.zoom, t); return { cursor: { x: CX + v(tracks.cx, t) * z, y: CY + v(tracks.cy, t) * z } }; };
  return { seek, inspect, since, sfx, rows, cursorRows: C };
}
```

- [ ] **Step 10: Run engine tests** — `node --test skills/motion-video/tests/engine.test.mjs` → PASS.

- [ ] **Step 11: Template integration** — in `template/index.html`:
  1. Keep the file header, `<style>`, fonts, `theme.css`, stage/camera/shape/cursor markup. Remove the three custom `.layer` divs (button/loader/check) from `#shape` and replace the comment with: `<!-- Component rows (use:) get their layers from the engine. For a custom row (name:), add <div class="layer" data-state="NAME">...</div> here and animate it in content. -->`.
  2. Replace the whole `<script type="module">` body up to (not including) the `?play` block with:

```js
import { createScene, registry } from './components/index.js';
let STAGE, CX, CY, THEME, song, END, beatT, scene, since;
const $ = (s) => document.querySelector(s);

// ---------------- the three tables you edit ----------------
// STATES: what the one shape is from beat `at`. `use` names a component from
// components/CATALOG.md (its other keys are that component's props); a row with
// `name` + w/h/r is a custom state (add a matching .layer in #shape and animate it
// in `content`). fill/ink override colours with a theme role (canvas, surface, ink,
// muted, accent, pos, neg) or #rrggbb. The last row must repeat the first and sit at
// least 2 beats before END so everything settles by the seam.
const states = () => [
  { at: 0,       use: 'button', label: 'Get started', fill: 'accent', ink: 'surface' },
  { at: 2,       use: 'loader', fill: 'ink', ink: 'surface' },
  { at: 4,       use: 'check' },
  { at: END - 2, use: 'button', label: 'Get started', fill: 'accent', ink: 'surface' },
];
// CURSOR: where the pointer is from beat `at`. Either x/y in px from the stage
// centre, or target: '<hotspot>' (see each component's hotspots in the catalog),
// optionally with dx/dy. press: true clicks (click sound); 'down' presses and holds,
// 'up' releases (drags). sound: 'key' plays sfx/key.wav on that beat.
// First and last rows must match, the last at least 2 beats before END.
const cursor = () => [
  { at: 0,       x: 240, y: 280 },
  { at: 1.25,    x: 60,  y: 18 },
  { at: 2,       x: 60,  y: 18, press: true },
  { at: 3,       x: 200, y: 230 },
  { at: END - 2, x: 240, y: 280 },
];
// EXTRA_SFX: any other sound cues, [{ beat, file, gain }], merged into window.SFX.
const extraSfx = () => [];
// Custom-state animation: functions of ABSOLUTE t, run every frame. since(name, t)
// gives seconds since the latest custom row `name` began. Components need nothing here.
const content = {};
// ------------------------------------------------------------

function seek(t) { scene.seek(t); }

window.ready = (async () => {
  const [songR, projR, themeR] = await Promise.all(['song.json', 'project.json', 'theme.json'].map((f) => fetch(f)));
  song = await songR.json();
  STAGE = projR.ok ? (await projR.json()).stage : { width: 1440, height: 1440 };
  THEME = themeR.ok ? await themeR.json() : Object.fromEntries(['canvas', 'surface', 'ink', 'muted', 'accent']
    .map((r) => [r, getComputedStyle(document.documentElement).getPropertyValue(`--${r}`).trim()]));
  window.STAGE = STAGE; CX = STAGE.width / 2; CY = STAGE.height / 2;
  END = song.beats.length;
  beatT = (b) => {
    const i = Math.floor(b), beat = song.beats[i];
    return (beat ? beat.cue_t ?? beat.t : i * song.beat_sec) + (b - i) * song.beat_sec;
  };
  Object.assign($('#stage').style, { width: `${STAGE.width}px`, height: `${STAGE.height}px` });
  const fam = getComputedStyle(document.documentElement).getPropertyValue('--font');
  await Promise.all([400, 500, 600].map((wt) => document.fonts.load(`${wt} 34px ${fam}`).catch(() => {})));
  await document.fonts.ready;
  scene = createScene({ states: states(), cursor: cursor(), extraSfx: extraSfx(), content, song, stage: STAGE, theme: THEME,
    beatT, Springs: window.Springs, registry, dom: { camera: $('#camera'), shape: $('#shape'), cursor: $('#cursor') } });
  since = scene.since;
  window.SFX = scene.sfx;
  seek(0);
})();
window.seek = seek;
window.inspect = (t) => scene.inspect(t);
```
  The `// ---------------- the three tables you edit ----------------` and `// ------------------------------------------------------------` marker lines are load-bearing: `gallery.mjs` and tests replace the text between them. Keep the cursor rows' text byte-identical (tests patch `{ at: 3,       x: 200, y: 230 },`) and keep a literal `fill: 'ink'` in the loader row (a test patches it to `'acent'`).
  3. `button`, `loader` and `check` do not exist until Tasks 2 and 4. Until then the template cannot render: Task 1 ends with the template tests temporarily expected to fail on "unknown component" and is committed that way ONLY on the `library` branch. Record this in the report; Task 2 (button) and Task 4 (loader, check) restore them. The render tests that use `fixtures.mjs` (not the template) must still pass.

- [ ] **Step 12: new_project.sh copies the library** — after the `cp -L ... springs.js` line add:

```bash
cp -RL "$SKILL/components" "$DIR/components"
rm -rf "$DIR/components/docs-images"   # docs only; projects do not need the thumbnails
```

- [ ] **Step 13: Run** `node --test skills/motion-video/tests/validate.test.mjs skills/motion-video/tests/engine.test.mjs` → PASS; `npm test` → only the template-dependent render tests fail with "unknown component" (list them in the report).

- [ ] **Step 14: Commit**

```bash
git add skills/motion-video/components skills/motion-video/tests/validate.test.mjs skills/motion-video/tests/engine.test.mjs skills/motion-video/template/index.html skills/motion-video/scripts/new_project.sh
git commit -m "Component engine and validator; template delegates to createScene

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Helpers, modifiers, reference component, catalog generator, gallery, contract tests

**Files:**
- Replace: `components/core/helpers.js`, `components/modifiers.js`
- Create: `components/controls/button.js`, `scripts/build_catalog.mjs`, `scripts/gallery.mjs`, `tests/harness.mjs`, `tests/contract.test.mjs`, `tests/gallery.test.mjs`
- Generated: `components/index.js`, `components/CATALOG.md`, `components/docs-images/button.png`

**Interfaces:**
- Consumes: Task 1 contract.
- Produces (helpers): `el(parent, tag, attrs, text)`, `textW(text, size, weight=500)`, `prog(ctx, t, t0, settleBeats=0.6, zeta=1) -> 0..1`, `fade(ctx, t, tIn, tOut) -> { o, y, blur }`, `drawOn(ctx, t, t0, beats=0.8) -> 0..1`, `fmt(n, { decimals=0, prefix='', suffix='' })`, `role(ctx, name, fallback)`, `ICONS` map, `icon(parent, name, size) -> svg`, `pressAt(ctx, hotspotPrefix) -> presses matching`, `edges(ctx, from, changes, t, settle, n, lead=0.7) -> { left, right }` (the reversal-safe two-edge indicator from motion-ui pattern 2, generalised).
- Produces (harness): `makeProject({ states, cursor, bars = 4, bpm = 120, extraSfx, size }) -> dir`, `openScene(dir) -> { page, seek(t), snap(selector), close() }`.

- [ ] **Step 1: helpers.js** — full implementation:

```js
// helpers.js -- pure building blocks shared by components. Nothing here reads a clock.
export { RESERVED } from './validate.js';
const SVG = 'http://www.w3.org/2000/svg';

export function el(parent, tag, attrs = {}, text) {
  const e = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

// Deterministic text width estimate (no layout at geometry time): ~0.56em per character.
export const textW = (text, size, weight = 500) => String(text).length * size * (weight >= 600 ? 0.6 : 0.56);

// 0 -> 1 progress of a critically damped (default) spring released at t0.
export function prog(ctx, t, t0, settleBeats = 0.6, zeta = 1) {
  if (t < t0) return 0;
  const omega = ctx.Springs.fromSettle(settleBeats * ctx.beat_sec, zeta);
  return ctx.Springs.spring(t, { from: 0, to: 1, t0, omega, zeta }).value;
}

// Sub-element enter/exit inside a row: rises 12px and unblurs after tIn, leaves fast at tOut.
export function fade(ctx, t, tIn, tOut = Infinity) {
  const i = prog(ctx, t, tIn, 0.5), o = t >= tOut ? 1 - prog(ctx, t, tOut, 0.2) : 1;
  const a = Math.max(0, Math.min(1, i * o));
  return { o: a, y: (1 - i) * 12, blur: (1 - a) * 6 };
}
export const applyFade = (e, f) => Object.assign(e.style, { opacity: f.o, transform: `translateY(${f.y}px)`, filter: f.blur > 0.05 ? `blur(${f.blur}px)` : 'none' });

export const drawOn = (ctx, t, t0, beats = 0.8) => Math.max(0, Math.min(1, prog(ctx, t, t0, beats)));

export function fmt(n, { decimals = 0, prefix = '', suffix = '' } = {}) {
  const s = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${n < 0 ? '-' : ''}${prefix}${s}${suffix}`;
}

// A theme role if the theme defines it as a colour, else the fallback role.
export const role = (ctx, name, fallback) => (/^#[0-9a-f]{6}$/i.test(ctx.theme[name] ?? '') ? name : fallback);
export const cssRole = (ctx, name, fallback) => `var(--${role(ctx, name, fallback)})`;

// One stroke weight everywhere: 24-unit grid, stroke 2, round caps and joins.
export const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6', 'chevron-down': 'M6 9l6 6 6-6', play: 'M8 5.5v13l10-6.5z', pause: 'M8.5 5v14M15.5 5v14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 19h14', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16.5 16.5L20 20',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4', info: 'M12 11v6M12 7.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z', calendar: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4', trend: 'M4 17l5-5 4 4 7-8M15 8h5v5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', volume: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z', wallet: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7V5h12M16 13h.01',
};
export function icon(parent, name, size = 32) {
  const s = el(parent, 'svg:svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `ico ico-${name}` });
  el(s, 'svg:path', { d: ICONS[name] ?? ICONS.sparkle });
  return s;
}

export const pressesOn = (ctx, prefix) => ctx.presses.filter((p) => p.hotspot && (p.hotspot === prefix || p.hotspot.startsWith(prefix + ':')));

// Two-edge travelling indicator (reversal-safe): same maths as motion-ui pattern 2.
export function edges(ctx, from, changes, t, settle, n, lead = 0.7) {
  const { Springs } = ctx;
  const trail = Springs.fromSettle(settle, 1), fast = Springs.fromSettle(settle * lead, 1);
  const hold = (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b));
  const e = [{ x: from, v: 0, x0: from, to: from, t: -Infinity, w: trail }, { x: from + 1, v: 0, x0: from + 1, to: from + 1, t: -Infinity, w: trail }];
  const at = (s, tt) => { if (!Number.isFinite(s.t) || tt < s.t) return { x: s.x0, v: 0 }; const r = Springs.response(tt - s.t, s.x0 - s.to, s.v0 ?? 0, s.w, 1); const x = hold(s.to + r.e, s.x0, s.to); return { x, v: x === s.to + r.e ? r.v : 0 }; };
  for (const c of changes.filter((c) => c.t <= t).sort((a, b) => a.t - b.t)) {
    const now = e.map((s) => at(s, c.t));
    const fwd = c.index + 0.5 > (now[0].x + now[1].x) / 2;
    e[0] = { x0: now[0].x, v0: now[0].v, to: c.index, t: c.t, w: fwd ? trail : fast };
    e[1] = { x0: now[1].x, v0: now[1].v, to: c.index + 1, t: c.t, w: fwd ? fast : trail };
  }
  const l = at(e[0], t).x, r = at(e[1], t).x;
  return { left: Math.max(0, Math.min(n, l)), right: Math.max(0, Math.min(n, r)) };
}
```

- [ ] **Step 2: modifiers.js** — shake and badge:

```js
// modifiers.js -- row keys usable on any row: shake (error shake) and badge (count bubble).
import { el, prog } from './core/helpers.js';

// Error shake: a short damped sine from the row's start. Deliberately underdamped; it is the one
// place motion-kit shakes, and only when a row asks for it.
export function shakeOffset(rows, t, base) {
  let dx = 0;
  for (const r of rows) {
    if (!r.row.shake || r.i === 0) continue;
    const tau = t - r.t0;
    if (tau < 0 || tau > 0.6) continue;
    dx += 14 * Math.exp(-tau * 9) * Math.sin(tau * 2 * Math.PI * 7);
  }
  return dx;
}

export function mountBadges(camera, rows, base) {
  return rows.filter((r) => r.row.badge != null).map((r) => {
    const b = el(camera, 'div', { class: 'mk-badge' });
    Object.assign(b.style, { position: 'absolute', minWidth: '44px', height: '44px', padding: '0 12px', boxSizing: 'border-box',
      borderRadius: '22px', display: 'grid', placeItems: 'center', font: '600 22px var(--font)', background: 'var(--accent)',
      color: 'var(--surface)', boxShadow: '0 0 0 4px var(--canvas)', opacity: 0 });
    b.textContent = String(r.row.badge);
    return { el: b, r };
  });
}

export function renderBadges(badges, t, { w, h, dx, CX, CY, base }) {
  for (const { el: b, r } of badges) {
    const inT = r.i === 0 ? -1e6 : r.t0 + 0.4 * base.beat_sec;
    const pin = prog(base, t, inT, 0.4, 0.8), pout = t >= r.t1 ? prog(base, t, r.t1, 0.2) : 0;
    const s = Math.max(0, pin * (1 - pout));
    Object.assign(b.style, { opacity: s, left: `${CX + w / 2 - 30 + dx}px`, top: `${CY - h / 2 - 14}px`, transform: `scale(${0.6 + 0.4 * s})` });
  }
}
```

- [ ] **Step 3: Reference component** — `components/controls/button.js` (the pattern every other component follows):

```js
import { el, textW, icon, pressesOn, prog } from '../core/helpers.js';

export const meta = {
  name: 'button', group: 'controls',
  useWhen: 'A call to action is pressed: start, import, buy, sign up.',
  motion: 'Presses dip the label slightly with the cursor; the shape morphs in from the previous state.',
  props: { label: ['string', 'Get started'], icon: ['enum:none|upload|plus|play|check|sparkle|chevron', 'none'] },
  hotspots: ['button'],
  sounds: [],
  example: "{ at: 0, use: 'button', label: 'Import payslip', icon: 'upload' }",
  edgeCases: [{ label: 'A very long call to action that keeps going and going' }, { label: '' }, { icon: 'plus', label: 'Add' }],
};

const PAD = 56, ICON = 36, GAP = 16;
export function geometry(p) {
  const w = Math.max(220, PAD * 2 + textW(p.label, 34) + (p.icon !== 'none' ? ICON + GAP : 0));
  return { w: Math.min(w, 1200), h: 112, r: 56, fill: 'accent', ink: 'surface' };
}

export function mount(root, p) {
  const row = el(root, 'div', { class: 'btn-row' });
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: `${GAP}px`, font: '500 34px var(--font)', letterSpacing: '-0.01em' });
  if (p.icon !== 'none') icon(row, p.icon, ICON);
  el(row, 'span', { class: 'btn-label' }, p.label);
}

export function render(root, p, ctx, t) {
  // Dip to 0.97 on each press aimed at this button, recovering with the press spring.
  let s = 1;
  for (const pr of pressesOn(ctx, 'button')) {
    if (t < pr.t - 0.08 * ctx.beat_sec) continue;
    const d = prog(ctx, t, pr.t - 0.08 * ctx.beat_sec, 0.15), u = prog(ctx, t, pr.t + 0.1 * ctx.beat_sec, 0.15);
    s = Math.min(s, 1 - 0.03 * d * (1 - u));
  }
  root.firstChild.style.transform = `scale(${s})`;
}

export function hotspot(name, p, geo) {
  return name === 'button' ? { x: Math.min(geo.w * 0.18, 90), y: 14 } : null;
}
```

- [ ] **Step 4: build_catalog.mjs**

```js
#!/usr/bin/env node
// build_catalog.mjs -- generate components/index.js and components/CATALOG.md from each component's meta.
//   node build_catalog.mjs            write both
//   node build_catalog.mjs --check    exit 1 if either is stale
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const COMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
const GROUPS = [['controls', 'Controls'], ['feedback', 'Feedback'], ['data', 'Data and content'], ['chrome', 'App chrome']];

export async function collect() {
  const out = [];
  for (const [g] of GROUPS) {
    const dir = path.join(COMP, g);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      if (mod.meta.name !== f.replace(/\.js$/, '')) throw new Error(`${g}/${f}: meta.name must be "${f.replace(/\.js$/, '')}"`);
      if (mod.meta.group !== g) throw new Error(`${g}/${f}: meta.group must be "${g}"`);
      out.push({ group: g, file: `${g}/${f}`, meta: mod.meta });
    }
  }
  return out;
}

export function indexJs(list) {
  const id = (n) => n.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  return ['// GENERATED by scripts/build_catalog.mjs -- do not edit.',
    "export { createScene } from './core/engine.js';",
    ...list.map((c) => `import * as ${id(c.meta.name)} from './${c.file}';`),
    `export const registry = {\n${list.map((c) => `  '${c.meta.name}': ${id(c.meta.name)},`).join('\n')}\n};`, ''].join('\n');
}

export function catalogMd(list) {
  const L = ['# Component catalog', '', '<!-- GENERATED by scripts/build_catalog.mjs from each component\'s meta. Do not edit; run the script. -->', '',
    'Name a component in a `states()` row with `use:` and pass its props as keys. Aim the cursor at a hotspot with `target:`.',
    'Any row can also carry `shake: true` (error shake on arrival) and `badge: <n>` (a count bubble on the shape).', '',
    '```js', "{ at: 4, use: 'toast', text: 'Exported' }            // states()", "{ at: 3.5, target: 'toast', press: true }             // cursor()", '```', ''];
  for (const [g, title] of GROUPS) {
    const items = list.filter((c) => c.group === g);
    if (!items.length) continue;
    L.push(`## ${title}`, '', items.map((c) => `[${c.meta.name}](#${c.meta.name})`).join(' · '), '');
    for (const { meta: m } of items) {
      L.push(`### ${m.name}`, '', `![${m.name}](docs-images/${m.name}.png)`, '', `**Use when:** ${m.useWhen}`, '', `**Motion:** ${m.motion}`, '',
        '| Prop | Type | Default |', '|---|---|---|',
        ...Object.entries(m.props).map(([k, [ty, def]]) => `| \`${k}\` | \`${ty}\` | \`${JSON.stringify(def)}\` |`), '',
        `**Hotspots:** ${m.hotspots.map((h) => `\`${h}\``).join(', ') || 'none'}  `, `**Sounds:** ${m.sounds.join(', ') || 'none'}`, '',
        '```js', m.example, '```', '');
    }
  }
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const list = await collect();
  const files = { 'index.js': indexJs(list), 'CATALOG.md': catalogMd(list) };
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, s]) => !existsSync(path.join(COMP, f)) || readFileSync(path.join(COMP, f), 'utf8') !== s).map(([f]) => f);
    if (stale.length) { console.error(`stale: ${stale.join(', ')} (run node scripts/build_catalog.mjs)`); process.exit(1); }
    console.log(`catalog up to date (${list.length} components)`);
  } else {
    for (const [f, s] of Object.entries(files)) writeFileSync(path.join(COMP, f), s);
    console.log(`wrote index.js and CATALOG.md (${list.length} components)`);
  }
}
```

- [ ] **Step 5: harness.mjs** — test helper that scaffolds a real project with given tables:

```js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openProject } from '../scripts/render.mjs';

const SKILL = path.resolve(import.meta.dirname, '..');
const START = '// ---------------- the three tables you edit ----------------';
const END_MARK = '// ------------------------------------------------------------';

export function makeProject({ states, cursor, bars = 4, bpm = 120, extraSfx = '[]', content = '{}', size } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mk-'));
  const song = path.join(root, 'beat.wav');
  execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.join(SKILL, 'tests'))})\nfrom test_analyze_song import click_track\nclick_track(${JSON.stringify(song)}, ${bpm}, seconds=${Math.ceil((bars * 4 * 60) / bpm) + 12})`]);
  const dir = path.join(root, 'p');
  execFileSync(path.join(SKILL, 'scripts', 'new_project.sh'), [dir, song, '--bars', String(bars), ...(size ? ['--size', size] : [])], { stdio: 'pipe' });
  if (states) {
    const f = path.join(dir, 'index.html'), html = readFileSync(f, 'utf8');
    const a = html.indexOf(START), b = html.indexOf(END_MARK, a);
    const tables = `${START}\nconst states = () => ${states};\nconst cursor = () => ${cursor};\nconst extraSfx = () => ${extraSfx};\nconst content = ${content};\n`;
    writeFileSync(f, html.slice(0, a) + tables + html.slice(b));
  }
  return dir;
}

export async function openScene(dir) {
  const proj = await openProject(dir, { workers: 1 });
  const page = proj.pages[0];
  return {
    page, errors: proj.errors,
    seek: (t) => page.evaluate((t) => window.seek(t), t),
    snap: (sel = '#stage') => page.evaluate((sel) => document.querySelector(sel).outerHTML, sel),
    close: () => proj.close(),
  };
}
```
(Tables are passed as JS source strings, so tests can use `END`.)

- [ ] **Step 6: gallery.mjs** — scaffold a project that plays every registered component (2 beats each, example props, then back to the first), optionally writing thumbnails:

```js
#!/usr/bin/env node
// gallery.mjs OUT [--only a,b] [--stills] -- a project that plays every component in catalog order.
// --stills writes components/docs-images/<name>.png (480 px) from a settled frame of each component.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './build_catalog.mjs';
import { makeProject } from '../tests/harness.mjs';
import { openProject, shoot, FFMPEG } from './render.mjs';

const COMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
export async function gallery({ only = null } = {}) {
  let list = await collect();
  if (only) list = list.filter((c) => only.includes(c.meta.name));
  const rows = list.map((c, i) => `  { at: ${i * 2}, ${c.meta.example.replace(/^\{\s*at:\s*[\d.]+,\s*/, '')},`.replace(/\},$/, ' },'));
  const first = list[0].meta.example.replace(/^\{\s*at:\s*[\d.]+,\s*/, '').replace(/\}$/, '');
  const beats = list.length * 2 + 2;
  const bars = Math.ceil(beats / 4);
  const states = `[\n${rows.join('\n')}\n  { at: END - 2, ${first} },\n]`;
  const cursor = "[\n  { at: 0, x: 300, y: 320 },\n  { at: END - 2, x: 300, y: 320 },\n]";
  const dir = makeProject({ states, cursor, bars });
  return { dir, list };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[2];
  const oi = process.argv.indexOf('--only');
  const { dir, list } = await gallery({ only: oi > 0 ? process.argv[oi + 1].split(',') : null });
  if (out) execFileSync('cp', ['-R', dir + '/.', out]);
  if (process.argv.includes('--stills')) {
    mkdirSync(path.join(COMP, 'docs-images'), { recursive: true });
    const proj = await openProject(dir, { workers: 1 });
    const song = proj.song;
    for (const [i, c] of list.entries()) {
      const t = (song.beats[i * 2 + 1] ?? song.beats.at(-1)).t + 0.4 * song.beat_sec;
      const png = await shoot(proj.pages[0], t);
      const f = path.join(COMP, 'docs-images', `${c.meta.name}.png`);
      writeFileSync(f + '.full.png', png);
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', f + '.full.png', '-vf', 'scale=480:-1', f]);
      execFileSync('rm', [f + '.full.png']);
    }
    await proj.close();
  }
  console.log(dir);
}
```
Note the regex requires every `meta.example` to be a single-line object literal starting `{ at: N, use: '...'`; the contract test enforces that shape.

- [ ] **Step 7: contract.test.mjs** — runs over every registered component (it grows automatically as T3–T6 add components):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import Springs from '../../../shared/springs.js';
import { registry } from '../components/index.js';
import { typeOk, validate } from '../components/core/validate.js';

const theme = { canvas: '#eceae6', surface: '#ffffff', ink: '#0b0b0b', muted: '#8c8883', accent: '#0b0b0b' }; // house: no pos/neg
const base = { beat_sec: 0.5, Springs, theme, stage: { width: 1440, height: 1440 }, beatT: (b) => b * 0.5, hex: () => [0, 0, 0] };
const withDefaults = (m, row) => Object.fromEntries(Object.entries(m.props).map(([k, [, d]]) => [k, k in row ? row[k] : structuredClone(d)]));
const exampleRow = (m) => Function(`return (${m.example})`)();

for (const [name, c] of Object.entries(registry)) {
  test(`${name}: meta is complete and consistent`, () => {
    const m = c.meta;
    for (const k of ['name', 'group', 'useWhen', 'motion', 'example']) assert.ok(typeof m[k] === 'string' && m[k].length, `meta.${k}`);
    assert.ok(Array.isArray(m.hotspots) && Array.isArray(m.sounds) && Array.isArray(m.edgeCases));
    assert.match(m.example, /^\{ at: [\d.]+, use: '[a-z-]+'.*\}$/, 'example must be a single-line { at: N, use: ... } literal');
    const ex = exampleRow(m);
    assert.equal(ex.use, name);
    for (const [k, [ty, def]] of Object.entries(m.props)) assert.ok(typeOk(ty, def), `default of ${k} matches ${ty}`);
    for (const f of ['geometry', 'mount', 'render', 'hotspot']) assert.equal(typeof c[f], 'function', f);
  });

  test(`${name}: geometry fits the stage for the example and every edge case`, () => {
    for (const row of [exampleRow(c.meta), ...c.meta.edgeCases]) {
      const g = c.geometry(withDefaults(c.meta, row), base);
      for (const k of ['w', 'h', 'r']) assert.ok(Number.isFinite(g[k]) && g[k] > 0, `${k} for ${JSON.stringify(row)}`);
      assert.ok(g.w <= 1400 && g.h <= 1400, `fits 1440 stage: ${g.w}x${g.h}`);
      assert.ok(typeof g.fill === 'string' && typeof g.ink === 'string');
    }
  });

  test(`${name}: hotspots resolve inside the shape`, () => {
    const ex = exampleRow(c.meta), p = withDefaults(c.meta, ex), geo = c.geometry(p, base);
    const names = c.meta.hotspots.map((h) => (h.includes(':<') ? (c.meta.hotspotExample?.[h] ?? null) : h)).filter(Boolean);
    for (const h of names) {
      const pt = c.hotspot(h, p, geo, base);
      assert.ok(pt, `hotspot ${h} resolves`);
      assert.ok(Math.abs(pt.x) <= geo.w / 2 && Math.abs(pt.y) <= geo.h / 2, `${h} inside ${geo.w}x${geo.h}: ${JSON.stringify(pt)}`);
    }
  });

  test(`${name}: example validates as a one-row loop`, () => {
    const ex = exampleRow(c.meta);
    const song = { beats: Array.from({ length: 8 }, (_, i) => ({ i, t: i * 0.5 })) };
    const r = validate({ states: [{ ...ex, at: 0 }, { ...ex, at: 6 }], cursor: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 0, y: 0 }], registry, song });
    assert.deepEqual(r.errors, []);
  });
}
```
Parametrised hotspots (`tab:<item>`) name a concrete example in `meta.hotspotExample`, e.g. `hotspotExample: { 'tab:<item>': 'tab:Month' }` (add this key to the Task 1 meta contract; build_catalog ignores it).

- [ ] **Step 8: gallery.test.mjs** — browser-level: every component mounts, renders, is pure, and the gallery seams:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gallery } from '../scripts/gallery.mjs';
import { openScene } from './harness.mjs';
import { beatStills } from '../scripts/beat_stills.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('every component renders purely (same pixels-to-DOM whatever came before) and the gallery loops', async () => {
  const { dir, list } = await gallery();
  const s = await openScene(dir);
  try {
    assert.deepEqual(s.errors, []);
    const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
    const D = song.loop.duration_sec;
    for (let i = 0; i < list.length; i++) {
      const t = song.beats[i * 2].t + 0.73 * song.beat_sec;      // mid-entrance
      await s.seek(0); await s.seek(t); const a = await s.snap();
      await s.seek(D * 0.9); await s.seek(t); const b = await s.snap();
      assert.equal(a, b, `${list[i].meta.name} is not a pure function of t`);
    }
  } finally { await s.close(); }
  const r = await beatStills(dir);
  assert.equal(r.seam.ok, true, r.seam.notes.join('; '));
});
```

- [ ] **Step 9: Generate and run**

```bash
node skills/motion-video/scripts/build_catalog.mjs
node skills/motion-video/scripts/gallery.mjs "" --stills
npm test
```
Expected: catalog lists `button`; `docs-images/button.png` exists (view it); contract, gallery, engine and validate tests pass. Template tests still fail only because `loader`/`check` are missing (restored in Task 4); list them in the report.

Add to the root `package.json` test script a first step `node skills/motion-video/scripts/build_catalog.mjs --check &&` so a stale catalog fails `npm test`.

- [ ] **Step 10: Commit**

```bash
git add -A skills/motion-video package.json
git commit -m "Component helpers, modifiers, button, catalog generator, gallery and contract tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Component tasks (3–6): shared instructions

Every component follows `controls/button.js`: one file, the Task 1 contract, `meta` complete (`hotspotExample` for parametrised hotspots, 2–4 `edgeCases`), design px at 1440, type scale and icons from Global Constraints, springs through helpers. For each group task:

1. Write the group's behaviour test file first (specified per task) and run it to see it fail.
2. Implement the components.
3. `node scripts/build_catalog.mjs && node scripts/gallery.mjs "" --stills`, then **Read every new `docs-images/*.png`** and fix anything cramped, clipped or off-style.
4. `npm test` all green (contract + gallery automatically cover the new components).
5. Commit with the generated files.

Behaviour tests use `makeProject` + `openScene` and read DOM state at chosen times via `s.page.evaluate`. Each component gives its key sub-elements stable class names (listed per component) so tests can find them.

Layer content conventions: the layer (`.layer.c-<name>`) fills the shape; components may paint a full background inside it (e.g. the toggle track colour animating) because the shape clips to its radius. Soft tones: `color-mix(in srgb, var(--accent) 14%, transparent)`.

---

### Task 3: Controls (7): button (done), toggle, checkbox, slider, tabs, input, dropdown

**Files:** Create `components/controls/{toggle,checkbox,slider,tabs,input,dropdown}.js`, `tests/components-controls.test.mjs`.

**Component specs:**
- **toggle** — props `on: ['boolean', false]`, `label: ['string', '']`. Geometry: label empty → 172×96 r48; with label → `w = 172 + 36 + textW(label,30)` h 112 r56 (label left of switch). fill `surface`. Layer paints the switch track (`.tg-track`, 172×96 r48 when no label, 132×76 inside the labelled row): colour `var(--muted)` → `var(--accent)` when on. Knob `.tg-knob` (circle 76/60) travels with `edges()` two-edge stretch (n=1 two positions: 0 off, 1 on). A press on `knob` flips state at the press time (each press toggles). Hotspot `knob` = knob centre. Test: at press+1 beat the knob's left edge is on the right half and `.tg-track` background is the accent colour; before the press, left half.
- **checkbox** — props `checked: ['boolean', false]`, `label: ['string', 'Remember me']`. Geometry `w = 72 + 24 + textW(label,30) + 72`, h 112, r 28, fill `surface`. `.cb-box` 56×56 r14 (2px `var(--muted)` border → filled `var(--accent)` when checked); `.cb-tick` path draws on with `drawOn` from the check time (prop `checked` true → checked from row start; a press on `box` checks at press time). Hotspot `box`. Test: `stroke-dashoffset` of `.cb-tick` is ~1 before the press and ~0 one beat after.
- **slider** — props `value: ['number', 0.4]`, `min: ['number', 0]`, `max: ['number', 1]`, `overstretch: ['boolean', true]`, `icon: ['enum:volume|none', 'volume']`. Geometry 640×112 r56 surface. `.sl-track` 440×10 r5 muted, `.sl-fill` accent, `.sl-thumb` 36 circle ink. Drag: between a `press:'down'` on `thumb` and the next `'up'`, the value follows `ctx.cursorAt(t).x` mapped along the track; past max with `overstretch`, the track and fill stretch by a rubber band `extra = 60 * (1 - exp(-over/120))`; after `'up'` the value springs (zeta 1) from wherever it was to the clamped value. Hotspots `thumb` (current value at row start), `track` (centre). Test: during the drag the thumb x follows the cursor; after release beyond max the fill width settles back to full track width within 1 beat.
- **tabs** — props `items: ['string[]', ['Day','Week','Month']]`, `active: ['string', 'Day']`. Geometry: item width `textW(item,28)+64`, `w = sum + 16`, h 100 r50, fill `muted` → use `surface` with a soft inset? Use fill `ink`, ink `surface`, indicator `.tb-ind` in `var(--surface)` with the active label in `var(--ink)` above it (clip-path swap like demo 1). Press on `tab:<item>` moves the indicator with `edges()` (n = items.length, settle 0.35 beat). Hotspot `tab:<item>` = that tab's centre (`hotspotExample: {'tab:<item>': 'tab:Month'}`). Unknown item in a target → hotspot returns null (engine error). Test: after pressing `tab:Month`, `.tb-ind` left/right settle on the Month slot; a quick reversal (press Month then Day 0.2 beat later) never puts left < 0 or right > n.
- **input** — props `placeholder: ['string', 'Search']`, `text: ['string', '']`, `typeAt: ['number', -1]` (beat typing starts; -1 = text shown from the start), `perChar: ['number', 0.25]` (beats per character), `icon: ['enum:search|none', 'search']`. Geometry `w = max(560, 140 + textW(max(text,placeholder),30) + 80)` capped 1100, h 112 r28 fill surface. `.in-field` shows placeholder (muted) until the first character, then typed text with a caret `.in-caret` (solid while typing, blinking 1 Hz after: `Math.floor((t - end)/0.5) % 2`). `sfx`: one `sfx/key.wav` per character at `typeAt + k*perChar` (gain 0.5). Clear: a press on `clear` dissolves the text (fade out 0.3 beat) back to the placeholder; the `.in-clear` x icon appears once text exists. Hotspots `field`, `clear`. Test: at `typeAt + 2.5*perChar` exactly 3 characters show; sfx has one entry per character.
- **dropdown** — props `label: ['string', 'Sort by']`, `items: ['string[]', ['Newest','Oldest','Popular']]`, `open: ['boolean', false]`, `selected: ['string', '']`. Geometry closed 420×96 r20; open `h = 96 + items.length*72 + 16` r24 (same width); fill surface. Closed and open are separate rows (the shape morph animates the opening); open rows stagger items in (`fade`, 0.06 beat apart). `.dd-trigger` label + chevron (rotates 180 when open); `.dd-item` rows; press on `item:<x>` highlights it (soft accent) and shows a check. Hotspots `trigger`, `item:<item>`. Test: in an open row, items appear in order (item 0 opacity > item 2 opacity mid-stagger); pressing `item:Oldest` gives that row the highlight class/background.

**Tests:** `tests/components-controls.test.mjs` implements exactly the per-component "Test:" lines above, one `test()` each, using `makeProject` with a states/cursor pair containing the component (and a loop back to the first row), `openScene`, `seek`, and `page.evaluate` reads of the named elements' computed style/attributes.

---

### Task 4: Feedback (5): loader, check, toast, progress, status

**Files:** Create `components/feedback/{loader,check,toast,progress,status}.js`, `tests/components-feedback.test.mjs`.

After this task the template (`button`, `loader`, `check`) renders again: every previously failing template test must pass.

**Component specs:**
- **loader** — props `style: ['enum:spinner|dots', 'spinner']`. Geometry 112×112 r56 fill `ink` ink `surface`. Spinner: `.ld-arc` circle r17 stroke 4 dasharray "70 200", rotation `(t - t0) * 450deg` (row 0 uses t). Dots: three 14px dots, each opacity `0.35 + 0.65 * max(0, sin(2π(t/0.9) - k*0.6))`. Test: rotation at t and t+0.2 s differ by 90°.
- **check** — props `label: ['string', '']`. Geometry: no label 112×112 r56; label → `w = 112 + textW(label,30) + 56` h 112 r56. fill `surface` ink `ink` (tick colour `cssRole(ctx,'pos','ink')`). `.ck-tick` path draws on over 0.8 beat from `t0 + 0.15 beat`; label fades in after the tick. Test: seam — a 4-bar piece `check` → `button` → `check` (last = first) passes `beatStills` seam check (Review Focus 2).
- **toast** — props `text: ['string', 'Saved']`, `icon: ['enum:check|info|none', 'check']`, `action: ['string', '']`. Geometry `w = 64 + (icon!=='none' ? 48+20 : 0) + textW(text,28) + (action ? 40 + textW(action,26) : 0) + 40`, h 88 r44, fill `ink` ink `surface`. Icon in a 48 circle `cssRole(ctx,'pos','accent')`. Content rises 12px as it fades in (`fade`). Hotspots `toast` (centre), `action` (action text centre; null when no action). Test: with `action: 'Undo'` hotspot `action` is right of centre; without action, targeting `action` fails validation... (validation passes pattern; engine throws "did not resolve") — assert createScene error message.
- **progress** — props `value: ['number', 0.62]`, `label: ['string', 'Uploading']`. Geometry 640×120 r28 surface. `.pg-label` small left, `.pg-pct` right (tabular, rounds with the fill), `.pg-bar` 560×12 r6 track `var(--muted)`-mix 30%, fill accent from 0 to value with `prog` (1 beat, zeta 1). Test: at t0+2 beats fill width ≈ value*560 ±2px and `.pg-pct` reads `62%`.
- **status** — props `level: ['enum:ok|warn|error', 'ok']`, `text: ['string', 'Connected']`, `collapsed: ['boolean', false]`. Geometry collapsed 56×56 r28; expanded `w = 56 + 20 + textW(text,26) + 32` h 64 r32; fill surface. Dot colour ok→`cssRole('pos','accent')`, warn→`var(--accent)`, error→`cssRole('neg','ink')`; warn/error dot pulses (scale 1→1.25→1, 1.2 s period, pure). Test: with the house theme (no pos) `level:'ok'` renders with `var(--accent)` and does not throw.

**Tests:** `tests/components-feedback.test.mjs` implements the "Test:" lines, plus: the original `template` preview and camera/purity/press tests in `render.test.mjs` all pass unchanged.

---

### Task 5: Data and content (8): card, counter, line-chart, bar-chart, list, calendar, sparkline, goal

**Files:** Create `components/data/{card,counter,line-chart,bar-chart,list,calendar,sparkline,goal}.js`, `tests/components-data.test.mjs`.

**Component specs:**
- **card** — props `title: ['string', 'Monthly surplus']`, `figure: ['string', '£900']`, `body: ['string', '£540 to goals, £360 spare']`. Geometry `w = max(560, textW(body,26)+96, textW(figure,72,600)+96)` cap 1000, h 96+ (figure?96:0) + (body?44:0) + 48, r32, fill surface. Caption title, figure, body stagger in (`fade`, 0.08 beat apart). Test: title, figure, body reach opacity 1 in that order.
- **counter** — props `from: ['number', 0]`, `to: ['number', 2450]`, `prefix: ['string', '']`, `suffix: ['string', '']`, `decimals: ['number', 0]`, `label: ['string', '']`. Geometry `w = max(360, textW(fmt(max(|from|,|to|)),96,600) + 120)`, h 200 (+40 with label) r40 surface. Value `from + (to-from)*prog(t0+0.1beat, 1.2 beats, zeta 1)`, formatted with `fmt`, `font-variant-numeric: tabular-nums` so width never jitters. Test: final text equals `fmt(to)`; `to < from` counts down; `decimals: 2` shows two decimals.
- **line-chart** — props `points: ['number[]', [4,6,5,8,7,10,9,13]]`, `label: ['string', 'Portfolio value']`, `hover: ['number', -1]`, `format: ['object', { prefix: '£', decimals: 0 }]`. Geometry 900×560 r36 surface. SVG path scaled into an 820×340 plot, drawn on with `stroke-dasharray`/`dashoffset` over 1.5 beats; gridlines (3, `var(--muted)` 20%). Hover: if `hover >= 0` from row start + 1.6 beats, or the cursor targets `point:<i>` (hover appears at that cursor row's time), a dot pops and `.lc-tip` shows the formatted value. Hotspots `point:<i>` (`hotspotExample {'point:<i>':'point:7'}`). Test: path dashoffset goes 1→0; tooltip text for `point:7` is `£13`.
- **bar-chart** — props `bars: ['object[]', [{label:'Mon',value:3},{label:'Tue',value:5},{label:'Wed',value:4},{label:'Thu',value:7}]]`, `label: ['string', 'Sessions']`, `highlight: ['string', '']`. Geometry 900×560 r36. Bars grow from 0 staggered 0.08 beat, zeta 1; highlighted bar accent, others muted-mix. Hotspot `bar:<label>`. Test: bar heights proportional to values at settle; an empty `bars` array renders without throwing (edge case).
- **list** — props `rows: ['object[]', [{title:'Rent',detail:'Tomorrow',value:'£850'},{title:'Holiday fund',detail:'Weekly',value:'£120'},{title:'Coffee',detail:'Today',value:'£3.40'}]]`, `highlight: ['number', -1]`. Geometry 760 × (48 + rows*96) r32 (max 8 rows shown). Rows stagger in; highlight or a press on `row:<i>` gives a soft accent background. Hotspot `row:<i>`. Test: row order of entry; press on `row:1` highlights row 1 only.
- **calendar** — props `week: ['string', '2026-03-23']` (ISO date of a Monday), `marks: ['object[]', [{day:3,label:'Payday'},{day:5,label:'Rent £850'}]]`, `selected: ['number', -1]`, `title: ['string', 'March']`. Geometry 1000×320 r32. Seven day cells with real weekday names and dates computed from `week` in UTC (`new Date(week + 'T00:00:00Z')`, add days); if `week` is not a Monday, render the week containing it starting Monday. Marks as chips; press on `day:<n>` (1–7) selects with the accent border. Hotspot `day:<n>` (`hotspotExample {'day:<n>':'day:3'}`). Test: `week: '2026-03-23'` renders MON 23 … SUN 29; `week: '2026-03-26'` (a Thursday) still renders Mon 23 … Sun 29 (Review Focus 4).
- **sparkline** — props `points: ['number[]', [3,4,3.5,5,4.8,6,7]]`, `label: ['string', 'This week']`, `value: ['string', '+£410']`. Geometry 700×280 r32. Line draws; last point dot pops (`prog` zeta 0.8 scale). Hotspot `last`. Test: last dot scale reaches 1.
- **goal** — props `name: ['string', 'Holiday fund']`, `saved: ['number', 2450]`, `target: ['number', 4000]`, `prefix: ['string', '£']`, `met: ['boolean', false]`. Geometry 760×240 r32. Bar fills to `min(1, saved/target)`; text `£2,450 of £4,000 · 61%`. `met` (or saved ≥ target) → bar colour `cssRole('pos','accent')` and a check chip pops. Hotspot `bar`. Test: percentage text; `met` under the house theme uses the accent fallback without throwing.

**Tests:** `tests/components-data.test.mjs` implements each "Test:" line.

---

### Task 6: App chrome (8): player, island, command, dock, sheet, banner, avatar-stack, chip-row

**Files:** Create `components/chrome/{player,island,command,dock,sheet,banner,avatar-stack,chip-row}.js`, `tests/components-chrome.test.mjs`.

**Component specs:**
- **player** — props `title: ['string', 'Tints']`, `artist: ['string', 'Artist']`, `playing: ['boolean', false]`, `position: ['number', 0.25]`, `duration: ['number', 214]`. Geometry 820×260 r40 surface. Art 180 square r24 `var(--accent)` with the `music` icon; title/artist; `.pl-btn` 72 circle ink with play/pause icons crossfading (scale 0.8↔1) on each press of `play`; progress 560×8 with thumb; when playing, position advances with time (pure: `position + (t - playStart)/duration`); scrubbing = drag on `thumb` exactly like slider. Hotspots `play`, `thumb`. Test: after a press on `play` the pause icon opacity is 1; dragging the thumb moves the elapsed time text.
- **island** — props `text: ['string', 'Now playing']`, `icon: ['enum:music|timer|none', 'music']`. Geometry `w = 88 + 44 + 16 + textW(text,26) + 16 + 48` h 88 r44 fill `ink` ink `surface`. Four waveform bars on the right animate `height = 10 + 18*abs(sin(2π t*f_k))` (pure, per-bar frequency). Hotspot `island`. Test: bar heights change between t and t+0.1 s and are identical at the same t.
- **command** — props `items: ['string[]', ['Export report','Export CSV','Invite teammate','New goal','Settings']]`, `query: ['string', '']`, `typeAt: ['number', -1]`, `perChar: ['number', 0.25]`, `selected: ['number', 0]`. Geometry 900 × (96 + min(5,items)*80 + 24) r32 surface. Search row with `command` icon and `⌘K` hint chip; typed query like `input` (key sfx per char); rows filter live (case-insensitive substring): hidden rows collapse (height springs to 0, zeta 1) and the rest slide up; the selected visible row gets the soft accent background. Press on `row:<i>` (index among *visible* rows at that time) or on `field`. Hotspots `field`, `row:<i>` (`hotspotExample {'row:<i>':'row:0'}`). Test: after typing "exp" only the two Export rows have non-zero height; sfx count equals query length.
- **dock** — props `items: ['string[]', ['Today','Plan','Calendar','Retirement','Settings']]`, `active: ['string', 'Plan']`, `icons: ['string[]', ['home','trend','calendar','wallet','settings']]`. Geometry `w = items*140 + 24` h 140 r44 surface. Icons + labels; travelling pill `.dk-pill` via `edges()` (settle 0.22 s as in the finance app, zeta 1) on presses of `item:<x>`. Test: quick reversal keeps the pill inside the dock and never below 0.75 item wide.
- **sheet** — props `title: ['string', 'Delete goal?']`, `body: ['string', 'This removes Holiday fund and its history.']`, `actions: ['string[]', ['Cancel','Delete']]`, `primary: ['string', 'Delete']`. Geometry 900×(200 + body lines*40 + 120) r40 surface (body wraps at ~40 chars per line, estimate lines = ceil(len/40)). Content rises in; actions as buttons at the bottom right (primary `var(--accent)` fill, others outlined). Hotspot `action:<label>`. Test: primary action has the accent background; hotspot for `action:Delete` is right of `action:Cancel`.
- **banner** — props `app: ['string', 'Personal Finance']`, `title: ['string', 'Payday']`, `body: ['string', '£3,200 landed in Current account']`, `icon: ['enum:bell|wallet|info|sparkle', 'bell']`. Geometry 900×150 r36 surface. Icon in a 64 accent circle; app caption, title, body; content slides down 16px in. Hotspot `banner`. Test: title visible (opacity 1) by t0 + 1 beat.
- **avatar-stack** — props `people: ['string[]', ['JW','AK','MS','LT']]`, `extra: ['number', 3]`. Geometry `w = 40 + people*64 + 56 + (extra?72:0)` h 120 r60 surface. 88 circles overlapping by 24, initials, fills cycling `accent`, `ink`, `muted` (text `surface`), 4px canvas ring; `+3` chip. When the cursor is on `avatar:<i>` (a cursor row targets it), that avatar lifts 10px and the others spread 8px (spring, zeta 1). Hotspot `avatar:<i>`. Test: targeted avatar translateY ≈ -10 at settle.
- **chip-row** — props `chips: ['string[]', ['All','Bills','Savings','Fun']]`, `selected: ['string[]', ['All']]`, `multi: ['boolean', false]`. Geometry `w = sum(textW(chip,26)+56) + gaps(16) + 32` h 104 r52 fill `canvas`-mix? Use fill `surface`. Chips outlined (2px muted) or filled accent when selected; a press on `chip:<label>` selects it (single-select replaces; multi toggles) with a colour spring. Hotspot `chip:<label>`. Test: single-select press moves selection; multi keeps both.

**Tests:** `tests/components-chrome.test.mjs` implements each "Test:" line.

---

### Task 7: The planner — motion-design v2 and check_brief

Use superpowers:writing-skills. The implementer writes the files; the **controller** runs the baseline and GREEN subagent checks (implementers never dispatch subagents).

**Files:**
- Create: `skills/motion-design/references/planner.md`, `skills/motion-video/scripts/check_brief.mjs`, `skills/motion-video/tests/check_brief.test.mjs`
- Modify: `skills/motion-design/SKILL.md` (rewrite as the planner), `skills/motion-design/references/state-plan.md` (brief table format with `use:`/`target:`)

**Interfaces:** `check_brief.mjs PROJECT` → exit 0 (prints warnings), 1 (prints errors), 2 (usage/missing files). Exports `async checkBrief(dir) -> { errors, warnings }`.

- [ ] **Step 1: Failing tests** — `tests/check_brief.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './harness.mjs';
import { checkBrief } from '../scripts/check_brief.mjs';   // async

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check_brief.mjs');
const brief = (tables, sections = true) => `# Motion brief\n\n${sections ? '## Request\nA promo.\n\n## Decisions\n- square\n\n## Moments\n1. Import -> button\n\n' : ''}## Beat table\n\n| # | bar.beat | t | component | what changes | sound |\n|---|---|---|---|---|---|\n\n\`\`\`js\n${tables}\n\`\`\`\n`;
const good = `const states = () => [\n  { at: 0, use: 'button', label: 'Go' },\n  { at: 4, use: 'check' },\n  { at: END - 2, use: 'button', label: 'Go' },\n];\nconst cursor = () => [\n  { at: 0, x: 240, y: 280 },\n  { at: 1.5, target: 'button' },\n  { at: 2, target: 'button', press: true },\n  { at: END - 2, x: 240, y: 280 },\n];`;

test('a good brief passes', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good));
  assert.deepEqual((await checkBrief(dir)).errors, []);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 0);
});

test('bad component and missing sections are errors', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("use: 'check'", "use: 'chek'"), false));
  const r = await checkBrief(dir);
  assert.match(r.errors.join('\n'), /did you mean "check"/);
  assert.match(r.errors.join('\n'), /missing section "## Request"/);
  assert.equal(spawnSync('node', [SCRIPT, dir]).status, 1);
});

test('strict holds apply', async () => {
  const dir = makeProject({ bars: 4 });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), brief(good.replace("{ at: 4, use: 'check' }", "{ at: 1, use: 'check' }")));
  assert.match((await checkBrief(dir)).errors.join('\n'), /holds 1 beat; min_hold_beats is 2/);
});

test('no brief is a usage error', () => {
  assert.equal(spawnSync('node', [SCRIPT, makeProject({ bars: 4 })]).status, 2);
});
```

- [ ] **Step 2: Implement check_brief.mjs**

```js
#!/usr/bin/env node
// check_brief.mjs PROJECT -- validate MOTION-BRIEF.md: required sections, then the beat table's
// states()/cursor() code with the engine's validator in strict mode (holds, budget, quiet beats).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { validate } from '../components/core/validate.js';

const SECTIONS = ['## Request', '## Decisions', '## Moments', '## Beat table'];

export async function loadRegistry(dir) {
  const own = path.join(dir, 'components', 'index.js');
  const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'index.js');
  return (await import(pathToFileURL(existsSync(own) ? own : lib).href)).registry;
}

export async function checkBrief(dir) {
  const errors = [], warnings = [];
  const md = readFileSync(path.join(dir, 'MOTION-BRIEF.md'), 'utf8');
  for (const s of SECTIONS) if (!md.includes(s)) errors.push(`missing section "${s}"`);
  const table = md.slice(md.indexOf('## Beat table'));
  const code = [...table.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  if (!code.trim()) return { errors: [...errors, 'no ```js block with states() and cursor() under "## Beat table"'], warnings };
  const song = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  let states, cursor;
  try {
    const ctx = vm.createContext({ END: song.beats.length });
    ({ states, cursor } = vm.runInContext(`${code}\n;({ states: states(), cursor: cursor() })`, ctx));
  } catch (e) { return { errors: [...errors, `beat table code does not run: ${e.message}`], warnings }; }
  const r = validate({ states, cursor, registry: await loadRegistry(dir), song, strict: true });
  return { errors: [...errors, ...r.errors], warnings: r.warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir || !existsSync(path.join(dir, 'MOTION-BRIEF.md')) || !existsSync(path.join(dir, 'song.json'))) {
    console.error('usage: check_brief.mjs PROJECT (needs PROJECT/MOTION-BRIEF.md and song.json)'); process.exit(2);
  }
  const r = await checkBrief(dir);
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  console.log(r.errors.length ? `brief has ${r.errors.length} error(s)` : 'brief OK');
  process.exit(r.errors.length ? 1 : 0);
}
```

- [ ] **Step 3: planner.md** — the flow, as the checklist later sub-projects extend:

```markdown
# Planner checklist

Sections are extension points: later sub-projects add rows to Questions and Assessments.

## Route (say it out loud)
| Request looks like | Route |
|---|---|
| a looping social promo | full flow below |
| a launch / non-looping video | full flow; intro and end cards are hand-built until sub-project D |
| animation inside a real app | hand to motion-ui |
| re-time or re-render an existing project | motion-video directly |

## Questions (one per message, multiple choice where possible; skip any already answered)
1. Goal and audience.
2. Where it will be posted → size (square 1440, vertical 1080x1920, landscape 1920x1080) and length (bars).
3. Which product → read its stylesheet (extract_theme.py, show the printed roles) and look at its real UI.
4. The song → a file the user has the rights to use (never download music); analyze_song.py; say BPM, confidence, warnings.
5. The 3 to 6 moments to show → propose one component per moment from components/CATALOG.md by its "Use when" line, props filled from the product; name a transitions.dev idea when relevant; user approves or swaps.
Write the understanding back for correction before planning.

## Assessments (before writing the brief)
- doctor.sh passes.
- song.json: min_hold_beats, max_states, loop window and sections, per-beat accent (biggest changes on the strongest beats).
- Theme coverage: which roles came from the product, which defaulted.
- Moments fit the state budget; text legible at the output size (nothing under 22 design px at 1440).

## MOTION-BRIEF.md (write into the project)
Sections, in order: `## Request` (classification), `## Decisions` (platform, size, length, theme, song window, one-line reasons), `## Moments` (moment → component → props), `## Beat table` (readable table: #, bar.beat, t, component, what changes, sound; then ONE ```js block with `const states = () => [...]` and `const cursor = () => [...]`, using `use:` and `target:`).
Then run `node ~/.claude/skills/motion-video/scripts/check_brief.mjs PROJECT` and fix every error before showing it.

## Gate
Show the brief. Build nothing until the user approves or asks for changes. On approval hand to motion-video.
```

- [ ] **Step 4: Rewrite `skills/motion-design/SKILL.md`** as the planner (keep the frontmatter name; broaden the description to "Use when the user wants any motion video of UI... — the planner: routes, asks, assesses, writes MOTION-BRIEF.md, gets approval"). Body: a short overview naming the suite, "Read `references/planner.md` and follow it exactly; each step is a todo", the red-flags table (existing rows plus: "I'll pick components myself without asking" → propose, user decides; "the brief looks fine" → run check_brief.mjs; "skip the questions, the request is clear" → skip only the answered ones and write the understanding back), and credits line (zero @twoclipping; transitions.dev by Jakub Antalik).

- [ ] **Step 5: state-plan.md** — replace the worked example's plan table with the brief's beat-table format and a matching ```js block using `use:`/`target:` rows for the demo-1 sequence at 120 BPM (12 components from the library, every hold >= 2 beats, last row = first at beat 26). The block must pass `validate` (add a test in `check_brief.test.mjs` that extracts it and validates it against a 7-bar 120 BPM song).

- [ ] **Step 6: Run** `npm test` → all pass. Commit.

- [ ] **Step 7 (controller):** baseline (no skill) and GREEN (with skill) subagent runs on: *"I want a 15 second vertical promo for my budgeting app at ~/Documents/AUTOMATION/personal-finance, cut to ~/Music/song.wav. Plan it."* GREEN must: say the route, ask one question at a time, propose components from the catalog for the moments, and describe writing + checking MOTION-BRIEF.md and stopping for approval. Iterate on SKILL.md/planner.md wording until it does.

---

### Task 8: Docs — recipes, authoring guide, motion-video skill, CLAUDE.md, README, credits

**Files:** Create `components/RECIPES.md`, `components/WRITING-A-COMPONENT.md`, `tests/recipes.test.mjs`. Modify `skills/motion-video/SKILL.md`, `CLAUDE.md`, `README.md`, `CREDITS.md`.

- [ ] **Step 1: RECIPES.md** — five complete sequences, each a heading, one-line "use for", and ONE ```js block with `states`/`cursor` for a 7-bar loop at 120 BPM (28 beats): **Onboarding** (button → input typing name → toggle notifications → check → toast), **Checkout** (list cart → button pay → loader → check → toast receipt), **Dashboard tour** (counter → line-chart hover → bar-chart → tabs → card), **AI assistant reply** (input typing a question → loader dots → card answer → chip-row follow-ups → toast), **Settings change** (dock → toggle → dropdown → status → banner). Every block must validate strictly.

- [ ] **Step 2: recipes.test.mjs** — extract every ```js block from RECIPES.md, run `validate(..., strict: true)` against a synthetic 7-bar 120 BPM song (`min_hold_beats: 2, max_states: 14`), assert no errors; then render one recipe's first bar with `render(dir, { preview: true, from: 0, to: 2 })` via `makeProject` to prove it runs in the browser.

- [ ] **Step 3: WRITING-A-COMPONENT.md** — the contract (copy from Task 1 Interfaces), a copyable template file (button.js as the model, annotated), the checklist (pure render, theme roles and fallbacks, design px, type scale, one stroke weight, meta complete with example/edgeCases/hotspotExample, stable class names), then "run `node scripts/build_catalog.mjs && node scripts/gallery.mjs '' --stills`, look at your thumbnail, `npm test`".

- [ ] **Step 4: motion-video SKILL.md** — "Build loop" step 2 becomes: copy the approved brief's `states`/`cursor` block into `index.html`; library components via `use:` and `target:` (catalog first: `components/CATALOG.md`); custom rows only for things the library lacks. Add "Components" to the command table (`build_catalog.mjs`, `gallery.mjs`, `check_brief.mjs`).

- [ ] **Step 5: CLAUDE.md / README / CREDITS** — CLAUDE.md: new "Components" section (where they live, the contract in brief, the docs, how the planner uses them), code map entries, and the planner as the entry point in "How a video gets made". README: a short "Components" section with a link to CATALOG.md and one example. CREDITS: no new outside sources unless introduced; note that component names mirror common UI patterns (and transitions.dev's catalog names) for discoverability but are original implementations.

- [ ] **Step 6:** `npm test` green; commit.

---

### Task 9: Proof — demos/04-library-reference, planned through the planner

- [ ] **Step 1:** Using the installed skills exactly as a user would, run the planner for demo 1's brief (same song, `--start-bar 21`, 7 bars, square, house theme), answering its questions with demo 1's choices. It writes `demos/04-library-reference/MOTION-BRIEF.md`; `check_brief.mjs` passes. **Controller shows the brief to Jack and waits for approval.**
- [ ] **Step 2:** Build with motion-video: copy the tables into `index.html`, beat stills (Read the contact sheet), preview, final render. Seam OK.
- [ ] **Step 3:** README for demo 04 with the comparison: project-specific lines of code in `demos/04-library-reference/index.html` tables vs `demos/01-reference/index.html` (count non-blank lines between the table markers vs the whole custom script), and wall-clock build time noted by the implementer. Commit (not `out/` or `clip.wav`).

---

### Task 10: Wiki — Components section and gallery video

Work in `~/Documents/AUTOMATION/Wiki`, following its CLAUDE.md/CONTRIBUTING.md. No dashes in copy; do not change reviewed dates.

- [ ] **Step 1:** Render a gallery video: `node scripts/gallery.mjs /tmp/gallery-proj && node scripts/render.mjs /tmp/gallery-proj --preview` (half size is enough), web copy under 10 MB (`ffmpeg ... -crf 26`), poster frame; put both in `assets/media/motion-kit/`.
- [ ] **Step 2:** In `claude/motion-kit.html` add a phase "Components" after "Pipeline": what they are, the `use:`/`target:` example, the planner flow in five lines, the gallery video, and links to `CATALOG.md`, `RECIPES.md` and `WRITING-A-COMPONENT.md` on GitHub `main`. Put tables outside collapsible step bodies or keep the new CSS rule in mind (it already handles tables inside steps).
- [ ] **Step 3:** `python3 scripts/build_index.py`, `sync_source_blocks.py --check`, dash grep, serve and screenshot at 1280 and 390 wide (Read them). Commit locally; the controller asks Jack before pushing either repo.

---

### Task 11: Wrap-up

- [ ] `npm test` green on `library`; `build_catalog.mjs --check` passes; `doctor.sh` ok.
- [ ] Update memory (motion-kit.md): sub-project A done, what's next (B).
- [ ] Report to Jack: component count, planner behaviour (GREEN result), demo 04 comparison numbers, the wiki page, and ask about merging `library` into `main` and pushing both repos.
