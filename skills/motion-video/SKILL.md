---
name: motion-video
description: Use when building or rendering a code-only motion video (HTML seek(t) page -> MP4) after a state plan is approved, or when asked to measure a song's BPM/beat grid for animation, re-time a piece to a new song, render a preview, export a finished piece for Reels, TikTok, Shorts, X, LinkedIn, Discord or the web, or fix a loop that stutters. Scripts: doctor, new_project, analyze_song, extract_theme, render, beat_stills, check_brief, export, safezones, build_catalog, gallery.
---

# Motion video

Everything lives in `~/.claude/skills/motion-video/` (a symlink made by `install.sh`; in a clone of the repo the same files are at `<clone>/skills/motion-video/`). Paths below are relative to that folder. Scripts put Homebrew on PATH themselves; for ad-hoc checks use `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`.

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
| Check a brief's beat table | `node scripts/check_brief.mjs DIR [--no-loop]` |
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

## Build loop

1. Start from the approved `DIR/MOTION-BRIEF.md` (motion-design). If there is no approved brief, go back and make one.
2. Copy the `states()`/`cursor()` block under the brief's `## Beat table` over the example `states()` and `cursor()` in `DIR/index.html`. Rows with
   `use:` are library components (`components/CATALOG.md`); they need nothing else: no layer, no
   `content`. Only for something the library lacks, write a custom row (`name:` with `w`, `h`, `r`)
   plus a `.layer[data-state=NAME]` and a `content` function, or add a component
   (`components/WRITING-A-COMPONENT.md`). Edit only the tables: `states()`, `cursor()`, `content`,
   `extraSfx()`, plus a `.layer` per custom state name. `cursor()` rows take `press: true` (click), `press: 'down'`/`'up'`
   (hold, for drags) and `sound: 'key'` (plays sfx/key.wav); `extraSfx()` returns `[{beat, file, gain}]`
   for any other cue. Every `press: 'down'` needs a later `press: 'up'`. A drag is three rows: down, move, up (the move row sits strictly between them; a move written on the 'up' row starts only after the release, so the 'up' row repeats the move row's position). Each `content` function takes absolute `t` and runs every frame (use `since(stateName, t)`). Colours in STATES are theme roles (`canvas surface ink muted accent`)
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
stamp's `sources`, taken at render start, so an edit saved mid-render counts). Anything else (a preview, a `--from`/`--to` section, an old render) is rendered again.

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
chat and web presets have none). `check_brief.mjs` checks the brief's tables against them only when the
brief has an `**Exports:**` line (it opens Chromium then); each issue is a warning, to resolve or justify.
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
