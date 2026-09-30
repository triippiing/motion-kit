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
