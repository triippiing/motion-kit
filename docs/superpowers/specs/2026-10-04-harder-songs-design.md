# Harder songs (sub-project C2b): design

Date: 2026-10-04
Status: approved; built (parts that changed in the build are marked *as built*)
Part of: the motion-kit roadmap (A, B, C1, C2a, F1, F2 done; then D, E). C2b fills in what C1's data format left for
later: tempo changes, swing and meter suggestions, and pickups (moved here from F).

## Purpose

Today the analyser fits one straight, steady 4/4 grid to every song. On real music that fails in four known ways,
seen on Jack's own library (2026-10-04 baseline, unchanged analyser):

| Song | Today | Problem |
|---|---|---|
| Queen, *Bohemian Rhapsody* | one grid, 141.7 BPM, confidence 0.34 | several sections at different tempos |
| Steely Dan, *Home at Last* | 128.9 BPM (95.9 among alternatives) | the shuffle's triplets pull the tempo to about 4/3 of the real one |
| Steely Dan, *Peg* | 118.3 BPM, 4/4, confidence 0.62 | control: should stay as it is |
| Billy Joel, *Piano Man* | 177.5 BPM in 4/4 | it is in 3/4: bars and downbeats are wrong |
| Tease Me (LoopGod) | 98.0 BPM, first downbeat 1.88 s | the pickup before bar 1 is not modelled |

C2b detects these and **suggests** fixes on the sync page; nothing changes until the user has heard a suggestion and
kept it (the ear wins, as in C1).

Success means:
1. The analyser writes suggestions for tempo maps (steps and ramps), swing (with a triplet tempo correction), meter
   (3/4, 6/8) and pickups, each with a confidence and a one-line reason, and none for a straight steady 4/4 track.
2. The sync page lets the user Try (hear), Keep and Dismiss each suggestion; Keep + Save applies it through `sync`.
3. Tables in beats keep working on a tempo-mapped grid; a loop can start on a pickup (`--from-start`).
4. Synthetic tests with known answers pass; projects without the new fields are unchanged.
5. **Acceptance by ear (Jack):** on the five songs above, each suggestion points at the real problem and lands close
   enough that a small nudge fixes it; *Peg* gets no false suggestions.
6. Merged and pushed.

Out of scope: meters other than 4/4, 3/4 and 6/8; tempo changes in the middle of a bar; automatic application of any
suggestion; downloading or committing music.

## 1. Detection (analyze_song.py)

The current grid stays the default output. A new derived top-level `suggestions` object is written on every run
(like the derived `markers`: never user data, rebuilt each time). A suggestion is included only when its confidence is
at or above its threshold and it differs from what the current grid already uses (so a kept suggestion stops being
suggested). Each has `confidence` (0..1) and `reason` (one line, plain words). *As built:* a tempo-map suggestion is
offered alone (swing, meter and pickup would be measured on the single grid it says is wrong; they appear once it is
kept or dismissed), none is suggested once `sync.tempo_map` is set, and swing is never suggested when the meter is (or
is suggested as) 6/8, whose thirds read as swing.

- **Tempo map.** Local tempo is estimated in overlapping windows (about 8 s, hop about 2 s) with the existing tempo
  estimator. *As built:* a window read at a simple metrical ratio of the dominant tempo (`METRICAL`: 2, 3/2, 4/3, 3
  and their inverses) is folded back to it (`_fold_metrical`) while that tempo is still present in the window (a
  candidate at least `alias_present` of its best). Beats are then tracked with a dynamic-programming beat tracker
  (Ellis 2007) whose tempo prior follows the local estimates. Segmentation: a change of more than about 4% that lasts
  at least 4 bars starts a new segment; a change spread over more than 2 bars is a ramp. Suggested when there are at
  least two segments *and (as built)* its confidence is at least `tempo_map_min`. That confidence comes from evidence
  the segmentation does not use: the worst steady span's salience (beat contrast x gap regularity) x change agreement
  (the local-tempo windows either side of each change agree with their span) x fit gain (the map's beats fit the
  onsets better than the single steady grid).
  `"tempo_map": { "segments": [{ "t": 0.0, "bpm": 72.1 }, { "t": 112.4, "bpm": 144.0, "ramp": false }], "beats": [song
  times], "confidence", "reason" }` — `beats` lets the page play the suggested grid before Save.
- **Swing.** For each beat, the strongest onset between 40% and 85% of the way to the next beat; the suggestion is the
  median position, rounded to 0.01, when at least 60% of beats have such an onset and the median is at least 0.56.
  *As built:* it is read on a high-band (≥ 5 kHz: hats, rides, ghost notes) envelope, falling back to the full band
  when that band is near silent; the share counts only beats that sound (an onset of their own); the off-beats must
  cluster (`swing_cluster`: enough of them within 0.06 of the median); and the off-beat must be `SWING_RATIO` (1.5x)
  stronger than the straight 8th, so 16th-note hats are not read as swing.
  Triplet correction (*as built*): only when **no** swing is found on the current grid, a grid is re-fitted near 3/4
  of the tempo (seeded by an alternative within ±2% of it, if any); swing found there, on a grid whose comb score is
  at least `triplet_fit` of the current grid's, is suggested with that tempo:
  `"swing": { "value": 0.62, "bpm": 96.6?, "confidence", "reason" }`. Swing found on the current grid never offers a
  slower tempo.
- **Meter.** Autocorrelation of the low-band (kick) energy sampled at beats, at lags of 3 and 4 beats; 3/4 is suggested
  when the 3-beat periodicity clearly exceeds the 4-beat one. 6/8 when the beats themselves divide in three (onset
  energy at thirds of the beat) and the bar periodicity is 2 dotted beats. `"meter": { "value": "3/4", ... }`.
- **Pickup.** *As built:* counted back from the downbeat of the first audible bar (`_first_bar`: leading silence is
  skipped, and a silent 1 after a pickup still starts the bar); if 1 to (beats per bar − 1) beats with audible onsets
  come before it and the beat before them is quiet (below `PICKUP_QUIET` of the median onset), that count is
  suggested. `"pickup": { "beats": 2, ... }`.

Thresholds are constants in one place (*as built:* `THRESHOLDS` in song_suggest.py, which holds the detectors), tuned on the synthetic tests and checked against the five
songs; the plan records the values chosen.

## 2. Data: new `sync` fields

The user-owned `sync` section (C1) gains, all optional:

| Field | Meaning |
|---|---|
| `tempo_map` | `[{ "t": seconds, "bpm": number, "ramp": boolean }]`, sorted by `t`, first `t` 0; replaces `bpm` when present. `ramp: true` means the tempo changes linearly from the previous anchor to this one. |
| `pickup_beats` | integer 0 to beats-per-bar − 1: beats before the first downbeat |
| `dismissed` | *as built:* list of `{ "key", "value" }`: the key of a suggestion the user dismissed (`"tempo_map"`, `"swing"`, `"meter"`, `"pickup"`) and its value then; dismissed suggestions are not written again until the analyser's suggestion value changes |

`swing`, `meter` and `bpm` already exist and are reused by Keep. Validation follows C1's rules (bad values →
`error: ...`, exit 2): tempo-map anchors sorted, bpm 40 to 240 (*as built*, as for `sync.bpm`), `pickup_beats` in range.

**Applying them:** with `tempo_map`, the analyser builds the grid from the map (the beat tracker constrained to it, then
phase-fitted per segment) instead of one tempo; `cue_t` equals the grid time, as for any ear-set grid. With
`pickup_beats`, bars are numbered from the first downbeat after the pickup (pickup beats are bar −1). The timing module
already follows the grid's own spacing (C1), so `beatT`, the engine, render and the validator need no change for tempo
maps; their parity tests with no new fields must still pass.

**`--from-start`:** a new analyser option (and `new_project.sh` / `swap_song.mjs` passthrough) that starts the loop,
*as built*, on the downbeat of the first audible bar, or on the first pickup beat before it only when
`sync.pickup_beats` is kept, so an intro can begin with the song. Beat 0 of the tables is then that beat;
`beats[i].bar` / `beat_in_bar` say where bar 1 starts (bar 1 is `bar: 0`; pickup beats are `bar: -1`).

## 3. The sync page: suggestions

- A **Suggestions** list above the controls, one item per suggestion in song.json not already dismissed: what it
  proposes ("tempo map: 72 → 144 at 1:52", "swing 0.62 and tempo 96.6", "meter 3/4", "pickup: 2 beats"), its
  confidence and reason, and three buttons:
  - **Try:** the clicks and grid lines switch to the suggested grid (tempo map: the `beats` list; swing/meter/pickup:
    applied to the current grid on the page, as nudge and swing are previewed today). Toggles off. Nothing is saved.
    *As built:* a pickup has no Try (it only applies to a `--from-start` loop, which the clip cannot play before).
  - **Keep:** adds it to the pending sync (the matching fields above); Save re-runs the analyser, which fits it.
  - **Dismiss:** adds `{ key, value }` to `sync.dismissed` (pending until Save).
- Keeping a grid-changing suggestion (tempo map, bpm, meter, pickup) clears `checked_by_ear`, like any grid change;
  swing does not (C1's rule).
- With no suggestions the page is exactly as today.

## Docs

CLAUDE.md (Syncing: suggestions, new sync fields, `--from-start`), SKILL.md (Sync section; analyse options),
planner.md (when the analyser suggests something, open the sync page before writing tables; a song with a pickup can
start the loop with `--from-start`).

## Testing

- `click_track.py` gains options for a tempo map (steps and ramps), swing ratio, 3/4 and 6/8, and a pickup of N beats.
- Detection tests with known answers: a 90→120 step and a 100→120 ramp (anchors within 2% and 1 bar), swing 0.62 (±0.03)
  with the 4/3 tempo case (suggests the slower tempo), 3/4 and 6/8 (meter suggested), pickup 1 and 2 (exact), and a
  plain straight 4/4 click track with **no** suggestions.
- Applying: the analyser keeps and validates the new sync fields; a tempo-mapped grid's beats match the map; pickups
  number bars correctly; `--from-start` puts beat 0 on the pickup; the timing parity tests still pass.
- Sync page: Try changes the clicks and grid lines and toggles back; Keep + Save writes the fields; Dismiss hides it
  and survives a reload after Save; no suggestions = today's page.
- Acceptance (manual, Jack's ears): the five songs, run from where they are (`~/Desktop/music lib`, `~/Downloads`);
  results recorded in the plan's final task.
