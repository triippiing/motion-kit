---
name: motion-video
description: Use when building or rendering a code-only motion video (HTML seek(t) page -> MP4) after a state plan is approved, or when asked to measure a song's BPM/beat grid for animation, re-time a piece to a new song, render a preview, or fix a loop that stutters. Scripts: doctor, new_project, analyze_song, extract_theme, render, beat_stills.
---

# Motion video

Everything lives in `~/.claude/skills/motion-video/`. Scripts put Homebrew on PATH themselves.

| Job | Command |
|---|---|
| Check tooling | `scripts/doctor.sh` |
| New project | `scripts/new_project.sh DIR SONG --bars 7 --states 12 [--size vertical] [--theme app.css]` |
| Re-theme from a project | `python3 scripts/extract_theme.py app.css --out DIR [--map accent=--brand]` |
| Re-time to a new song | `python3 scripts/analyze_song.py SONG --out DIR --bars 7` |
| Watch live with audio | `node scripts/render.mjs DIR --serve` → open URL, click |
| Beat stills + seam check | `node scripts/beat_stills.mjs DIR` |
| Preview render | `node scripts/render.mjs DIR --preview` |
| Section render (`--from`/`--to` are seconds) | `node scripts/render.mjs DIR --from 4 --to 8 --preview` |
| Final render | `node scripts/render.mjs DIR` → `DIR/out/video.mp4` |

## Build loop

1. Start from the approved state plan (motion-design). If there is none, go back and make one.
2. In `DIR/index.html` edit only the tables — `states()`, `cursor()`, `content`, `extraSfx()` —
   plus a `.layer` per state name. `cursor()` rows take `press: true` (click), `press: 'down'`/`'up'`
   (hold, for drags) and `sound: 'key'` (plays sfx/key.wav); `extraSfx()` returns `[{beat, file, gain}]`
   for any other cue. Every `press: 'down'` needs a later `press: 'up'`. Each `content` function takes absolute `t` and runs every frame (use `since(stateName, t)`). Colours in STATES are theme roles (`canvas surface ink muted accent`)
   so the piece re-themes with the project (theme.json may also carry optional `pos`/`neg` roles when the CSS defines success/danger colours; use `var(--pos)` / `var(--neg)` in layers, and only when present); use CSS `var(--accent)` etc. inside layers, never hex. Keep the page contract: `window.ready`, `window.STAGE`,
   pure `window.seek(t)` that does not wrap `t`, `window.inspect(t)`, `window.SFX`.
3. Rules inside `seek(t)`: every style computed from `t`; no CSS transitions, animations,
   timers, `Date.now()` or variables written by an earlier frame; no `will-change`. Use
   `Springs.track` for anything that changes more than once; per-change `omega` for
   two-edge stretches; `fromSettle(seconds, zeta)` instead of raw stiffness. Timing comes from
   `beatT(beat)`, never hard-coded seconds.
4. `beat_stills.mjs DIR`, then **look at `out/stills/contact-sheet.png`** (Read the image).
   Fix anything off the grid, cramped, clipped or hard to read. Repeat until the seam check passes.
5. `render.mjs DIR --preview`, then the final render. Report the output path, duration,
   BPM and any song.json warnings.

## Song rules (from song.json)
- `rules.spring` sets the house spring (ζ 0.85, settle 0.6 beat); the template already uses it.
- Outside 100–130 BPM: follow the warning (half-time events or half-beat accents).
- A commercial track is for local viewing: remind the user before they post.

## When the loop stutters
Seam check failing on frame: the last STATES/CURSOR row must equal the first and be
≥ 2 beats before END. Failing on cursor velocity: the last cursor move is too late.
