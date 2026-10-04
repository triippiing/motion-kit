---
name: motion-video
description: Use when building or rendering a code-only motion video (HTML seek(t) page -> MP4) after a state plan is approved, or when asked to measure a song's BPM/beat grid for animation, re-time a piece to a new song (swap the song), watch a piece live while editing it, check the beat grid by ear or mark moments in the song (the sync page), render a preview, export a finished piece for Reels, TikTok, Shorts, X, LinkedIn, Discord or the web, or fix a loop that stutters. Scripts: doctor, new_project, analyze_song, swap_song, sync, watch, extract_theme, render, beat_stills, check_brief, export, safezones, build_catalog, gallery.
---

# Motion video

Everything lives in `~/.claude/skills/motion-video/` (a symlink made by `install.sh`; in a clone of the repo the same files are at `<clone>/skills/motion-video/`). Paths below are relative to that folder. Scripts put Homebrew on PATH themselves; for ad-hoc checks use `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`.

| Job | Command |
|---|---|
| Check tooling | `scripts/doctor.sh` |
| New project | `scripts/new_project.sh DIR SONG --bars 7 --states 12 [--size vertical] [--theme app.css] [--start-bar N \| --start-near SEC \| --from-start]` |
| Re-theme from a project | `python3 scripts/extract_theme.py app.css --out DIR [--map accent=--brand]` |
| Re-time to a new song | `node scripts/swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B \| --start-near SEC \| --from-start] [--no-open] [--port N]` (backs up, clears `sync`, re-analyses, lists the marker names to place, opens the sync page; see Sync) |
| Hear and fix the beat grid, try the analyser's suggestions, mark moments | `node scripts/sync.mjs DIR [--port N] [--no-open] [--song PATH]` (see Sync below) |
| Watch live while editing (reloads on save, re-runs check_brief) | `node scripts/watch.mjs DIR [--brief] [--port N] [--no-open]` (see Watch below) |
| Watch live with audio | `node scripts/render.mjs DIR --serve` → open URL, click |
| Beat stills + seam check | `node scripts/beat_stills.mjs DIR` |
| Preview render | `node scripts/render.mjs DIR --preview` |
| Section render (`--from`/`--to` are seconds) | `node scripts/render.mjs DIR --from 4 --to 8 --preview` |
| Final render | `node scripts/render.mjs DIR` → `DIR/out/video.mp4` |
| Check a brief's beat table | `node scripts/check_brief.mjs DIR [--no-loop]`: strict validation of the tables, then a frame check in Chromium (cursor past the stage edges, text past or cut off in its shape, and the safe zones when there is an Exports line); fix every error, resolve every warning. The table checks include: typing (input `text`, command `query`) still going when the next row starts (error); a `'down'`/`'up'` pair on a custom state gets the drag rules; a `press: true` click with under half a beat to arrive (warning: add an approach row aimed at the target first); duplicate keyed entries such as two bar-chart labels "Mon" (warning; aiming the cursor at one is an error) |
| Export for where it will be posted | `node scripts/export.mjs DIR --for reels,x,discord,web [--silent]` → `DIR/out/exports/` |
| Safe-zone previews (bands over the zones) | `node scripts/export.mjs DIR --for reels,tiktok --guides` |
| Safe-zone check on its own | `node scripts/safezones.mjs DIR --for reels,tiktok [--samples beats\|half]` |
| Render at another shape | `node scripts/render.mjs DIR --stage 1080x1920` → `DIR/out/shapes/1080x1920/video.mp4` |
| Components: rebuild the catalog | `node scripts/build_catalog.mjs` (writes `components/index.js` + `components/CATALOG.md`) |
| Components: watch or thumbnail them | `node scripts/gallery.mjs OUT [--only a,b] [--stills]` |

## Components

The library is in `components/`: 28 ready-made UI pieces (button, toggle, tabs, loader, toast,
line-chart, dock...) that each fill the one shape. A table row names one with `use:` and passes its
props; the cursor aims at its hotspots with `target:`.

- `components/CATALOG.md`: every component with its picture, when to use it, how it moves, props and hotspots. Pick from here first.
- `components/RECIPES.md`: five complete 7-bar sequences (onboarding, checkout, dashboard, AI reply, settings) to start from.
- `components/WRITING-A-COMPONENT.md`: how to add one when the library lacks it.
- Text stays inside the shape: the frame check (`scripts/framecheck.mjs`, run by check_brief) reports words that
  run past it or are cut off, measuring the words' own line boxes. `data-overhang` on an element (a tooltip above
  its point) is an opt-in hook for component authors (no built-in component uses it today); it only silences that
  check: `#shape` clips its overflow, so the element is still cut at the shape's edge.

## Build loop

1. Start from the approved `DIR/MOTION-BRIEF.md` (motion-design). If there is no approved brief, go back and make one.
2. Copy the `states()`/`cursor()` block under the brief's `## Beat table` over the example `states()` and `cursor()` in `DIR/index.html`
   (keep `node scripts/watch.mjs DIR` open in the background and give the user its URL: each save reloads the animation; see Watch). Rows with
   `use:` are library components (`components/CATALOG.md`); they need nothing else: no layer, no
   `content`. Only for something the library lacks, write a custom row (`name:` with `w`, `h`, `r`)
   plus a `.layer[data-state=NAME]` and a `content` function, or add a component
   (`components/WRITING-A-COMPONENT.md`). Edit only the tables: `states()`, `cursor()`, `content`,
   `extraSfx()`, plus a `.layer` per custom state name. `cursor()` rows take `press: true` (click), `press: 'down'`/`'up'`
   (hold, for drags), `sound: 'key'` (plays sfx/key.wav) and `hide: true` (fades the cursor out from that beat
   while it keeps moving; the next row without it fades it back in; a hidden row cannot press). Hide the cursor where it
   is not doing anything, e.g. `{ at: 3, x: 200, y: 230, hide: true }` after a press; `extraSfx()` returns `[{beat, file, gain}]`
   for any other cue. A row's `at` may also name a marker set on the sync page (`at: 'drop'`, optionally
   `offset` in beats; see Sync). Every `press: 'down'` needs a later `press: 'up'`. A drag is three rows: down, move, up (the move row sits strictly between them; a move written on the 'up' row starts only after the release, so the 'up' row repeats the move row's position). Each `content` function takes absolute `t` and runs every frame (use `since(stateName, t)`). Colours in STATES are theme roles (`canvas surface ink muted accent`)
   so the piece re-themes with the project (theme.json may also carry optional `pos`/`neg` roles when the CSS defines success/danger colours; use `var(--pos)` / `var(--neg)` in layers, and only when present); use CSS `var(--accent)` etc. inside layers, never hex. Keep the page contract: `window.ready`, `window.STAGE`,
   pure `window.seek(t)` that does not wrap `t`, `window.inspect(t)`, `window.SFX`.
3. Rules inside `seek(t)`: every style computed from `t`; no CSS transitions, animations,
   timers, `Date.now()` or variables written by an earlier frame; no `will-change`. Use
   `Springs.track` for anything that changes more than once; per-change `omega` for
   two-edge stretches; `fromSettle(seconds, zeta)` instead of raw stiffness. Timing comes from
   `beatT(beat)`, never hard-coded seconds.
   If the plan names a transitions.dev moment (success check, tabs sliding, toast...), rebuild it
   from `t` with springs using that transition's durations, distances and blur as starting values;
   never paste its CSS transitions or keyframes into the page.
4. `beat_stills.mjs DIR`, then **look at `out/stills/contact-sheet.png`** (Read the image).
   Fix anything off the grid, cramped, clipped or hard to read. Repeat until the seam check passes.
5. `render.mjs DIR --preview`, then the final render. Report the output path, duration,
   BPM and any song.json warnings.
6. Export for the brief's `**Exports:**` line: `node scripts/export.mjs DIR --for reels,x,discord,web`
   (its preset names, comma-separated, no spaces). Report each file, its size and loudness, and every
   warning from the output or `out/exports/manifest.json` (see Export below).

## Song rules (from song.json)
- `rules.spring` sets the house spring (ζ 0.85, settle 0.6 beat); the template already uses it.
- Outside 100–130 BPM: follow the warning (half-time events or half-beat accents).
- A commercial track is for local viewing: remind the user before they post. `export.mjs --silent` drops the audio.
- `song.json` `sync` (set on the sync page) belongs to the user: every `analyze_song.py` run keeps it and applies it.
  Re-timing to a **different** song? Use `node scripts/swap_song.mjs DIR NEWSONG` (see Sync, Swapping the song): it
  clears the `sync` section first, since its nudge, tempo and markers were set by ear against the old song.
- `song.json` `suggestions` (tempo map, swing, meter, pickup) are the analyser's guesses, never applied by
  themselves. When there are any, open the sync page before writing tables (see Sync, Suggestions): a kept one can
  change the beats, bars and loop length.
- The loop window: `analyze_song.py SONG --out DIR --bars N` picks the loudest window; `--start-bar B` starts on bar B,
  `--start-near SEC` on the bar nearest SEC seconds into the song, and `--from-start` on the downbeat of the song's
  first audible bar (a silent 1 after a pickup still counts; or the first pickup beat before it when
  `sync.pickup_beats` is set), so an intro can begin with the song; check it by ear, the downbeat it finds can be a
  beat or more off. The three cannot be combined; new_project.sh and swap_song.mjs pass them on.

## Sync

Only a person can hear whether the beat grid sits on the music. Claude cannot: never say the sync is
right. The sync page lets the user hear clicks over the song next to the live animation, fix the grid,
and mark named moments that table rows can then hit. It also lists the analyser's suggestions (a tempo map,
swing, a meter, a pickup) so the user can hear each one and keep or dismiss it.

```bash
node scripts/sync.mjs DIR [--port N] [--no-open] [--song PATH]
```

It serves DIR on 127.0.0.1 only, prints `sync page: http://127.0.0.1:PORT/__sync`, and opens it in the
browser (macOS `open`) unless `--no-open`. `--port` is 0 to 65535 (default 0: any free port). It keeps
running until stopped, so start it in the background (or let the user run it) and pass on the URL.
`--song PATH` first records where the original song is now (see Save). Bad usage exits 2 with `error: ...`.

**Layout.** Left: the project's own `index.html` in a frame, driven by `seek(t)` from the audio clock, so
what plays is what renders. Right: a zoomed waveform (about 2 bars) that follows the playhead, with bars
as strong lines and numbers, beats faint, swung half-beats fainter, and markers as orange flags. Under
it, the whole loop as a strip with the view's window on it, then the markers list (one line each: name,
song time m:ss.mmm, note; click a line to select the marker and move the playhead there; markers outside the
loop are listed as "outside loop" and cannot be jumped to). The selected marker's line holds a note field
("add a note"). Then the Suggestions list when song.json has any (see Suggestions below), then Play, Clicks,
Sounds right, Save, the
readouts (nudge, tempo, meter, swing) and a status line.

**Keys and mouse.**

| Key or action | Does |
|---|---|
| Space | play / stop (song, clicks and animation together) |
| ← / → | scrub the playhead 10 ms back / forward; with Shift, a quarter beat; with Alt, to the previous / next beat line. It wraps at the loop edges. Stopped, each step plays an 80 ms blip of the song there (no clicks), so you can hear exactly where M will drop a marker; playing, it seeks |
| Home | playhead to the loop start |
| ↑ / ↓ | nudge the grid 5 ms later / earlier; with Shift, 20 ms |
| T | tap the tempo; after 8 taps (a gap over 2 s starts again) the readout shows the tapped BPM |
| Enter | apply the tapped BPM (40 to 240); it replaces a kept tempo map (its row then reads "removed"), since a map wins over a tempo on Save |
| M | drop a marker at the playhead and type its name; Enter keeps it, Esc (or clicking away) drops it |
| click a flag, then type in "add a note" | select a marker (its line in the markers list then shows a note field, pre-filled) and write a note on it. Enter or clicking away keeps a changed note, Esc drops the edit, an empty note removes it; Save or Ctrl/Cmd+S writes it (Ctrl/Cmd+S inside the field keeps it and saves in one step). Hover a flag to read its note. A note (at most 200 characters) is for people only: it never moves the grid and does not clear "Sounds right" |
| N | focus the selected marker's note field |
| Delete or Backspace | remove the selected marker (right-click a flag does the same) |
| C | clicks on / off (the downbeat click is higher; on a swung grid the off-beat click is lower and quieter) |
| Esc | clear the selection and any taps |
| Ctrl+S or Cmd+S | Save. It also works while typing a marker name: the marker is kept first, and an empty or invalid name stops the Save |
| drag a flag | move a marker (it stays inside the loop) |
| click the waveform | move the playhead |
| wheel / Ctrl+wheel | scroll / zoom the waveform (0.5 to 8 bars) |
| the loop strip | click anywhere to move the playhead there and centre the view on it (playing, the song and clicks carry on from there; stopped, a short blip plays); drag the view's window to pan the view without moving the playhead |
| "use detected" | drop a tapped tempo and go back to the detected one |
| Meter, Swing | 4/4, 3/4 or 6/8 (6/8 counts two dotted beats a bar); swing 0.50 (straight) to 0.75, 0.67 is triplet |
| Sounds right | records today's date as `checked_by_ear` (the button then reads "Checked DATE") |

Leaving the page with unsaved changes asks first.

**The status line.** It shows the confidence (with "(low: check by ear)" under 0.5), whether the grid is
checked by ear, any markers outside the loop, and:

| Says | Means |
|---|---|
| grid follows detected hits | each beat sounds on the detected hit near it (`cue_t`), as the analyser measured |
| even grid: detected hits off | a nudge (other than 0), a tapped tempo or a tempo map is set (saved or pending), so the ear wins: every beat sits exactly on the user's grid (even, or at the map's tempo), with no snapping to detected hits. It switches on the first nudge or tempo change, so that first press can move some clicks by more than 5 ms. A meter change alone does not switch it |
| preview is approximate until you save | a tempo or meter change is pending. The clicks follow an even grid at the new tempo over the **old** loop length, so expect a flam at the loop seam; the animation keeps the saved tempo. Save fits the real grid. Save keeps `--bars N`, so a tempo change alters the loop's length in seconds and a meter change alters its length in beats (bars times beats a bar): afterwards re-read song.json's `beats` and `loop.duration_sec` and redo the bars and the tables |
| unsaved changes / saving: re-cutting the clip / saved HH:MM:SS | the Save state |

Nudge and swing preview exactly (clicks, lines and animation). Swing does not clear "Sounds right" (the
beats themselves do not move); a nudge, tempo, meter, tempo map or pickup change does, and the server applies the
same rule as a backstop.

**Suggestions.** Every `analyze_song.py` run writes a derived top-level `suggestions` object to song.json (rebuilt
each run, never user data). Each entry has a `confidence` (0..1) and a one-line `reason`:

| Key | Proposes | Keep sets |
|---|---|---|
| `tempo_map` | `segments` `[{t, bpm, ramp}]` (song seconds) for a song whose tempo steps or ramps, plus the suggested `beats` | `sync.tempo_map` |
| `swing` | `value`, the off-beat's place in the beat; with `bpm` when a shuffle's triplets pulled the measured tempo to about 4/3 of the real one | `sync.swing` (and `sync.bpm`) |
| `meter` | `3/4` or `6/8` | `sync.meter` |
| `pickup` | `beats` with audible onsets before the first downbeat | `sync.pickup_beats` |

The page lists them above the controls ("tempo map: 72 → 144 at 1:52", "swing 0.62 and tempo 96.6", "meter 3/4",
"pickup: 2 beats"), with the confidence and reason and three toggles:
- **Try**: the clicks and grid lines switch to the suggested grid (a tempo map plays its own `beats`; swing and meter
  apply to the current grid like the controls' previews). Press again to stop. Nothing is saved. A pickup has no
  Try: it only applies to a loop made with `--from-start` (the row says so, and how to make one).
- **Keep**: puts its fields into the pending sync; Save re-runs the analyser, which fits it. Keeping a tempo map,
  a tempo, a meter or a pickup clears "Sounds right", as those controls do; a swing alone does not. Keeping a tempo
  map drops a pending tempo, and keeping a swing that carries a tempo drops a tempo map (a map wins over a tempo on
  Save, so the page keeps only the one it previews); keeping it again puts back what it replaced.
- **Dismiss**: adds `{ "key", "value" }` to `sync.dismissed` (pending until Save); it stays hidden until the
  analyser's value for that key changes. Dismiss on a kept one un-keeps it first.

A tempo map or a pickup already saved in the sync is listed first as **kept** ("tempo map: 90 → 120 at 0:19 ·
kept"), with **Remove**: it takes the field out of the pending sync (a grid change, so it clears "Sounds right"; the
row then reads "removed: save to apply"), again puts it back, and Save applies it (the analyser may then suggest it
afresh). A tapped tempo replaces a kept tempo map the same way.

A tempo-map suggestion is offered alone: swing, meter and pickup would be measured on the single steady grid the map
says is wrong, so they appear after the map is kept or dismissed and saved. A suggestion equal to what the sync
already uses is not offered: no tempo map once `sync.tempo_map` is set, and no swing when the meter is (or is
suggested as, not dismissed) 6/8, whose thirds read as swing. A straight, steady 4/4 song gets none, and with none the page is as before. They are
guesses: Claude cannot hear, so never keep one for the user, and say which ones there are when handing over the page.

**What Save does.** Save sends the `sync` section to the server, which:
1. writes it into `DIR/song.json` and keeps the previous file as `DIR/song.json.bak`;
2. re-runs `analyze_song.py` on the **original song** (its absolute path is in `DIR/.source.json`, written
   by the analyser; local and git-ignored, never commit it) with the project's `--bars` and `--fps` and
   `--start-near` the current loop start, so the loop window stays put while the bars renumber (a loop made with
   `--from-start` gets `--from-start` again, so it still starts with the song);
3. which rebuilds `song.json` and re-cuts `clip.wav` (a nudge or tempo change moves the cut). The page
   then reloads the grid, the audio and the animation.

If anything fails, the previous `song.json` is put back and the page shows the error. If the song has
moved, the error says `... record where the song is with: node sync.mjs DIR --song PATH`: run
`node scripts/sync.mjs DIR --song /new/path/song.mp3` and Save again.
If the analyser runs longer than 120 s (MK_ANALYSER_TIMEOUT, in ms, changes it), Save stops it, puts the previous song.json back and reports the error.

The `sync` section it writes:

| Key | Meaning | Default |
|---|---|---|
| `nudge_ms` | shifts every beat earlier (negative) or later; markers do not move | 0 |
| `bpm` | tapped tempo: the grid is fitted at it instead of the detected one | `null` |
| `meter` | `4/4`, `3/4` or `6/8` (beats per bar 4, 3, 2) | `4/4` |
| `swing` | where the off-beat sits inside a beat, 0.5 to 0.75 | 0.5 |
| `tempo_map` | `[{ "t", "bpm", "ramp" }]`: `t` song seconds, sorted, the first 0; `bpm` 40 to 240; `ramp: true` means the tempo moves linearly from the previous anchor to this one (else it steps at `t`). Replaces `bpm`: the grid is laid at the map's tempo, each span's phase fitted to the song, so `cue_t` equals `t` and tables in beats work unchanged; song.json's `bpm`, `beat_sec` and `rules` then come from the loop's mean beat. Set by keeping a tempo-map suggestion | absent |
| `pickup_beats` | beats before the first downbeat, 0 to beats a bar − 1. They are bar −1 (`beats[i].bar`); only a loop made with `--from-start` starts on them, and it then holds the pickup plus `--bars` bars | 0 |
| `dismissed` | `[{ "key", "value" }]`: suggestions the user dismissed (`key` one of `tempo_map`, `swing`, `meter`, `pickup`; `value` the suggestion's value then) | `[]` |
| `markers` | `[{ "name", "t", "note" }]`, `t` in seconds from the start of the song file; `note` is optional free text (at most 200 characters) and never affects timing | `[]` |
| `checked_by_ear` | the date "Sounds right" was pressed | absent |

The analyser validates it (a bad value is `error: ...`, exit 2) and lists the markers for the current
loop as top-level `markers: [{ name, song_t, t, in_loop, note }]` in `song.json` (`t` in loop seconds;
`note` only when the marker has one).

**Swapping the song.**

```bash
node scripts/swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B | --start-near SEC | --from-start] [--no-open] [--port N]
```

In order: checks DIR has a song.json and NEWSONG is a readable file (else `error: ...`, exit 2); copies song.json,
clip.wav and .source.json (those present) to `DIR/.swap-backup/<YYYYMMDD-HHMMSS>/` (ignored in this repo; keep it out of
your own commits: audio and a local path); lists the marker names the tables use (index.html's table block and the brief's `## Beat table` block, every
`at:` that is a string); removes `sync` (and the derived `markers`) from song.json; runs
`analyze_song.py NEWSONG --out DIR --bars N` with the project's `loop.bars` (or `--bars`), its `fps`, and
`--start-bar` / `--start-near` / `--from-start` when given (without them the analyser picks the loop window afresh for the new song,
so pass `--start-bar` to keep a window chosen by hand). If the analyser fails, the backup is put back and the project is as it
was; Ctrl+C while it runs stops it, puts the backup back and keeps the backup directory. Then it prints:

```
tempo: 109.00 -> 124.02 BPM (confidence 0.71)
loop: 7 bars = 13.55 s (was 15.41 s)
window: bar 0 -> 23 (pass --start-bar 0 to keep it)   (or: window: bar 21 (unchanged))
to place: drop, chorus                       (or: no markers to place)
warning: the tables have 14 states; the new song allows 12 (shorten the table or pass --bars)   (only when over)
reminder: update the brief's Song/Music line if the licence changed                           (only with a brief)
backup: DIR/.swap-backup/20261004-142233
```

and, unless `--no-open`, runs `node scripts/sync.mjs DIR [--port N]` in the foreground (start it in the background
and pass on the URL, as for sync.mjs). The swap never edits the tables: placing each listed name on the sync page
makes them work again. Ask the user to listen again too (the grid is the analyser's until they press Sounds right).

**To place.** The page asks the server (`GET /__sync/needed`, `{ "names": [...] }`) for the marker names the tables
use that `sync.markers` has not placed, and lists them as "To place" above the markers list (hidden when empty).
Click a name, then press M: the marker drops at the playhead with that name. Save, and the list shrinks. While a
saved name is still to place, the animation pane shows `place these moments to see the animation: drop, chorus`
instead of tables that would throw; once a Save leaves nothing to place, the animation loads. A table name that is
not a valid marker name (see below) is listed but cannot be picked, with the note `rename it in the table: marker
names are lowercase letters, digits and -`. check_brief's unknown-marker error ends
`(after a song swap, place it on the sync page: node sync.mjs DIR)`.

**Markers in tables.** A `states()` or `cursor()` row can sit on a marker by name, with an optional
`offset` in beats:

```js
{ at: 'drop', offset: -0.5, target: 'button' }        // cursor(): the approach, half a beat before
{ at: 'drop', target: 'button', press: true }         // cursor(): the press, exactly on the marker
{ at: 'drop', offset: 0.5, use: 'check', label: 'Done' }  // states(): its result, half a beat after
```

Put the action on the marker and its result after it; a lead (`offset: -0.5`) is for the approach only.

- Names are lowercase letters, digits and `-`, starting with a letter. Marker names (`at:`) and hotspot
  names (`target:`) are separate: a marker called `button` does not clash with the `button` hotspot.
- The row resolves to the marker's exact beat (fractional, swing included) before any rule runs, so
  holds, the state budget and the seam treat it like a numeric row. Rows must still be in beat order.
- Errors (from `check_brief.mjs`, and thrown by the page) name the marker, and give a marker's beat rounded
  to 3 places, e.g. `states() row 3: unknown marker 'drp' (did you mean 'drop'?)`,
  `cursor() row 5: marker 'drop' is outside the loop (at 1:42 in the song)` and
  `rows must be in ascending beat order (beat 9.309 ('drop') after 10)`. With no markers at all the hint is
  `song.json has no markers; mark them with sync.mjs DIR`. An `offset` on a numeric row is an error:
  `offset at beat N only goes with a marker, e.g. { at: 'drop', offset: -0.5 }`.
- While the grid follows detected hits, a beat's cue can sit a little off the even grid, leaving short
  gaps no beat covers. A marker in such a gap resolves to the nearest whole beat. After a nudge or tempo
  change the grid is even and there are no gaps.

**Known limits.**
- A loop window that ends at the very end of the song cannot be nudged or re-tempoed: Save fails with
  "the loop window would end past the end of the song". Move the loop window first with
  `python3 scripts/analyze_song.py SONG --out DIR --bars N --start-bar B`, or `--start-near SEC` to start on the bar
  nearest a time in the song (the strip on the page moves the playhead and view inside the loop, never the loop window).
- Markers outside the loop are listed in the status line and the markers list ("outside loop") but not drawn, so they cannot be dragged on the
  page. To remove one, click its line in the markers list (that selects it), press Delete, then Save. To move
  one, edit its `t` in `song.json` `sync.markers` with the page closed, then open the page and Save (Save
  re-runs the analyser even with nothing changed). Or move the loop window to include it.
- Save does not pass `--states`, so a "states need N beats" warning from `new_project.sh` is not repeated.
- Older projects. One copied before `components/core/timing.js` existed still works on the page: sync.mjs
  serves the kit's timing module at `/__sync/timing.js` as a fallback. But a `components/` copy from before
  markers does not know `at: 'drop'` (its engine rejects it), so copy a fresh `components/` in before using
  markers. `check_brief.mjs` validates with the kit's own rules and the project's component registry, and
  refuses marker rows when the project's copy is too old (no `components/core/timing.js`): "the project's
  components/ copy predates markers; copy a fresh components/ in (see SKILL.md, Older projects)". An older
  `index.html` also lacks `window.rebuild(song)`, the template's hook used only by the sync page, so the
  animation shows the saved grid while you edit and is reloaded after each Save. Its inline `beatT` also
  ignores swing, while render's sound cues (from `components/core/timing.js`) apply it, so on a swung grid
  the animation and the sounds disagree on the off-beats until the page uses the kit's `beatTime`.
- Older projects and `hide`. A `components/` copy from before cursor `hide` rejects it: its engine throws at page load
  with `unknown cursor key "hide" at beat N (keys: ...)`. `check_brief.mjs` refuses a brief with any `hide` key when
  the project's copy is too old (its `components/core/validate.js` does not list `'hide'` in `CURSOR_KEYS`, or its
  `core/engine.js` never reads `.hide`): "the project's components/ copy predates hide; copy a fresh components/ in
  (see SKILL.md, Older projects)". The safe-zone check skips the cursor while it is hidden (opacity under 0.05).
- Older projects and the typing and duplicate checks. A `components/` copy from before them lacks `meta.typing` and
  `meta.unique`, so `check_brief.mjs` silently skips those two checks for it (typing that overruns its row, duplicate
  keyed entries). Copying a fresh `components/` in can make the page refuse a table that rendered before (typing that
  overruns its row, or a cursor aimed at a duplicate entry); the error says what to change. An `index.html` without
  table markers now gets the "index.html has no table markers" note on every `check_brief.mjs` run.
- A project with no `.source.json` (analysed before it existed) needs `--song PATH` once.
- The kit's page server (`serve()` in render.mjs, used by render, beat_stills, gallery, export, safezones, check_brief's
  safe-zone check and sync)
  refuses any file in the project that is a symlink to somewhere outside it. `new_project.sh` copies files
  rather than linking them, so its projects are unaffected.

## Watch

```bash
node scripts/watch.mjs DIR [--brief] [--port N] [--no-open]
```

A live preview for editing the tables. It serves DIR on 127.0.0.1 only, prints
`watching: http://127.0.0.1:PORT/__watch` and opens it (macOS `open`) unless `--no-open`; it runs until stopped,
so start it in the background and pass on the URL. `--port` is 0 to 65535 (default 0: any free port). Bad usage
exits 2 with `error: ...`.

- The page plays clip.wav (click "Click to play"; Space plays and stops) and drives the project's `index.html` in an iframe with `seek(t)`.
- It watches `index.html`, `MOTION-BRIEF.md`, `song.json`, `theme.json`, `theme.css`, `project.json` and
  `components/`; changes within 200 ms are one. On a change it first runs the tables that will be served and checks
  them with the engine's validator (non-strict, as the page does): if they throw or fail it (a syntax error, an
  unknown marker, a component typo), the version stays, the terminal prints `error: ...`, the page keeps the last
  good frame and its panel shows the error; otherwise it prints `reloaded (version N)` and only the iframe reloads,
  so the song and the playhead carry on. A new song (a swap, a moved loop) reloads the audio too.
- The page loads each new version into a second, unseen iframe and swaps it in only once its `ready` resolves. If it
  fails there instead (an error only the browser sees, such as a throw in `content`), the old frame stays, the panel
  shows the error, and the page sends it to the server (`POST /__watch/page-error`): the terminal prints
  `error: ...` and the status carries it until the next reload. A broken table never blanks the preview.
- When `MOTION-BRIEF.md` exists, check_brief re-runs after each reload (frame check included, a few seconds) and
  prints as its CLI does (`warning:` / `error:` lines, then `brief OK` or `brief has N error(s)`). The page's corner
  panel shows the same, plus the page's own errors: errors red, warnings amber, `brief OK` green; click to collapse;
  a dot when all is clean. `GET /__watch/status` returns `{ ok, errors, warnings, at, version, brief }`.
- `--brief` serves the brief's tables spliced into index.html (as check_brief's frame check does), so it works while
  planning, before the tables are pasted in. Until the brief's tables first pass, index.html is not served: the
  frame waits and the panel and status say so. Without it, index.html as is.
- Nothing is written to the project; Ctrl+C stops the server. A watcher that fails (the folder removed) prints
  `error: ...` and stops it. It is a preview: the render is still the reference.

Watch reads the project's components/ once, when it starts: after changing a component's props, geometry or meta, or adding one, restart watch (until then its check can report false errors and hold good saves).

## Export

```bash
node scripts/export.mjs DIR --for reels,x,discord,web [--silent]
```

`--for` is required: a comma-separated list of preset names (a typo gets a did-you-mean). The presets
live in `presets.json` at the root of this skill. Each platform limit there was researched from the
platform's own docs and carries a `source` URL and a `checked` date (`web` and `gif` are house defaults,
with no source); values that could not be sourced
(every loudness target and several safe zones, including TikTok's and Shorts'; the zero margins of the feed and chat presets are marked too; Reels' zones come from Meta's ads guidance) are listed in the preset's `estimated` field, which the
manifest copies for every file.

| Group | Preset | Size | fps | Max length | Size cap | Audio |
|---|---|---|---|---|---|---|
| Reels / TikTok / Shorts | `reels` | 1080x1920 | 30 | 900 s | 300 MB | yes |
| | `tiktok` | 1080x1920 | 30 | 600 s | 4000 MB | yes |
| | `shorts` | 1080x1920 | 60 | 180 s | none | yes |
| X / LinkedIn | `x` | 1200x1200 (from the 1440 square) | 30 | 140 s | 512 MB | yes |
| | `x-landscape` | 1920x1080 | 30 | 140 s | 512 MB | yes |
| | `linkedin` | 1440x1440 | 30 | 600 s | 5000 MB | yes |
| | `linkedin-landscape` | 1920x1080 | 30 | 600 s | 5000 MB | yes |
| Discord / chat | `discord` (free) | design | 60 | none | 20 MB | yes |
| | `discord-nitro` | design | 60 | none | 1 GB (stored as 1000 MB) | yes |
| Web / wiki / GitHub | `web`: MP4 + WebM + poster JPG | design | 60 | none | none | yes |
| | `gif`: README GIF | 720 wide | 15 | none | 10 MB | none |

"design" is the project's own stage (`project.json`). Only `discord` and `discord-nitro` are private;
every other preset is public. `x` renders the 1440 square and scales it to 1200x1200, because X documents
1920x1200 (or 1200x1900) as its largest upload.

**What it writes.** `DIR/out/exports/<preset>.mp4` (plus `web.webm` and `web.jpg` for `web`, `gif.gif`
for `gif`) and `DIR/out/exports/manifest.json`, which records every file: size, duration, resolution,
fps, codecs, measured LUFS and true peak, any step-down, notes, warnings, the preset's `source`/`checked`
and its `estimated` fields. A later call merges into the manifest: its presets' entries (and its render
sizes) replace the old ones, and other presets' entries stay while their files still exist, so two calls
(say `--for reels,x --silent`, then `--for discord`) leave one manifest listing both. It prints one line per
file (this call's), then the manifest path.

**Renders.** Presets are grouped by size and each size is rendered once (60 fps, 4 subframes) into
`DIR/out/shapes/<W>x<H>/video.mp4`, with the stage swapped in as the page is served (`project.json` on
disk is never changed). Export never overwrites `DIR/out/video.mp4`. It reuses `out/video.mp4` (for the
design size) or an earlier shape render only when its `.render.json` stamp matches exactly (a full-quality,
full-loop render at that size by the current renderer: render.mjs, the engine, ffmpeg's version and
Playwright's Chromium), it lasts the loop, and no project file changed after that render started (the
stamp's `sources`, taken at render start, so an edit saved mid-render counts). Anything else (a preview, a `--from`/`--to` section, an old render, including any made before stamps recorded `sources`) is rendered again, once.

**Encoding.** Each preset is encoded from its size's render: frame rate dropped to the preset's fps,
scaled, H.264 at the preset's CRF (capped by its maxrate), AAC. Over the preset's max length is a warning,
not an error.

**Size caps.** When the CRF encode is over the preset's cap, it is re-encoded two-pass at the bitrate that
fills the cap (aiming 3% under, then 7% under on one retry). If that bitrate is below the quality floor
for the size, the resolution steps down by short side (1080, then 720, then 540; a 1440 square steps to 1080
first) and the manifest records the step-down. If no size works, the export stops:

| Exit | Meaning |
|---|---|
| 2 | the cap is impossible on the numbers: at that length, after the audio's share, even 540 short side would be under its quality floor. The message says what to change (raise the cap, shorten the piece, or `--silent`) |
| 1 | the cap was still missed after encoding (two-pass, GIF narrowing, or a WebM or JPG over it), or any other runtime failure (an ffmpeg or render error) |

Both print `error: ...`. Every file is staged first, so a failed export writes nothing into
`out/exports` (no files, no manifest). A GIF over its cap is narrowed by 0.8 up to 4 times.

**Loudness.** Every preset with audio targets -14 LUFS integrated with a -1 dBTP true-peak ceiling (two-pass
`loudnorm`, then measured). A file more than 1 LU off target, or more than 0.5 dB over the ceiling, gets a
warning. The AAC encode itself can push true peak over the ceiling: ffmpeg's native `aac` adds a few dB of
overshoot on sharp transients such as the click and key sounds, even when `loudnorm`'s output is under it (on
demo 04, -2.4 dBTP after `loudnorm` became about +1 in the file). So the audio is encoded on its own, measured,
and on a miss re-encoded down a ladder of AAC coders: native `aac`, then `aac -aac_coder fast`, then Apple's
`aac_at` where ffmpeg lists it (macOS). The video is encoded once and the audio muxed in, so a retry never
re-encodes video; the manifest's `audioCoder` says which coder each file used, and a note says when it was not
the default. Lowering the ceiling does not help (the overshoot moves with it). If every coder misses, the
warning stays. Very peaky audio (a click track, sparse hits) can also miss because `loudnorm` falls back to its
dynamic mode; a near-silent clip (below -50 LUFS) is not normalised and gets a note. WebM (Opus) is unaffected.

**`--silent`** drops the audio from every file (use it for public posts of a commercial track).

**Commercial music.** When the brief's Decisions say the song is commercial (`**Song:** ..., a commercial
track`, where track can also be song, music, release or recording; or `**Music:** commercial`), or
`project.json` has `"music": "commercial"`, every public preset that carries audio gets a warning to export
with `--silent` or use a licensed track. Negated or licence wording ("not a commercial track", "licensed
for commercial use") does not count.

**Safe zones.** Reels, TikTok and Shorts cover the bottom and sides with captions and buttons (the feed,
chat and web presets have none). `check_brief.mjs` checks the brief's tables against them when the
brief has an `**Exports:**` line, in the same Chromium frame check it always runs; each issue is a warning, to resolve or justify.
To check a project on its own: `node scripts/safezones.mjs DIR --for reels,tiktok` (exit 1 when anything
enters a zone, e.g. "beat 12: shape extends 40 px into the Instagram Reels bottom zone"). To see them:
`node scripts/export.mjs DIR --for reels,tiktok --guides` renders a half-size preview per preset with
translucent bands over its zones, to `DIR/out/shapes/<W>x<H>/preview-guides-<preset>.mp4`, and exports
nothing (`node scripts/render.mjs DIR --guides reels` makes a full-size one,
`DIR/out/shapes/1080x1920/guides-reels.mp4`; add `--preview` for `preview-guides-reels.mp4`). Guides are
never stamped, so they never reach an export. On a vertical piece rest the cursor near the centre
(e.g. `x: 140, y: 100`): the template's `x: 240, y: 280` sits in the Reels, TikTok and Shorts zones.

## Long pieces, 4K and launch videos
No hard limits: `--bars 28` is about a minute at 109 BPM; `--size 3840x2160` is 4K. Components are sized
for a 1440 stage; on a bigger stage the engine scales the camera and cursor by
`K = max(1, min(W, H) / 1440)` itself (never below 1, so 1080-wide stages are unchanged), so the design keeps its proportions (set `"designScale": N` in `project.json` to override K).
Full-quality 4K renders at about 19 s per second of video on an Apple M5: measure with `--from 0 --to 5`
first, iterate with `--preview`, and render in full once.

A piece that does not loop (a launch video that ends on its own end card): add `"loop": false` to
`DIR/project.json`. The page then allows a last row that differs from the first, `check_brief.mjs`
checks it as a one-off, `render.mjs` clamps its motion blur at both ends instead of blending the end
into the start, and the seam check in `beat_stills.mjs` can be ignored. `--serve` with `?play` still
loops playback (it is a preview; the rendered MP4 plays once).

## When the loop stutters
Seam check failing on frame: the last STATES/CURSOR row must equal the first and be
≥ 2 beats before END. Failing on cursor velocity: the last cursor move is too late.
