# Planner checklist

Sections are extension points: later sub-projects add rows to Questions and Assessments.
`S=~/.claude/skills/motion-video/scripts`. Make each step below a todo.

## Route (say it out loud)
| Request looks like | Route |
|---|---|
| a looping social promo | full flow below |
| a launch / non-looping video | full flow, not a loop: after scaffolding, add `"loop": false` to `DIR/project.json` (check_brief.mjs and the page read it); intro and end cards are hand-built until sub-project D |
| animation inside a real app | hand to motion-ui |
| re-time or re-render an existing project | motion-video directly |

## Questions (one per message, multiple choice where possible; skip any already answered)
1. Goal and audience.
2. Where will you post it? Multiple choice, more than one answer allowed (each group's presets and limits are in `~/.claude/skills/motion-video/presets.json`):

   | Choice | Presets | Shape |
   |---|---|---|
   | Reels / TikTok / Shorts | `reels`, `tiktok`, `shorts` | vertical 1080x1920 |
   | X / LinkedIn feed | `x`, `linkedin` (square 1440); `x-landscape`, `linkedin-landscape` (1920x1080) | square, or landscape if asked |
   | Discord / chat | `discord` (20 MB free), `discord-nitro` (1 GB) | the design shape |
   | Web / wiki / GitHub | `web` (MP4 + WebM + poster), `gif` (README GIF) | the design shape |

   The first choice sets the design shape (`--size`): vertical for Reels/TikTok/Shorts, otherwise square unless the user wants landscape. Every other choice is rendered natively at its own shape at export time (no letterboxing), so design for the first and keep the moments near the centre. Also ask the length in seconds. Bars are decided after the song is measured (Assessments).
3. Which product → read its stylesheet (extract_theme.py, show the printed roles) and look at its real UI. No product (a concept piece, or the user wants a neutral look) → use the house theme: leave `--theme` off when scaffolding and write "theme: house (no product)" in Decisions.
4. The song → a file the user has the rights to use (never download music). Ask whether it is a commercial track (a released song) or licensed music. If commercial, say once that social platforms will likely mute it, and record it in Decisions so the export warns: `**Song:** "Title", a commercial track, so social platforms would likely mute it` (or `**Music:** commercial`; export.mjs also reads `"music": "commercial"` from `DIR/project.json`, but check_brief reads only the brief). Wording like "licensed for commercial use" or "not a commercial track" does not count as commercial.
5. The 3 to 6 moments to show → propose one component per moment from `~/.claude/skills/motion-video/components/CATALOG.md` by its "Use when" line, props filled from the product's real screens and copy (`components/RECIPES.md` has five complete sequences to start from); name a transitions.dev idea when relevant (ideas and timings only, rebuilt with springs). A moment that is one thing changing (tabs Day then Month, a balance growing) is two consecutive rows of the same component: the second animates the change. The user approves or swaps each one.

Write the understanding back (goal, destinations and size, length, product, song and whether it is commercial, moments) for correction before planning.

## Assessments (before writing the brief)
- `bash $S/doctor.sh` passes; stop and show the fixes if anything is MISSING.
- Scaffold and measure with a provisional length: `bash $S/new_project.sh DIR SONG --bars 8 --size SIZE --theme PRODUCT.css` (no `--theme` for the house theme; no `--states` yet: the rows are not counted until the moments are approved). If it reports fewer whole bars than asked ("song is shorter than the requested loop: N whole bars available"), re-run with `--bars N` (that number). Read the BPM from song.json and say it with its confidence and warnings.
- Length → bars (4/4): `bars = round(seconds * bpm / 240)`. Say it: "15 s at 109 BPM = 7 bars = 15.4 s" (bars * 240 / bpm). Choose `--start-bar` from song.json `sections` (a section boundary inside a strong section). Count the states: K = the `states()` rows the approved moments need (a moment that is one thing changing is two rows; a loop's closing row repeats the first). Then re-run `python3 $S/analyze_song.py SONG --out DIR --bars N --start-bar B --states K` so song.json matches the real length and warns if K rows do not fit, before planning.
- song.json: `rules.min_hold_beats`, `rules.max_states`, loop window and sections, per-beat `accent` (biggest changes on the strongest beats).
- Theme coverage: which roles came from the product, which defaulted; fix a wrong role with `--map accent=--other-var` (house theme: nothing to check).
- Moments fit the state budget (`max_states`); text legible at the output size (anything the viewer must read at 22 design px or more at 1440; components use 18 px only for captions).
- Safe zones: `check_brief.mjs` checks them for the chosen exports (Reels, TikTok and Shorts have bands for captions and buttons; the feed, chat and web presets show the whole frame). It runs only when the brief has an `**Exports:**` line, and it opens Chromium. Resolve each warning (move or shrink the content), or justify it in the brief.
- Vertical cursor rest: the template's rest point `x: 240, y: 280` sits inside the Reels, TikTok and Shorts bottom and right zones on a vertical stage. On a vertical piece rest the cursor nearer the centre, for example `x: 140, y: 100` (checked clean on all three with the template's own rows, including its closest zoom). Cursor `x`/`y` are design px from the centre and grow with the camera zoom (up to 2.4x on a small component), so keep a rest within about -190 to 150 across and -280 to 100 down; `check_brief.mjs` has the final word.

## MOTION-BRIEF.md (write into the project)
Sections, in order: `## Request` (classification), `## Decisions` (platform, size, length in seconds and bars, theme, song and window, one-line reasons; the destinations as one line of preset names, e.g. `**Exports:** reels, x, discord, web`), `## Moments` (moment → component → props), `## Beat table` (readable table: #, bar.beat, t, component, what changes, sound; then ONE ```js block with `const states = () => [...]` and `const cursor = () => [...]`, using `use:` and `target:`; any row can also take the row-level keys `fill`, `ink` (a theme role or `#rrggbb`), `w`/`h`/`r`, `shake: true` and `badge: <n>`, listed at the top of `components/CATALOG.md`). A drag is three rows: down, move, up (`press: 'down'`, then a row that moves the cursor, then `press: 'up'` at that same position; a move written on the 'up' row starts only after the release). Format and a worked example: `references/state-plan.md`.
Then run `node $S/check_brief.mjs DIR` (a launch video is checked as a one-off when project.json has `"loop": false`; `--no-loop` does the same without it): fix every error, and read every warning and resolve it, or justify it in the brief. Do both before showing it.

## Gate
Show the brief. Build nothing until the user approves or asks for changes. On approval hand to motion-video, which builds, renders and ends with `node $S/export.mjs DIR --for PRESETS` (the brief's Exports line, comma-separated with no spaces).
