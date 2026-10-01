# Sync page (sub-project C1): design

Date: 2026-10-01
Status: approved in conversation, awaiting spec review
Part of: the motion-kit roadmap (A and B done; C split into C1 this, and C2 harder songs and speed;
then D narrative, E real-app footage, F hardening)

## Purpose

Only a human ear can confirm that a beat grid sits on the music. Today the kit measures a grid
(`analyze_song.py`), reports a confidence (Tints: 0.39), and offers no way to hear the grid, fix it,
or say "this is right". C1 adds a browser sync page where the user hears clicks over the song, sees
the grid on a waveform next to the real animation, nudges it, taps the tempo, sets swing and time
signature, marks named moments, and saves. Tables can then hit those moments by name.

Jack's goals for C (all four chosen): trust the grid, harder songs, sync to moments, faster iteration.
C1 covers trust, moments and the live animation; C2 covers tempo-change detection, swing and meter
suggestions, one-step song swap, and watch mode, filling in the data format C1 defines.

Success means:
1. `node sync.mjs DIR` opens a page that plays the loop with beat clicks and the live animation in
   lockstep, and shows the grid and markers on a scrolling waveform.
2. Nudge, tap tempo, meter, swing and markers can be set on the page; Save persists them in
   `song.json` and they survive any re-analysis.
3. A table row can use `at: 'drop'` (optionally with `offset` in beats) and hits the marker's exact
   time, even between beats; the validator and `check_brief` understand markers.
4. A project without a `sync` section renders exactly as today (same frame times).
5. The planner flags an unchecked low-confidence grid and asks about moments; the brief records it.
6. Demo 04 is checked by ear on the page, one moment is marked and used, and the result is re-rendered.

## Non-goals (C1)

- Detecting tempo changes, swing or meter from audio (C2). C1 supports them in the data format and
  timing, set by hand.
- Song swap and watch mode (C2).
- Marking moments outside the loop window (move the window with `--start-bar` first).
- Editing the animation tables on the page (the page is for timing; tables stay in the brief).

## Data: the `sync` section of song.json

```json
"sync": {
  "nudge_ms": -18,
  "bpm": null,
  "meter": "4/4",
  "swing": 0.5,
  "markers": [{ "name": "drop", "t": 42.310 }],
  "checked_by_ear": "2026-10-01"
}
```

| Field | Meaning | Default |
|---|---|---|
| `nudge_ms` | Shifts every beat earlier (negative) or later; markers do not move (they were placed by ear against the audio) | 0 |
| `bpm` | Tap-tempo override: the grid is fitted at this tempo instead of the detected one | `null` (use detection) |
| `meter` | `4/4`, `3/4` or `6/8`; sets beats per bar (6/8 counts two dotted beats per bar; if detection locked onto the eighth notes, tap the dotted beat to set `bpm`) | `4/4` |
| `swing` | Position of the off-beat inside a beat, 0.5 (straight) to 0.75; 0.667 is triplet swing | 0.5 |
| `markers` | Named moments in **song time** (seconds from the start of the file), so they survive moving the loop window. Names: lowercase letters, digits and `-`, unique | `[]` |
| `checked_by_ear` | Date the user pressed "Sounds right"; cleared when the grid changes afterwards | absent |

- The section is owned by the user. `analyze_song.py` always preserves it and applies it when building
  the grid: `bpm` replaces the detected tempo for the grid fit, `meter` sets `beats_per_bar`, and
  `nudge_ms` shifts every beat time.
- **The ear wins over detection:** when `nudge_ms != 0` or `bpm` is set, each beat's `cue_t` equals its
  grid time (no snapping to detected onsets), so the grid sits exactly where the user put it.
- The analyser also writes a derived top-level `markers` list for the current loop:
  `[{ "name", "song_t", "t" (loop time), "beat" (exact, fractional), "in_loop": true|false }]`.
- `swing` is not baked into beats; it is applied by `beatT` (below) so whole beats never move.
- Validation: bad values in `sync` (unknown meter, swing outside 0.5 to 0.75, duplicate or invalid
  marker names, non-numeric times) are an `error: ...` with exit 2 from the analyser.

## Timing: beatT, swing and markers

- `beatT(b)` interpolates between consecutive beats instead of adding a fraction of the average beat:
  `t = beats[i].t' + warp(f) * (beats[i+1].t' - beats[i].t')`, where `t'` is `cue_t ?? t`, `f` is the
  fractional part of `b`, and after the last beat it falls back to `beat_sec`.
- `warp(f)` is the swing curve: piecewise linear through `(0,0)`, `(0.5, swing)`, `(1,1)`.
  With swing 0.5 it is the identity.
- One implementation, shared: `beatT` moves into a small pure module (`components/core/timing.js`,
  copied into projects like the rest of `components/`) used by the template, the engine, render's sound
  cues, `beat_stills.mjs`, export's poster time and the validator. Today's copies are replaced.
- **Parity:** with no `sync` section, every beat and half-beat time equals today's to within 1e-9 s on
  the fixtures and demos 01, 02 and 04 (today the grid is uniform, so interpolation equals the old sum).
- **Markers in tables:** a row's `at` may be a marker name (`at: 'drop'`) with an optional
  `offset` in beats (`{ at: 'drop', offset: -0.5 }`). The engine resolves it once to an exact beat
  number (`marker.beat + offset`, where `marker.beat` is the inverse of `beatT`, swing included, so
  `beatT(marker.beat)` equals the marker's loop time) before anything else runs, so holds, budget, quiet beats and the loop
  seam use the same arithmetic as numeric rows.
- **Validator / check_brief:** an unknown marker name is an error with did-you-mean; a marker with
  `in_loop: false` used in a table is an error; a row resolved from a marker may fall between beats
  and still counts as on time for the quiet-beat rule. `check_brief` reads markers from the project's
  `song.json`.

## The sync page

```
node $S/sync.mjs DIR [--port N] [--no-open]
```

`sync.mjs` reuses `serve()` from `render.mjs` (one server, two added routes: `GET /__sync` for the page,
`POST /__sync/save` for saving), opens the browser unless `--no-open`, and prints the URL. It binds to
127.0.0.1 only.

**Layout (Jack's choice: side by side, like FL Studio's playlist):**
- Left: the real animation, the project's own `index.html` in an iframe, driven by `seek(t)` from the
  page's clock, so what plays is what renders.
- Right, top: a zoomed waveform (about 2 bars) that scrolls with the playhead. Bars are strong lines,
  beats faint, half-beats fainter when swing is not 0.5 (drawn at their swung positions). Markers are
  orange flags with their name; drag to move, Delete or right-click to remove. Mouse wheel scrolls,
  Ctrl+wheel zooms, click moves the playhead.
- Right, below: the whole loop as a strip; drag the highlighted window or click to jump.
- Controls under them: play, nudge readout, tap/BPM readout, meter dropdown, swing slider, clicks
  toggle, "Sounds right", Save, and a status line (confidence, unsaved changes, last save).

**Keys:**

| Key | Action |
|---|---|
| Space | Play / stop (animation and audio locked together) |
| ← / → | Nudge the grid 5 ms earlier / later; Shift for 20 ms |
| T | Tap tempo: after 8 or more taps the page shows the tapped BPM; Enter applies it |
| M | Drop a marker at the playhead, then type its name |
| C | Clicks on / off (downbeat accented) |
| Ctrl+S | Save |

**Audio:** the page decodes `clip.wav` with the Web Audio API and schedules clicks on the audio clock
(not timers), so clicks and song stay sample-accurate. The waveform is drawn from the decoded audio.

**Preview vs save:** nudge and swing preview instantly (the page recomputes the grid and `beatT` in the
browser with the shared timing module). Tempo and meter changes preview approximately and become exact
on Save. Nothing is written until Save; leaving with unsaved changes asks first.

**Save:** `POST /__sync/save` with the new `sync` object. The server validates it, copies `song.json` to
`song.json.bak`, writes `sync`, re-runs `analyze_song.py` for this project (same song, bars and window as
`song.json` records), and returns the new `song.json`; the page reloads the grid and the animation. If
the analyser fails, the server restores the previous `song.json`, returns the error, and the page shows
it. The save route only ever writes `song.json` and `song.json.bak` inside DIR. Changing the grid after
"Sounds right" clears `checked_by_ear` until it is pressed again.

**Re-running the analyser needs the song file.** `song.json` stores only the basename (privacy). The
analyser gains `--reapply DIR`: it re-applies `sync` using the cached analysis it writes alongside
(`DIR/.analysis.json`: the detection results it needs, no audio), so saving never needs the original song.
Projects without the cache fall back to asking for the song path once (`sync.mjs DIR --song PATH`).

## Planner and docs

- `planner.md` assessments: after measuring the song, if `bpm_confidence < 0.5` and `sync.checked_by_ear`
  is absent, ask the user to open the sync page (`sync.mjs DIR`) before the brief. Ask "Any moments to
  hit (a drop, a vocal)? Mark them on the sync page" and plan those rows with `at: 'name'`.
- Brief Decisions gain `**Sync:** checked by ear 2026-10-01; markers: drop, vocal` or
  `**Sync:** not checked (confidence 0.39)`.
- `check_brief.mjs` warns when confidence is below 0.5 and the grid is not checked by ear.
- `skills/motion-video/SKILL.md` gains a "Sync" section (the command, keys, what Save does, markers in
  tables); `CLAUDE.md` gains the step and the code map entries; README a short "Syncing" section.
  No em or en dashes in new prose.

## Testing

- Parity: no `sync` gives identical beat and half-beat times on fixtures and demos 01, 02, 04.
- Timing module: interpolation over a drifting grid, the swing warp (0.5 identity, 0.667, 0.75 bounds),
  marker resolution with offsets, the last-beat fallback.
- Analyser: preserves `sync` across re-runs and `--start-bar` changes; applies nudge, bpm and meter;
  derived `markers` with `in_loop`; `cue_t` snapping off once the user has nudged or set a tempo;
  `--reapply` without the song; bad `sync` values exit 2.
- Validator / check_brief: unknown marker (did-you-mean), out-of-loop marker, off-grid marker rows,
  the low-confidence warning.
- Save route: writes only inside DIR, keeps `.bak`, restores on analyser failure, rejects invalid sync.
- Page: a Playwright test loads the page on a fixture, presses Space, ←, M (and names a marker), drags
  it, saves, and checks `song.json`; plus a check that the iframe's frame matches `seek(t)` at the
  playhead.
- Whether it sounds right cannot be automated; that is the proof.

## Proof

Jack opens demo 04 on the sync page, checks Tints by ear (nudging if needed), presses "Sounds right",
and marks one moment. One demo 04 table row is changed to use that marker (with Jack's approval of the
brief change), check_brief passes, the piece is re-rendered and Jack watches it. The wiki gains a short
"Syncing" step (local commit; push after the motion-kit merge, with Jack's go-ahead).

## Build order (for the plan)

1. Shared timing module (beatT with interpolation and swing, marker resolution) + parity tests; switch
   every consumer to it.
2. `song.json` `sync` section in the analyser (preserve, apply, derived markers, `.analysis.json`,
   `--reapply`) + tests.
3. Markers in tables: engine resolution, validator and check_brief rules + tests.
4. `sync.mjs` server routes and Save (validation, `.bak`, restore on failure) + tests.
5. The sync page UI (layout B, keys, audio clock, waveform, markers, preview) + Playwright test.
6. Planner and docs.
7. Proof on demo 04 + wiki.
