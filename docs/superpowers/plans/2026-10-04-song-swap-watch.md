# Song Swap and Watch Mode (C2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command swaps a project's song and leads the user to re-place its marked moments; one command serves a live preview that updates on every save and shows check_brief's result.

**Architecture:** A small shared module (`scripts/tables.mjs`) extracts and runs a project's tables (from index.html or the brief) and lists the marker names they use; check_brief, swap_song, the sync server and watch all use it. `swap_song.mjs` backs up, clears `sync`, re-runs the analyser and opens the sync page, which gains a "to place" list fed by `GET /__sync/needed`. `watch.mjs` serves a wrapper page (`/__watch`) holding the audio clock, a results panel and the project's index.html in an iframe; on a change the server checks the tables run, re-runs check_brief, and tells the page over Server-Sent Events to reload only the iframe, so playback continues uninterrupted.

**Tech Stack:** Node 22+ ES modules (node:test, node:http, fs.watch, node:vm), Playwright Chromium, Python analyser (existing).

**Spec:** `docs/superpowers/specs/2026-10-04-song-swap-watch-design.md`. One refinement (recorded here and in the spec at the end): the playhead is kept because the audio lives in the wrapper page and only the iframe reloads — a full page reload would need a new click before audio could play.

All paths relative to `~/motion-kit`; `MV=skills/motion-video`. Branch `song-swap-watch` from `main`.

## Global Constraints

- Scripts fail with `error: ...` and exit 2 on bad input, never a traceback.
- Servers bind 127.0.0.1 only and reuse render.mjs `serve()` (its origin checks and symlink refusal).
- Never write project files from watch or the sync page's "to place" list; swap_song writes only song.json, clip.wav, .source.json (via the analyser) and `.swap-backup/`.
- Music: never download songs; tests use synthetic click tracks (`scripts/click_track.py` / `scaffold.mjs` `clickTrack`).
- No new dependencies. Match surrounding comment density and idiom.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run shell snippets with bash, `export PATH=/opt/homebrew/bin:$PATH`; full suite `npm test` from the repo root.
- Table cursor x/y are shape-centred and multiplied by camera zoom: a safe resting cursor is `x: 140, y: 100`.

## Review Focus

1. A swap where the new song is shorter than the loop (`song is shorter than the requested loop`) must leave the project exactly as it was (backup restored), exit non-zero with the analyser's `error:` line — Task 2 pins it.
2. Marker names used only in the brief (not yet in index.html) must still be listed to place — Task 2 and Task 3 pin it.
3. Saving the same file twice quickly (editors write temp files and rename) must produce one reload, not a storm, and a save during a running check must not interleave results — Task 4 pins the debounce with two rapid writes.
4. A brief whose code is fine but whose check fails (e.g. a state over budget) must still reload the preview (only code that cannot run blocks a reload) — Task 4 pins it.
5. The sync page with nothing to place must look and behave exactly as before (no empty list, animation loads) — Task 3 pins it with an existing-project test.

---

### Task 1: `scripts/tables.mjs`: extract, run and inspect tables

**Files:**
- Create: `$MV/scripts/tables.mjs`
- Create: `$MV/tests/tables.test.mjs`
- Modify: `$MV/scripts/check_brief.mjs` (use the helpers; unknown-marker hint)
- Modify: `$MV/scripts/render.mjs` only to export `START_MARK`/`END_MARK` if tables.mjs needs them (or move them to tables.mjs and import back into render.mjs — keep one definition)

**Interfaces (Produces):**
- `briefCode(md: string) -> string` — the joined ```` ```js ```` / ```` ```javascript ```` blocks under `## Beat table` ('' when none). Exactly check_brief's current extraction.
- `pageCode(html: string) -> string | null` — the code between the template's table markers in index.html (null when the markers are missing).
- `runTables(code: string, beats: number) -> { states, cursor }` — evaluates `${code}\n;({ states: states(), cursor: cursor() })` in a fresh `vm` context with `END = beats`, timeout 1000 ms; throws `TablesError` with message `beat table code took longer than 1 s to run (an endless loop?)` or `beat table code does not run: <message>`.
- `class TablesError extends Error`.
- `markerNames(rows: object[][]) -> string[]` — sorted unique string `at` values across the given row lists (non-arrays and non-objects ignored).
- `projectMarkerNames(dir) -> string[]` — union of `markerNames` over index.html's tables and (when `MOTION-BRIEF.md` exists) the brief's tables, each run with `END = song.json beats length`; a table that does not run contributes nothing (no throw).

- [ ] **Step 1: Failing tests** (`tables.test.mjs`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { briefCode, pageCode, runTables, markerNames, projectMarkerNames, TablesError } from '../scripts/tables.mjs';
import { makeProject } from './harness.mjs';

test('briefCode joins the js blocks under ## Beat table only', () => {
  const md = '## Request\n```js\nconst nope = 1;\n```\n## Beat table\n```js\nconst a = 1;\n```\ntext\n```javascript\nconst b = 2;\n```\n';
  assert.equal(briefCode(md), 'const a = 1;\n\nconst b = 2;\n');
  assert.equal(briefCode('## Beat table\nno code'), '');
});

test('runTables evaluates with END and reports code that does not run', () => {
  const ok = runTables("const states = () => [{ at: 0, use: 'button' }, { at: END - 2, use: 'button' }];\nconst cursor = () => [{ at: 0, x: 0, y: 0 }];", 8);
  assert.equal(ok.states[1].at, 6);
  assert.throws(() => runTables('const states = () => [;', 8), (e) => e instanceof TablesError && /^beat table code does not run: /.test(e.message));
  assert.throws(() => runTables('const states = () => { for (;;) {} }; const cursor = () => [];', 8), /took longer than 1 s/);
});

test('markerNames: sorted unique string ats', () => {
  assert.deepEqual(markerNames([[{ at: 'drop' }, { at: 2 }, { at: 'chorus' }], [{ at: 'drop', offset: -0.5 }], null]), ['chorus', 'drop']);
});

test('projectMarkerNames unions index.html and the brief', () => {
  const dir = makeProject({ bars: 2, states: "[{ at: 0, use: 'button' }, { at: 'drop', use: 'button', label: 'Go' }, { at: END - 2, use: 'button' }]",
    cursor: '[{ at: 0, x: 140, y: 100 }, { at: END - 2, x: 140, y: 100 }]' });
  writeFileSync(path.join(dir, 'MOTION-BRIEF.md'), "## Beat table\n```js\nconst states = () => [{ at: 0, use: 'button' }, { at: 'chorus', use: 'button' }, { at: END - 2, use: 'button' }];\nconst cursor = () => [{ at: 0, x: 140, y: 100 }];\n```\n");
  assert.deepEqual(projectMarkerNames(dir), ['chorus', 'drop']);
  assert.ok(pageCode(readFileSync(path.join(dir, 'index.html'), 'utf8')).includes("at: 'drop'"));
});
```

- [ ] **Step 2: Run** `node --test $MV/tests/tables.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** `tables.mjs` (header comment: what it is for, who uses it). `pageCode` slices between `START_MARK` and `END_MARK` (one definition shared with render.mjs's `spliceTables`). check_brief uses `briefCode` and `runTables` in place of its inline code (same messages, so its tests stay green), and appends ` (after a song swap, place it on the sync page: node sync.mjs DIR)` to any error that starts with `unknown marker` (check_brief only — validate.js is copied into projects and pinned byte-identical to demo 04's copy, so it does not change).
- [ ] **Step 4: Run** `node --test $MV/tests/tables.test.mjs $MV/tests/check_brief.test.mjs $MV/tests/render.test.mjs` → PASS; add one check_brief test asserting the hint on an unknown marker row.
- [ ] **Step 5: Commit** — `tables.mjs: one place to read, run and list a project's tables; check_brief hints at the sync page for unknown markers` + trailer.

---

### Task 2: `scripts/swap_song.mjs`

**Files:**
- Create: `$MV/scripts/swap_song.mjs`
- Create: `$MV/tests/swap_song.test.mjs`
- Modify: `.gitignore` (add `.swap-backup/`)

**Interfaces:**
- Consumes: `projectMarkerNames(dir)` (Task 1); `startSync(dir, { port })` from sync.mjs; `isMain` from is_main.mjs; `UsageError` from render.mjs.
- Produces: `swapSong(dir, song, { bars, startBar, startNear, python = 'python3' }) -> { before: { bpm, duration }, after: { bpm, confidence, duration, bars }, toPlace: string[], budget: string | null, backup: string }`; CLI `swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B | --start-near SEC] [--no-open] [--port N]`.

- [ ] **Step 1: Failing tests** (`swap_song.test.mjs`): build with `makeProject({ bars: 4, bpm: 120, states: <a table with a row at: 'drop'> })`, analyse it (`analyze_song.py <root>/beat.wav --out dir --bars 4 --start-bar 1`, as sync.test.mjs's `project()` does), write a `sync` with a marker `drop` and `nudge_ms: -10`; make a second click track at 100 BPM (`clickTrack(path, 100, 40)` from scaffold.mjs) in a `tempDir`.

```js
test('swap: backs up, clears sync, re-analyses at the new tempo with the same bars, lists names to place', async () => {
  const r = await swapSong(dir, song100);
  assert.ok(existsSync(path.join(r.backup, 'song.json')) && existsSync(path.join(r.backup, 'clip.wav')));
  assert.match(path.relative(dir, r.backup), /^\.swap-backup\/\d{8}-\d{6}$/);
  const s = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  assert.equal(s.sync, undefined);
  assert.ok(Math.abs(s.bpm - 100) < 1, String(s.bpm));
  assert.equal(s.loop.bars, 4);
  assert.deepEqual(r.toPlace, ['drop']);
  assert.ok(Math.abs(r.before.bpm - 120) < 1 && Math.abs(r.after.bpm - 100) < 1);
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.source.json'), 'utf8')).path, path.resolve(song100));
});

test('swap: --bars and --start-bar are passed to the analyser', async () => {
  await swapSong(dir, song100, { bars: 2, startBar: 1 });
  const s = JSON.parse(readFileSync(path.join(dir, 'song.json'), 'utf8'));
  assert.equal(s.loop.bars, 2);
  assert.equal(s.loop.start_bar, 1);
});

test('swap: a song shorter than the loop leaves the project as it was', async () => {
  const before = ['song.json', 'clip.wav', '.source.json'].map((f) => readFileSync(path.join(dir, f)));
  const short = clickTrack(path.join(tempDir('mk-swap-'), 'short.wav'), 120, 3);
  await assert.rejects(swapSong(dir, short), /shorter than the requested loop/);
  assert.deepEqual(['song.json', 'clip.wav', '.source.json'].map((f) => readFileSync(path.join(dir, f))), before);
});

test('swap CLI: report lines, --no-open, bad usage exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, dir, song100, '--no-open'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^tempo: 120\.\d+ -> 100\.\d+ BPM \(confidence [\d.]+\)$/m);
  assert.match(r.stdout, /^loop: 4 bars = [\d.]+ s \(was [\d.]+ s\)$/m);
  assert.match(r.stdout, /^to place: drop$/m);
  const bad = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /^error: /m);
  const missing = spawnSync(process.execPath, [SCRIPT, dir, '/nope/song.wav', '--no-open'], { encoding: 'utf8' });
  assert.equal(missing.status, 2); assert.match(missing.stderr, /^error: .*\/nope\/song\.wav/m);
});

test('swap report: tables with more states than the new song allows warn with both numbers', async () => {
  // a 1-bar loop at 100 BPM allows few states; index.html's table above has more rows than that once bars is 1
  const r = await swapSong(dir, song100, { bars: 1 });
  assert.match(r.budget ?? '', /^the tables have \d+ states; the new song allows \d+ \(shorten the table or pass --bars\)$/);
});
```

(The budget test needs index.html's table to have more states than a 1-bar loop allows: give the scaffolded table at least 4 rows plus the closing row, at beats 0, 'drop', 2, 3, END - 2, or adjust so `states.length - 1 > rules.max_states` for bars 1, and say what you used.)

- [ ] **Step 2: Run** `node --test $MV/tests/swap_song.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `swap_song.mjs`:
  - `swapSong`: validate (`song.json` in dir, song file readable → else `UsageError`); read old song.json (`before.bpm`, `before.duration = loop.duration_sec`, default bars = `loop.bars`); `toPlace` = `projectMarkerNames(dir)` (computed before clearing, from the tables, which do not change); backup dir `.swap-backup/<YYYYMMDD-HHMMSS>` (local time) with copies of the present files among `song.json`, `clip.wav`, `.source.json`; write song.json without `sync` (atomic, as sync.mjs's `writeJsonAtomic` does); run `analyze_song.py NEWSONG --out DIR --bars N [--start-bar B | --start-near S]` (spawn with `/opt/homebrew/bin` on PATH, as sync.mjs does); on a non-zero exit copy the backup files back and throw (`UsageError` for analyser exit 2 with its last `error:` line, else `Error`); read the new song.json for `after`. `budget`: when the tables (index.html, else the brief) run, count `states.length - 1` against the new `rules.max_states`; over → `the tables have N states; the new song allows M (shorten the table or pass --bars)`.
  - CLI prints the report lines (spec section 1 step 5; `warning: ` prefix for budget; `reminder: update the brief's Song/Music line if the licence changed` when MOTION-BRIEF.md exists), then unless `--no-open` starts `startSync(dir, { port })`, prints `sync page: <url>` and opens it (as sync.mjs's main does), keeping the process alive until Ctrl+C (install sync.mjs's signal handling by importing what it exports, or run `node sync.mjs DIR` as a child with stdio inherited — choose the simpler that keeps Ctrl+C behaviour, and say which in the report).
  - `.gitignore`: add `.swap-backup/`.
- [ ] **Step 4: Run** `node --test $MV/tests/swap_song.test.mjs $MV/tests/sync.test.mjs` → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `swap_song: one step to put a new song on a project (backup, clear sync, re-analyse, names to place)` + trailer.

---

### Task 3: "To place" on the sync page

**Files:**
- Modify: `$MV/scripts/sync.mjs` (`GET /__sync/needed` route; header comment)
- Modify: `$MV/scripts/sync-page/index.html`, `app.js`, `style.css`
- Test: `$MV/tests/sync.test.mjs` (route), `$MV/tests/sync-page.test.mjs` (page)

**Interfaces:**
- Consumes: `projectMarkerNames(dir)` (Task 1).
- Produces: `GET /__sync/needed` → `200 { "names": [...] }` = `projectMarkerNames(root)` minus the names in song.json `sync.markers` (read fresh per request).

- [ ] **Step 1: Failing tests**
  - sync.test.mjs: a project whose table uses `at: 'drop'` and song.json without sync → `needed` = `['drop']`; after `saveSync(dir, { markers: [{ name: 'drop', t: <in-loop song time> }] })` → `[]`.
  - sync-page.test.mjs (Playwright, as the file's other tests do):
    - with `drop` to place: `#to-place` is visible and lists a `drop` button; the animation pane shows the text `place these moments to see the animation: drop` and the iframe has no `src` loaded (or is hidden); selecting `drop`, then pressing M at a playhead inside the loop creates a pending marker named `drop` without the name prompt; after Save, `#to-place` is hidden and the iframe loads (window.syncState shows the animation ready).
    - an existing project with nothing to place (Review Focus 5): `#to-place` hidden, iframe loads as before, all existing sync-page tests still pass.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - sync.mjs: add the route to `routes` in `startSync` (`'GET /__sync/needed'`), reply with `sendJson`; document it in the header comment.
  - Page: on load and after every marker change and Save, fetch `/__sync/needed`, minus names already in the pending (unsaved) markers, and render `#to-place` above the markers list (buttons; one selected at a time; hidden when empty). `newMarker()`/`commitDraft`: when a to-place name is selected, commit the draft immediately with that name (skip the name prompt) and clear the selection. While the saved needed list is non-empty, do not call `loadFrame`; show the placeholder text in `#frame-box`; once it becomes empty after a Save, call `loadFrame(false)` as today.
  - Style: match the existing markers list.
- [ ] **Step 4: Run** `node --test $MV/tests/sync.test.mjs $MV/tests/sync-page.test.mjs` → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `sync page: a 'to place' list of the marker names the tables use; the animation waits until they are placed` + trailer.

---

### Task 4: `scripts/watch.mjs` and the watch page

**Files:**
- Create: `$MV/scripts/watch.mjs`
- Create: `$MV/scripts/watch-page/index.html`, `app.js`, `style.css`
- Create: `$MV/tests/watch.test.mjs`

**Interfaces:**
- Consumes: `serve(dir, port, { routes, tables })` from render.mjs; `briefCode`, `pageCode`, `runTables`, `TablesError` (Task 1); `checkBrief(dir, { loop })` and `projectLoop(dir)` from check_brief.mjs; `isMain`.
- Produces: `startWatch(dir, { port = 0, brief = false, debounceMs = 200 }) -> { url, close(), status() }` where `status()` returns the current `{ ok, errors, warnings, at, version }`; routes `GET /__watch` (the page), `GET /__watch/<file>` (page assets), `GET /__watch/events` (SSE: `event: reload` with `data: {version}`, `event: status` with the status JSON, `event: error` with `data: {message}`), `GET /__watch/status` (JSON).

- [ ] **Step 1: Failing tests** (`watch.test.mjs`), each on `makeProject({ bars: 2, ... })` with `startWatch(dir, { debounceMs: 50 })`, closed in `finally`:
  - status starts `ok` and `version` 1; the page `GET /__watch` loads in Playwright, its iframe shows the project (`window.seek` exists in the frame).
  - editing index.html's table (change a button label) → within 2 s `version` is 2 and the iframe's DOM shows the new label; the wrapper's audio element is the same object (playback not interrupted: `document.querySelector('audio').dataset.id` unchanged, set once on load) and the playhead (`window.watchState.t`) did not jump back to 0.
  - two writes 20 ms apart → exactly one version bump (Review Focus 3).
  - writing a syntax error into the table → no version bump; status `errors[0]` matches `/^beat table code does not run/`; the panel shows it; fixing the file → version bumps.
  - with a MOTION-BRIEF.md whose tables run but exceed the state budget → the page still reloads (Review Focus 4) and status has the check_brief error; `--brief` (`startWatch(dir, { brief: true })`) serves the brief's tables (the iframe shows the brief's label).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - watch.mjs: `serve(dir, port, { routes, tables: brief ? briefCode(md) : undefined })` — when `brief`, re-read the brief on each change and pass the new code (serve's `tables` option is read per request; if it is fixed at start, add a getter/function form to `serve` in render.mjs, keeping current callers unchanged). Watch the listed files/dirs with `fs.watch` (components recursively), debounce, then: run the code that will be served (`pageCode(index.html)` or `briefCode(brief)`) through `runTables`; on `TablesError` push `error` + status (errors: [message]) and do not bump the version; else bump `version`, push `reload`, then (when MOTION-BRIEF.md exists) run `checkBrief(dir, { loop: projectLoop(dir).loop })` and push `status` (`ok = errors.length === 0`). Serialise checks: a change during a running check queues one more run after it (no interleaving). Print the check result lines to stdout as check_brief's CLI does. CLI: `watch.mjs DIR [--brief] [--port N] [--no-open]`, prints `watching: <url>` and opens it; Ctrl+C closes watchers and the server.
  - watch page: like the sync page's frame — an `<audio src="/clip.wav" loop>` in the wrapper, started by a click (a "click to play" overlay), a requestAnimationFrame loop that calls `iframe.contentWindow.seek(audio.currentTime % D)` when the frame is ready; on `reload`, reload only the iframe and resume seeking at the current audio time once `ready` resolves; on `error` keep the frame and show the message; the panel (bottom right): red errors, amber warnings, green `brief OK`; click toggles collapsed; collapsed to a dot when ok and no warnings. `window.watchState = { version, t, ok }` for tests.
- [ ] **Step 4: Run** `node --test $MV/tests/watch.test.mjs $MV/tests/render.test.mjs` → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `watch: a live preview that reloads on save, keeps playing, and shows check_brief's result` + trailer.

---

### Task 5: Docs, spec note, manual check

**Files:**
- Modify: `CLAUDE.md`, `$MV/SKILL.md`, `skills/motion-design/references/planner.md`, `docs/superpowers/specs/2026-10-04-song-swap-watch-design.md` (one line: the playhead is kept because only the iframe reloads)

- [ ] **Step 1: Docs** per the spec's Docs section; code map lists `tables.mjs`, `swap_song.mjs`, `watch.mjs`, `watch-page/`. Replace every "delete `sync` from song.json first" instruction (CLAUDE.md, SKILL.md) with `node $S/swap_song.mjs DIR NEWSONG`.
- [ ] **Step 2: Manual check** (report only; nothing committed): copy `~/motion-kit-launch/kit` to a scratch dir (read-only source; never write into ~/motion-kit-launch), swap it to a click track with `--no-open`, check the report; swap back to `~/Downloads/2000s-x-90s-RB-Pop-Pharrell-Type-Beat---Tease-Me.mp3` (if present; never download music); start `watch.mjs` on the scratch copy with `--no-open`, edit a label, confirm a version bump via `/__watch/status`. Record outputs in the report.
- [ ] **Step 3: Full suite** `npm test` (bash) → green.
- [ ] **Step 4: Commit** — `docs: swap_song and watch` + trailer.
