# Hardening F2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** check_brief catches what would look or be wrong before a brief is approved (frame check in the browser plus new table checks), six component edge cases are fixed, and the tooling and F1 leftovers are cleared.

**Architecture:** A new `scripts/framecheck.mjs` owns the page sampler (moved out of `safezones.mjs`) and measures the cursor against the stage edges and text against its shape at every half beat; safe zones become one consumer of the same samples, and check_brief always runs it once the tables validate. Table-level checks go in `components/core/validate.js`, driven by two new optional component meta keys (`typing`, `unique`). Component fixes stay inside each component file.

**Tech Stack:** Node 22+ ES modules (node:test), Playwright Chromium (existing), Python 3 + numpy (unittest), ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-03-hardening-f2-design.md`

All paths are relative to `~/motion-kit`; `MV=skills/motion-video`. Work on branch `hardening-f2` (`git switch -c hardening-f2` from `main` before Task 1).

## Global Constraints

- New checks: an **error** when the output would be wrong, a **warning** when it would look wrong (spec Purpose).
- check_brief output shape unchanged: `warning:` / `error:` lines; exit 1 only on errors, 2 on bad usage.
- Measurement failures never error: one warning `the frame check did not run: <first line of the error>`.
- Scripts fail with `error: ...` and exit 2 on bad input, never a traceback.
- No new dependencies. Match surrounding comment density and idiom (short comments that say why).
- `seek(t)` stays pure: every component change computes from `t` alone (contract test enforces).
- After changing any component's `meta`, run `node $MV/scripts/build_catalog.mjs` (npm test fails when CATALOG.md/index.js are stale).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run shell snippets with **bash** (`bash -c '...'` or a bash script), `export PATH=/opt/homebrew/bin:$PATH`. Full suite: `npm test` from the repo root.

## Review Focus

1. Deliberate overhangs (a line-chart tooltip above its point, a badge, a focus ring) must not be reported as text overflow — Task 3 audits the gallery and recipes and marks them with `data-overhang`; its test pins one marked element.
2. A cursor resting deliberately just off-stage at the loop start (some demos hide it) must not warn while hidden — Task 1 pins "hidden cursor ignored".
3. A brief with no Exports line must still get the frame check, and one with Exports must not open the page twice for the same stage — Task 2 pins both with a counting stub.
4. Typing that ends exactly at the next row's beat is an error (the last character never shows), while ending a hair before is fine — Task 4 pins both boundaries.
5. A command/input continuation that extends the previous text only types the new characters — the overrun check must count only those (Task 4 pins it), or valid briefs get false errors.

---

### Task 1: `framecheck.mjs`: shared sampler, cursor edges, text overflow

**Files:**
- Create: `$MV/scripts/framecheck.mjs`
- Create: `$MV/tests/framecheck.test.mjs`
- Modify: `$MV/scripts/safezones.mjs` (move `measure` and the sampling loop out; `checkSafeZones` keeps its signature and output)

**Interfaces:**
- Produces (from `framecheck.mjs`):
  - `sampleTimes(song, samples = 'half') -> [{ beat, t }]` (beats and half beats within `song.loop.duration_sec`).
  - `measure(t)` (page function): `{ stage: { W, H }, shape: box|null, cursor: box|null, texts: [{ text, over, clip }] }`; boxes in stage px `{ left, top, right, bottom }`; `over` = px past `#shape`'s box (max over the four edges, 0 if inside), `clip` = px clipped inside its own box (`scrollWidth - clientWidth`, in stage px).
  - `checkFrames(dir, { tables, loop, presets = [], frame = true, samples = 'half' }) -> { issues, notes }` where each issue is one of
    `{ kind: 'cursor', beat, through, t, edge, px }`, `{ kind: 'text', beat, through, t, text, px, how: 'past'|'clipped' }`, `{ kind: 'zone', preset, beat, through, t, part, edge, px }` (zone issues exactly as `checkSafeZones` returns them today, plus `kind`).
  - `frameIssueText(issue) -> string` for `cursor` and `text` issues.
- `safezones.mjs` `checkSafeZones(dir, opts)` returns `{ issues, notes }` exactly as today (zone issues without `kind`), implemented as `checkFrames(dir, { ...opts, frame: false })`.

- [ ] **Step 1: Write the failing tests** — `$MV/tests/framecheck.test.mjs`:

```js
// framecheck.test.mjs -- the frame check: cursor past the stage edges, text past or clipped in its shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from './harness.mjs';
import { checkFrames, frameIssueText, sampleTimes } from '../scripts/framecheck.mjs';

const REST = "{ at: 0, use: 'button' }", BACK = "{ at: END - 2, use: 'button' }";
const run = (states, cursor) => checkFrames(makeProject({ bars: 2, states, cursor }), {});
const kinds = (r, k) => r.issues.filter((i) => i.kind === k);

test('sampleTimes: every beat and half beat inside the loop', () => {
  const song = { beats: [0, 1, 2, 3].map((i) => ({ i, t: i * 0.5, cue_t: i * 0.5 })), beat_sec: 0.5, loop: { duration_sec: 2 } };
  assert.deepEqual(sampleTimes(song).map((s) => s.beat), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(sampleTimes(song, 'beats').map((s) => s.beat), [0, 1, 2, 3]);
});

test('a plain brief has no frame issues', async () => {
  const r = await run(`[${REST}, ${BACK}]`, '[{ at: 0, x: 300, y: 320 }, { at: END - 2, x: 300, y: 320 }]');
  assert.deepEqual(r.issues, []);
});

test('the cursor past the right edge is one grouped issue', async () => {
  const r = await run(`[${REST}, ${BACK}]`, '[{ at: 0, x: 300, y: 320 }, { at: 2, x: 2000, y: 320 }, { at: 4, x: 300, y: 320 }, { at: END - 2, x: 300, y: 320 }]');
  const c = kinds(r, 'cursor');
  assert.equal(c.length, 1, JSON.stringify(r.issues));
  assert.equal(c[0].edge, 'right');
  assert.ok(c[0].px > 0 && c[0].through > c[0].beat);
  assert.match(frameIssueText(c[0]), /^beats? [\d.]+(-[\d.]+)?: the cursor goes \d+ px past the right edge$/);
});

test('a hidden cursor off-stage is not reported', async () => {
  const r = await run(`[${REST}, ${BACK}]`, '[{ at: 0, x: 300, y: 320 }, { at: 1, x: 3000, y: 320, hide: true }, { at: 4, x: 300, y: 320 }, { at: END - 2, x: 300, y: 320 }]');
  assert.deepEqual(kinds(r, 'cursor'), []);
});

test('a button label too long for its shape is reported with the text cut to 24 characters', async () => {
  const long = 'A very long label that goes on and on well past any reasonable width for a button';
  const r = await run(`[${REST}, { at: 2, use: 'button', label: '${long}' }, ${BACK}]`, '[{ at: 0, x: 300, y: 320 }, { at: END - 2, x: 300, y: 320 }]');
  const t = kinds(r, 'text');
  assert.ok(t.length >= 1, JSON.stringify(r.issues));
  assert.equal(t[0].text, `${long.slice(0, 24)}…`);
  assert.match(frameIssueText(t[0]), /^beats? [\d.]+(-[\d.]+)?: text "A very long label that g…" (runs \d+ px past its shape|is cut off by \d+ px)$/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test $MV/tests/framecheck.test.mjs` → FAIL (`Cannot find module .../framecheck.mjs`).

- [ ] **Step 3: Write `framecheck.mjs`**

Move `measure` and the per-stage sampling loop from `safezones.mjs` here and extend `measure`:

```js
#!/usr/bin/env node
// framecheck.mjs -- what a viewer would see as broken, measured in the real page at every beat and half beat:
// the cursor past a stage edge, text past (or clipped inside) its shape, and, for presets with safe zones, the
// shape or cursor inside a destination's UI zones (safezones.mjs's check, sharing these samples).
// Library only: check_brief.mjs runs it; safezones.mjs keeps the zone check's own CLI.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beatTime, openProject, UsageError } from './render.mjs';
import { loadPresets, resolvePresets, designStage, presetStage, scaledMargins } from './safezones.mjs';

const EDGES = ['top', 'bottom', 'left', 'right'];

export function sampleTimes(song, samples = 'half') {
  const D = song.loop?.duration_sec ?? Infinity, out = [];
  for (let b = 0; b < song.beats.length; b++) for (const beat of samples === 'half' ? [b, b + 0.5] : [b]) {
    const t = beatTime(song, beat);
    if (t <= D + 1e-9) out.push({ beat, t });
  }
  return out;
}
```

`measure(t)` = today's safezones `measure` (shape box, cursor box with the arrow, hidden cursor → null) plus:

```js
  // Text: every element in #shape with its own text. Skipped when (nearly) invisible: its opacity times every
  // ancestor's up to #shape under 0.05 (a crossfade), zero size, or marked data-overhang (a deliberate overhang,
  // e.g. a tooltip above its point). px are stage px: CSS px times the element's on-screen scale.
  const texts = [];
  const sb = shape?.getBoundingClientRect();
  if (sb && sb.width > 0) for (const e of shape.querySelectorAll('*')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (e.closest('[data-overhang]')) continue;
    let o = 1;
    for (let a = e; a && a !== shape.parentElement; a = a.parentElement) o *= Number(getComputedStyle(a).opacity);
    const r = e.getBoundingClientRect();
    if (o < 0.05 || r.width === 0 || r.height === 0) continue;
    const scale = e.offsetWidth ? r.width / e.offsetWidth : 1;
    const over = Math.max(0, sb.left - r.left, r.right - sb.right, sb.top - r.top, r.bottom - sb.bottom);
    const clip = Math.max(0, (e.scrollWidth - e.clientWidth) * scale);
    if (over >= 1 || clip >= 1) texts.push({ text: e.textContent.trim(), over: Math.round(over), clip: Math.round(clip) });
  }
```

and returns `{ stage: { W: st.width, H: st.height }, shape: box, cursor, texts }` (`st` = `#stage`'s rect).

`checkFrames`:
- Validate `dir` (song.json present, beats list) as `checkSafeZones` does today (same UsageError messages).
- Stage groups: when `frame` is true, the design stage (`designStage(root)`) with `{ frame: true, zones: [] }`; for each preset in `resolvePresets(P, presets)` (only when `presets.length`) with non-null `scaledMargins`, add `{ name, m }` to the group of its `presetStage` (creating it with `frame: false` if new). One `openProject(root, { workers: 1, stage, tables, loop })` per group; the `tables` note as today (`"index.html has no table markers, so the frame check used index.html's own tables, not the brief's"`; keep the old safe-zone wording when `frame` is false so `checkSafeZones` output is unchanged).
- For each sample: `got = await page.evaluate(measure, t)`; page errors throw as today. When the group has `frame`:
  - cursor: for each edge, `px = { left: -c.left, top: -c.top, right: c.right - W, bottom: c.bottom - H }[edge]`; `px >= 1` is an intrusion keyed `cursor/${edge}`.
  - text: each entry keyed `text/${text}` with `px = Math.max(over, clip)`, `how = over >= clip ? 'past' : 'clipped'`; `text` in the issue is cut to 24 characters plus `…` when longer.
  - zones: unchanged logic, keyed `${preset}/${part}/${edge}`, `kind: 'zone'`.
- Grouping of consecutive samples (`last === i - 1` extends `through` and keeps the max `px`) exactly as today, for all three kinds. Sort: zone issues as today, then cursor, then text, each by beat.

`frameIssueText(i)`:

```js
const beats = (i) => (i.through > i.beat ? `beats ${i.beat}-${i.through}` : `beat ${i.beat}`);
export function frameIssueText(i) {
  if (i.kind === 'cursor') return `${beats(i)}: the cursor goes ${i.px} px past the ${i.edge} edge`;
  return `${beats(i)}: text "${i.text}" ${i.how === 'past' ? `runs ${i.px} px past its shape` : `is cut off by ${i.px} px`}`;
}
```

In `safezones.mjs`: delete the moved code; `checkSafeZones = async (dir, opts = {}) => { const r = await checkFrames(dir, { ...opts, frame: false }); return { issues: r.issues.map(({ kind, ...i }) => i), notes: r.notes }; }` (import `checkFrames` from `./framecheck.mjs`; the circular import is safe because neither module calls the other at load time). Keep its option validation (`samples` must be `beats` or `half`) in `checkFrames`.

- [ ] **Step 4: Run the tests**

Run: `node --test $MV/tests/framecheck.test.mjs $MV/tests/safezones.test.mjs` → PASS (safezones tests unchanged and green proves the refactor kept its output).

- [ ] **Step 5: Commit**

```bash
git add $MV/scripts/framecheck.mjs $MV/scripts/safezones.mjs $MV/tests/framecheck.test.mjs
git commit -m "framecheck: one page sampler for the cursor past the stage, text past its shape, and safe zones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: check_brief always runs the frame check; theme.json must be an object

**Files:**
- Modify: `$MV/scripts/check_brief.mjs` (the safe-zone block at the end of `checkBrief`; `projectTheme`)
- Modify: `$MV/tests/check_brief.test.mjs`
- Modify: `CLAUDE.md` (step 5 of "How a video gets made"), `$MV/SKILL.md` (check_brief description), `skills/motion-design/references/planner.md` (where check_brief is run)

**Interfaces:**
- Consumes: `checkFrames`, `frameIssueText` (Task 1); `issueText` from safezones.mjs for zone issues.
- Produces: `checkBrief(dir, { loop, frameCheck })` — `opts.frameCheck` replaces `opts.safeZones` (same calling convention: `(dir, { presets, samples, tables, loop }) -> { issues, notes }`, issues carrying `kind`).

- [ ] **Step 1: Write the failing tests** — in `check_brief.test.mjs`:
  - Add near the top: `const noFrames = async () => ({ issues: [], notes: [] });` and make every existing `checkBrief(dir)` / `checkBrief(dir, {...})` call that is not about the frame check pass `frameCheck: noFrames` (or its existing stub renamed from `safeZones` to `frameCheck`, with stub issues given `kind: 'zone'`). Use a small wrapper `const check = (dir, o = {}) => checkBrief(dir, { frameCheck: noFrames, ...o });` and replace calls with it.
  - New tests:

```js
test('the frame check runs without an Exports line, once, and its issues are warnings', async () => {
  const dir = briefProject();            // the file's existing helper for a valid brief without Exports
  let calls = 0, seen;
  const fc = async (d, o) => { calls++; seen = o; return { issues: [{ kind: 'cursor', beat: 2, through: 3, t: 1, edge: 'right', px: 40 }], notes: [] }; };
  const r = await checkBrief(dir, { frameCheck: fc });
  assert.equal(calls, 1);
  assert.deepEqual(seen.presets, []);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.includes('beats 2-3: the cursor goes 40 px past the right edge'), r.warnings.join('\n'));
});

test('with Exports the zones ride the same frame check (one call, presets passed)', async () => {
  const dir = briefProject({ exports: 'reels, x' });   // adapt to the file's helper for an Exports line
  let calls = 0, seen;
  const fc = async (d, o) => { calls++; seen = o; return { issues: [], notes: [] }; };
  await checkBrief(dir, { frameCheck: fc });
  assert.equal(calls, 1);
  assert.deepEqual(seen.presets, ['reels', 'x']);
});

test('a frame check that throws is one warning, never an error', async () => {
  const r = await checkBrief(briefProject(), { frameCheck: async () => { throw new Error('no chromium\nstack'); } });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.includes('the frame check did not run: no chromium'), r.warnings.join('\n'));
});

test('theme.json must be an object', async () => {
  const dir = briefProject();
  writeFileSync(path.join(dir, 'theme.json'), 'null');
  assert.match((await check(dir)).errors.join('\n'), /theme\.json should be an object of colour roles, got null/);
});

test('end to end: a cursor off the right edge and a long button label are reported', async () => {
  // real browser: no frameCheck stub
  const dir = briefProject({ states: "[{ at: 0, use: 'button' }, { at: 2, use: 'button', label: 'A very long label that goes on and on well past any reasonable width for a button' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 300, y: 320 }, { at: 2, x: 2000, y: 320 }, { at: 4, x: 300, y: 320 }, { at: END - 2, x: 300, y: 320 }]' });
  const r = await checkBrief(dir);
  assert.ok(r.warnings.some((w) => /the cursor goes \d+ px past the right edge/.test(w)), r.warnings.join('\n'));
  assert.ok(r.warnings.some((w) => /text "A very long label that g…"/.test(w)), r.warnings.join('\n'));
});
```

(`briefProject` stands for whatever helper the file already uses to write a MOTION-BRIEF.md with given tables into a scaffolded project; extend it with `exports`, `states`, `cursor` options if it lacks them. Read the file first.)

- [ ] **Step 2: Run them to verify they fail** — `node --test $MV/tests/check_brief.test.mjs` → the new tests FAIL.

- [ ] **Step 3: Implement**

`projectTheme`:

```js
export function projectTheme(dir) {
  if (!existsSync(path.join(dir, 'theme.json'))) return HOUSE;
  const t = readJson(dir, 'theme.json');
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new ThemeError(`theme.json should be an object of colour roles, got ${JSON.stringify(t)}`);
  return t;
}
```

with `class ThemeError extends Error {}` local to check_brief; in `checkBrief`, `let theme; try { theme = projectTheme(dir); } catch (e) { if (!(e instanceof ThemeError)) throw e; return { errors: [...errors, e.message], warnings }; }`.

Replace the end of `checkBrief` (from `// No Exports line: nothing more, and no browser.`) with:

```js
  // With errors the page (running the same tables) would only fail on what they already say.
  if (errors.length) return { errors, warnings };
  // The frame check always runs (cursor past the stage, text past its shape); presets with safe zones ride the
  // same samples. A measurement that cannot run is a warning: the tables themselves are fine.
  try {
    const fc = opts.frameCheck ?? (await import('./framecheck.mjs')).checkFrames;
    const { issues, notes = [] } = await fc(dir, { presets: names ?? [], samples: 'half', tables: code, loop });
    const { frameIssueText } = await import('./framecheck.mjs');
    sz ??= await import('./safezones.mjs');
    warnings.push(...notes, ...issues.map((i) => (i.kind === 'zone' ? sz.issueText(i, P) : frameIssueText(i))));
  } catch (e) { warnings.push(`the frame check did not run: ${e.message.split('\n')[0]}`); }
  return { errors, warnings };
```

(`P` is null when there is no Exports line; zone issues only occur with presets, so `issueText` always has it. Keep the existing early-return when an Exports line names unknown presets: `names` stays null and the frame check then runs without zones.) Update the comment above the Exports block: safezones.mjs is loaded for presets; Playwright is now always loaded once the tables validate.

- [ ] **Step 4: Docs**
  - CLAUDE.md step 5: `node $S/check_brief.mjs DIR -> strict validation of the tables, then a frame check in Chromium (cursor past the stage edges, text past or cut off in its shape, and the safe zones when there is an Exports line); fix every error, resolve every warning`.
  - SKILL.md: the same, where check_brief is described.
  - planner.md: one line where check_brief runs: `check_brief now always opens Chromium for the frame check (a few seconds).`

- [ ] **Step 5: Run** `node --test $MV/tests/check_brief.test.mjs $MV/tests/recipes.test.mjs` → PASS; then full `npm test`.

- [ ] **Step 6: Commit** — `check_brief: always run the frame check (cursor past the stage, text past its shape); theme.json must be an object` + trailer.

---

### Task 3: Frame-check audit: no false warnings on the gallery, recipes and demo 04

**Files:**
- Modify: component files that draw deliberate overhangs (add `data-overhang` to the overhanging element), found by the audit below
- Create: `$MV/tests/framecheck-audit.test.mjs`

**Interfaces:**
- Consumes: `checkFrames`, `frameIssueText` (Task 1); `gallery({ root })` from `scripts/gallery.mjs`; `tempDir` from `tests/tmp.mjs`; recipes in `components/RECIPES.md` (the recipes test shows how they are extracted and scaffolded).
- Produces: the `data-overhang` attribute convention (documented in `components/WRITING-A-COMPONENT.md`: "an element meant to sit outside the shape, like a tooltip above its point, carries `data-overhang` so the frame check does not report it").

- [ ] **Step 1: Run the audit** (a scratch script, not committed): `checkFrames` on the gallery project (`gallery({ root: tempDir('mk-audit-') })`), on a scaffolded project per recipe (as `recipes.test.mjs` builds them), and on `demos/04-library-reference` (read-only: it is served, not modified). Print `frameIssueText` for every issue.
- [ ] **Step 2: Classify each issue** in the task report: (a) a deliberate overhang (the design puts it outside the shape: tooltips, badges, focus rings) → add `data-overhang` on that element in the component's `mount`; (b) a gallery **edge case** that exists to show long text (e.g. `edgeCases` with "A very long ...") → expected, leave it; (c) a real problem in a recipe or demo 04 → do NOT fix the recipe/demo; list it in the report for the controller (Jack decides).
- [ ] **Step 3: Write the test** pinning the result:

```js
// framecheck-audit.test.mjs -- the frame check reports nothing on the five recipes (deliberate overhangs carry data-overhang).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFrames, frameIssueText } from '../scripts/framecheck.mjs';
import { makeProject } from './harness.mjs';
// reuse the recipes test's extraction + scaffolding helpers (import or copy the minimal part)

test('recipes: no frame issues', async () => {
  for (const { name, dir } of await recipeProjects()) {
    const r = await checkFrames(dir, {});
    assert.deepEqual(r.issues.map(frameIssueText), [], name);
  }
});

test('an element marked data-overhang is not reported', async () => {
  // One row showing an element Step 2 marked (example for the line-chart tooltip over its highest point; use the
  // element actually marked): no text issue mentions its text.
  const dir = makeProject({ bars: 2, states: "[{ at: 0, use: 'button' }, { at: 2, use: 'line-chart', hover: 7 }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 300, y: 320 }, { at: END - 2, x: 300, y: 320 }]' });
  const r = await checkFrames(dir, {});
  assert.deepEqual(r.issues.filter((i) => i.kind === 'text' && i.text === '13'), []);
});
// If Step 2 marked no element at all, delete this second test and say so in the report.
```

If step 2 found real recipe problems (class c), the first test lists those recipes in an `expectedIssues` map with the exact texts and a comment pointing at the report, so the test still pins everything else; the controller raises them with Jack.

- [ ] **Step 4: Run** `node --test $MV/tests/framecheck-audit.test.mjs $MV/tests/framecheck.test.mjs`; `node $MV/scripts/build_catalog.mjs` if any meta changed; full `npm test`.
- [ ] **Step 5: Commit** — `framecheck: deliberate overhangs carry data-overhang; recipes check clean` + trailer.

---

### Task 4: Table checks: typing overrun, custom-state drags, rushed clicks, duplicate keys

**Files:**
- Modify: `$MV/components/core/validate.js`
- Modify: `$MV/components/controls/input.js` (`meta.typing: 'text'`), `$MV/components/chrome/command.js` (`meta.typing: 'query'`)
- Modify: `$MV/components/data/bar-chart.js`, `controls/tabs.js`, `controls/dropdown.js`, `chrome/chip-row.js`, `chrome/dock.js`, `chrome/sheet.js` (`meta.unique`)
- Modify: `$MV/components/WRITING-A-COMPONENT.md` (document `typing` and `unique`), `$MV/tests/contract.test.mjs` (meta shape check for the two keys, if the contract test validates meta keys)
- Test: `$MV/tests/validate.test.mjs`

**Interfaces:**
- `meta.typing: '<prop>'` — the string prop typed in from `typeAt` (beats after the row starts; `< 0` shows at once) at `perChar` beats per character.
- `meta.unique: { '<listProp>': true | '<field>' }` — entries of that list prop (or that field of each object entry) must be unique; its hotspot family (the one in `meta.hotspots` whose `<...>` resolves against that list) can only reach the first of duplicates.

- [ ] **Step 1: Write the failing tests** — add to `validate.test.mjs` registry:

```js
  input: { ...fake('input', { text: ['string', ''], typeAt: ['number', -1], perChar: ['number', 0.25] }, ['field']), meta: { name: 'input', props: { text: ['string', ''], typeAt: ['number', -1], perChar: ['number', 0.25] }, hotspots: ['field'], typing: 'text' } },
  chart: { ...fake('chart', { bars: ['object[]', [{ label: 'Mon', value: 1 }]] }, ['bar:<label>'], undefined,
    (h, p) => (h.startsWith('bar:') && p.bars.some((b) => b.label === h.slice(4)) ? { x: 0, y: 0 } : null)), meta: { name: 'chart', props: { bars: ['object[]', [{ label: 'Mon', value: 1 }]] }, hotspots: ['bar:<label>'], unique: { bars: 'label' } } },
```

and tests:

```js
test('typing that reaches the next row is an error; ending before it is fine', () => {
  // 9 characters from beat 2 + 0.25, 0.25 beat apart: the last lands at 2.25 + 8 * 0.25 = 4.25
  const rows = (next) => loopOk([{ at: 0, use: 'button' }, { at: 2, use: 'input', text: 'Groceries', typeAt: 0.25, perChar: 0.25 }, { at: next, use: 'button' }]);
  assert.match(run(rows(4.25)).errors.join('\n'), /input at beat 2 types "Groceries" until beat 4\.25 but the next row starts at beat 4\.25; end typing before beat 4\.25 \(typeAt or perChar\)/);
  assert.deepEqual(run(rows(4.5)).errors, []);
});

test('a continuation that extends the text only types the new characters', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 2, use: 'input', text: 'Gro', typeAt: 0.25, perChar: 0.25 },
    { at: 4, use: 'input', text: 'Groceries', typeAt: 0.25, perChar: 0.25 }, { at: 6, use: 'button' }]);
  // 6 new characters from 4.25: the last at 5.5, before 6
  assert.deepEqual(run(states).errors, []);
});

test('typeAt -1 shows the text at once: no overrun', () => {
  assert.deepEqual(run(loopOk([{ at: 0, use: 'button' }, { at: 2, use: 'input', text: 'A long text', typeAt: -1 }, { at: 4, use: 'button' }])).errors, []);
});

test('a drag on a custom state that never moves warns', () => {
  const states = loopOk([{ at: 0, name: 'a', w: 100, h: 100, r: 10 }, { at: 4, name: 'b', w: 100, h: 100, r: 10 }]);
  const cursor = [{ at: 0, x: 0, y: 0 }, { at: 1, x: 10, y: 10, press: 'down' }, { at: 2, x: 10, y: 10, press: 'up' }, { at: 14, x: 0, y: 0 }];
  assert.match(run(states, cursor).warnings.join('\n'), /drag from beat 1 to 2 never moves/);
});

test('strict: a click with under half a beat to arrive warns', () => {
  const states = loopOk([{ at: 0, use: 'button' }, { at: 4, use: 'button', label: 'Next' }]);
  const cursor = [{ at: 0, x: 0, y: 0 }, { at: 2, target: 'button' }, { at: 2.25, target: 'button', press: true }, { at: 14, x: 0, y: 0 }];
  // the move starts at the row before the press that changes position: beat 2; the press is 0.25 later
  assert.match(run(states, cursor, { strict: true }).warnings.join('\n'), /cursor\(\) row 3: the cursor has only 0\.25 beat to reach 'button' before the click; give it about 0\.8 beat/);
  assert.doesNotMatch(run(states, cursor).warnings.join('\n'), /before the click/);
});

test('duplicate keyed entries warn; aiming at one is an error', () => {
  const bars = [{ label: 'Mon', value: 1 }, { label: 'Mon', value: 2 }];
  const states = loopOk([{ at: 0, use: 'button' }, { at: 2, use: 'chart', bars }, { at: 4, use: 'button' }]);
  assert.match(run(states).warnings.join('\n'), /chart at beat 2 has duplicate bars labels \("Mon"\); the cursor and hover can only reach the first/);
  const aim = [{ at: 0, x: 0, y: 0 }, { at: 3, target: 'bar:Mon' }, { at: 14, x: 0, y: 0 }];
  assert.match(run(states, aim).errors.join('\n'), /cursor target "bar:Mon" at beat 3 names a duplicate label of chart; it reaches the first "Mon" only/);
});
```

(Adjust `loopOk` usage/`at` values to the file's song: 16 beats, min hold 2. If the existing click "rushed" rule fires for the drag test or vice versa, keep each test's cursor timing generous except where it is under test.)

- [ ] **Step 2: Run** `node --test $MV/tests/validate.test.mjs` → the new tests FAIL.

- [ ] **Step 3: Implement in `validate.js`**

Typing (inside `states.forEach`, after `r.props` is set, `!r.bad`):

```js
      // Typing that has not finished when the next row starts: that row continues from text never fully shown.
      const tk = comp.meta.typing;
      if (tk && !r.bad && r.props.typeAt >= 0) {
        const text = String(r.props[tk] ?? ''), prev = rows[i - 1];
        const before = prev?.comp === comp && prev.props ? String(prev.props[tk] ?? '') : '';
        const n = text.length - (before && text.startsWith(before) ? before.length : 0);
        const next = states[i + 1]?.at ?? END;
        const last = num(row.at + r.props.typeAt + (n - 1) * r.props.perChar);
        if (n > 0 && next != null && last >= next)
          errors.push(`${row.use} at beat ${B(row)} types "${text}" until beat ${last} but the next row starts at beat ${B({ at: next })}; end typing before beat ${B({ at: next })} (typeAt or perChar)`);
      }
```

(`num` and `B` are the file's existing number/beat formatters; use whichever the file defines for "4.25".)

Duplicates (same place):

```js
      for (const [listKey, field] of Object.entries(comp.meta.unique ?? {})) {
        const list = r.props[listKey];
        if (!Array.isArray(list)) continue;
        const keys = list.map((x) => (field === true ? x : x?.[field])).filter((k) => typeof k === 'string');
        const dup = [...new Set(keys.filter((k, j) => keys.indexOf(k) !== j))];
        if (dup.length) { r.dups = dup; warnings.push(`${row.use} at beat ${B(row)} has duplicate ${listKey}${field === true ? '' : ` ${field}s`} (${dup.map((d) => `"${d}"`).join(', ')}); the cursor and hover can only reach the first`); }
      }
```

In the cursor loop, after resolving a target's row (`targetRow(rows, c)`), if that row has `dups` and the target is `<family>:<d>` for a `d` in `dups`: `errors.push(\`cursor target "${c.target}" at beat ${B(c)} names a duplicate label of ${r.row.use}; it reaches the first "${d}" only\`)`.

Custom drags: change `isDrag` (exported; used by the engine too — check `engine.js` callers still behave: a custom-state press is now a drag for the move/never-moves rules only):

```js
// A press aimed at one of its row's drag hotspots (meta.drag), or any 'down' on a custom state (no component):
// with 'down', a drag, not a press-and-hold.
export function isDrag(rows, c) {
  const r = c.target ? targetRow(rows, c) : null;
  if (r) return matchHotspot(r.comp.meta.drag ?? [], c.target);
  return !c.target && !pressRow(rows, c)?.comp;
}
```

If `engine.js` uses `isDrag` for anything that changes rendering (e.g. drag landing speed-up), keep that behaviour unchanged for custom rows by giving the engine its own call to the old predicate (`isHotspotDrag`), and say so in the report.

Rushed clicks (where `press === true` is handled, strict only):

```js
      if (strict && c.press === true) {
        const g = rushed(i);
        if (g !== null) warnings.push(`cursor() row ${i + 1}: the cursor has only ${g} beat to reach '${c.target ?? `${c.x}, ${c.y}`}' before the click; give it about 0.8 beat`);
      }
```

Add `typing: 'text'` to input's meta, `typing: 'query'` to command's; `unique` to: bar-chart `{ bars: 'label' }`, tabs `{ items: true }`, dropdown `{ items: true }`, and to chip-row, dock and sheet on the list prop their `<label>` hotspot resolves against (read each `hotspot()` to name it). Document both keys in WRITING-A-COMPONENT.md's meta table. Run `node $MV/scripts/build_catalog.mjs`.

- [ ] **Step 4: Check existing briefs still pass**: `node --test $MV/tests/validate.test.mjs $MV/tests/recipes.test.mjs $MV/tests/check_brief.test.mjs $MV/tests/contract.test.mjs`; then `node $MV/scripts/check_brief.mjs demos/04-library-reference` and report its output (new warnings there are reported, not silenced).
- [ ] **Step 5: Commit** — `validate: typing past its row, drags on custom states, rushed clicks, duplicate keyed entries` + trailer.

---

### Task 5: line-chart hover crossfade and `hover` after a cursor hover

**Files:**
- Modify: `$MV/components/data/line-chart.js` (`mount`: a second dot and tip for the outgoing point; `hovered`; `render`; `meta.motion`)
- Test: `$MV/tests/components-data.test.mjs`

- [ ] **Step 1: Write the failing tests** (helpers `scene`, `REST`, `BACK`, `num`, `text` exist in the file):

```js
test('line-chart: moving from point A to point B fades A out while B pops in', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'line-chart' }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 3, target: 'point:2' }, { at: 4.5, target: 'point:5' }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    await at(4.6);   // 0.1 beat after the aim moves: both visible
    const tips = await s.page.evaluate(() => [...document.querySelectorAll('.c-line-chart .lc-tip, .c-line-chart .lc-tip-out')].map((e) => [e.textContent, Number(e.style.opacity)]));
    const a = tips.find(([t]) => t === '5'), b = tips.find(([t]) => t === '10');   // default points: [4,6,5,8,7,10,9,13]
    assert.ok(a && a[1] > 0.05 && a[1] < 0.95, `A fading: ${JSON.stringify(tips)}`);
    assert.ok(b && b[1] > 0.05, `B popping: ${JSON.stringify(tips)}`);
    await at(4.8);
    const out = await s.page.evaluate(() => Number(document.querySelector('.c-line-chart .lc-tip-out').style.opacity));
    assert.ok(out < 0.01, 'A gone after 0.2 beat');
  });
});

test('line-chart: a hover prop taking over from a faded cursor hover fades in, not snaps', async () => {
  await scene({ bars: 4, states: `[${REST}{ at: 2, use: 'line-chart', hover: 4 }${BACK}]`,
    cursor: "[{ at: 0, x: 0, y: 400 }, { at: 2.5, target: 'point:1' }, { at: 4.5, x: 0, y: 400 }, { at: END - 2, x: 0, y: 400 }]" }, async (s, at) => {
    // the cursor hover fades out from 4.5 over 0.2 beat; the hover prop (due at 3.6) then fades in
    const o = [];
    for (const b of [4.71, 4.8, 4.9, 5.2]) { await at(b); o.push(await num(s, '.c-line-chart .lc-tip', 'opacity')); }
    assert.ok(o[0] < 0.5, `starts low, got ${o}`);
    assert.ok(o[3] > 0.95, `reaches full, got ${o}`);
    assert.ok(o[1] <= o[2] && o[2] <= o[3], `rises, got ${o}`);
  });
});
```

- [ ] **Step 2: Run** `node --test --test-name-pattern='line-chart' $MV/tests/components-data.test.mjs` → the two new tests FAIL.

- [ ] **Step 3: Implement**
  - `mount`: add `.lc-dot-out` and `.lc-tip-out`, styled exactly like `.lc-dot` / `.lc-tip` (share one style object; no duplication).
  - `hovered` returns `{ cur: { i, k, v }, out: { i, k, v } | null }`:
    - In the cursor-target loop, when the aim switches from a shown point `on.i` to another shown point `j`, record `out = { i: on.i, t: e.t }` before setting `on` to `j`.
    - `out.k = 1 - prog(ctx, t, out.t, 0.2)` (the same 0.2 beat fade as leaving the chart); null once `k <= 0.001` or when `out.i === cur.i`.
    - When falling through to the row's `hover` prop and a cursor hover faded at `off.t`, the prop's pop starts no earlier than the fade's end: `start = Math.max(propStart, off.t + 0.2 * bs)`, so it fades in instead of snapping.
  - `render` draws `cur` into `.lc-dot`/`.lc-tip` (unchanged code path) and `out` into `.lc-dot-out`/`.lc-tip-out` with opacity `out.k` (every property set every frame, as the hidden branch does today, so the DOM depends on t alone).
  - `meta.motion`: replace "they fade out when a later cursor row aims elsewhere" with "they fade out when a later cursor row aims elsewhere, including at another point (which pops in as the old one fades)"; add "a `hover` that takes over from a cursor hover fades in after it".
  - `node $MV/scripts/build_catalog.mjs`.
- [ ] **Step 4: Run** `node --test $MV/tests/components-data.test.mjs $MV/tests/gallery.test.mjs $MV/tests/contract.test.mjs` → PASS (the gallery test is the purity check across all edge cases).
- [ ] **Step 5: Commit** — `line-chart: point to point fades the old tooltip out; a hover after a cursor hover fades in` + trailer.

---

### Task 6: badge stays across consecutive rows

**Files:**
- Modify: `$MV/components/modifiers.js` (`mountBadges`, `renderBadges`)
- Modify: `CLAUDE.md` / `components/CATALOG.md` source wherever badge behaviour is described (grep `badge`)
- Test: `$MV/tests/components-feedback.test.mjs` (or wherever badge is tested in a real page; `engine.test.mjs:177` has a fake-DOM one)

- [ ] **Step 1: Write the failing tests**

```js
test('badge: the same count on consecutive rows stays put across the change', async () => {
  await scene({ bars: 2, states: `[{ at: 0, use: 'button' }, { at: 2, use: 'button', badge: 3 }, { at: 4, use: 'button', label: 'Next', badge: 3 }, { at: END - 2, use: 'button' }]`, cursor: STILL }, async (s, at) => {
    for (const b of [3.5, 3.9, 4.0, 4.1, 4.3]) {
      await at(b);
      const o = await s.page.evaluate(() => Math.max(...[...document.querySelectorAll('.mk-badge')].map((e) => Number(e.style.opacity))));
      assert.ok(o > 0.99, `badge fully shown at beat ${b}, got ${o}`);
    }
  });
});

test('badge: a changed count keeps the bubble and pops the number', async () => {
  await scene({ bars: 2, states: `[{ at: 0, use: 'button' }, { at: 2, use: 'button', badge: 3 }, { at: 4, use: 'button', label: 'Next', badge: 4 }, { at: END - 2, use: 'button' }]`, cursor: STILL }, async (s, at) => {
    const shown = () => s.page.evaluate(() => [...document.querySelectorAll('.mk-badge')].filter((e) => Number(e.style.opacity) > 0.5).map((e) => [e.textContent, e.style.transform]));
    await at(3.9); assert.deepEqual((await shown()).map(([t]) => t), ['3']);
    await at(4.1);
    const s1 = await shown();
    assert.deepEqual(s1.map(([t]) => t), ['4'], 'the new count is on at once');
    assert.match(s1[0][1], /scale\((1\.0[5-9]|1\.1\d*)/, 'and pops (scale above 1)');
    await at(4.6); assert.match((await shown())[0][1], /scale\(1\)/, 'settled');
  });
});
```

(`STILL` and `scene` as in the file; if the feedback file lacks `STILL`, define it as in components-data.)

- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** in `modifiers.js`: give each badge entry its neighbours (`prev`/`next`: the badge entries of the rows directly before/after, when those rows have a non-zero badge). In `renderBadges`:
  - fade-in: when `prev` exists, the bubble is fully on from `r.t0` (`pin = 1` for `t >= r.t0`); else as today.
  - fade-out: when `next` exists, no fade (`pout = 0`), and the bubble hides at `t >= r.t1` exactly (opacity 0) because `next` is fully on from that instant.
  - pop: when `prev` exists and its count differs, `scale = 1 + 0.12 * bump` with `bump = Math.sin(Math.PI * clamp((t - r.t0) / (0.3 * beat_sec)))` for the first 0.3 beat (pure function of t); otherwise today's `0.6 + 0.4 * s`.
  - Set every style property every frame (purity).
  Update the badge description wherever docs state it fades between rows (`grep -rn "badge" CLAUDE.md $MV/SKILL.md $MV/components/*.md`).
- [ ] **Step 4: Run** the feedback tests, `engine.test.mjs`, `contract.test.mjs`, `gallery.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `badge: stays across consecutive rows; a changed count pops in place` + trailer.

---

### Task 7: command continuation with `typeAt: -1` springs the rows

**Files:**
- Modify: `$MV/components/chrome/command.js` (`times`/`events` for a continuation with `typeAt < 0`; `meta.motion`)
- Test: `$MV/tests/components-chrome.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('command: a continuation that extends the query at once still springs the rows', async () => {
  await scene({ bars: 2, states: `[{ at: 0, use: 'button' }, { at: 2, use: 'command', query: '' }, { at: 4, use: 'command', query: 'exp', typeAt: -1 }, { at: END - 2, use: 'button' }]`, cursor: STILL }, async (s, at) => {
    // 'Invite teammate' stops matching 'exp': its row collapses over ~0.3 beat from beat 4, not at once
    const h = async (b) => { await at(b); return s.page.evaluate(() => parseFloat(document.querySelector('.c-command[data-row="2"] .cm-row[data-item="Invite teammate"]').style.height)); };
    const h0 = await h(4.02), h1 = await h(4.6);
    assert.ok(h0 > 10, `still collapsing just after the row starts, got ${h0}`);
    assert.ok(h1 < 1, `collapsed by 0.6 beat, got ${h1}`);
  });
});
```

- [ ] **Step 2: Run** → FAIL (h0 is 0: snapped).
- [ ] **Step 3: Implement**: in command.js, when the row continues (`ctx.continues`) with `typeAt < 0` and its query differs from `ctx.prev.query`, the filter change happens at `ctx.t0` (an event at `ctx.t0` from the previous row's state) instead of at `-Infinity`, so `Springs.track` springs from the previous filter. A fresh (non-continuing) row with `typeAt < 0` keeps showing its filter at once (row 0 must be settled for the loop seam). Update `meta.motion`: "a query that extends it types on, or with `typeAt: -1` arrives at once and the rows spring to the new filter". `node $MV/scripts/build_catalog.mjs`.
- [ ] **Step 4: Run** `node --test $MV/tests/components-chrome.test.mjs $MV/tests/contract.test.mjs $MV/tests/gallery.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `command: a typeAt -1 continuation springs the rows to the new filter` + trailer.

---

### Task 8: goal tiny-target easing and slider long-to-short label

**Files:**
- Modify: `$MV/components/data/goal.js` (`render`: the target easing rule; `meta.motion`)
- Modify: `$MV/components/controls/slider.js` (`label()` for the previous label; `meta.motion` if wording changes)
- Test: `$MV/tests/components-data.test.mjs` (goal), `$MV/tests/components-controls.test.mjs` (slider)

- [ ] **Step 1: Write the failing tests**

```js
test('goal: a target that grows more than tenfold shows at once (no thousands of percent)', async () => {
  await scene({ bars: 2, states: `[${REST}{ at: 2, use: 'goal', saved: 1, target: 2 }, { at: 4, use: 'goal', saved: 2450, target: 4000 }${BACK}]`, cursor: STILL }, async (s, at) => {
    for (let b = 4; b <= 5.4; b += 0.1) {
      await at(b);
      const pct = Number((await text(s, '.c-goal[data-row="2"] .gl-text')).match(/(\d+)%$/)[1]);
      assert.ok(pct <= 100, `beat ${b.toFixed(1)}: ${pct}%`);
    }
  });
});
```

```js
test('slider: a long label giving way to a short one leaves no stub past the new layout', async () => {
  const long = 'A very long slider label that keeps going', short = 'Gain';
  await scene({ bars: 2, states: `[{ at: 0, use: 'button' }, { at: 2, use: 'slider', label: '${long}', icon: 'none' }, { at: 4, use: 'slider', label: '${short}', icon: 'none' }, { at: END - 2, use: 'button' }]`, cursor: STILL }, async (s, at) => {
    await at(4.1);   // mid crossfade
    const r = await s.page.evaluate(() => {
      const prev = document.querySelector('.c-slider[data-row="2"] .sl-prev');
      return { ellipsis: prev.scrollWidth > prev.clientWidth + 1 && getComputedStyle(prev).textOverflow === 'ellipsis' };
    });
    assert.equal(r.ellipsis, false, 'the old label is not squeezed into the new width with an ellipsis');
  });
});
```

(For the slider, the observable bug is the old label ellipsized to the new short width: the "stub". The assertion that matters is `ellipsis === false`; read `.sl-prev`'s computed style to confirm the fix lays it out at its own width.)

- [ ] **Step 2: Run** → both FAIL.
- [ ] **Step 3: Implement**
  - goal.js: `const ease = prev && prev.target > 0 && p.target > 0 && p.target / prev.target <= 10 && prev.target / p.target <= 10;` `const t0 = ease ? prev.target : p.target;` and update the comment and `meta.motion` ("from or to a zero target, or a change of more than ten times, the new target shows at once").
  - slider.js: the previous label (`'sl-prev'`) is laid out with the **previous** row's frame (`ctx.prev` props and its own geometry width: `geometry(ctx.prev).w`) so its `maxWidth` is its own full width; the shape's frame clips it (the frame already has `overflow: hidden`, or set it on the label's container). The current label keeps today's layout.
  - `node $MV/scripts/build_catalog.mjs`.
- [ ] **Step 4: Run** `node --test $MV/tests/components-data.test.mjs $MV/tests/components-controls.test.mjs $MV/tests/contract.test.mjs $MV/tests/gallery.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `goal: a tenfold target change shows at once; slider: the old label fades at its own width` + trailer.

---

### Task 9: Tooling: purity scan, cursorAt regex, all recipes to MP4

**Files:**
- Modify: `$MV/tests/contract.test.mjs:14-28,78`
- Modify: `$MV/tests/recipes.test.mjs:~53`

- [ ] **Step 1: Write the failing assertions** in contract.test.mjs (next to the existing ones at line ~25):

```js
  for (const ok of ['const transitionTime = 2', 'animationStep(x)', 'let transitions = []']) assert.doesNotMatch(code(ok), IMPURE, ok);
  assert.match(code('d = new Date'), IMPURE, 'new Date without parentheses is the clock too');
  assert.match(code('d = new Date;'), IMPURE);
```

and for the cursorAt rule: a component source whose only `cursorAt` is in a comment must not require `meta.drag` (unit-test the predicate by extracting it into a small function `readsCursor(src) => /\bctx\.cursorAt\b/.test(code(src))` and asserting `readsCursor('// ctx.cursorAt is not used') === false`).

- [ ] **Step 2: Run** `node --test $MV/tests/contract.test.mjs` → FAIL.
- [ ] **Step 3: Implement**: 

```js
// transition/animation as a CSS property or API: 'transition: ...', style.transition =, transitionDuration,
// getAnimations; not identifiers that merely start with the word (transitionTime, animationStep).
const IMPURE = /\b(?:transition|animation)(?:Duration|Delay|TimingFunction|Property|Name|IterationCount|Direction|FillMode|PlayState)?\b(?!\w)|\bgetAnimations\b|Date\.now|new\s+Date\b(?!\s*\(\s*[^)\s])|Math\.random|setTimeout|setInterval|requestAnimationFrame|performance\.now/;
```

(`new Date` followed by `(` with an argument stays allowed, as the "fixed date" assertion requires; `new Date`, `new Date;` and `new Date()` are the clock.) Check the existing assertions at lines 25-28 still hold; adjust the regex until all pass. Use `readsCursor` at line 78.

recipes.test.mjs: render every recipe to MP4 (preview, `from: 0, to: 2`, as the first one is), in a loop over all five, asserting each output has the expected frame count as the existing first-recipe assertion does.
- [ ] **Step 4: Run** `node --test $MV/tests/contract.test.mjs $MV/tests/recipes.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `tests: purity scan matches CSS/API names only and catches new Date; cursorAt rule ignores comments; all recipes render` + trailer.

---

### Task 10: F1 leftovers

**Files:**
- Modify: `$MV/tests/tmp.test.mjs`, `$MV/scripts/gallery.mjs`, `$MV/tests/gallery.test.mjs`, `$MV/tests/is_main.test.mjs`, `$MV/scripts/sync.mjs`, `$MV/tests/sync.test.mjs`, `$MV/tests/test_analyze_song.py`, `$MV/tests/components-feedback.test.mjs`, `$MV/tests/export.test.mjs`, `$MV/scripts/media.mjs` (only if a helper export is needed for the unit test)

- [ ] **Step 1: tmp.test.mjs**
  - SIGINT test: resolve the path promise on the first of stdout `data` or the child's `exit` (an exit before printing fails the test with the child's stderr), and pass `{ timeout: 20_000 }` to `test(...)`.
  - crash test: `assert.match(path.basename(r.stdout.trim()), /^mk-tmptest-/)` before the existence check.
  - MK_KEEP_TMP test: `assert.equal(r.status, 0, r.stderr)`.
- [ ] **Step 2: gallery.mjs**: wrap the CLI body after `parseArgs` in `try { ... } catch (e) { console.error(`error: ${e.message.split('\n')[0]}`); process.exitCode = 1; }` and make the `finally` remove `root` when the run failed even in keep mode (`if (!keep || failed) rmSync(...)`). gallery.test: the first test uses `tempDir('mk-galtest-')`; add a test that `gallery.mjs` with an unwritable OUT (e.g. a path under a file: `path.join(<a file>, 'x')`) exits non-zero with `error:` on stderr, no stack trace (`doesNotMatch(r.stderr, /\n\s+at /)`), and leaves no new `mk-gallery-` dir.
- [ ] **Step 3: is_main.test.mjs**: the old-guard regex becomes `/realpathSync\(\s*process\.argv/`.
- [ ] **Step 4: sync.mjs**: keep a module-level `Set` of live analyser process-group ids (add on spawn, delete on close); the CLI entry (the `isMain` block) installs `process.on('SIGINT'|'SIGTERM', …)` and `process.on('exit', …)` handlers that `process.kill(-pgid, 'SIGTERM')` each (try/catch) before exiting (130/143 for the signals). Test in sync.test.mjs: spawn `node sync.mjs DIR --no-open --port 0` (as the existing CLI tests do), POST a Save whose analyser is the fake `sleep 30` python (via `MK_PYTHON`? — if sync.mjs has no way to swap the interpreter from the CLI, add `MK_ANALYSER_PYTHON` env read in the CLI path only, documented in the header comment), SIGINT the server, then assert no `sleep 30` process from that group remains (`pgrep -f` on a unique marker argument). Extend the existing SIGTERM test: `song.json` byte-identical afterwards and the message matches `/^the analyser took longer than 0\.3 s and was stopped; song\.json is unchanged$/`.
- [ ] **Step 5: test_analyze_song.py**: rename `test_short_song_window_choice_is_unchanged` to `test_short_song_window_prefers_sections_that_fit`. components-feedback progress band: `30..32` instead of `30..35` (keep the comment accurate).
- [ ] **Step 6: export.test.mjs** gap check: assert every packet time and duration is finite (`Number.isFinite`) before checking gaps; the stretched-packet reference is the median packet duration; add a unit test: `loudnormArgs` on a 1 s sine (ffmpeg `-f lavfi -i sine=f=440:d=1`) returns args whose `-af` value ends with `,asetpts=N/SR/TB`.
- [ ] **Step 7: Run** the changed test files, then full `npm test` → green.
- [ ] **Step 8: Commit** — `F1 leftovers: tmp tests fail instead of hang; gallery error handling; sync stops its analyser on exit; tighter tests` + trailer.

---

### Task 11: Verify, stills for Jack, docs, deferred list

**Files:**
- Modify: `docs/superpowers/deferred.md` (remove what F2 did; leave the honest remainder), `CLAUDE.md` (Rules that matter: one line on `data-overhang`; the new table checks under check_brief), `$MV/SKILL.md` (same)

- [ ] **Step 1: Before/after stills** for each of the six component fixes. For each fix, a tiny project with the row sequence from its test (Tasks 5-8), rendered as stills at the moments that change (the beats the test samples) with `main`'s components and with the branch's: use `git worktree add <scratch>/main main` for the old copy, scaffold the same tables in both, `beat_stills.mjs` or `render.mjs --from A --to B --preview` + ffmpeg frame grabs, and put the pairs side by side (ffmpeg `hstack`) into `<scratch>/f2-stills/<fix>.png`. List the six paths in the report. Remove the worktree afterwards (`git worktree remove`).
- [ ] **Step 2: check_brief on demo 04 and each recipe project**: list every warning in the report (none should be a false positive; any real one is listed for Jack, not silenced).
- [ ] **Step 3: Docs + deferred.md**; `node $MV/scripts/build_catalog.mjs --check`.
- [ ] **Step 4: Full suite** (bash): `npm test` → green; save the summary lines to the report.
- [ ] **Step 5: Commit** — `docs: F2 checks, data-overhang, deferred list` + trailer.

(Merge and push are the controller's, after Jack approves the six still sheets.)
