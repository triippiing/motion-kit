# motion-kit

Three [Claude Code](https://claude.com/claude-code) skills that turn any project's UI into
beat-synced motion videos and springy in-app motion, all in code. No After Effects,
Remotion or Lottie: every video frame is a pure function of time, so the same page renders
the same loop every time and re-times to any song.

The look and build rules adapt the open prompt template by
[@twoclipping](https://x.com/twoclipping/status/2103273003555402193): one shape that never cuts,
a cursor that drives every change, springs everywhere, and a last frame identical to the first.

Docs with the demo videos: <https://triippiing.github.io/Wiki/claude/motion-kit.html>

## The skills

| Skill | Use it for | Say something like |
|---|---|---|
| `motion-design` | Planning a promo or reel: states on the song's beat grid, then an approval stop before any code | "Make a promo video for my app to ~/Music/song.mp3" |
| `motion-video` | Building and rendering: song analysis, the `seek(t)` page, contact sheet, seam check, MP4 | "Render it" / "Re-time this to a new song" |
| `motion-ui` | Live product UI: indicators, toggles, drags, interruptible transitions, following the project's own motion rules | "Make this tab indicator springier" |

## Install (macOS)

Needs Homebrew, `ffmpeg` (`brew install ffmpeg`), Node 20+ and Python 3 with numpy.

```bash
git clone https://github.com/triippiing/motion-kit.git ~/motion-kit
~/motion-kit/install.sh   # links skills into ~/.claude/skills, installs Playwright, runs the doctor
```

`install.sh` installs ffmpeg, numpy, Playwright and its Chromium when they are missing, then runs
`skills/motion-video/scripts/doctor.sh`, which prints the exact fix for anything still missing
(only Homebrew itself needs a manual, password-prompted install).

## Using it with Claude

Open Claude Code in the cloned folder, or just give it this repo's URL: `CLAUDE.md` explains
the whole project (pipeline, page contract, rules, code map, tests). Once installed, the skills
trigger on their own in any project, e.g. "make a 15 second promo of this app to ~/Music/song.mp3".

## Using it by hand

```bash
S=~/.claude/skills/motion-video/scripts
$S/new_project.sh ~/promo ~/Music/song.mp3 --bars 7 --theme ./app/style.css   # measure the song, scaffold
# edit ~/promo/index.html: the states(), cursor() and content tables
node $S/beat_stills.mjs ~/promo      # contact sheet + loop-seam check
node $S/render.mjs ~/promo           # -> ~/promo/out/video.mp4
```

## Pipeline

```
song ──analyze_song.py──▶ song.json (BPM, downbeat, beat grid, loop window, rules) + clip.wav
project CSS ──extract_theme.py──▶ theme.css / theme.json (canvas, surface, ink, muted, accent, font, pos?, neg?)
new_project.sh DIR SONG [--size square|vertical|landscape|WxH] [--theme app.css]
index.html: window.seek(t) computes every style from t (closed-form springs, shared/springs.js)
beat_stills.mjs DIR ──▶ one still per beat + contact sheet + loop-seam check
render.mjs DIR ──▶ Playwright frames ─▶ ffmpeg tmix motion blur + audio + UI sounds ─▶ out/video.mp4
```

## Layout

```
shared/springs.js        closed-form damped springs (spring, track, live, fromSettle), no deps
skills/motion-design/    planning skill + direction and state-plan references
skills/motion-video/     scripts, seek(t) template, tests
skills/motion-ui/        in-app motion skill + tested patterns
demos/                   01 reference sequence, 02 finance-app promo, 03 dock pill capture
docs/superpowers/        design spec and implementation plan
```

## Tests

```bash
npm test   # node:test suites + python unittest
```

## Music

The demos were cut to a commercial track for local viewing; audio files are git-ignored and
never committed. Bring your own licensed song and re-run `analyze_song.py`: everything re-times.

## License

MIT
