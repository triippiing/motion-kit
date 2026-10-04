# Harder Songs (C2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The analyser suggests tempo maps, swing (with triplet tempo correction), meter and pickups; the sync page lets the user try, keep or dismiss each; kept ones apply through `sync`.

**Architecture:** Detection lives in a new pure-numpy module `scripts/song_suggest.py` (functions over the analyser's onset envelopes and beat grid), called by `analyze_song.py`, which writes a derived `suggestions` block and applies the new `sync` fields (`tempo_map`, `pickup_beats`, `dismissed`) when building the grid. `click_track.py` grows the synthetic cases the tests need. The sync page gets a Suggestions list (Try / Keep / Dismiss).

**Tech Stack:** Python 3 + numpy (analyser, unittest), Node 22 (sync server, node:test), Playwright Chromium (page tests).

**Spec:** `docs/superpowers/specs/2026-10-04-harder-songs-design.md`

All paths relative to `~/motion-kit`; `MV=skills/motion-video`. Branch `harder-songs` from `main`.

## Global Constraints

- Suggestions only: the analyser never applies a detection by itself; only `sync` (the user's, via Keep + Save) changes the grid.
- A project without the new sync fields produces the same grid as before (beats, cue_t, loop, markers) — the existing parity tests and demo checks must pass unchanged; only the new `suggestions` key may be added.
- `sync` validation follows C1: bad values → `error: ...`, exit 2. Tempo values use the existing `SYNC_BPM` range (40 to 240), not a new one.
- Meters supported: `4/4`, `3/4`, `6/8` only (`METERS`). No mid-bar tempo changes.
- Never download, copy or commit music. Tests use synthetic click tracks; acceptance uses Jack's files where they are (`~/Desktop/music lib/`, `~/Downloads/`).
- Scripts fail with `error: ...` and exit 2 on bad input, never a traceback. No new dependencies (numpy only).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- bash, `export PATH=/opt/homebrew/bin:$PATH`; full suite `npm test`.

## Review Focus

1. A straight, steady 4/4 song with a busy hi-hat (16ths) must get no swing suggestion — Task 2 pins it with a 16th-hat click track.
2. A song whose tempo is steady but whose detected global tempo is octave-doubled (e.g. 70 vs 140) must not be reported as a tempo map with a 2:1 jump — Task 3 pins it (local estimates octave-consistent with the global tempo).
3. Keeping a tempo map then Saving must not move markers placed by ear (markers are in song time) — Task 4 pins it.
4. A dismissed suggestion must not come back on the next Save unless its value changes — Task 4 pins it.
5. A song shorter than ~8 s windows allow (a 20 s click) must still analyse (no tempo-map suggestion, no crash) — Task 3 pins it.

---

### Task 1: `click_track.py` learns tempo maps, swing, meters and pickups

**Files:** Modify `$MV/scripts/click_track.py`; Test `$MV/tests/test_analyze_song.py` (new class `ClickTrackShapeTests`)

**Interfaces (Produces):**
`click_track(path, bpm, seconds=40.0, offset=0.37, noise=0.001, hat=0.3, seed=0, tempo_map=None, swing=0.5, meter="4/4", pickup=0) -> path` plus `beat_times(bpm, seconds, offset=0.37, tempo_map=None) -> list[float]` (the beat onsets the track uses). Unchanged defaults produce byte-identical output to today (every existing test and the harness depend on it).
- `tempo_map`: list of `(t, bpm, ramp)` tuples, first `t` 0 (overrides `bpm`); beats are placed by integrating the tempo: between anchors the tempo is constant (`ramp=False` at the next anchor) or linear (`ramp=True`).
- `swing`: when > 0.5, an extra quieter hat (0.6 × `hat`) at `beat + swing × interval` on every beat.
- `meter`: `"4/4"` kick every 4th beat (today), `"3/4"` every 3rd; `"6/8"` beats are dotted quarters: a kick every 2nd beat and two extra quiet hats at 1/3 and 2/3 of each beat.
- `pickup`: N beats with hats only before the first kick (the first kick lands on beat index `pickup`).
CLI: `--tempo-map 0:90,20:120,40:120r` (`r` = ramp into that anchor), `--swing`, `--meter`, `--pickup`; bad values → argparse error, exit 2.

- [ ] **Step 1: Failing tests**

```python
class ClickTrackShapeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_defaults_are_unchanged(self):
        a = (self.tmp / "a.wav"); b = (self.tmp / "b.wav")
        click_track(a, 120, seconds=10); click_track(b, 120, seconds=10, tempo_map=None, swing=0.5, meter="4/4", pickup=0)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertEqual(hashlib.sha256(a.read_bytes()).hexdigest(), KNOWN_120_10S)  # computed once on main, pasted here

    def test_beat_times_follow_the_tempo_map(self):
        t = beat_times(90, 40, tempo_map=[(0, 90, False), (20, 120, False)])
        gaps = np.diff(t)
        self.assertAlmostEqual(gaps[0], 60 / 90, places=6)
        self.assertAlmostEqual(gaps[-1], 60 / 120, places=6)
        r = beat_times(100, 40, tempo_map=[(0, 100, False), (20, 100, False), (30, 120, True)])
        g = np.diff(r)
        self.assertTrue(all(g[i] >= g[i + 1] - 1e-9 for i in range(len(g) - 1)), "a ramp up only shortens the gaps")

    def test_cli_options(self):
        out = self.tmp / "s.wav"
        r = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(out), "100", "--seconds", "12",
                            "--swing", "0.62", "--meter", "3/4", "--pickup", "2", "--tempo-map", "0:100,6:110r"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        bad = subprocess.run([sys.executable, str(SCRIPTS / "click_track.py"), str(out), "100", "--meter", "5/4"], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 2); self.assertNotIn("Traceback", bad.stderr)
```

(`KNOWN_120_10S`: run `click_track(path, 120, seconds=10)` on `main` before changing the file and paste the sha256.)

- [ ] **Step 2: Run** `python3 -m unittest discover -s $MV/tests -p test_analyze_song.py -k ClickTrackShape` → FAIL.
- [ ] **Step 3: Implement** in `click_track.py`: factor today's loop into `beat_times(...)` (when `tempo_map` is None: `offset + i * 60 / bpm` while `< seconds - 0.3`, exactly today's positions) and a synthesis loop over those times that adds the hat, the kick on `(i - pickup) % bar_beats == 0 and i >= pickup`, the swing hat and the 6/8 thirds. Keep the RNG call order identical for defaults (draw the swing/compound extras from a second `default_rng(seed + 1)` so the main stream is untouched).
- [ ] **Step 4: Run** the Python suite → PASS (all existing analyser tests unchanged).
- [ ] **Step 5: Commit** — `click_track: tempo maps, swing, 3/4 and 6/8, pickups (defaults unchanged)` + trailer.

---

### Task 2: `song_suggest.py`: swing, meter and pickup detectors

**Files:** Create `$MV/scripts/song_suggest.py`; Create `$MV/tests/test_song_suggest.py`

**Interfaces (Produces):** constants `THRESHOLDS = { "swing_min": 0.56, "swing_share": 0.60, "triplet_tol": 0.02, "meter_margin": 0.15, "pickup_onset": 0.35, "tempo_change": 0.04, "tempo_bars": 4, "ramp_bars": 2 }` (starting values; Task 3/4 and the acceptance run may tune them — every change recorded in the task report). Functions take numpy arrays and plain numbers only:
- `detect_swing(full_env, fps_env, beat_times, bpm, alternatives) -> dict | None` → `{ "value": 0.62, "bpm": 96.6 (only for the triplet case), "confidence": 0..1, "reason": str }`. For each beat interval, the time of the strongest envelope peak between 40% and 85% of the interval, as a fraction; requires an onset (peak ≥ 0.25 × the beat's own peak) in ≥ `swing_share` of beats; value = median rounded to 0.01; suggest when value ≥ `swing_min`. A 16th-note hat (onsets at 0.25/0.5/0.75) must NOT read as swing: compare energy at the candidate fraction against 0.5 and 0.75 — suggest only when the candidate peak is clearly stronger than the 0.5 position (ratio ≥ 1.5). Triplet correction: if any alternative `a` satisfies `|bpm / a − 4/3| ≤ triplet_tol × 4/3`, add `"bpm": round(a, 2)` and say so in `reason`.
- `detect_meter(low_env, full_env, fps_env, beat_times) -> dict | None` → `{ "value": "3/4" | "6/8", ... }`. Sample low-band energy at each beat; autocorrelation at lags 2, 3, 4 (beats); 3/4 when `ac[3] - ac[4] ≥ meter_margin`; 6/8 when the full envelope has peaks at 1/3 and 2/3 of most beats (≥ 60%) and `ac[2]` is the strongest. None otherwise.
- `detect_pickup(full_env, fps_env, beat_times, downbeat_index, beats_per_bar) -> dict | None` → `{ "beats": n }` for `1 ≤ n ≤ beats_per_bar − 1`, n = the number of grid beats directly before the first downbeat whose onset strength ≥ `pickup_onset` × the median beat onset (counting backwards, stopping at the first quiet beat), only when the song's audio is quiet before them (the beat before the pickup has onset < 0.1 × median, or does not exist).
All helpers that sample the envelope at a time use one function `at(env, fps_env, t)` (linear interpolation; 0 outside).

- [ ] **Step 1: Failing tests** (`test_song_suggest.py`; build tracks with Task 1's `click_track`, get envelopes with `analyze_song.envelopes(decode(path))`, the grid with `beat_times(...)` shifted by the analyser's `ENV_TIME_OFFSET` as `analyze()` does — or simpler: call `A.analyze(path, bars=2)` and read `song["beats"]`' `abs_t` for the grid and `bpm`/`alternatives`):

```python
class SwingMeterPickup(unittest.TestCase):
    # track(**kw) -> (full, low, beats, song): a 30 s click_track in self.tmp, its envelopes, and the analyser's grid
    def test_straight_track_gets_nothing(self):
        full, low, beats, song = self.track(bpm=120)
        self.assertIsNone(S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"]))
        self.assertIsNone(S.detect_meter(low, full, A.FPS_ENV, beats))
        self.assertIsNone(S.detect_pickup(full, A.FPS_ENV, beats, self.downbeat(song), 4))
    def test_sixteenth_hats_are_not_swing(self):                  # Review Focus 1
        full, low, beats, song = self.track(bpm=110, mix_sixteenths=True)
        self.assertIsNone(S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"]))
    def test_swing_062_is_found(self):
        full, low, beats, song = self.track(bpm=110, swing=0.62)
        r = S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"])
        self.assertLessEqual(abs(r["value"] - 0.62), 0.03); self.assertEqual(set(r) - {"bpm"}, {"value", "confidence", "reason"})
    def test_triplet_tempo_correction(self):
        # a 96 BPM shuffle whose analysed tempo comes out near 128 (4/3): the suggestion carries bpm ~96
        full, low, beats, song = self.track(bpm=96, swing=0.667, force_bpm=128.0)
        r = S.detect_swing(full, A.FPS_ENV, beats, song["bpm"], song["alternatives"] + [96.0])
        self.assertLessEqual(abs(r["bpm"] - 96.0), 2.0)
    def test_three_four(self):
        full, low, beats, song = self.track(bpm=150, meter="3/4")
        self.assertEqual(S.detect_meter(low, full, A.FPS_ENV, beats)["value"], "3/4")
    def test_six_eight(self):
        full, low, beats, song = self.track(bpm=60, meter="6/8")
        self.assertEqual(S.detect_meter(low, full, A.FPS_ENV, beats)["value"], "6/8")
    def test_pickup_two(self):
        full, low, beats, song = self.track(bpm=100, pickup=2, offset=0.5)
        self.assertEqual(S.detect_pickup(full, A.FPS_ENV, beats, self.downbeat(song), 4)["beats"], 2)
    def test_no_pickup_when_song_starts_on_the_downbeat(self):
        full, low, beats, song = self.track(bpm=100, offset=0.5)
        self.assertIsNone(S.detect_pickup(full, A.FPS_ENV, beats, self.downbeat(song), 4))
```

Helpers in the test class: `track(**kw)` writes a 30 s `click_track` (kw passed through; `mix_sixteenths=True` mixes in a quieter second track at 4 × bpm with numpy, so click_track's surface stays small; `force_bpm` analyses with `sync={'bpm': force_bpm}` to reproduce the triplet mis-read), runs `A.analyze(path, bars=2, sync=...)`, and returns `(full, low, beats, song)` with `full, low, _ = A.envelopes(A.decode(path))` and `beats` = the analyser's full-song beat grid (expose it from analyze() as `song['_grid']` only when a private `debug=True` argument is passed, or recompute it with `fit_grid` — say which); `downbeat(song)` returns the downbeat beat index. If a tolerance proves wrong for a principled reason, adjust it and record why.

- [ ] **Step 2: Run** `python3 -m unittest $MV/tests/test_song_suggest.py` → FAIL.
- [ ] **Step 3: Implement** the three detectors as specified; module header says what it is for and that it never decides anything (suggestions only).
- [ ] **Step 4: Run** → PASS; Python suite green.
- [ ] **Step 5: Commit** — `song_suggest: swing (with triplet tempo correction), meter and pickup detectors` + trailer.

---

### Task 3: Tempo-map detection (local tempo + DP beat tracker + segments)

**Files:** Modify `$MV/scripts/song_suggest.py`; Test `$MV/tests/test_song_suggest.py`

**Interfaces (Produces):**
- `local_tempo(full_env, fps_env, global_bpm, win_sec=8.0, hop_sec=2.0) -> list[(t_center, bpm)]` — per window, the tempo candidate (analyse_song's `tempo_candidates` on the window, passed in as a function argument to avoid a circular import) nearest the global tempo's octave family (`bpm × 2^k`, k ∈ {−1, 0, 1}, folded to within ×√2 of `global_bpm`) — Review Focus 2.
- `track_beats(full_env, fps_env, tempo_curve, tightness=100.0) -> np.ndarray` — Ellis (2007) dynamic programming: `score[t] = env[t] + max_{p} (score[p] − tightness · log((t − p) / period(t))²)` over `p ∈ [t − 2·period, t − period/2]`, backtrace from the best end; `period(t)` from `tempo_curve` (interpolated). Returns beat times in seconds.
- `segment_tempo(beat_times, beats_per_bar) -> list[{ "t", "bpm", "ramp" }]` — per-bar tempo (median of the bar's inter-beat gaps), smoothed over 3 bars; a new anchor where the tempo differs from the running segment by > `tempo_change` for ≥ `tempo_bars` bars; if the move from old to new tempo spans > `ramp_bars` bars, the anchor is a ramp (`ramp: true` at its end, with an anchor at its start).
- `detect_tempo_map(full_env, fps_env, global_bpm, beats_per_bar, tempo_candidates) -> dict | None` → `{ "segments": [...], "beats": [song seconds, 3 decimals], "confidence", "reason" }` when ≥ 2 segments; None for songs shorter than 2 windows (Review Focus 5).

- [ ] **Step 1: Failing tests** — a 90→120 step at 20 s (anchors within 2% bpm and 1 bar of 20 s), a 100→120 ramp from 20 to 30 s (a ramp anchor), a steady 120 track (None), a steady 70 BPM track whose global tempo reads 140 (None: Review Focus 2), a 20 s track (None, no exception: Review Focus 5), and `track_beats` on a steady 120 click returning beats within 15 ms of the click times.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** as specified (vectorise the DP over candidate predecessors per frame; it must run in under ~5 s for a 6-minute song — time it on a 360 s synthetic track and record the number in the report).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `song_suggest: tempo maps from local tempo and a DP beat tracker` + trailer.

---

### Task 4: The analyser writes suggestions and applies the new `sync` fields

**Files:** Modify `$MV/scripts/analyze_song.py`, `$MV/scripts/new_project.sh`, `$MV/scripts/swap_song.mjs`; Test `$MV/tests/test_analyze_song.py`, `$MV/tests/swap_song.test.mjs` (passthrough)

**Interfaces:**
- Consumes: Task 2/3 detectors; Task 1 click tracks.
- Produces: song.json top-level `"suggestions": { "tempo_map"?, "swing"?, "meter"?, "pickup"? }` (keys only when suggested and not dismissed-with-the-same-value); new sync fields `tempo_map`, `pickup_beats`, `dismissed`, each validated in `validate_sync`; analyser option `--from-start`.

Rules (spec sections 1-2):
- A suggestion is written only when it differs from what the grid uses (e.g. no meter suggestion when `sync.meter` already equals it; no tempo map when `sync.tempo_map` is set; no swing when `sync.swing` is within 0.02).
- `sync.dismissed` is a list of `{ "key": "swing", "value": <the suggestion's value> }` (store the value so a changed suggestion comes back — Review Focus 4). Validation: keys from the four names.
- `tempo_map` in sync: validate (sorted, first t 0, bpm within SYNC_BPM, ramp boolean); the grid is built with `track_beats` constrained by that map (tempo_curve from the anchors, linear on ramps) and phase-fitted per segment; `cue_t = t` (ear-set grid); `bpm` in song.json = the first segment's.
- `pickup_beats`: bars numbered from the first downbeat after the pickup (pickup beats have `bar: -1`); `--from-start` starts the loop on the first pickup beat (or the first downbeat without one); mutually exclusive with `--start-bar` / `--start-near`.
- Markers stay in song time, untouched by any of this (Review Focus 3).

- [ ] **Step 1: Failing tests** (in `test_analyze_song.py`): suggestions present for the step/swing/3-4/pickup tracks and absent for the straight track; `dismissed` with the same value hides it and a different value shows it; invalid `tempo_map` / `pickup_beats` / `dismissed` → exit 2 with `error:`; a tempo-map sync gives beats whose gaps follow the map (within 2%); markers' `song_t` unchanged after adding a tempo map; `pickup_beats: 2` numbers bars from beat 2; `--from-start` puts beat 0 at the first pickup beat; a project with no new fields: song.json identical to `main`'s analyser except the added `suggestions` key (compare against `git show main:$MV/scripts/analyze_song.py` run on the same track). `new_project.sh --from-start` and `swap_song.mjs --from-start` pass it through.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; keep analyze() readable by calling `song_suggest.suggest(...)` (a function assembling the four detectors with the dismiss/differs rules) once after the grid is built.
- [ ] **Step 4: Run** the Python suite, `swap_song.test.mjs`, `sync.test.mjs`, `timing.test.mjs`, `render.test.mjs` → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `analyze_song: suggestions, tempo maps, pickups and --from-start` + trailer.

---

### Task 5: Suggestions on the sync page

**Files:** Modify `$MV/scripts/sync-page/index.html`, `app.js`, `style.css`, `$MV/scripts/sync.mjs` (staleCheck: tempo_map and pickup_beats changes clear checked_by_ear); Test `$MV/tests/sync-page.test.mjs`, `$MV/tests/sync.test.mjs`

**Interfaces:** Consumes song.json `suggestions` (Task 4) and the sync fields.

- [ ] **Step 1: Failing tests**: a project analysed from a swung click track shows a Suggestions list with one item ("swing 0.62"); Try changes the click schedule (the page's `syncState` clicks list differs) and toggles back; Keep adds `swing` to pending sync and Save writes it; the suggestion is gone after Save; Dismiss + Save writes `dismissed` and the item stays hidden after a reload; a tempo-map suggestion's Try uses its `beats` for the click schedule; keeping a tempo map clears `checked_by_ear` on Save (sync.test: staleCheck); a project with no suggestions renders no list (existing tests unchanged).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per spec section 3 (match the markers list's style; keyboard focus unchanged).
- [ ] **Step 4: Run** → PASS; full `npm test`.
- [ ] **Step 5: Commit** — `sync page: suggestions you can try, keep or dismiss` + trailer.

---

### Task 6: Docs and the acceptance run on Jack's songs

**Files:** Modify `CLAUDE.md`, `$MV/SKILL.md`, `skills/motion-design/references/planner.md`

- [ ] **Step 1: Docs** per the spec's Docs section (new sync fields table rows, suggestions, `--from-start`).
- [ ] **Step 2: Acceptance run (report only, nothing committed):** run the analyser into scratch dirs (never into the music folders) on:
  `~/Desktop/music lib/01 - Bohemian Rapsody.mp3`, `5. Home at Last.flac`, `Steely Dan - 04 - Peg.flac`, `02 - Piano Man.flac`, and `~/Downloads/2000s-x-90s-RB-Pop-Pharrell-Type-Beat---Tease-Me.mp3`. Record each song's suggestions (values, confidence, reason) in the report, and the expectations: Bohemian → a tempo map with several sections; Home at Last → swing plus a tempo near 96; Peg → no suggestions; Piano Man → meter 3/4; Tease Me → a pickup. Where a detector misses, tune its threshold (record before/after values and re-run the synthetic tests) — do not special-case songs. Prepare one scratch project per song (`new_project.sh <scratch>/<name> <song> --bars 4`) so Jack can open `node sync.mjs <dir>` on each and listen; list the five commands in the report.
- [ ] **Step 3: Full suite** `npm test` → green.
- [ ] **Step 4: Commit** — `docs: song suggestions, tempo maps, pickups` + trailer.

(The by-ear verdict is Jack's; merge waits for it.)
