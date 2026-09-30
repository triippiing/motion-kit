# Demo 1: reference sequence

A code-only motion loop: one black-and-white UI shape, driven by a cursor, morphs
through 12 states (button, loader, check, island, player with scrub, volume
overstretch, toggle, tabs, chart, command bar, toast, back to the button),
cut to the beat of "Tints" by Anderson .Paak featuring Kendrick Lamar. Every frame is a pure
function of time (`seek(t)` in `index.html`), rendered to MP4 at 60 fps.

- BPM 109.00 (4/4, beat 0.5504 s), square 1440x1440, house theme.
- Loop window: bar 21 of the song (47.363 s), 7 bars = 28 beats = 15.413 s = 925 frames.
  The last frame equals the first, so it loops seamlessly.
- Beat-by-beat plan: `PLAN.md`. Sounds: `sfx/click.wav` (presses), `sfx/key.wav` (typing).

Uses a commercial track for local viewing only; re-run analyze_song on a licensed track before posting.

## Re-render

`clip.wav` and `out/` are not committed. Recreate the clip, then render:

```bash
S=~/.claude/skills/motion-video/scripts
python3 $S/analyze_song.py "<your copy of the song>" --out demos/01-reference --bars 7 --states 12 --start-bar 21
node $S/render.mjs demos/01-reference --serve         # watch live with audio (?play, click)
node $S/beat_stills.mjs demos/01-reference            # one still per beat + loop-seam check
node $S/render.mjs demos/01-reference                 # final: demos/01-reference/out/video.mp4
```

To re-time to another song, run `analyze_song.py` on it with `--out demos/01-reference`;
all timing comes from `song.json` beats.
