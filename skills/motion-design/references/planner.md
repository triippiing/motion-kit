# Planner checklist

Sections are extension points: later sub-projects add rows to Questions and Assessments.
`S=~/.claude/skills/motion-video/scripts`. Make each step below a todo.

## Route (say it out loud)
| Request looks like | Route |
|---|---|
| a looping social promo | full flow below |
| a launch / non-looping video | full flow; intro and end cards are hand-built until sub-project D |
| animation inside a real app | hand to motion-ui |
| re-time or re-render an existing project | motion-video directly |

## Questions (one per message, multiple choice where possible; skip any already answered)
1. Goal and audience.
2. Where it will be posted → size (square 1440, vertical 1080x1920, landscape 1920x1080) and length in seconds. Bars are decided after the song is measured (Assessments).
3. Which product → read its stylesheet (extract_theme.py, show the printed roles) and look at its real UI.
4. The song → a file the user has the rights to use (never download music). If it is a commercial track, say once that social platforms will likely mute it.
5. The 3 to 6 moments to show → propose one component per moment from `~/.claude/skills/motion-video/components/CATALOG.md` by its "Use when" line, props filled from the product's real screens and copy; name a transitions.dev idea when relevant (ideas and timings only, rebuilt with springs). A moment that is one thing changing (tabs Day then Month, a balance growing) is two consecutive rows of the same component: the second animates the change. The user approves or swaps each one.

Write the understanding back (goal, size, length, product, song, moments) for correction before planning.

## Assessments (before writing the brief)
- `bash $S/doctor.sh` passes; stop and show the fixes if anything is MISSING.
- Scaffold and measure with a provisional length: `bash $S/new_project.sh DIR SONG --bars 8 --states K --size SIZE --theme PRODUCT.css`. Read the BPM from song.json and say it with its confidence and warnings.
- Length → bars (4/4): `bars = round(seconds * bpm / 240)`. Say it: "15 s at 109 BPM = 7 bars = 15.4 s" (bars * 240 / bpm). Choose `--start-bar` from song.json `sections` (a section boundary inside a strong section). Then re-run `python3 $S/analyze_song.py SONG --out DIR --bars N --start-bar B --states K` so song.json matches the real length before planning.
- song.json: `rules.min_hold_beats`, `rules.max_states`, loop window and sections, per-beat `accent` (biggest changes on the strongest beats).
- Theme coverage: which roles came from the product, which defaulted; fix a wrong role with `--map accent=--other-var`.
- Moments fit the state budget (`max_states`); text legible at the output size (nothing under 22 design px at 1440).

## MOTION-BRIEF.md (write into the project)
Sections, in order: `## Request` (classification), `## Decisions` (platform, size, length in seconds and bars, theme, song window, one-line reasons), `## Moments` (moment → component → props), `## Beat table` (readable table: #, bar.beat, t, component, what changes, sound; then ONE ```js block with `const states = () => [...]` and `const cursor = () => [...]`, using `use:` and `target:`). Format and a worked example: `references/state-plan.md`.
Then run `node $S/check_brief.mjs DIR` and fix every error before showing it.

## Gate
Show the brief. Build nothing until the user approves or asks for changes. On approval hand to motion-video.
