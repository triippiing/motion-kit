---
name: motion-design
description: Use when the user wants any motion video of UI made with code (a promo, reel, social clip, launch video or showcase of their app, cut to a song's beat), or says "motion design", "promo video for my app", "animate my UI to music", "plan a video". The planner: routes, asks, assesses, writes MOTION-BRIEF.md, gets approval before any code. Not for live in-app animation (use motion-ui).
---

# Motion design (the planner)

motion-kit makes code-only motion design: one HTML page, every frame a pure function of time,
rendered to MP4. This skill plans; `motion-video` builds from its approved MOTION-BRIEF.md;
`motion-ui` is for animation inside a real app. The look is in `references/direction.md`.

**Read `references/planner.md` and follow it exactly; each step is a todo.** In short: say the route,
ask the open questions one per message, assess (tooling, song, length in bars, theme), write
MOTION-BRIEF.md with real `use:`/`target:` tables (format: `references/state-plan.md`), run
`node ~/.claude/skills/motion-video/scripts/check_brief.mjs PROJECT` until it passes, then stop for approval.

Components come from `~/.claude/skills/motion-video/components/CATALOG.md`: pick one per moment by
its "Use when" line. Consecutive rows of the same component animate a change (tabs Day then Month).

## Red flags

| Thought | Reality |
|---|---|
| "I'll pick the states myself and start" | The brief is the approval gate. Build nothing before a yes. |
| "I'll pick components myself without asking" | Propose one per moment from the catalog; the user decides. |
| "Skip the questions, the request is clear" | Skip only the answered ones, and write the understanding back for correction. |
| "The brief looks fine" | Run check_brief.mjs and fix every error before showing it. |
| "15 seconds is about 8 bars" | Measure first: bars = round(seconds * bpm / 240), then re-run analyze_song.py. |
| "I'll grab the track from YouTube" | Never. Ask for a file. |
| "Just use a CSS animation / GSAP" | Every frame must be computed in `seek(t)`. |
| "120 BPM is close enough" | Use the measured grid in song.json. |

Credits: the look and rules adapt the open prompt template by zero (@twoclipping); the
transitions.dev catalog is by Jakub Antalik.
