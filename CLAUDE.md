# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Read this first; it is enough
to use, change or extend the kit without any other context.

## What this is

motion-kit makes **code-only motion design**: promo videos where one UI shape morphs through
states, driven by a cursor, cut to a song's beat grid, rendered from an HTML page to MP4.
No After Effects, Remotion or Lottie. It also brings the same spring maths to **live product
UI**. It ships as four Claude Code skills plus the scripts they call.

| Skill (`skills/`) | Job |
|---|---|
| `motion-design` | The planner, and the entry point: routes the request, asks, measures the song, writes a checked `MOTION-BRIEF.md` built from library components, then **stops for the user's approval** before any code. Style rules: `references/direction.md`. |
| `motion-video` | Build and render: scaffold, `seek(t)` page, contact sheet + seam check, MP4. All scripts and the component library live here. |
| `motion-ui` | In-app motion (indicators, toggles, drags). Rule one: **the project's own motion spec/tokens win**. Patterns: `references/patterns.md`. |
| `motion-story` | A video from something that already exists (for now a repo: its intro, a release or a pull request): `story_facts.mjs` reads it into a facts file, Claude drafts `STORY.md` from it, the user **approves it**, then it is motion-design's request. See Stories. |

## Setup on a fresh Mac

```bash
git clone https://github.com/triippiing/motion-kit.git ~/motion-kit
~/motion-kit/install.sh      # links skills into ~/.claude/skills, installs ffmpeg/numpy/Playwright with its Chromium
                             # and WebKit, and the transitions.dev companion skills, runs the doctor
```

Only Homebrew itself needs a manual step (it asks for a password): the doctor prints the
command. Re-run `install.sh` after. `skills/motion-video/scripts/doctor.sh` is the source of
truth for "is this machine ready" (it checks Playwright's Chromium and its WebKit, which capture.mjs uses); run it
whenever something fails oddly.

Claude's shell usually does not load `~/.zprofile`, so `/opt/homebrew/bin` may be missing from
PATH. Every script adds it itself; for ad-hoc commands use `/opt/homebrew/bin/ffmpeg` and
`/opt/homebrew/bin/ffprobe`. Rendering needs network access once per page load: the template
loads its house font (Geist) from Google Fonts. Offline, it falls back to the system UI font.

## How a video gets made

Say what you want ("a 15 second promo of this app to ~/Music/song.mp3") and `motion-design` takes it
from there. Starting from a repo instead ("make a video of this repo", "the latest release", "this PR")?
`motion-story` goes first: facts, then a `STORY.md` the user approves, which becomes the request below (its
answered questions skipped; see Stories). The steps, with `S=~/.claude/skills/motion-video/scripts`:

```
   -- motion-design (the planner, skills/motion-design/references/planner.md) --
1  route the request, ask the open questions one at a time (including where it will be posted), run doctor.sh
2  new_project.sh DIR SONG --bars 7 --states 12 [--size square|vertical|landscape|WxH] [--theme app.css] [--start-bar N | --start-near SEC | --from-start]
     -> analyze_song.py: song.json (BPM, downbeat, beats[] with t/cue_t/accent, loop window, rules, suggestions) + clip.wav
        + .source.json (the song's absolute path, for the sync page's Save; local and git-ignored)
     -> extract_theme.py: theme.css/theme.json from the project's :root CSS vars (roles below)
     -> copies template/index.html, springs.js and components/, synthesises sfx/click.wav and sfx/key.wav, writes project.json
3  node $S/sync.mjs DIR  -> the sync page (run it in the background; it prints the URL and opens the browser).
     The USER listens: clicks over the song beside the live animation, nudges or taps the tempo, presses
     Sounds right, marks moments (M: drop, vocal...), saves. Claude cannot hear: never claim the sync is right.
     Needed when song.json bpm_confidence < 0.5 and sync.checked_by_ear is absent, or when song.json has suggestions
     (tempo map, swing, meter, pickup: the user tries, keeps or dismisses them); always ask about moments to hit
3b a moment that shows the real app (see Footage): capture it now, before the brief, with the user's say-so
     node $S/capture.mjs APP.html --steps steps.json --out DIR/footage/NAME   (or node $S/footage.mjs REC.mov --out DIR/footage/NAME)
4  pick one library component per moment and write DIR/MOTION-BRIEF.md with the real states()/cursor() tables
     (format: skills/motion-design/references/state-plan.md; starting points: components/RECIPES.md)
     (its Decisions list the destinations as **Exports:** reels, x, discord, web, and the ear check as
     **Sync:** checked by ear 2026-10-01; markers: drop  or  **Sync:** not checked (confidence 0.39);
     a row on a marked moment is { at: 'drop', ... }, optionally with offset in beats)
5  node $S/check_brief.mjs DIR  -> strict validation of the tables, then a frame check in Chromium (cursor past the stage
     edges, text past or cut off in its shape, and the safe zones when there is an Exports line); fix every error,
     resolve every warning
6  show the brief and STOP until the user approves it
   -- motion-video --
7  paste the brief's states()/cursor() block into DIR/index.html; keep node $S/watch.mjs DIR open while editing
     (a live preview with the song: each save reloads the animation, check_brief re-runs; see Watching)
8  node $S/beat_stills.mjs DIR  -> out/stills/contact-sheet.png (LOOK at it) + loop-seam check; iterate
9  node $S/render.mjs DIR --preview, then node $S/render.mjs DIR -> out/video.mp4 (60 fps, 4-subframe tmix blur, audio + UI sounds)
10 node $S/export.mjs DIR --for reels,x,discord,web [--silent]
     -> out/exports/<preset>.<ext> + manifest.json, one native render per shape in out/shapes/<W>x<H>/video.mp4
   Longer than one loop (intro, chapters, end card)? Each chapter is a project like the above, played back to back on
   one song by node $S/sequence.mjs SEQ init|analyse|check|render|watch; export.mjs SEQ (see Sequences)
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
  lasts the loop, and no project file changed after that render started (the stamp's `sources`; the stamp's
  renderer id covers render.mjs, the engine, ffmpeg's version and Playwright's Chromium). Over a size cap it re-encodes two-pass and, if that
  bitrate is too low, steps the short side down (1080, 720, 540); if the cap still cannot be met it stops with `error: ...`,
  exit 2 when the numbers rule it out and exit 1 when an encode missed it, and writes nothing to
  `out/exports`. Every preset with audio aims at -14 LUFS / -1 dBTP and warns when a file misses by more
  than 1 LU, or its true peak ceiling by 0.5 dB. AAC adds true-peak overshoot on sharp transients (the click
  and key sounds), so the audio is encoded alone and, on a miss, re-encoded down a coder ladder (`aac`, `aac
  -aac_coder fast`, then `aac_at` when ffmpeg lists it) before muxing; the manifest's `audioCoder` names the one
  used, and only a miss on every coder (or very peaky audio, like a click track) warns. `--silent` drops
  the audio. A commercial track (`**Song:** ..., a commercial track` or `**Music:** commercial` in the
  brief's Decisions, or `"music": "commercial"` in project.json) warns on every public preset that carries
  audio. `export.mjs DIR --for reels,tiktok --guides` renders previews with translucent
  bands over each safe zone (`out/shapes/<W>x<H>/preview-guides-<preset>.mp4`); guides never reach an
  export. `safezones.mjs DIR --for reels,tiktok` checks the zones on their own.
- Vertical pieces: the template's cursor rest `x: 240, y: 280` sits in the Reels/TikTok/Shorts bottom and
  right zones; rest nearer the centre, e.g. `x: 140, y: 100`.
- The loop window: unless you pass `--start-bar N`, `analyze_song.py` picks the loudest N-bar window,
  preferring one that starts on a detected section boundary (listed in `song.json` `sections`) and one that
  ends inside the song. To move it later, re-run `analyze_song.py SONG --out DIR --bars N --start-bar B`
  (rewrites only song.json, clip.wav and .source.json; song.json's `sync` section is kept, see Syncing).
  A window that still runs past the song's end (chosen with --start-bar or --start-near) gets a
  silence-padded clip.wav and a warning. `--from-start` (also on new_project.sh and swap_song.mjs) starts the loop
  on the downbeat of the song's first audible bar (a silent 1 after a pickup still counts; or on the first pickup
  beat before it when `sync.pickup_beats` is set); check it by ear, the downbeat it finds can be a beat or more off.
  See Syncing.
- Re-timing to a different song: `node $S/swap_song.mjs DIR NEWSONG [--bars N] [--start-bar B | --start-near SEC |
  --from-start] [--no-open] [--port N]`. It backs up song.json, clip.wav and .source.json to `DIR/.swap-backup/<YYYYMMDD-HHMMSS>/`
  (ignored in this repo; keep it out of your own commits), clears `sync` (its nudge, tempo and markers were set by
  ear against the old song; the analyser would otherwise keep and apply it), re-analyses with the project's bars (or `--bars`) and fps (the loop window is picked afresh unless
  `--start-bar`, `--start-near` or `--from-start` is given), and prints
  `tempo: A -> B BPM (confidence C)`, `loop: N bars = S s (was S s)`, `window: bar A -> B (pass --start-bar A to
  keep it)` (or `window: bar B (unchanged)`), `to place: drop, chorus` (the marker names
  the tables use; or `no markers to place`), a `warning:` when the tables have more states than the new song
  allows, a reminder to update the brief's Song/Music line when a brief exists, and `backup: PATH`. Then it runs
  `sync.mjs DIR` (unless `--no-open`) to place those names. A failed analyser or Ctrl+C during it puts the backup
  back (Ctrl+C keeps the backup directory too). It never edits the tables. Bad usage exits 2 with `error: ...`.
- Loop length vs states: each state holds at least `rules.min_hold_beats`, so `max_states` = beats / min hold.
  The template's 4 states exactly fill a 2-bar loop at ~120 BPM; use 7 bars for a 12-state piece.
- The template's button uses the `accent` role; the house accent is black, so a new project looks black and
  white until a theme sets an accent.

Changing colours: re-run `extract_theme.py project.css --out DIR` (it warns, harmlessly, for roles the CSS
lacks and keeps the house value), use `--map accent=--brand` when it picks the wrong variable, or edit
`theme.json` **and** `theme.css` together by hand (both are read: JSON for animated colours, CSS for `var(--role)`).

No music to hand (testing, or a fresh machine)? Make a click track at any tempo:
```bash
python3 <clone>/skills/motion-video/scripts/click_track.py beat.wav 120 --seconds 30
```
It also makes the hard cases the suggestions are tested on: `--tempo-map 0:90,20:120r` (T:BPM anchors, `r` = ramp
into it), `--swing 0.62`, `--meter 3/4|6/8`, `--pickup N`.

## Syncing

Only a person can confirm that the beat grid sits on the music, so the kit has a page for it and Claude
never claims the sync is right. `node $S/sync.mjs DIR [--port N] [--no-open] [--song PATH]` serves the
project on 127.0.0.1 and opens `/__sync`: the project's own animation on the left, a waveform with the
grid and marker flags on the right, beat clicks scheduled on the audio clock. The user nudges the grid
(↑ / ↓, 5 ms, Shift 20 ms), scrubs the playhead (← / →, 10 ms, Shift a quarter beat, Alt to the next beat line, Home
the start; stopped, each step plays a short blip), taps the tempo (T, then Enter), sets meter and swing,
drops named markers at the playhead (M) with an optional note (click the flag, type in its "add a note"
field; at most 200 characters, never used for timing), clicks the loop strip to move the playhead, presses Sounds right and saves (Ctrl/Cmd+S). The full guide (keys, status line, errors, known limits)
is the Sync section of `skills/motion-video/SKILL.md`.

- **Save** writes song.json's `sync` section (`nudge_ms`, `bpm`, `meter`, `swing`, `markers` in song
  seconds with an optional `note`, `checked_by_ear`, and the fields suggestions set: `tempo_map`, `pickup_beats`,
  `dismissed`), keeps the old file as `song.json.bak`, and re-runs `analyze_song.py` on the
  original song (path from `DIR/.source.json`) with the project's bars and fps and `--start-near` the loop
  start (`--from-start` for a loop made with it), re-cutting clip.wav. A failure puts the previous files back. A song that has moved gets an error
  naming `sync.mjs DIR --song PATH`. If the analyser runs longer than 120 s (MK_ANALYSER_TIMEOUT, in ms,
  changes it), Save stops it, puts the previous song.json back and reports the error.
- **The ear wins:** once a nudge, tempo or tempo map is set, beats sit on the grid itself (`cue_t` equals `t`, no
  snapping to detected hits). A nudge, tempo, meter, `tempo_map` or `pickup_beats` change clears `checked_by_ear`;
  swing does not.
- **Suggestions:** every analyser run writes a derived top-level `suggestions` object (song_suggest.py; never user
  data, rebuilt each run): `tempo_map` (`segments` [{t, bpm, ramp}] and the suggested `beats`), `swing` (`value`, and
  `bpm` when a shuffle's triplets pulled the tempo to about 4/3 of the real one), `meter` (`3/4` or `6/8`) and
  `pickup` (`beats` before the first downbeat), each with a `confidence` (0..1) and a one-line `reason`. Nothing in
  it is applied: the sync page lists them above the controls with **Try** (hear it on the grid; toggles; never saved;
  a pickup has none), **Keep** (puts its fields in the pending sync; Save applies it) and **Dismiss** (adds
  `{key, value}` to `sync.dismissed`; hidden until the analyser's value for it changes). A tempo-map suggestion is
  offered alone (the others would be measured on the single grid it says is wrong): they appear once it is kept or
  dismissed and saved. A tempo map or pickup already saved in `sync` is listed as **kept** with **Remove** (clears it
  in the pending sync, which clears `checked_by_ear` like any grid change; again restores it; Save applies it); a
  tapped tempo replaces a kept tempo map, keeping a tempo map drops a pending tempo, and keeping a swing with a tempo
  drops a tempo map (a map wins over `bpm` on Save, so the page keeps only what it previews). No tempo map is
  suggested once `sync.tempo_map` is set, and no swing when the meter is (or is
  suggested as, not dismissed) 6/8 (its thirds read as swing). Keeping a tempo map, a swing with a tempo, a meter or a pickup clears `checked_by_ear`
  (a swing alone does not). A straight steady 4/4 song gets none, and with none the page is as before. They are
  guesses: Claude cannot hear, so never keep one for the user or say one is right.
- **New sync fields:** `tempo_map` `[{t, bpm, ramp}]` (sorted, first `t` 0, bpm 40 to 240; replaces `bpm`; `ramp:
  true` = linear from the previous anchor; the grid is laid at the map's tempo, so `cue_t` equals `t` and tables in
  beats work unchanged; song.json's `bpm`, `beat_sec` and `rules` then come from the loop's mean beat), `pickup_beats` (0 to beats-a-bar − 1; those beats are bar −1) and `dismissed`
  (`[{key, value}]`). A pickup only changes a loop made with `--from-start`: it then starts on the first pickup beat
  and holds the pickup plus `--bars` bars (`beats[i].bar` / `beat_in_bar` say where bar 0 starts). Swung grids click
  their off-beats at a lower, quieter tone.
- **Markers in tables:** `{ at: 'drop', ... }` or `{ at: 'drop', offset: -0.5, ... }` (offset in beats) lands
  on the marker's exact time. Put the action (the press) on the marker and its result after it; a lead is for the
  approach row. The analyser lists the loop's markers as top-level song.json `markers`
  (`name`, `song_t`, `t`, `in_loop`); one outside the loop is an error. check_brief warns
  `beat grid not checked by ear (confidence N): open it with sync.mjs DIR and press Sounds right` when
  `bpm_confidence` < 0.5 and `sync.checked_by_ear` is absent.
- **Limits:** a loop window that ends at the song's end cannot be nudged (Save refuses it; move the window
  with `--start-bar` first). Markers outside the loop are listed but not drawn. To remove one, click its row
  in the markers list, then Delete, and Save. To move one, edit `sync.markers` with the page closed, then open
  it and Save, or move the window (`--start-near SEC` a bar or two before the moment). Save does not pass `--states`. Older projects get the kit's timing module from
  `/__sync/timing.js` and, lacking `window.rebuild`, a reload after Save; their old `components/` copy does
  not know markers. Every script's page server refuses files symlinked from outside the project
  (`new_project.sh` copies, so its projects are fine).
- **To place:** after a song swap the tables still name markers the new song lacks. `GET /__sync/needed` lists the
  marker names the tables use (index.html's and the brief's) that `sync.markers` has not placed; the page shows them
  as a "to place" list above the markers: click a name, press M, and the marker drops at the playhead with that
  name. Until a Save leaves nothing to place, the animation pane says
  `place these moments to see the animation: drop, chorus` instead of loading tables that would throw. A table
  name that is not a valid marker name is listed with a note to rename it in the table. check_brief's unknown-marker
  error adds `(after a song swap, place it on the sync page: node sync.mjs DIR)`.

## Watching

`node $S/watch.mjs DIR [--brief] [--port N] [--no-open]` serves the project on 127.0.0.1, prints
`watching: http://127.0.0.1:PORT/__watch` and opens it (unless `--no-open`). The page plays clip.wav and drives
the project's index.html in an iframe with `seek(t)`; on every save of index.html, MOTION-BRIEF.md, song.json,
theme.json, theme.css, project.json or anything in components/ (changes within 200 ms are one) only the iframe
reloads, so the song and the playhead carry on. Before reloading, the tables are run and checked with the
engine's validator (non-strict, as the page's createScene does): if they throw or fail it (a syntax error, an
unknown marker, a component typo), the version stays, the terminal prints `error: ...` and the page keeps the last
good frame with the error in its panel; the next good save reloads. The page loads each new version into a second,
unseen iframe and swaps it in only once its `ready` resolves; an error only the page can see (a throw in `content`)
keeps the old frame too, and the page POSTs it to `/__watch/page-error` so the terminal and the status have it
until the next reload. A broken table never blanks the preview.
Watch reads the project's components/ once, when it starts: after changing a component's props, geometry or meta, or adding one, restart watch (until then its check can report false errors and hold good saves).
When MOTION-BRIEF.md exists, check_brief re-runs (frame check included) and prints its lines in the terminal
(`warning:` / `error:`, then `brief OK` or `brief has N error(s)`); the page's corner panel shows the same (errors
red, warnings amber, OK green; click to collapse; a dot when clean). `GET /__watch/status` returns
`{ ok, errors, warnings, at, version, brief }`. `--brief` serves the brief's tables in place of index.html's (as
check_brief's frame check does), so it works while planning; until the brief's tables first pass, index.html is not
served (the frame waits and the status says why). It writes nothing to the project; Ctrl+C stops it; a watcher that
fails prints `error: ...` and stops it.

## The planner

`skills/motion-design` is where every video starts. `references/planner.md` is its checklist (route,
questions, assessments, brief, gate); `references/state-plan.md` is the beat-table format with a worked
example that uses 12 components. The result is `DIR/MOTION-BRIEF.md` with sections `## Request`,
`## Decisions`, `## Moments` and `## Beat table`; the last holds a readable table and ONE `js` block
with the real `states()` and `cursor()`.

`node $S/check_brief.mjs DIR` checks it: the sections, then the block with the engine's own validator in
strict mode (every row holds `rules.min_hold_beats`, at most `rules.max_states` states, something starts
on every beat, the loop seam; typing (input `text`, command `query`) that would still be typing when the next row
starts is an error; a press `'down'`/`'up'` pair on a custom-state row gets the drag rules (stay in one row: error;
must move: warning); a `press: true` click with under half a beat for the cursor to arrive warns, as a rushed drag
does; duplicate keyed entries (bar-chart labels, tabs, dropdown and dock items, chip-row chips, sheet actions) warn,
and a cursor aimed at a duplicated one is an error). Once those pass, it runs a frame check in Chromium (the cursor
going past the stage edges, text running past or cut off in its shape, and the chosen presets' safe zones; each a
warning). Exit 0 is OK, 1 is errors, 2 is bad usage. A launch video that does not
loop gets `"loop": false` in `DIR/project.json` (or `check_brief.mjs DIR --no-loop`).

## Components

The library is `skills/motion-video/components/`: 29 UI pieces in five groups (controls, feedback,
data, app chrome, media: `footage`, real app footage, see Footage), each one file that draws inside the kit's one
morphing shape. A table row uses one by name, the cursor aims at its hotspots, and consecutive rows of the same
component are one component changing (tabs `active: 'Day'` then `active: 'Month'` slides the indicator), not a cut:

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
props after its presses, which the next row of the same component starts from as `ctx.prev`), and `check` /
`checkTarget` (rules that need data beyond the row, such as footage's clip; checkTarget returns an error reason, or
`{ warning }` under check_brief). Row 0 is
shown settled so the loop seam matches; hover comes from `ctx.targets`; anything periodic takes its
period from `loopPeriod`. A cursor row with `hide: true` fades the cursor out from its beat (it keeps moving, and
`inspect(t).cursor.opacity` reports it); the next row without it fades it back in; a hidden row cannot press.

After adding or changing a component: `node $S/build_catalog.mjs` (regenerates `components/index.js` and
`CATALOG.md`; `npm test` fails when they are stale), `node $S/gallery.mjs --only NAME --stills` (its
thumbnail; look at it), then `npm test`. `gallery.mjs OUT` without `--stills` writes a project that
plays every component and edge case.

New projects get their own copy of `components/` (so a project keeps working if the library changes);
`check_brief.mjs` validates with the kit's own rules and the project's component registry (the library's when
the project has no copy), and refuses marker rows when the project's copy predates markers (no `core/timing.js`), `hide`
cursor rows when it predates hide, and `footage` rows when it predates footage (no `media/footage.js`) or the
project's `index.html` does (no `loadClips()`).

## Footage

A piece can show **real footage of a real app** inside the one shape, cut to the beat like everything else: the
`footage` component (group media) plays a **clip**, a directory `DIR/footage/NAME/` of JPEG frames
(`frame-00001.jpg` ..., frame 1 is clip time 0) plus `clip.json` (`fps`, `width`, `height`, `frames`, `duration`,
`mode` `stepped` | `realtime` | `video`, `source`, `browser`, and `steps`: each named step's `name`, `action`, `t` in
clip seconds and `box` in clip pixels). `scripts/clip.mjs` reads, checks and writes it. Never capture a private app
(or open its URL) without the user's say-so. Clips are big (a 2.4 s 1280x800 capture is 144 JPEGs): this repo's
`.gitignore` has `footage/`, but `new_project.sh` writes no `.gitignore`, so tell the user to keep `footage/` out of
their own repos (add it to theirs).

**Capture an HTML app** (a file, served from its own directory on 127.0.0.1 so relative assets load, or an
`http(s)://` / `file://` URL):

```bash
node $S/capture.mjs URL|FILE --steps FILE --out CLIPDIR [--browser webkit|chromium] [--size WxH] [--fps N] [--scale N] [--realtime]
```

- Defaults: `--size 1280x800`, `--fps 60`, `--scale 1` (device pixels per CSS pixel, up to 4; `2` for retina-sharp
  stepped frames; the frame size must come out even). The browser is WebKit (Safari's engine) for stepped capture
  and Chromium for `--realtime`. CLIPDIR must be new, empty or an existing clip (its frames are replaced); frames go to
  a temp directory beside it first, so a failed run leaves it as it was. At most 99999 frames.
- The steps file is a JSON list: `{ "wait": SEC }`, `{ "click": SEL }`, `{ "hover": SEL }`,
  `{ "type": SEL, "text": STR }`, `{ "scroll": PX }` (down is positive; at the pointer) or `{ "scroll": PX, "in": SEL }`,
  each optionally with a unique `"name"` (a named step lands in clip.json with its `t` and `box`). Selectors are
  Playwright selectors (CSS); several matches use the first. The pointer starts at the viewport's centre and moves to
  a target's centre over `"move"` seconds (default 0.4, ease-in-out); `type` clicks to focus, then types `"cps"`
  characters a second (default 12); a scroll turns the wheel over 0.3 s. A 0.5 s hold comes before the first step and
  after the last; steps run back to back, laid out on frames up front.
- Prints `capture: 144 frames, 2.4 s, 1280x800 (stepped, webkit) -> CLIPDIR`. Bad input (unknown key, unreadable or
  invalid steps file, a selector Playwright cannot parse, checked before the first frame) is `error: ...`, exit 2. A
  selector that matches nothing is exit 1 naming the step: `error: step 2 (click "#pay"): no element matches (waited 5 s)`
  (also exit 1: not visible, or its centre outside the viewport: scroll to it first). A page that throws gets
  `warning: the page threw N error(s) during the capture; the first: ...`.
- **Stepped (default): frame-exact.** The page runs on Playwright's fake clock (`page.clock`: `Date`,
  `performance.now`, timers, `requestAnimationFrame`), and every CSS transition, keyframe animation and Web Animation
  is paused and set from that clock each frame, so the same page and steps give the same frames on every run. Limits:
  an animation a timer starts between frames begins on the next frame; a page's own animation that it pauses and
  plays again later is not re-synced; `<video>`, `<audio>`, iframes and WebGL run on their own clock and are not
  stepped (use `--realtime`); scrolling is applied at once (no smooth scrolling). A selector's 5 s wait is real time
  while the fake clock is paused, so an element a page timer shows later is never found: put a `wait` step (long
  enough for the timer) before the step that needs it. A click with `"move": 0` right after another click on the
  same spot may read as a double click.
- **`--realtime`: any app, approximate timing.** No fake clock and no animation sync: Playwright records the page
  while the steps run on the real clock, and ffmpeg cuts the frames. It warns
  `warning: realtime capture: timing is approximate (about ±1 frame per step)`. The recording is 25 fps (at 30 or 60
  some frames repeat) and in CSS pixels (`--scale` does not apply). Each run measures its own recording offset (a
  calibration flash before the app loads) and fails (exit 1) rather than give misaligned footage. Chromium is the
  default: sharp and true-colour. `--realtime --browser webkit` warns
  `warning: webkit realtime recordings on macOS are smaller and colour-shifted; chromium is the realtime default`
  (WebKit draws it at about 90%; the page area is cropped out and the step boxes mapped). Frames differ from run to run.
- Capture relies on Playwright's private `window.__pwClock.builtins` (the real `requestAnimationFrame`) and on how
  its clock install replays; it is tested with the pinned `playwright` 1.63.0. A Playwright upgrade must re-run
  `skills/motion-video/tests/capture.test.mjs` and re-check both. A paint wait that never returns is exit 1 after 2 s
  (`paint wait timed out (Playwright internals changed? ...)`), never a hang.

**A screen recording** (any .mov/.mp4) skips capture:

```bash
node $S/footage.mjs VIDEO --out CLIPDIR [--fps N] [--max-width PX]
```

Default 60 fps, the video's size capped at 1600 px wide (never scaled up; even dimensions). It writes `mode: "video"`
and no steps (aim the cursor with `point:X,Y`) and prints `footage: N frames, S s, WxH -> CLIPDIR`. A missing or
unreadable video is `error: ...`, exit 2.

**The component.** `{ at: 4, use: 'footage', src: 'checkout', from: 0, speed: 1, fit: 'cover', width: 0, zoom: 1, focus: [0.5, 0.5], browser: '' }`:

- `src` names `DIR/footage/<src>/`; `from` is seconds into the clip (default 0), `speed` (default 1), `fit` `cover`
  (default; crops) or `contain` (letterboxes), `width` the shape's width in design px (default 0: the clip's aspect
  fitted inside the stage less a 10% margin on every side; height follows the aspect). Radius 32, `fill: 'ink'`.
  `src` is required (a row without it is `footage needs src`) and must be a folder inside `footage/`: one with a `..`
  segment or an absolute path is `footage: src "SRC" must be a folder inside footage/ (no ".." segments, not an
  absolute path)`, and no script reads it.
- Clip time is `from + (t - t0) x speed`, clamped to the clip (it holds the last frame) and frozen outside the row's
  window; the frame is `round(clipT x fps) + 1`, a pure function of `t`. A continuation (the next row with the same
  `src`) carries on from where the clip had got to unless it sets `from`, while the shape morphs.
- `zoom` (1 or more, default 1) scales the clip about `focus` (`[x, y]`, fractions 0..1 of the frame, default
  `[0.5, 0.5]`): focus is the frame point shown at the shape's centre, clamped so the clip never leaves an empty edge
  (with `contain`, a letterboxed axis stays centred until the zoom fills it). A continuation of the same `src` glides
  from where the previous row's framing ended to its own, released at its beat on a no-overshoot spring that settles
  in 0.6 beat (zoom eases geometrically and the content zooms about one fixed point, so an off-centre pull-back never
  bends at the clamp; row 0 shows its own). The frame is laid out at its zoomed size (no scaling transform, no
  `will-change`), so it stays sharp. A row with zoom 1, the default focus and no browser (and not gliding from one
  that had them) is the plain footage, DOM and pixels as before.
- `browser` (a URL, default `''`: off) draws the clip inside a plain window: a title bar (`max(4% of the clip's
  height, its width / 32)` clip px) in `surface`, three `muted` dots and the URL as real text in a centred rounded
  field (a URL too long for half the window's width is cut with `…`). The window is part of the zoomed content:
  zoom 1 fits the whole window (the shape takes the window's aspect), and focus is still a fraction of the clip's
  own frame, so a high zoom on the page puts the bar off the shape. While the zoom crops the URL's field it carries
  `data-overhang` (the frame check measures it only when it is in view). A continuation that turns `browser` on or
  off glides too (the clip stays where it was on screen at the row change), so a pull-back can end on the window:
  `{ at: 0, use: 'footage', src: 'app', zoom: 4, focus: [0.3, 0.7] }`, then `{ at: 2, use: 'footage', src: 'app',
  browser: 'example.com/app' }`; turning it off, the bar goes at the row change. Setting the same `browser` on every
  row also works. A browser row's shape has the window's aspect (W x (H + bar)), so framing just the page needs
  `zoom` about `(H + bar) / H` (H the clip's height, bar the title bar's) and crops the page's sides slightly.
- Hotspots: `step:NAME` aims at the centre of the box the capture's named step acted on, mapped through `fit`, the
  browser bar, the row's own settled zoom/focus and the shape (time the press to the step: the row's beat time plus
  `(t - from) / speed` of the step's `t`), and `point:X,Y` at fractions (0..1) of the frame. A cursor row resolves
  to one fixed point, so on a row that glides in from another framing, aim and press after the glide has settled
  (0.6 beat after the row's beat).
- Checks: `footage: no clip at footage/SRC/clip.json` and a `step:` the clip does not have (the error lists its
  steps) are errors in check_brief, watch and the page, as are `footage needs src`, an unsafe `src`,
  `footage: zoom must be 1 or more (1 shows the whole frame), got 0.5` and `footage: focus must be [x, y], two
  fractions of the frame from 0 to 1, got [1.2,0.5]` (a non-number `zoom` or `focus` is the usual prop type error); an invalid
  clip is an error in check_brief and watch (the page, which cannot read it, only reports "no clip at"); zoom/focus
  errors are reported together with a missing clip. check_brief also warns when a cursor's `step:` or `point:` target
  lands off the shape at the row's settled framing (zoomed past it): `footage at beat 4: step:mark is outside the
  shape at zoom 4` (beat: the footage row's), and when a row's
  window outlasts the clip: `SRC holds its last frame for 1.2 s (footage at beat 4)`. In a loop the last row
  repeats the first, so a footage first row usually holds a spent clip at the seam; that warning then adds
  `(at the loop seam: set from, or end on a non-footage row)`. A frame that fails to load (a deleted JPEG) is a page error: render exits 1 naming it
  (`footage: cannot load footage/SRC/frame-00031.jpg ...`). A project whose `components/` copy predates footage gets
  `the project's components/ copy predates footage; copy a fresh components/ in (see SKILL.md, Older projects)`, and
  one whose `index.html` predates footage (no `loadClips()`) gets `the project's index.html predates footage; copy
  loadClips() and its CLIPS wiring in from the template (see SKILL.md, Older projects and footage)`.
- Watch does not watch `footage/` (and a save that changes nothing does not reload): after re-capturing a clip,
  reload the watch page in the browser to see it, or restart watch to re-check the tables against it.

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
  return to a resting state, rather than one unbroken chain; past one loop, make each section its own project and
  play them back to back on the song as a sequence (see Sequences).
- **Not a loop?** Add `"loop": false` to `DIR/project.json`: the page then accepts a last row that
  differs from the first, `check_brief.mjs` checks the brief as a one-off, and `render.mjs` clamps the
  motion-blur subframes to the piece instead of wrapping them (so the end card never ghosts into frame 0).
  `render.mjs --serve` with `?play` still loops playback. The seam check in
  `beat_stills.mjs` assumes the last frame equals the first; for a one-off its failure can be ignored.

## Sequences

A piece longer than one loop (a launch video: intro, product chapters, end card) is built as **chapters**: separate
ordinary projects, each with its own brief and tables, played back to back on ONE song. One song per sequence; the
chapters are joined with no transition of their own (the shape's motion is the transition).
`node $S/sequence.mjs SEQ <command>` (bad usage: `error: ...`, exit 2):

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

`SEQ/sequence.json`: `dir` is relative to SEQ (any name but `out`, which holds the sequence's renders), `bars` the
chapter's length; chapter 1 starts with the song (`from_start`) or at `"start_bar": N` (or where the analyser picks),
and every later chapter starts where the previous one ends (giving one a start is an error). Each chapter is a
`new_project.sh` project with `"loop": false` in its project.json (chapters are not loops; they may end on a hold).
The song path may be relative to SEQ, and is read in place.

- `init --song PATH NAME... [--bars N]` makes sequence.json (N bars each, default 4; chapter 1 `from_start`) and one
  project per name with `"loop": false`. Then edit the bars in sequence.json.
- `analyse` lines the windows up on chapter 1's grid: chapter 1's `sync` grid (nudge, tempo, meter, swing, pickup;
  set by ear with `sync.mjs` on **chapter 1**) is copied to every chapter, and markers are merged by name across the
  chapters into every chapter's song.json (place a marker on the chapter whose window holds it). A name with two times
  keeps chapter 1's (else the earlier chapter's) and warns, so **move a marker on chapter 1**. To **remove** one,
  delete it from every chapter's song.json before analysing: a name still on any chapter comes back everywhere. A
  chapter whose sync changes keeps its old song.json as `song.json.bak`. Then analyze_song.py runs on each chapter
  with its bars: chapter 1 `--from-start` / `--start-bar N`, chapter k+1 `--start-bar` = chapter k's `start_bar + bars`,
  so the windows abut exactly. Prints `kit: bars 2-16, 0:04.9-0:37.9` per chapter.
- `check` runs check_brief on each chapter that has a MOTION-BRIEF.md (as a one-off, not a loop), then checks that
  each chapter is analysed on sequence.json's song (song.json's `source`) with sequence.json's bars (chapter 1 with
  its `from_start` / `start_bar`, when it has one), starts where the previous one ends (within 1 ms), and shares
  chapter 1's bpm (unless a tempo map), fps and the sequence's sync (after a hand edit, `check` says to re-run
  `analyse`); a project.json without `"loop": false` is a warning. Lines start with the chapter's name; errors exit
  1; `sequence OK: 4 chapters, 0:00.0-1:00.7`.
- `render [--preview] [--stage WxH]` first checks every chapter is analysed on sequence.json's song (chapter 1 with its
  start), abuts and has chapter 1's fps and stage (exit 2, nothing rendered, otherwise); renders each chapter whose
  render is stale (its `.render.json` stamp, as export decides), printing `name: rendered|reused`; then joins the chapter videos (stream copy) over ONE cut of the
  song from chapter 1's start to the last chapter's end (10 ms fades at the very ends only, so no seam at a join),
  mixed with each chapter's UI sounds at its offset, the whole mix faded out over `fade_out_sec`. Writes
  `SEQ/out/sequence.mp4`, or `SEQ/out/sequence-preview.mp4` with `--preview` (a preview never replaces the full
  join), under `SEQ/out/shapes/WxH/` with `--stage`, each with a stamp listing the chapters' stamps.
- `watch CHAPTER [--brief] [--port N] [--no-open]` is `watch.mjs SEQ/CHAPTER` (see Watching), for editing one
  chapter at a time; Ctrl+C stops it. An unknown chapter is exit 2.
- `export.mjs SEQ --for ...` exports the joined sequence through the presets (sizes, caps, loudness, GIF, poster at
  chapter 1's beat 1.5): one full `renderSequence` per render size (chapters reused by their own stamps). The design
  size has no stage override, so it re-renders any stale chapter into its own `out/video.mp4` and re-joins
  `SEQ/out/sequence.mp4`; other sizes go to `SEQ/out/shapes/WxH/`. Safe zones are checked on every chapter at each
  shape (warnings prefixed with the chapter's name); a commercial track on any chapter warns for the whole piece.
  Files go to `SEQ/out/exports/`; the manifest adds `"sequence": { "chapters": [...] }` and each render's
  `chapters: [{ name, reused }]`. `--guides` renders each chapter's guides previews.

The flow: `init`, set the grid by ear with `sync.mjs SEQ/<chapter 1>`, `analyse`, one brief per chapter (planner),
`check` before the approval gate, build each chapter with `watch`, `render --preview`, then `export.mjs SEQ`.

## Stories

`skills/motion-story` turns a source that already exists into the request for a video (G1: a code repository;
writing and numbers come later). Its flow (SKILL.md, with `references/story.md` for the STORY.md format): route,
pick the story kind (intro by default; release; pr), read the source, draft `STORY.md`, **stop for the user's
approval**, hand it to motion-design, whose planner skips the questions it answers and keeps its words.

```bash
node ~/.claude/skills/motion-story/scripts/story_facts.mjs repo SOURCE [--intro | --release TAG|latest | --pr N|BRANCH] --out DIR/facts.json
```

- SOURCE is a local git work tree or `https://github.com/OWNER/REPO`. A URL is read with read-only GETs to the GitHub
  API (meant for public repos, or a private one that a `GITHUB_TOKEN` the user already set can read; otherwise a
  private repo or a typo is `not found (private repos: use a local clone)`; never ask for, set or try a token to
  reach a private repo: use the user's local clone; `GITHUB_TOKEN`, sent only when set, raises the 60-an-hour limit; a release lists at most 250 commits and tags or
  commits at most 10 pages, with a warning); nothing else is sent. `--release TAG` reads from the previous version
  tag (a non-version tag: the tag created before it; over a URL, the API's listed order, as GitHub does not promise
  creation order), and over a URL a GitHub release body with bullets takes precedence; `--release latest` is the
  highest version tag that is not a pre-release. `--pr N` needs a URL, `--pr BRANCH` a local clone (its title: the
  oldest commit's subject, its `feat:` or area prefix such as `sequence:` stripped). Bad input exits 2, a read
  failure 1.
- The facts file (format: the header of `scripts/facts.mjs`): title, subtitle, at most 12 items (label, detail, tag),
  stats, links, media, and `source.command`, the command that re-creates it (`--intro`, the default, never written;
  `parseCommand` splits it back into argv). Intro items are in README order, release and pr items ranked. Text is
  cut to fixed caps (title 80, subtitle 200 in whole sentences when they fit, label 60, detail and alt 160); badges,
  navigation bullets (tables of contents, docs links) and commit trailers are skipped. The same input gives a
  byte-identical file.
- STORY.md: a hook, 3 to 5 moments for one loop (more becomes a sequence) and an end card, each with a catalog
  component and words taken from the facts; every moment moves or changes within its hold (no dead beats), and the
  end card's text is short (`OWNER/REPO`, not a full URL). `## Left out` and `## Media` are notes, not moments.
  Never invent facts or numbers (a README with no features section gives no items: use the subtitle, stats and
  links); media becomes footage only with the user's say-so; nothing is posted anywhere; music is never downloaded.

## Rules that matter (the tests enforce most of them)

- **`seek(t)` is pure.** Every style is computed from `t` alone: no CSS transitions/animations,
  timers, `Date.now()`, or variables written by an earlier frame. Frames render in parallel
  pages in any order; impurity shows up as flicker. `seek` must not wrap `t` (the renderer does).
- **Page contract:** `window.ready` (promise), `window.STAGE = {width, height}` set by the time
  ready resolves, `window.seek(t)`, `window.inspect(t) -> {cursor: {x, y, opacity}}`, `window.SFX = [{beat, file, gain}]`.
  `seek(t)` returns a promise that settles once the frame's media has loaded (footage frames; resolved at once
  without): render, beat_stills and the frame check await it; the watch and sync pages do not.
- **Loop seam:** last STATES/CURSOR row repeats the first, at least 2 beats before the end.
- **Timing comes from the song:** `beatT(beat)` (uses measured `cue_t`, and swing from `sync`; one definition in
  `components/core/timing.js`), never hard-coded seconds. A moment the user marked is `at: 'name'`, not a guessed beat.
  Springs: `Springs.fromSettle(seconds, zeta)`; house spring is `song.rules.spring` (zeta 0.85, settle 0.6 beat).
- **Colours are theme roles, not hex:** `canvas surface ink muted accent` (+ optional `pos neg`),
  used as `'accent'` in tables and `var(--accent)` in CSS. An unknown role throws on purpose.
- **Style (direction.md):** one shape never cut; tiny overshoot at most; content swaps blur with
  their own enter/exit timing; one stroke width; banned: gradients, glows, particles, bouncy easing, dead beats.
  No `will-change` under the camera (blurry text).
- **Text stays inside the shape:** the frame check measures the words' own line boxes. An element meant to sit
  outside the shape (a tooltip above its point) can carry `data-overhang`, an opt-in hook for component authors
  (footage sets it on its browser URL only while a zoom crops it); it only silences the frame check: `#shape` clips
  its overflow, so the element is still cut off at the shape's edge.
- **Approval gate:** always show MOTION-BRIEF.md (with check_brief.mjs passing) and wait before building. If the user's request
  already lists every state, the table is quick to confirm, but still show it.
- **Music:** never download songs. Users supply files. Audio (`clip.wav`, songs), renders (`out/`) and
  `.source.json` (a local path to the song) are git-ignored and must never be committed. Nor must clips
  (`footage/`, ignored in this repo; projects have no `.gitignore` of their own). Commercial tracks: local viewing
  only (or `export.mjs --silent`).
- **Footage:** never capture a private app (or open its URL) without the user's say-so; tests use local pages only.
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
                                  doctor.sh, check_brief.mjs (validates MOTION-BRIEF.md, then the frame check
                                  and safe zones for its Exports), framecheck.mjs (the frame check: one page
                                  sampler for the cursor past the stage, text past or cut off in its shape, and
                                  the safe zones safezones.mjs reports), build_catalog.mjs (index.js + CATALOG.md from each meta), gallery.mjs
                                  (every component in one project; --stills), export.mjs (ready-to-post files per
                                  preset + manifest), media.mjs (ffmpeg helpers: probe, loudness, size caps, encodes),
                                  safezones.mjs (safe-zone check, guides overlay, shared preset helpers),
                                  sync.mjs (the sync page's server: GET /__sync, POST /__sync/save, GET /__sync/needed; reuses render.mjs serve(),
                                  which refuses files symlinked from outside the project), song_suggest.py (the
                                  analyser's suggestions: tempo map, swing, meter, pickup; numpy only), click_track.py
                                  (synthetic beat; --tempo-map, --swing, --meter, --pickup for tests), scaffold.mjs (a project from tables on a click track; gallery + tests),
                                  is_main.mjs (the entry guard every script uses), tables.mjs (one place to
                                  read, run and list a project's tables: briefCode, pageCode, runTables,
                                  markerNames, projectMarkerNames; used by check_brief, render, swap_song, sync,
                                  watch), swap_song.mjs (a new song on a project: backup, clear sync, re-analyse,
                                  names to place; then the sync page), watch.mjs (the live preview's server:
                                  GET /__watch, /__watch/events (SSE), /__watch/status; reuses serve()),
                                  sequence.mjs (chapters on one song: sequence.json, init, analyse, check, render
                                  (renderSequence: the join over one song cut), watch; export.mjs takes a SEQ),
                                  capture.mjs (an HTML app -> a clip: stepped on Playwright's fake clock in WebKit, or
                                  --realtime recorded; uses Playwright's private window.__pwClock.builtins, tested
                                  with the pinned 1.63.0: re-check it on any Playwright upgrade), capture_steps.mjs (the
                                  steps format: check, lay out on frames, play into the page), footage.mjs (a video ->
                                  a clip), clip.mjs (the clip format: readClip, writeClip, extractFrames)
skills/motion-video/scripts/sync-page/  index.html, app.js, style.css: the sync page (Web Audio clicks, waveform,
                                  suggestions, nudge, tap tempo, meter, swing, markers, to place, Save); tested by
                                  tests/sync-page.test.mjs
skills/motion-video/scripts/watch-page/ index.html, app.js, style.css: the watch page (the audio and playhead live
                                  here; only its iframe of the project reloads; the check_brief corner panel); tested by
                                  tests/watch.test.mjs
skills/motion-video/presets.json  destination presets: shapes, platform limits with source/checked, safe margins
skills/motion-video/template/     index.html: the seek(t) scaffold every project starts from (reads project.json:
                                  stage, optional loop and designScale; window.rebuild(song) is for the sync page only)
skills/motion-video/components/   the component library: core/engine.js (runs the tables; its header is the
                                  contract), core/validate.js (table rules, shared with check_brief),
                                  core/timing.js (beatTime/beatAt: the one beat-to-seconds mapping with swing,
                                  plus markerBeat/resolveRows for `at: 'name'` rows; used by the page, the engine,
                                  the validator, render, beat_stills, export, safezones, gallery and the sync page,
                                  which falls back to the kit's copy at /__sync/timing.js for older projects),
                                  core/helpers.js (pure building blocks), modifiers.js (shake, badge),
                                  controls/ feedback/ data/ chrome/ media/ (one file per component; media/footage.js
                                  plays a clip),
                                  CATALOG.md + index.js (generated), docs-images/ (thumbnails),
                                  RECIPES.md, WRITING-A-COMPONENT.md
skills/motion-design/references/  planner.md (the planner checklist), state-plan.md (beat-table format),
                                  direction.md (the look)
skills/motion-ui/references/      patterns.md (pattern 2 is extracted and tested by tests/patterns.test.mjs)
skills/motion-story/scripts/      story_facts.mjs (the CLI: kind, SOURCE, story flag -> a facts file; SOURCES maps a
                                  kind to its reader), facts.mjs (the facts format: validateFacts, normalizeFacts,
                                  writeFacts), sources/repo.mjs (the repo reader: local git via execFile, or a GitHub
                                  URL), sources/github.mjs (read-only GitHub API GETs), sources/readme.mjs (README and
                                  release/PR notes to plain text)
skills/motion-story/references/   story.md (the STORY.md format and how to draft it from facts)
demos/                            worked examples (see "Demos" below)
tests/, skills/*/tests/           node:test + python unittest
DIR/.source.json                  per project, written by analyze_song.py: {"path": the song's absolute path}, read by
                                  sync.mjs Save. Local only and git-ignored: never commit it
```

## Testing

```bash
npm test          # all Node suites + Python unittest (a few minutes; renders real frames with Chromium)
node --test skills/motion-video/tests/render.test.mjs   # one suite
```

Test temp dirs are removed when each test file ends; `MK_KEEP_TMP=1 npm test` keeps them (their paths
are printed) for a look after a failure.

Tests use synthetic click tracks (`scripts/click_track.py`) and tiny fixture projects
(`skills/motion-video/tests/fixtures.mjs`), so they need no song and no network except the
template's Google Fonts request.

## Demos

- `01-reference`: the sequence from zero (@twoclipping)'s prompt template, in the house style. Self-contained apart from the song.
- `02-finance-promo`: a promo for a private personal-finance app (made-up figures); theme came from
  that app's CSS, which is not in this repo. Still renders from a clone: `theme.json` is committed.
- `03-finance-inapp`: capture of `motion-ui` applied to that private app; its own `demos/03-finance-inapp/capture.mjs`
  (not the kit's `scripts/capture.mjs`) needs the app's repo, so it will not run from a clone. The pattern it demonstrates is `motion-ui` pattern 2.
- `04-library-reference`: demo 1's sequence rebuilt from library components only, and the export proof
  (every preset it exports, with the results table, in its README).

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
