# motion-kit — design

Date: 2026-09-29
Status: draft, awaiting review

## Purpose

Turn the "code-only motion design" approach (source: @twoclipping prompt template,
x.com/twoclipping/status/2103273003555402193) into reusable Claude Code skills Jack
can call in future projects, for two uses:

1. **Promo videos** for his projects — a single morphing UI shape, cursor-driven,
   cut to a song's beat grid, rendered from HTML to MP4 with no After Effects.
2. **In-product motion** — the same spring maths used live in real web UIs
   (personal-finance vanilla JS UI, Arcade HTML games, rendered HTML pages).

Success = in a fresh session, Jack says "make a promo for X to song Y" or "add
motion to this view" and the skills carry it end to end, and the three demo videos
below exist and were produced by the skills (not hand-built around them).

## Non-goals

- No After Effects, Remotion, Lottie or other animation frameworks. Plain HTML/JS.
- No downloading copyrighted music. Jack supplies audio files; skills only analyse
  and mux them. Skills warn that commercial tracks will be muted on social platforms.
- No publishing/posting of videos.
- No porting in-app motion to `personal-finance-linux` (Jack's usual post-step; offered after).

## Layout

One git repo, `~/motion-kit`, is the source of truth. `install.sh` symlinks each
skill into `~/.claude/skills/` so they are callable everywhere.

```
~/motion-kit/
  install.sh                   symlink skills; run doctor
  shared/springs.js            the one spring implementation (ES module, no deps)
  shared/springs.test.mjs      node --test
  skills/
    motion-design/             art direction + planning (no code runs here)
      SKILL.md
      references/direction.md    style rules, banned list, gotchas (from the template)
      references/state-plan.md   how to lay states on a beat grid; plan table format
    motion-video/              render pipeline
      SKILL.md
      assets/springs.js -> ../../../shared/springs.js
      template/index.html        seek(t) scaffold: stage, camera, cursor, sound cues
      scripts/doctor.sh          checks brew, ffmpeg (with tmix), node, Playwright chromium, numpy
      scripts/analyze_song.py    song -> song.json (see below)
      scripts/render.mjs         Playwright frames -> ffmpeg (tmix blur, audio mux)
      scripts/beat_stills.mjs    one still per beat + contact sheet; loop-seam check
      tests/                     synthetic click-track tests, 1s smoke render
      package.json               playwright pinned
    motion-ui/                 live in-product motion
      SKILL.md
      assets/springs.js -> ../../../shared/springs.js
      references/patterns.md     morphing container, two-edge indicator, drag+release,
                                 content swap with enter/exit, reduced-motion
  demos/
    01-reference/   02-finance-promo/   03-finance-inapp/
```

## Components

### shared/springs.js
Pure functions, identical in video and live UI.
- `spring(t, {from, to, t0, omega, zeta})` → `{value, velocity}`: closed-form damped
  step response (under/critically damped branches). `t < t0` returns `from`.
- `track(changes, t)`: value that retargets many times = base + sum of one spring
  per change (each spring animates the *delta*). Stays a pure function of `t`,
  so `seek(t)` never carries state between frames.
- `live(opts)`: rAF driver for UI; retargeting starts a new spring from the current
  value **and velocity**, so interrupting mid-motion is continuous.
- `fromSettle(settleSec, zeta)` → `omega` (2% settle ≈ 4/(ζω)), so callers think in
  durations, not stiffness. This is how finance-app tokens (e.g. 240ms) map to springs.
- Tests: settles to target; overshoot ≤ bound for given ζ; `track` is continuous in
  value and velocity at each change; `live` retarget continuity; t<t0 exactness.

### motion-video / analyze_song.py
Input: an audio file (any format ffmpeg reads — Tints is FLAC). Decodes via ffmpeg to
mono float PCM, numpy only (no librosa/scipy).
- Onset envelope (spectral flux from an STFT) → tempo by autocorrelation over
  60–180 BPM, reporting confidence and the best half/double alternatives.
- Beat phase: constant-tempo grid fit to onset peaks. Downbeat: of the 4 bar phases,
  the one with the most low-band (kick) energy.
- Per-beat accent strength; section boundaries from bar-level RMS/spectral change.
- Picks the loop window: `--bars N` (default: most bars that fit the state count)
  starting on a downbeat inside a strong section, or `--start-bar` to override.

Writes `song.json`:
```json
{ "source": "...", "bpm": 0, "bpm_confidence": 0, "alternatives": [],
  "beat_sec": 0, "downbeat_sec": 0, "fps": 60,
  "loop": { "start_sec": 0, "bars": 7, "duration_sec": 0, "frames": 0 },
  "beats": [{ "i": 0, "t": 0, "frame": 0, "bar": 0, "accent": 0 }],
  "sections": [], "peaks": [],
  "rules": { "max_states": 0, "min_hold_beats": 0,
             "spring": { "zeta": 0.85, "settle_sec": 0, "omega": 0 },
             "warnings": [] } }
```
Derived rules: loop length snapped to whole bars; one event per beat → state budget;
spring settle = 0.6 × beat so slower songs feel looser; sound cues only on measured
peaks; a warning (not a block) outside ~100–130 BPM suggesting half/double-time
eventing. Also writes `clip.wav` — the loop window with 10ms edge fades — for muxing.

The HTML fetches `song.json`; swapping the song and re-running analysis retimes the
piece with no code edits.

### motion-video / template + render
- `template/index.html`: 1440×1440 stage (configurable), `window.seek(t)` computes
  every style from `t` (no CSS transitions, timers or cross-frame state), camera
  scale/translate so each state fills frame, scripted cursor with press/drag
  keyframes, `window.inspect(t)` exposing cursor pos/velocity for the seam check.
  Follows the template's gotchas (no `will-change` under camera scale; text swaps
  get their own enter/exit timing; last frame == first frame).
- `render.mjs`: Chromium via Playwright; N parallel pages; for each output frame,
  4 subframes at t + k/(4·fps); PNGs piped to ffmpeg `tmix=frames=4` then keep
  every 4th → 60fps H.264 yuv420p, CRF 16, `clip.wav` muxed as AAC. `--preview`
  = half-res, 1 subframe, for fast iteration.
- `beat_stills.mjs`: renders a frame at each beat + a tiled contact sheet so Claude
  (and Jack) can review spacing/legibility before the full render; seam check
  compares frame 0 vs last frame pixels and cursor pos/velocity; fails loudly.

### motion-design / SKILL.md
The template's process, generalised: ask for inputs (states, colour, song file) →
run analyze_song → present the state list on the beat grid as a table → **wait for
approval** → hand off to motion-video. For project promos it first reads the
project's design tokens (colours, fonts) and uses real UI states from that project.

### motion-ui / SKILL.md
For live product UI. Hard rule: **if the project has a motion spec or motion tokens,
they win.** Step 1 is always to look for them (e.g. personal-finance's
`design-system/design_handoff_motion/` and `--t-*`/`--ease-*` in `style.css`).
Springs are used only where that spec allows, via `fromSettle(token)`, with ζ ≥ 1
where the spec bans overshoot. Covers retargetable springs, drag-then-release,
two-edge indicators, content swap timing, and `prefers-reduced-motion`.

## Tooling

- Homebrew: Jack installs it himself (sudo password), then `brew install ffmpeg`.
- Playwright Chromium: installed 2026-09-29 (`~/Library/Caches/ms-playwright`).
- numpy 2.5.2 present on python.org 3.13. No other Python deps.
- `doctor.sh` verifies all of the above and that ffmpeg has the `tmix` filter; every
  skill runs it first and prints the exact fix if something is missing.

## Demos

All use Jack's local copy of *Tints* (Anderson .Paak ft. Kendrick Lamar), for
local viewing only; each demo folder's README says to re-run analysis on a licensed
track before posting.

1. **01-reference** — the template's own sequence (button → loader → check → island →
   player → scrub → volume → toggle → tabs → chart → ⌘K → toast → button) in the
   template's black/white/Geist style, retimed to Tints' measured grid. Proves the
   pipeline against the source it copies.
2. **02-finance-promo** — same pipeline, states drawn from the real finance UI
   (e.g. dropzone → payslip chip → goal bar fill → surplus split → calendar →
   status pill), using the app's own palette and tokens. State list approved by
   Jack on the beat grid before any code.
3. **03-finance-inapp** — motion-ui applied to one finance-app view on a
   `motion-demo` branch (not merged), within the existing Motion Spec; captured as
   a short Playwright screen recording. Jack decides whether to keep it.

Output per demo: `out/<name>.mp4`, `out/contact-sheet.png`, `song.json`.

## Testing

- `node --test shared/` for springs.
- `analyze_song` tested on generated click tracks at 90/120/128 BPM with a known
  downbeat accent: BPM within ±0.5, downbeat within 1 frame.
- 1-second smoke render of the template: correct frame count, duration, audio stream.
- Seam check passes for every demo.
- Finance-app demo 3: the app's existing pytest suite still passes on the branch.

## Open decisions for review

- Repo at `~/motion-kit` with symlinked skills (vs. files directly in `~/.claude/skills`).
- Tints measured ~109 BPM (rough autocorrelation probe, 2026-09-29; analyze_song
  refines it). Inside 100–130, so demos 1–2 event on every beat; 7 bars ≈ 15.4s.

## Tooling status (2026-09-29)

Homebrew 7.0.7, ffmpeg 9.0.2 (tmix present), Node 24.19, numpy 2.5.2, Playwright
Chromium 1243 — all verified.
