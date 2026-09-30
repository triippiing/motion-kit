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
| `motion-design` | Plan a piece: inputs, song analysis, a state table on the beat grid, then **stop for the user's approval** before any code. Style rules: `references/direction.md`. |
| `motion-video` | Build and render: scaffold, `seek(t)` page, contact sheet + seam check, MP4. All scripts live here. |
| `motion-ui` | In-app motion (indicators, toggles, drags). Rule one: **the project's own motion spec/tokens win**. Patterns: `references/patterns.md`. |

## Setup on a fresh Mac

```bash
git clone https://github.com/triippiing/motion-kit.git ~/motion-kit
~/motion-kit/install.sh      # links skills into ~/.claude/skills, installs ffmpeg/numpy/Playwright+Chromium, runs the doctor
```

Only Homebrew itself needs a manual step (it asks for a password): the doctor prints the
command. Re-run `install.sh` after. `skills/motion-video/scripts/doctor.sh` is the source of
truth for "is this machine ready"; run it whenever something fails oddly.

Claude's shell usually does not load `~/.zprofile`, so `/opt/homebrew/bin` may be missing from
PATH. Every script adds it itself; for ad-hoc commands use `/opt/homebrew/bin/ffmpeg`.

## How a video gets made

```
1  new_project.sh DIR SONG --bars 7 --states 12 [--size square|vertical|landscape|WxH] [--theme app.css] [--start-bar N]
     -> analyze_song.py: song.json (BPM, downbeat, beats[] with t/cue_t/accent, loop window, rules) + clip.wav
     -> extract_theme.py: theme.css/theme.json from the project's :root CSS vars (roles below)
     -> copies template/index.html + springs.js, synthesises sfx/click.wav and sfx/key.wav, writes project.json
2  plan: a table of states on the beat grid (format: skills/motion-design/references/state-plan.md); get approval
3  edit DIR/index.html: only the tables states(), cursor(), content (+ one .layer per state), extraSfx()
4  node beat_stills.mjs DIR  -> out/stills/contact-sheet.png (LOOK at it) + loop-seam check; iterate
5  node render.mjs DIR --preview, then node render.mjs DIR -> out/video.mp4 (60 fps, 4-subframe tmix blur, audio + UI sounds)
```

Scripts are in `skills/motion-video/scripts/` (after install also `~/.claude/skills/motion-video/scripts/`).
`node render.mjs DIR --serve` serves the page; open the printed `?play` URL and click to watch it live with sound.

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
- **Music:** never download songs. Users supply files. Audio (`clip.wav`, songs) and renders (`out/`)
  are git-ignored and must never be committed. Commercial tracks: local viewing only.
- **motion-ui:** find the project's motion spec/tokens first; zeta >= 1 where it bans overshoot;
  put maths in a pure function of `(from, changes, t)` and unit-test it; reduced motion jumps.

## Code map

```
shared/springs.js                 closed-form springs: response, spring, track, fromSettle, live (classic script:
                                  globalThis.Springs + module.exports; works in browser, Node, JavaScriptCore)
skills/*/assets/springs.js        symlinks to it; projects get a copy (cp -L)
skills/motion-video/scripts/      analyze_song.py, extract_theme.py (numpy only), new_project.sh,
                                  render.mjs (Playwright + ffmpeg), beat_stills.mjs, doctor.sh
skills/motion-video/template/     index.html: the seek(t) scaffold every project starts from
skills/motion-ui/references/      patterns.md (pattern 2 is extracted and tested by tests/patterns.test.mjs)
demos/                            worked examples (see "Demos" below)
docs/superpowers/                 the design spec and implementation plan this was built from
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

- `01-reference`: the @twoclipping sequence in the house style. Self-contained apart from the song.
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

## Conventions

- Plain HTML/JS/Python, no frameworks; Node deps are only `playwright` (pinned) in `skills/motion-video/`.
- Match the surrounding code's comment density and idiom. Scripts fail with `error: ...` and exit 2
  on bad input, never a traceback.
- Skill docs (`SKILL.md`) are instructions to Claude: keep commands exact and in sync with the scripts.
