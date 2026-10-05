# Sequences: chapters on one song (sub-project D): design

Date: 2026-10-04
Status: approved on Jack's behalf (overnight authorization, 2026-10-04); for his morning review — not merged before it
Part of: the motion-kit roadmap (A, B, C1, C2a, C2b, F1, F2 done; E next).

## Purpose

A piece longer than one loop is built as chapters: separate projects, each with its own tables, played back to back
on one song. The launch video did this by hand (`~/motion-kit-launch/build.sh`): four chapters whose loop windows had
to be lined up on the song manually, rendered one by one, joined with ffmpeg, and encoded outside `export.mjs`. D makes
that one workflow.

Decision (Jack, 2026-10-04): one song, chapters back to back. Chapters with different songs are out of scope.

Success means:
1. A `sequence.json` lists chapter projects in order on one song; one command lines their loop windows up back to
   back on the song (the first can start with the song, `--from-start`), sharing one ear-checked grid.
2. One command checks the chapters (their briefs, and that each chapter starts exactly where the previous one ends).
3. One command renders every chapter, joins them, and lays one continuous cut of the song under the whole piece (no
   seams at the joins), with an optional fade-out.
4. `export.mjs` exports a sequence through the existing presets (sizes, caps, loudness, safe zones).
5. The launch video can be rebuilt from a `sequence.json` (checked on a scratch copy; nothing in `~/motion-kit-launch`
   is changed).
6. Tests green; not merged before Jack's review.

Out of scope: different songs per chapter, transitions between chapters other than the shape's own motion, editing
chapters on any page.

## 1. `sequence.json`

In a sequence directory (SEQ):

```json
{
  "song": "/path/to/song.mp3",
  "chapters": [
    { "dir": "intro", "bars": 2, "from_start": true },
    { "dir": "kit", "bars": 15 },
    { "dir": "end", "bars": 2 }
  ],
  "fade_out_sec": 2.0
}
```

- `dir` is relative to SEQ; each is an ordinary motion-video project (`new_project.sh`) with `"loop": false` in its
  project.json (chapters are not loops; the sequence sets it).
- `bars` is the chapter's length. The first chapter starts with the song (`from_start: true`, C2b's `--from-start`) or
  at `start_bar` (`"start_bar": N`); each later chapter starts where the previous one ends.
- Validation: unknown keys, missing dirs, bars < 1, both `from_start` and `start_bar`, later chapters with a start of
  their own → `error: ...`, exit 2.

## 2. `scripts/sequence.mjs`

`node sequence.mjs SEQ <command>`; commands:

- **`init NAME...`** — scaffold: creates SEQ/sequence.json (song from `--song PATH`, chapters from the names, bars from
  `--bars N` each, default 4) and runs `new_project.sh` for each chapter.
- **`analyse`** — the grid is chapter 1's: if chapter 1's song.json has a `sync` section (set by ear with `sync.mjs` on
  chapter 1), its grid fields (everything but markers) are copied to every other chapter first. Markers (song time)
  are merged by name across every chapter's sync and written to all of them: a name at two times keeps chapter 1's
  (else the earlier chapter's) and warns, so a marker is moved on chapter 1; a name deleted on one chapter but still on
  another comes back, so a marker is removed from every chapter's song.json. A markers list (even an empty one, which
  the sync page always saves) is kept. A chapter whose sync changes keeps its old song.json as `song.json.bak`. Then each chapter is analysed with `analyze_song.py SONG --out
  DIR --bars N` and its start: chapter 1 `--from-start` or `--start-bar`; chapter k>1 `--start-bar` = chapter k−1's
  `loop.start_bar + bars` (bars counted on the same grid, so the windows abut exactly). Prints one line per chapter
  (`kit: bars 2-16, 0:04.9-0:37.9`).
- **`check`** — for each chapter: check_brief (when it has a brief, `--no-loop` semantics since chapters are not
  loops); then continuity: chapter k+1's `loop.start_sec` equals chapter k's `loop.start_sec + loop.duration_sec`
  within 1 ms, and all chapters have the same `bpm`, `sync` and fps. Errors exit 1; usage exits 2.
- **`render [--preview]`** — renders each chapter whose render is stale (render.mjs, its `.render.json` stamp decides),
  then joins: video = the chapter videos concatenated (same size and fps; checked); audio = ONE cut of the song from
  chapter 1's start to the last chapter's end (analyze_song's clip writer logic: same fades at the ends, plus the
  sequence's `fade_out_sec`, applied to the whole mix), mixed with each chapter's UI sounds at their offsets — no seams
  at the joins. Output SEQ/out/sequence.mp4 (SEQ/out/sequence-preview.mp4 with `--preview`, so a preview never
  replaces the full join; under SEQ/out/shapes/WxH/ with `--stage WxH`) with a stamp listing the chapter stamps.
  `renderSequence` resolves `{ file, chapters: [{ name, reused }] }`.
- **`watch CHAPTER [--brief] [--port N] [--no-open]`** — shorthand for `watch.mjs SEQ/CHAPTER` (C2a) with the same
  flags, for editing one chapter at a time; Ctrl+C is passed on and it exits with watch.mjs's code. An unknown
  chapter is exit 2.

The last chapter of the launch video holds on its end card; chapters may end on a hold (not a loop), which
`"loop": false` already allows.

## 3. Export

`export.mjs SEQ --for ...` accepts a sequence directory (detected by sequence.json): for each preset shape it renders
every chapter at that shape (render.mjs's stage override, as today per project) and joins them as `render` does, then
runs the existing encode path (size caps, loudness, safe zones on each chapter's frames, GIF, manifest). The manifest
records the chapters. Reuse rules follow export's existing stamp logic per chapter. The design size is rendered
without a stage override, so it re-renders stale chapters into their own out/video.mp4 and re-joins
SEQ/out/sequence.mp4 (a full render, never the preview).

## 4. Docs

CLAUDE.md (a "Sequences" section; code map), SKILL.md (commands), planner.md (a long piece is planned in chapters: one
brief per chapter, a sequence.json, and `sequence.mjs SEQ check` before approval).

## Testing

- Synthetic: a 3-chapter sequence on a 40 s click track (chapters 2, 3, 2 bars; first from_start): analyse makes the
  windows abut (check passes); render's sequence.mp4 has video frames = sum of chapter frames and audio that matches the
  song cut sample-for-sample at the joins (no fades/clicks inside); fade_out applies at the end; export --for web,gif
  works on SEQ.
- Errors: bad sequence.json, mismatched chapter sizes/fps, a chapter re-analysed by hand so the windows no longer abut
  (check fails naming the chapter and the gap).
- Acceptance (report only): rebuild the launch video from a sequence.json on a scratch copy of ~/motion-kit-launch with
  Jack's Tease Me file; compare duration with the shipped linkedin.mp4 (60.7 s) and listen-free checks (audio is one
  continuous cut; no gaps by the export gap check).
