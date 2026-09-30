---
name: motion-design
description: Use when the user wants a promo, reel, social clip or showcase video of UI made with code — one morphing shape driven by a cursor, cut to a song's beat — or says "motion design", "promo video for my app", "animate my UI to music". Plans the piece and gets approval before any code. Not for live in-app animation (use motion-ui).
---

# Motion design

Code-only motion design: one HTML page, every frame a pure function of time,
rendered to MP4 by `motion-video`. No After Effects, Remotion or Lottie.
The look and rules are in `references/direction.md`; read it before planning.

## Process (do these in order; each is a todo)

1. **Tooling.** Run `~/.claude/skills/motion-video/scripts/doctor.sh`. Stop and show the fixes if anything is MISSING.
2. **Inputs — ask in one message:**
   - 8–12 UI states the shape becomes. For a promo of an existing project, first read its design tokens and UI (CSS variables, main views) and *propose* states from its real screens.
   - Palette: pure black/white or one accent. For a project promo, the project's own tokens.
   - The song: a file path the user supplies. Never download music. If it is a commercial track, say once that social platforms will likely mute it and a licensed track can be swapped in later by re-running analysis.
   - Size: square 1440×1440 unless they want vertical 1080×1920 (Reels/TikTok/Shorts) or landscape 1920×1080.
3. **Scaffold + measure.** `~/.claude/skills/motion-video/scripts/new_project.sh <dir> <song> --bars <N> --states <K> [--size square|vertical|landscape|WxH] [--theme <project css>]` (default 7 bars, square, house theme). For a project promo always pass `--theme` with the project's main stylesheet and check the printed theme; fix a wrong role with `--map accent=--other-var`. Read `song.json`: `bpm`, `rules.min_hold_beats`, `rules.max_states`, `rules.warnings`. Say the BPM and any warnings out loud. Choose `--start-bar` from song.json `sections`: start at a section boundary inside a strong section, and use a different start bar for each piece when making several from one song. To change the start bar after scaffolding, re-run `python3 ~/.claude/skills/motion-video/scripts/analyze_song.py <song> --out <dir> --bars <N> --start-bar <B>` (it rewrites `song.json` and `clip.wav` only; the index.html you have is kept). Use the per-beat `accent` values to put the biggest changes (shape swaps, big stretches) on the strongest beats.
4. **Borrow from the transitions.dev catalog** when choosing what each state change looks like. If `~/.claude/skills/transitions-dev/SKILL.md` exists, read its quick-reference table and name the matching moments in the plan (e.g. "spinner to check: success check + icon swap", "tabs sliding", "toast", "number pop-in", "texts reveal", "error shake"). In a video these are **ideas and timings only**: never paste its CSS transitions, keyframes or timers into `index.html`, because `seek(t)` must stay pure. Rebuild each one from `t` with springs (`fromSettle(duration, zeta)`), using its durations, distances and blur amounts as the starting values.
5. **Plan on the beat grid** using the table format in `references/state-plan.md`: one row per beat, something happens on every beat, sound cues use `sfx/click.wav` for presses and `sfx/key.wav` for typing, states hold at least `min_hold_beats`, the last row returns to the first state at least 2 beats before the end.
6. **STOP for approval.** Show the table. Do not write any code until the user approves it or asks for changes. If the request already lists every state, the table is quick to confirm, but still show it.
7. **Build** with the `motion-video` skill.

## Red flags

| Thought | Reality |
|---|---|
| "I'll pick the states myself and start" | The table is the approval gate. |
| "I'll grab the track from YouTube" | Never. Ask for a file. |
| "Just use a CSS animation / GSAP" | Every frame must be computed in `seek(t)`. |
| "120 BPM is close enough" | Use the measured grid in song.json. |
