# Demo 4: the reference sequence from the library

Demo 1's sequence (button, loader, check, island, player with scrub, volume overstretch, toggle,
tabs, line chart, command bar, toast, back to the button) rebuilt with library components only.
It was planned with the `motion-design` planner, which wrote `MOTION-BRIEF.md`; that brief was
approved, then adjusted by the drag fixes (move rows at 11 and 13, knob approach at 14), and built
with `motion-video` by pasting its `states()`/`cursor()` block into `index.html`. No custom states, layers or `content` functions.

- Same song window as demo 1: "Tints" (feat. Kendrick Lamar), 109.00 BPM, bar 21 (47.363 s),
  7 bars = 28 beats = 15.413 s = 925 frames at 60 fps. Square 1440x1440, house theme.
- The last row repeats the first, so the loop is seamless (beat_stills seam check: OK).
- Sounds: `sfx/click.wav` (presses), `sfx/key.wav` (typing in the command bar, added by the component).

Uses a commercial track for local viewing only; re-time to a licensed track before posting.

## Re-render

The song is not included, and `clip.wav` and `out/` are not committed. Bring your own copy of the
song (or any song you have the rights to; a different song re-times the piece, though its accents differ):

```bash
S=~/.claude/skills/motion-video/scripts
python3 $S/analyze_song.py "<your song>" --out demos/04-library-reference --bars 7 --states 14 --start-bar 21
node $S/beat_stills.mjs demos/04-library-reference     # one still per beat + loop-seam check
node $S/render.mjs demos/04-library-reference --serve  # watch live with audio (?play, click)
node $S/render.mjs demos/04-library-reference          # final: demos/04-library-reference/out/video.mp4
```

## Exports

The brief lists `**Exports:** reels, x, discord, web, gif`. One command made every file, with audio,
for local viewing only (a public post of this track would use `--silent`):

```bash
node $S/export.mjs demos/04-library-reference --for reels,x,discord,web,gif
```

It rendered two native shapes, 1080x1920 for Reels and 1440x1440 for everything else, and encoded
each preset from its shape. The full record is `exports-manifest.json` (a copy of
`out/exports/manifest.json`, paths relative to this folder).

| Preset | File | Resolution | fps | Size (MB) | Duration (s) | LUFS / true peak | Warnings |
|---|---|---|---|---|---|---|---|
| reels | reels.mp4 | 1080x1920 | 30 | 0.69 | 15.43 | -14.0 / +1.2 dBTP | commercial track; true peak over -1 |
| x | x.mp4 | 1440x1440 | 30 | 0.90 | 15.43 | -14.1 / +1.1 dBTP | commercial track; true peak over -1 |
| discord | discord.mp4 | 1440x1440 | 60 | 0.88 | 15.42 | -14.1 / +0.9 dBTP | true peak over -1 |
| web | web.mp4 | 1440x1440 | 60 | 0.72 | 15.42 | -14.0 / +1.2 dBTP | commercial track; true peak over -1 |
| web | web.webm | 1440x1440 | 60 | 0.96 | 15.42 | -14.0 / -1.5 dBTP | commercial track |
| web | web.jpg | 1440x1440 | still | 0.03 | | | poster at beat 1.5 |
| gif | gif.gif | 720x720 | 15 | 1.35 | 15.40 | no audio | none |

Every file is within its preset's size cap and length limit. Loudness hit -14 LUFS on every file, but
the AAC files peak about 1 dB over zero: the loudnorm output peaks at -2.4 dBTP, and ffmpeg's built-in
AAC encoder adds about 3.6 dB of overshoot on this track (the Opus WebM stays at -1.5). The commercial
track warning is accepted in the brief. `check_brief.mjs` also reports the cursor and, for half a beat,
the line chart entering the Reels safe zones; those are open for a decision and the brief is unchanged.

## Compared with demo 1

| | Demo 1 (`01-reference`) | Demo 4 (`04-library-reference`) |
|---|---|---|
| Project-specific JS, non-blank lines | 290 (the whole `<script type="module">`) | 60 (between the table markers) |
| Same, excluding comment-only lines | 269 | 45 |
| Custom CSS layers | yes (hand-written per state) | none |
| Build time, approved plan to final MP4 | not recorded | about 3 minutes wall clock |

How the lines were counted: demo 4 counts the lines between `// ---- the three tables you edit ----`
and the closing `// ----` marker in `index.html` (the `states()` and `cursor()` tables plus the
template's comments and the empty `extraSfx`/`content`). Demo 1 counts every non-blank line of its
module script, which includes its own page scaffolding (`window.ready`, `seek`, `beatT`) as well as
the per-state drawing code; demo 4 gets that scaffolding from the unchanged template and the
component library, which are not counted.

Build time covers refreshing the vendored `components/`, pasting the tables, beat stills (one pass,
nothing to fix), preview and final render; the final 925-frame render took under two minutes on an
Apple M5. Planning time (writing and approving the brief) is not included.
