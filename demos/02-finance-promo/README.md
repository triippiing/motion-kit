# Demo 2: finance-app promo

A 15.4-second looping promo for Jack's Personal Finance app, made in code alone. One shape
morphs through eleven of the app's real UI moments, driven by a cursor and cut to a song's
beat grid. `index.html` is a pure `seek(t)` page; `render.mjs` turns it into an MP4.

- **Song:** "Tints" by Anderson .Paak featuring Kendrick Lamar at **109.00 BPM** (confidence 0.39). Loop window is **bar 7**
  (16.538 s in the track): 7 bars = 28 beats = 925 frames at 60 fps. Demo 1 uses bar 21.
- **Look:** the app's light theme, pulled from `web/style.css` by `extract_theme.py` (canvas #eef0f3,
  surface, ink, muted, accent #0c7d74, pos #067647, and the -apple-system / SF Pro stack). Soft
  tones (hairline, track, accent-soft, pos-soft) are mixed from those roles, so no colour is hard-coded.
- **Sequence** (see `PLAN.md` for the full beat table): Import payslip button → drag a PDF into
  the dropzone → "read" outcome → Holiday fund bar → Monthly surplus split bar → calendar week
  (payday, Rent) → status pill → dock indicator travels Plan → Calendar → portfolio sparkline
  point lands → Laptop fund goal met → Add goal in flight → back to the button.
- **Figures are made up**, not taken from the app's database or fixtures: net pay £3,200,
  Holiday fund £2,450 of £4,000, monthly surplus £900 (£540 to goals, £360 spare), Rent £850,
  portfolio £12,240 → £12,650, Laptop fund £1,500.

## Re-render

```sh
S=~/.claude/skills/motion-video/scripts
node $S/beat_stills.mjs demos/02-finance-promo     # one still per beat + seam check
node $S/render.mjs demos/02-finance-promo --serve  # watch live with audio (?play, click)
node $S/render.mjs demos/02-finance-promo          # -> out/video.mp4
```

`clip.wav` and `out/` are not committed. To recreate `clip.wav`, re-run
`analyze_song.py ~/Desktop/"Tints (feat. Kendrick Lamar).flac" --out demos/02-finance-promo --bars 7 --start-bar 7`.

## Licence note

Tints is a commercial track. Keep this video for local viewing unless Jack decides otherwise.
To post it anywhere, re-time it to a licensed or original track first (`analyze_song.py` with a new song).
