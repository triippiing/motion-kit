# Song swap and watch mode (sub-project C2a): design

Date: 2026-10-04
Status: approved in conversation, awaiting spec review
Part of: the motion-kit roadmap (A, B, C1, F1, F2 done). C2 is split: C2a (this) is workflow — song swap and
watch mode; C2b is harder songs — tempo changes, swing and meter suggestions, pickup/anacrusis — with its own
spec once Jack's test songs are known.

## Purpose

Two chores slow every video down. Swapping a project's song means deleting `sync` from song.json by hand and
re-running the analyser, after which marker rows (`at: 'drop'`) silently point at nothing. And iterating on the
tables means edit, re-render, open the file. C2a makes both one step.

Success means:
1. `node swap_song.mjs DIR NEWSONG` backs up, clears the old sync, re-analyses with the project's bars, reports
   what changed, and opens the sync page listing the marker names the tables still need ("to place").
2. Placing each listed name on the sync page makes the tables work again unchanged.
3. `node watch.mjs DIR [--brief]` serves a live preview that reloads at the same playhead within about a second of
   saving, re-runs check_brief, and shows its result in the terminal and on the page.
4. A broken table never blanks the preview: the last good version stays, with the error shown.
5. All tests green; docs updated; merged and pushed.

Out of scope: C2b's detection work; automatic preview MP4 renders on save (Jack chose the live page); editing
tables on any page.

## 1. Song swap: `scripts/swap_song.mjs`

`node swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B | --start-near SEC] [--no-open] [--port N]`

Steps, in order; any failure before step 4 leaves the project untouched, and from step 4 on a failure restores
the backup:

1. **Validate:** DIR is a motion-video project (song.json present), NEWSONG is a readable file. Bad usage:
   `error: ...`, exit 2.
2. **Back up** `song.json`, `clip.wav` and `.source.json` (those present) to
   `DIR/.swap-backup/<YYYYMMDD-HHMMSS>/`. `.swap-backup/` is added to the template's and repo's `.gitignore`
   (it holds audio and a local path).
3. **Collect marker names the tables use:** from `index.html`'s table block and, when present, the brief's
   ```` ```js ```` block under "## Beat table" (the same extraction check_brief uses), every row whose `at` is a
   string. Union, sorted.
4. **Clear `sync`** from song.json (the old nudge, tempo, meter, swing and markers were set by ear against the old
   song) and **re-analyse**: `analyze_song.py NEWSONG --out DIR --bars <N>` where N is `--bars` or the current
   `song.json` `loop.bars`, plus `--start-bar` / `--start-near` when given. The analyser writes song.json, clip.wav
   and .source.json (the new path).
5. **Report** (stdout):
   - `tempo: 109.00 -> 124.02 BPM (confidence 0.71)`;
   - `loop: N bars = 15.48 s (was 15.41 s)`;
   - `to place: drop, chorus` (or `no markers to place`);
   - the state budget: if the tables have more states than the new song's `rules.max_states` allows, a warning
     with both numbers (from the same rules check_brief uses);
   - `reminder: update the brief's Song/Music line if the licence changed` when a brief exists.
6. **Open the sync page** (unless `--no-open`): run sync.mjs's server for DIR and open it, as `sync.mjs DIR` does.

Exit 0 on success. The swap never edits the tables.

## 2. "To place" on the sync page

- The sync server gains `GET /__sync/needed`: `{ "names": [...] }`, the marker names the tables use (section 1
  step 3, from index.html and the brief) minus the names in song.json's `sync.markers`. Computed on every
  request; nothing is stored.
- The page shows a "to place" list above the markers list when it is non-empty: each name a button; pressing M
  (or the existing add-marker action) while a name is selected creates the marker with that name; the list
  re-fetches after each marker change and Save. The list is hidden when empty.
- While any name is still to place, the animation pane shows `place these moments to see the animation: drop,
  chorus` instead of loading tables that would fail on unknown markers. Once the list is empty (after Save, which
  re-runs the analyser and writes the derived `markers`), the pane loads the animation as today.
- check_brief's existing unknown-marker error gains a hint: `(after a song swap, place it on the sync page:
  node sync.mjs DIR)`.

## 3. Watch mode: `scripts/watch.mjs`

`node watch.mjs DIR [--brief] [--port N] [--no-open]`

- Serves DIR with render.mjs's `serve()` (127.0.0.1, same origin checks) and opens `/__watch` (as built; first written
  as `?play&watch`). With `--brief`,
  the brief's tables are spliced into the served index.html (`serve(..., { tables })`, as check_brief's frame check
  does), so the same tool works while planning and after approval. Without `--brief`, index.html as is.
- Watches `index.html`, `MOTION-BRIEF.md`, `song.json`, `theme.json`, `theme.css`, `project.json` and
  `components/` (recursive) with `fs.watch`; changes within 200 ms are one event.
- On a change:
  - **check_brief** runs in-process (`checkBrief(DIR)`, frame check included) when MOTION-BRIEF.md exists;
    results print to the terminal (`warning:` / `error:` lines, then `brief OK` or `brief has N error(s)`).
  - **Reload:** the server pushes `reload` over Server-Sent Events (`GET /__watch/events`); only the project's
    iframe reloads, so the playhead and playing state are kept. (As built, a refinement from the plan: the watch
    page at `/__watch` holds the audio and the clock and drives `index.html` in an iframe with `seek(t)`; a reload
    replaces the iframe's page and seeks it to the current time, and the audio never stops. This replaces the
    earlier idea of a full page reload that saved its time in sessionStorage.)
  - **Results panel:** the page fetches `GET /__watch/status` (`{ errors, warnings, ok, at }`) and shows a small
    corner panel: errors red, warnings amber, `brief OK` green; collapsible; collapsed to a dot when clean. Without
    a brief the panel shows only page errors.
- **Broken tables:** before pushing a reload, the server checks that the new tables run (the same `vm` evaluation
  check_brief uses, 1 s timeout). If they don't, it pushes `error` with the message instead of `reload`; the page
  keeps showing the last good version and the panel shows the error. A later good save reloads normally.
- The watch page is its own page (`scripts/watch-page/`, served at `/__watch`, as the sync page is) wrapping the
  project's `index.html` in an iframe; nothing is injected into the project's page, and projects and the template
  are unchanged on disk. (As built: this replaces the earlier `?play&watch` page with an injected
  `/__watch/client.js`.)
- Ctrl+C stops the server and the watchers; nothing is written to the project.

## Docs

- CLAUDE.md "How a video gets made": step 7-8 note `keep node $S/watch.mjs DIR open while editing`; "Re-timing to a
  different song" becomes `node $S/swap_song.mjs DIR NEWSONG`; code map lists swap_song.mjs and watch.mjs.
- SKILL.md: the swap row in the command table, a Watch section, and the swap flow in the Sync section.
- planner.md: while drafting, `watch.mjs DIR --brief` shows the brief live.

## Testing

- swap_song: two click tracks at 120 and 100 BPM; a project with a marker row (`at: 'drop'`) and a sync section.
  Assert: backup files present; `sync` cleared; song.json re-analysed at the new tempo with the same bars; report
  lines (tempo, to place: drop); `--bars` and `--start-bar` honoured; bad usage exit 2; a failing analyser restores
  the backup.
- To place: `/__sync/needed` lists `drop` until a marker named drop is saved; the page shows the list and the
  placeholder in the animation pane, then the animation once placed (Playwright, as sync-page tests do).
- watch: start on a scaffolded project; edit a table in index.html; assert the page reloaded (a changed DOM) and
  kept its playhead (within one frame); break the tables (syntax error) and assert no reload plus an error in
  `/__watch/status` and the panel; fix them and assert a reload; with a brief, a check_brief error appears and
  clears. `--brief` serves the brief's tables.
- Purity and existing suites unchanged.

## Verification before merge

- `npm test` green (bash; `export PATH=/opt/homebrew/bin:$PATH`).
- A manual run on a scratch copy of a launch chapter with Jack's Tease Me file (no new music downloaded): swap to a
  click track and back, place a marker, watch the page reload on an edit.
