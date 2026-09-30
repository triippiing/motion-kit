# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Read this first; it is enough
to use, change or extend the kit without any other context.

## What this is

motion-kit makes **code-only motion design**: promo videos where one UI shape morphs through
states, driven by a cursor, cut to a song's beat grid, rendered from an HTML page to MP4.
No After Effects, Remotion or Lottie. It also brings the same spring maths to **live product
UI**. It ships as three Claude Code skills plus the scripts they call.

| Skill (`skills/`) | Job |
|---|---|
| `motion-design` | The planner, and the entry point: routes the request, asks, measures the song, writes a checked `MOTION-BRIEF.md` built from library components, then **stops for the user's approval** before any code. Style rules: `references/direction.md`. |
| `motion-video` | Build and render: scaffold, `seek(t)` page, contact sheet + seam check, MP4. All scripts and the component library live here. |
| `motion-ui` | In-app motion (indicators, toggles, drags). Rule one: **the project's own motion spec/tokens win**. Patterns: `references/patterns.md`. |

## Setup on a fresh Mac

```bash
git clone https://github.com/triippiing/motion-kit.git ~/motion-kit
~/motion-kit/install.sh      # links skills into ~/.claude/skills, installs ffmpeg/numpy/Playwright+Chromium and the
                             # transitions.dev companion skills, runs the doctor
```

Only Homebrew itself needs a manual step (it asks for a password): the doctor prints the
command. Re-run `install.sh` after. `skills/motion-video/scripts/doctor.sh` is the source of
truth for "is this machine ready"; run it whenever something fails oddly.

Claude's shell usually does not load `~/.zprofile`, so `/opt/homebrew/bin` may be missing from
PATH. Every script adds it itself; for ad-hoc commands use `/opt/homebrew/bin/ffmpeg` and
`/opt/homebrew/bin/ffprobe`. Rendering needs network access once per page load: the template
loads its house font (Geist) from Google Fonts. Offline, it falls back to the system UI font.

## How a video gets made

Say what you want ("a 15 second promo of this app to ~/Music/song.mp3") and `motion-design` takes it
from there. The steps, with `S=~/.claude/skills/motion-video/scripts`:

```
   -- motion-design (the planner, skills/motion-design/references/planner.md) --
1  route the request, ask the open questions one at a time (including where it will be posted), run doctor.sh
2  new_project.sh DIR SONG --bars 7 --states 12 [--size square|vertical|landscape|WxH] [--theme app.css] [--start-bar N]
     -> analyze_song.py: song.json (BPM, downbeat, beats[] with t/cue_t/accent, loop window, rules) + clip.wav
     -> extract_theme.py: theme.css/theme.json from the project's :root CSS vars (roles below)
     -> copies template/index.html, springs.js and components/, synthesises sfx/click.wav and sfx/key.wav, writes project.json
3  pick one library component per moment and write DIR/MOTION-BRIEF.md with the real states()/cursor() tables
     (format: skills/motion-design/references/state-plan.md; starting points: components/RECIPES.md)
     (its Decisions list the destinations as **Exports:** reels, x, discord, web)
4  node $S/check_brief.mjs DIR  -> strict validation of the tables; fix every error, resolve every warning
     (with an Exports line it also opens Chromium and checks the Reels/TikTok/Shorts safe zones)
5  show the brief and STOP until the user approves it
   -- motion-video --
6  paste the brief's states()/cursor() block into DIR/index.html
7  node $S/beat_stills.mjs DIR  -> out/stills/contact-sheet.png (LOOK at it) + loop-seam check; iterate
8  node $S/render.mjs DIR --preview, then node $S/render.mjs DIR -> out/video.mp4 (60 fps, 4-subframe tmix blur, audio + UI sounds)
9  node $S/export.mjs DIR --for reels,x,discord,web [--silent]
     -> out/exports/<preset>.<ext> + manifest.json, one native render per shape in out/shapes/<W>x<H>/video.mp4
```

Scripts are in `<clone>/skills/motion-video/scripts/`; after `install.sh` the same files are at
`~/.claude/skills/motion-video/scripts/` (a symlink). Use whichever exists, e.g.
`S=~/.claude/skills/motion-video/scripts` or `S=<clone>/skills/motion-video/scripts`.

Details worth knowing:
- `--preview` renders **half size** with 1 subframe (fast); the final render is full size with 4.
- `node render.mjs DIR --serve` serves the page; open the printed `?play` URL and click to watch it live with sound.
- Export (the full guide is the Export section of `skills/motion-video/SKILL.md`): the presets and their
  sourced platform limits are in `skills/motion-video/presets.json` (`source`, `checked`, and an `estimated`
  list the manifest copies). Discord is 20 MB free and 1 GB with Nitro. Export never overwrites
  `out/video.mp4`; it reuses it (or a shape render) only when its `.render.json` stamp matches exactly, it
  lasts the loop, and it is newer than every project file. Over a size cap it encodes two-pass and steps the
  resolution down (1080, 720, 540 short side); if the cap still cannot be met it stops with `error: ...`,
  exit 2 when the numbers rule it out and exit 1 when an encode missed it, and writes nothing to
  `out/exports`. Every preset with audio aims at -14 LUFS / -1 dBTP and warns when a file misses by more
  than 1 LU (very peaky audio, like a click track, can). `--silent` drops the audio. A commercial track (`**Song:** ..., a commercial track` or
  `**Music:** commercial` in the brief's Decisions, or `"music": "commercial"` in project.json) warns on
  every public preset. `export.mjs DIR --for reels,tiktok --guides` renders previews with translucent
  bands over each safe zone (`out/shapes/<W>x<H>/preview-guides-<preset>.mp4`); guides never reach an
  export. `safezones.mjs DIR --for reels,tiktok` checks the zones on their own.
- Vertical pieces: the template's cursor rest `x: 240, y: 280` sits in the Reels/TikTok/Shorts bottom and
  right zones; rest nearer the centre, e.g. `x: 140, y: 100`.
- The loop window: unless you pass `--start-bar N`, `analyze_song.py` picks the loudest N-bar window,
  preferring one that starts on a detected section boundary (listed in `song.json` `sections`). To move
  it later, re-run `analyze_song.py SONG --out DIR --bars N --start-bar B` (rewrites only song.json and clip.wav).
- Loop length vs states: each state holds at least `rules.min_hold_beats`, so `max_states` = beats / min hold.
  The template's 4 states exactly fill a 2-bar loop at ~120 BPM; use 7 bars for a 12-state piece.
- The template's button uses the `accent` role; the house accent is black, so a new project looks black and
  white until a theme sets an accent.

Changing colours: re-run `extract_theme.py project.css --out DIR` (it warns, harmlessly, for roles the CSS
lacks and keeps the house value), use `--map accent=--brand` when it picks the wrong variable, or edit
`theme.json` **and** `theme.css` together by hand (both are read: JSON for animated colours, CSS for `var(--role)`).

No music to hand (testing, or a fresh machine)? Make a click track at any tempo:
```bash
python3 -c "import sys; sys.path.insert(0, '<clone>/skills/motion-video/tests'); from test_analyze_song import click_track; click_track('beat.wav', 120, seconds=30)"
```

## The planner

`skills/motion-design` is where every video starts. `references/planner.md` is its checklist (route,
questions, assessments, brief, gate); `references/state-plan.md` is the beat-table format with a worked
example that uses 12 components. The result is `DIR/MOTION-BRIEF.md` with sections `## Request`,
`## Decisions`, `## Moments` and `## Beat table`; the last holds a readable table and ONE `js` block
with the real `states()` and `cursor()`.

`node $S/check_brief.mjs DIR` checks it: the sections, then the block with the engine's own validator in
strict mode (every row holds `rules.min_hold_beats`, at most `rules.max_states` states, something starts
on every beat, the loop seam). Exit 0 is OK, 1 is errors, 2 is bad usage. A launch video that does not
loop gets `"loop": false` in `DIR/project.json` (or `check_brief.mjs DIR --no-loop`).

## Components

The library is `skills/motion-video/components/`: 28 UI pieces in four groups (controls, feedback,
data, app chrome), each one file that draws inside the kit's one morphing shape. A table row uses one
by name, the cursor aims at its hotspots, and consecutive rows of the same component are one component
changing (tabs `active: 'Day'` then `active: 'Month'` slides the indicator), not a cut:

```js
{ at: 4, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Day' }   // states()
{ at: 5, target: 'tab:Month', press: true }                             // cursor()
{ at: 6, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Month' } // states(): the pressed result
```

| Doc | For |
|---|---|
| `components/CATALOG.md` | every component: picture, when to use it, how it moves, props, hotspots, one example. Generated; never edit |
| `components/RECIPES.md` | five complete, tested 7-bar sequences (onboarding, checkout, dashboard tour, AI reply, settings) |
| `components/WRITING-A-COMPONENT.md` | the contract, a working component to copy, the rules, and how to ship one |

The contract in brief (the full one is the header of `components/core/engine.js`): a component exports
`meta` (name, group, useWhen, motion, props with types and defaults, hotspots, sounds, a one-line
example, edge cases), `geometry` (the shape's size and colours), `mount` (build DOM once), `render`
(a pure function of `t`), `hotspot` (where the cursor lands), and optionally `sfx` and `endState` (the
props after its presses, which the next row of the same component starts from as `ctx.prev`). Row 0 is
shown settled so the loop seam matches; hover comes from `ctx.targets`; anything periodic takes its
period from `loopPeriod`.

After adding or changing a component: `node $S/build_catalog.mjs` (regenerates `components/index.js` and
`CATALOG.md`; `npm test` fails when they are stale), `node $S/gallery.mjs --only NAME --stills` (its
thumbnail; look at it), then `npm test`. `gallery.mjs OUT` without `--stills` writes a project that
plays every component and edge case.

New projects get their own copy of `components/` (so a project keeps working if the library changes);
`check_brief.mjs` validates against the project's copy when there is one.

## Long pieces and 4K

There is no hard limit on length or resolution. Length is `--bars N` (the song must be at least that
long); size is `--size WxH` (even numbers). A one-minute 4K piece:

```bash
new_project.sh ~/promo song.mp3 --bars 28 --size 3840x2160 --states 40   # 28 bars ~ 1 min at 109 BPM
```

- **Keep the design size.** Components and the template are tuned for a ~1440 px stage (shape sizes,
  text, the 44 px cursor, the 2.4 zoom cap). On a bigger stage the engine (`components/core/engine.js`,
  the `zoom` line and the cursor `scale(...)` in `seek`) multiplies the camera zoom and the cursor by
  `K = max(1, min(W, H) / 1440)` (never below 1), so the piece looks the same, just sharper. To override it, set
  `"designScale": N` in `DIR/project.json`. Everything is vector, so the zoom renders crisp text rather
  than upscaling.
- **Render time** grows with pixels, frames and subframes. Measured on an Apple M5: 1 s of full-quality
  4K (60 fps, 4 subframes) took ~19 s, so a minute is ~20 to 30 min. Frames stream into ffmpeg, so disk
  use stays small. Measure your own with `render.mjs DIR --from 0 --to 5` and scale up; iterate with
  `--preview` (half size, 1 subframe) and `beat_stills.mjs`, and do the full render once.
- **Plan in chapters.** A minute is ~110 beats and up to ~55 states. Plan 3 or 4 sections that each
  return to a resting state, rather than one unbroken chain.
- **Not a loop?** Add `"loop": false` to `DIR/project.json`: the page then accepts a last row that
  differs from the first, `check_brief.mjs` checks the brief as a one-off, and `render.mjs` clamps the
  motion-blur subframes to the piece instead of wrapping them (so the end card never ghosts into frame 0).
  `render.mjs --serve` with `?play` still loops playback. The seam check in
  `beat_stills.mjs` assumes the last frame equals the first; for a one-off its failure can be ignored.

## Rules that matter (the tests enforce most of them)

- **`seek(t)` is pure.** Every style is computed from `t` alone: no CSS transitions/animations,
  timers, `Date.now()`, or variables written by an earlier frame. Frames render in parallel
  pages in any order; impurity shows up as flicker. `seek` must not wrap `t` (the renderer does).
- **Page contract:** `window.ready` (promise), `window.STAGE = {width, height}` set by the time
  ready resolves, `window.seek(t)`, `window.inspect(t) -> {cursor: {x, y}}`, `window.SFX = [{beat, file, gain}]`.
- **Loop seam:** last STATES/CURSOR row repeats the first, at least 2 beats before the end.
- **Timing comes from the song:** `beatT(beat)` (uses measured `cue_t`), never hard-coded seconds.
  Springs: `Springs.fromSettle(seconds, zeta)`; house spring is `song.rules.spring` (zeta 0.85, settle 0.6 beat).
- **Colours are theme roles, not hex:** `canvas surface ink muted accent` (+ optional `pos neg`),
  used as `'accent'` in tables and `var(--accent)` in CSS. An unknown role throws on purpose.
- **Style (direction.md):** one shape never cut; tiny overshoot at most; content swaps blur with
  their own enter/exit timing; one stroke width; banned: gradients, glows, particles, bouncy easing, dead beats.
  No `will-change` under the camera (blurry text).
- **Approval gate:** always show MOTION-BRIEF.md (with check_brief.mjs passing) and wait before building. If the user's request
  already lists every state, the table is quick to confirm, but still show it.
- **Music:** never download songs. Users supply files. Audio (`clip.wav`, songs) and renders (`out/`)
  are git-ignored and must never be committed. Commercial tracks: local viewing only (or `export.mjs --silent`).
- **motion-ui:** find the project's motion spec/tokens first; zeta >= 1 where it bans overshoot;
  put maths in a pure function of `(from, changes, t)` and unit-test it; reduced motion jumps.

## Companion: transitions.dev

`install.sh` also installs the free [transitions.dev](https://transitions.dev) skills by Jakub Antalik
(`transitions-dev`, `transitions-polish`) into `~/.claude/skills` with their own CLI
(`npx skills add Jakubantalik/transitions.dev -g -a claude-code -s '*' -y`; skip with `--no-transitions`).
They are a catalog of 32 ready-made UI transitions with decision rules and `reveal`, `review`,
`apply` and `refine` commands.

- `motion-ui` reaches for the catalog for standard UI moments (dropdown, modal, toast, tabs, success
  check...) and keeps motion-kit springs for interruptible or physical motion. The project's own motion
  spec still wins: catalog values are mapped onto the project's tokens.
- `motion-design` names catalog moments when planning a video, then rebuilds them in `seek(t)` with
  springs. Their CSS/JS never goes into a video page (it would break purity).
- **Licence:** their terms allow use and modification in your projects but forbid republishing the
  collection (or a substantial part) as a library or kit. Never copy their files into this repo;
  reference transitions by name and let their CLI install them.

## Code map

```
shared/springs.js                 closed-form springs: response, spring, track, fromSettle, live (classic script:
                                  globalThis.Springs + module.exports; works in browser, Node, JavaScriptCore)
skills/*/assets/springs.js        symlinks to it; projects get a copy (cp -L)
skills/motion-video/scripts/      analyze_song.py, extract_theme.py (numpy only), new_project.sh,
                                  render.mjs (Playwright + ffmpeg; --stage WxH, --guides PRESET), beat_stills.mjs,
                                  doctor.sh, check_brief.mjs (validates MOTION-BRIEF.md, and safe zones for its
                                  Exports), build_catalog.mjs (index.js + CATALOG.md from each meta), gallery.mjs
                                  (every component in one project; --stills), export.mjs (ready-to-post files per
                                  preset + manifest), media.mjs (ffmpeg helpers: probe, loudness, size caps, encodes),
                                  safezones.mjs (safe-zone check, guides overlay, shared preset helpers)
skills/motion-video/presets.json  destination presets: shapes, platform limits with source/checked, safe margins
skills/motion-video/template/     index.html: the seek(t) scaffold every project starts from (reads project.json:
                                  stage, optional loop and designScale)
skills/motion-video/components/   the component library: core/engine.js (runs the tables; its header is the
                                  contract), core/validate.js (table rules, shared with check_brief),
                                  core/helpers.js (pure building blocks), modifiers.js (shake, badge),
                                  controls/ feedback/ data/ chrome/ (one file per component),
                                  CATALOG.md + index.js (generated), docs-images/ (thumbnails),
                                  RECIPES.md, WRITING-A-COMPONENT.md
skills/motion-design/references/  planner.md (the planner checklist), state-plan.md (beat-table format),
                                  direction.md (the look)
skills/motion-ui/references/      patterns.md (pattern 2 is extracted and tested by tests/patterns.test.mjs)
demos/                            worked examples (see "Demos" below)
docs/superpowers/                 the design spec and implementation plan this was built from (historical: the
                                  code and CLAUDE.md are current; the plan records how it was first built)
tests/, skills/*/tests/           node:test + python unittest
```

## Testing

```bash
npm test          # all Node suites + Python unittest (a few minutes; renders real frames with Chromium)
node --test skills/motion-video/tests/render.test.mjs   # one suite
```

Tests use synthetic click tracks (`test_analyze_song.click_track`) and tiny fixture projects
(`skills/motion-video/tests/fixtures.mjs`), so they need no song and no network except the
template's Google Fonts request.

## Demos

- `01-reference`: the sequence from zero (@twoclipping)'s prompt template, in the house style. Self-contained apart from the song.
- `02-finance-promo`: a promo for a private personal-finance app (made-up figures); theme came from
  that app's CSS, which is not in this repo. Still renders from a clone: `theme.json` is committed.
- `03-finance-inapp`: capture of `motion-ui` applied to that private app; `capture.mjs` needs the
  app's repo, so it will not run from a clone. The pattern it demonstrates is `motion-ui` pattern 2.

The songs are not in the repo. To render 01 or 02 from a fresh clone, give it any song you have
the rights to (the plan re-times automatically, though a different song's accents differ):

```bash
S=~/.claude/skills/motion-video/scripts
python3 $S/analyze_song.py ~/Music/your-song.mp3 --out demos/01-reference --bars 7 --states 12
node $S/render.mjs demos/01-reference
```

## Credits

See `CREDITS.md`. Keep it current: credit any new idea, asset, font or tool you bring in, and never
copy another project's code or assets into this repo without its licence allowing it.

## Conventions

- Plain HTML/JS/Python, no frameworks; Node deps are only `playwright` (pinned) in `skills/motion-video/`.
- Match the surrounding code's comment density and idiom. Scripts fail with `error: ...` and exit 2
  on bad input, never a traceback.
- Skill docs (`SKILL.md`) are instructions to Claude: keep commands exact and in sync with the scripts.
