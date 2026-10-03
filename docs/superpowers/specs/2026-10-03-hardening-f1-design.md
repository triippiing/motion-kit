# Hardening, first pass (sub-project F1): design

Date: 2026-10-03
Status: approved in conversation, awaiting spec review
Part of: the motion-kit roadmap (A, B, C1 done; F split into F1 this, and F2 edge cases and lints;
then C2, D, E in an order to be picked)

## Purpose

motion-kit goes public on LinkedIn on Monday 2026-10-05. F1 fixes what a fresh clone hits first:
test runs that fill the temp dir, a script that imports from the tests, a crash on a missing script
path, a sync-page Save that can hang forever, and a loop clip that comes out short. It is small
enough to merge and push before Monday. Everything else from the deferred list is F2 (below).

Success means:
1. A full `npm test` run (node and Python) leaves no new temp directories behind (count of
   `$TMPDIR` entries from the kit's prefixes before and after is equal).
2. `gallery.mjs` imports nothing from `tests/`.
3. No script throws ENOENT from its entry guard when `argv[1]` names a missing file.
4. A hung analyser makes Save fail cleanly after a timeout, with `song.json` unchanged, and the
   next Save on the same project still runs.
5. `clip.wav` is always exactly the loop's duration, and the analyser no longer picks a loop window
   past the end of the song when one that fits exists.
6. Demos 01 to 04 and the launch video re-analyse to the same `song.json` (no visible change).
7. All tests green; merged to main and pushed.

Out of scope: any behaviour change a user would see in a render, new checks, component fixes
(F2); pickup/anacrusis support (moved to C2, which reworks the grid anyway).

## 1. Temp directories

Today `makeProject` (`tests/harness.mjs`, prefix `mk-`) and `fixture` (`tests/fixtures.mjs`,
prefix `mv-`) create a temp directory per project and never remove it; render, recipes and symlink
tests call `mkdtempSync` directly (`np-`, `tpl-`, `sz-`, `tp-`, `sp-`, `tag-`, `mk-symlink-`).
Only the export and sync tests clean up. On 2026-10-03 there were 146 `mk-*` dirs (539 MB) from two
days of runs.

New `tests/tmp.mjs`:

- `tempDir(prefix)` makes a directory with `mkdtempSync(path.join(tmpdir(), prefix))`, records it,
  and returns it.
- On process `exit`, and on `SIGINT` / `SIGTERM` (remove, then re-raise the default behaviour by
  exiting with 130 / 143), every recorded directory is removed with `rmSync(d, { recursive: true,
  force: true })`. Handlers are installed once, on the first call.
- `MK_KEEP_TMP=1` skips the removal and prints the kept paths to stderr, for inspecting a failure.

`node --test` runs each test file in its own process, so each file cleans up after itself with no
`after()` blocks. Every direct `mkdtempSync` in `tests/` moves to `tempDir`; the existing `after()`
cleanups in export and sync tests stay (harmless). `media.mjs`'s `mk-2pass-` logs are already
removed by the script itself and are not touched.

Tests (`tests/tmp.test.mjs`): a child process that calls `tempDir` and exits normally leaves no
directory; a child that calls `tempDir` then receives SIGINT leaves no directory; with
`MK_KEEP_TMP=1` the directory remains (and the test removes it).

## 2. gallery.mjs off the test harness

`gallery.mjs` imports `makeProject` from `tests/harness.mjs`, which itself shells into the Python
test file for `click_track`. A script must not depend on tests.

- `click_track` moves from `tests/test_analyze_song.py` to `scripts/click_track.py` (same
  signature and output). The test file imports it from there; its tests are unchanged.
- The scaffolding part of `makeProject` moves to `scripts/scaffold.mjs`:
  `scaffold(dir, { states, cursor, bars, bpm, extraSfx, content, size })` writes the click track and
  project into `dir` (which it creates) and returns the project directory. No temp-dir logic.
- `tests/harness.mjs` keeps `makeProject(opts)` as `scaffold(tempDir('mk-'), opts)` and keeps
  `openScene` as is, so no test changes.
- `gallery.mjs` scaffolds into a temp directory it removes when done (after rendering or stills),
  unless `--keep` is passed, in which case it prints the path. `parseArgs` learns `--keep`.

Tests: `gallery.mjs` source has no `tests/` import (a grep test); existing gallery tests pass;
`parseArgs` accepts `--keep`.

## 3. Entry guard

Eight scripts (beat_stills, build_catalog, check_brief, export, gallery, render, safezones, sync) repeat `process.argv[1] && realpathSync(process.argv[1]) === realpathSync(...)`,
which throws ENOENT when `argv[1]` names a file that does not exist (a moved checkout, some
loaders). New `scripts/is_main.mjs` exports `isMain(metaUrl)`: true when `argv[1]` resolves to the
same real path as `metaUrl`; false when `argv[1]` is missing or either path cannot be resolved.
All eight guards use it.

Tests: `isMain` with a missing `argv[1]` path returns false; each script still runs as a CLI (the
existing CLI tests cover this).

## 4. Save timeout

`sync.mjs`'s `run()` spawns the analyser with no time limit. A hung analyser hangs Save, and since
saves are chained per project, every later Save waits behind it.

- `run()` takes a `timeoutMs`. On expiry it kills the child (SIGTERM, then SIGKILL after 2 s) and
  resolves `{ timedOut: true, ... }`.
- Default 120 000 ms; `MK_ANALYSER_TIMEOUT` (milliseconds) overrides it; `saveSync` accepts a
  `timeoutMs` option (tests).
- `doSave` treats a timeout as a failure: restores `song.json` from the backup (as for any analyser
  failure) and throws `SaveError("the analyser took longer than 120 s and was stopped; song.json is
  unchanged")` (seconds from the actual limit). HTTP 500, shown on the page like other Save errors.
- The chain already continues after a failed save; a test confirms it after a timeout.

Tests (`tests/sync.test.mjs`): a fake analyser (a Python script that sleeps) with `timeoutMs: 300`
gives SaveError mentioning "stopped", leaves `song.json` byte-identical, and a following Save with
the real analyser succeeds.

## 5. Loop window past the end of the song

For a detected grid (no user `sync`), the last bar's beat times can extend past the audio. If that
window is chosen, `write_clip` asks ffmpeg for `duration` seconds but gets less: the clip is short,
its fade-out starts after the audio ends (no fade, a possible click at the loop seam), and the video
outlives its audio.

- Window choice: the "fits" filter (window starts at or after 0 and ends at or before
  `song_sec`) applies to every grid, not only user grids. If no window fits, all windows remain
  candidates, as today. `--start-bar` and `--start-near` are unchanged (explicit choices).
- Clip length: `write_clip` pads with silence to exactly `duration_sec` (`apad=whole_dur`), and the
  fade-out sits at the end of the padded clip. When padding is needed the analyser prints
  `warning: the loop runs N ms past the end of the song; clip.wav is padded with silence` to stderr.
- A user grid past the end still errors exactly as today (unchanged).

Behaviour change: a song with no sync whose best-scoring window overran will pick a different window
on its next fresh analysis. Save passes `--start-near`, so a project re-saved from the sync page keeps
its window. Success item 6 checks the demos and launch video.

Tests (`tests/test_analyze_song.py`): a click track that ends partway through its last bar, with
the loudest window at the end, picks a window that fits; with `--start-bar` forcing the overrun,
`clip.wav` has exactly `round(duration * 48000)` samples (within 1) and stderr has the warning.

## Verification before merge

- `npm test` and the Python tests green.
- Temp-dir count by prefix (`mk-`, `mv-`, `np-`, `tpl-`, `sz-`, `tp-`, `sp-`, `tag-`) before and
  after a full run: equal.
- Re-run the analyser (as Save does, with `--start-near` and the stored `--bars`) on demos 01 to 04
  and the launch project into a scratch copy; `song.json` equal apart from the analysis date, if any.
- After merge: remove the 146 existing leaked `mk-*` dirs (nothing references them).

## F2 (later, its own spec)

Agreed scope, recorded here so nothing is lost:

- Component edge cases a normal brief can hit get fixed (line-chart point-to-point hover fades;
  `hover` prop after a cursor hover; badge across two consecutive rows; command continuation with
  `typeAt -1`; goal text for a tiny target easing from 0; slider long-to-short label stub).
- Edge cases needing unusual input become check_brief messages instead of component changes
  (duplicate bar-chart labels, button labels over about 57 characters, very long dock/chip-row
  lists).
- New check_brief lints: cursor leaving the frame (camera zoom aware), long labels on vertical
  stages, typing that overruns its row, drags on custom states, click approaches shorter than the
  pointer settle lag. Error when the output would be wrong; warning when it would look wrong.
- Tooling: theme.json must be an object; purity scan over-matching and `new Date` without
  parentheses; contract test `cursorAt` regex matching comments; render all recipes to MP4 in tests
  (or document why not).
- Remaining from launch: `export.mjs` on a joined video belongs to D, not F2.
