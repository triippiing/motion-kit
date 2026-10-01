---
name: motion-design
description: Use when the user wants any motion video of UI made with code (a promo, reel, social clip, launch video or showcase of their app, cut to a song's beat), or says "motion design", "promo video for my app", "animate my UI to music", "plan a video". The planner: routes, asks, assesses, writes MOTION-BRIEF.md, gets approval before any code. Not for live in-app animation (use motion-ui).
---

# Motion design (the planner)

motion-kit makes code-only motion design: one HTML page, every frame a pure function of time,
rendered to MP4. This skill plans; `motion-video` builds from its approved MOTION-BRIEF.md;
`motion-ui` is for animation inside a real app. The look is in `references/direction.md`.

**Read `references/planner.md` and follow it exactly; each step is a todo.** In short: say the route,
ask the open questions one per message (including where it will be posted: the destinations become the brief's
`**Exports:**` line), assess (tooling, song, length in bars, the user's ear check on the sync page and moments to hit, theme, safe zones), write
MOTION-BRIEF.md with real `use:`/`target:` tables (format: `references/state-plan.md`), run
`node ~/.claude/skills/motion-video/scripts/check_brief.mjs PROJECT` until it passes, then stop for approval.
A launch video that does not loop gets `"loop": false` in `PROJECT/project.json` first.

Components come from `~/.claude/skills/motion-video/components/CATALOG.md`: pick one per moment by
its "Use when" line. Consecutive rows of the same component animate a change (tabs Day then Month).
Five complete sequences to start from: `~/.claude/skills/motion-video/components/RECIPES.md`.

## Red flags

| Thought | Reality |
|---|---|
| "I'll pick the states myself and start" | The brief is the approval gate. Build nothing before a yes. |
| "I'll pick components myself without asking" | Propose one per moment from the catalog; the user decides. |
| "Skip the questions, the request is clear" | Skip only the answered ones, and write the understanding back for correction. |
| "The brief looks fine" | Run check_brief.mjs; fix every error, resolve or justify every warning (one `**Accepted:**` line in Decisions each), before showing it. |
| "15 seconds is about 8 bars" | Measure first: bars = round(seconds * bpm / 240), then re-run analyze_song.py. |
| "I'll grab the track from YouTube" | Never. Ask for a file. |
| "It's for Reels, the template cursor is fine" | Its rest point (240, 280) sits in the vertical safe zones. Rest nearer the centre, e.g. (140, 100), and let check_brief confirm. |
| "The song's commercial, I'll mention it later" | Say it once and write it on the Song line ("a commercial track"), so check_brief and export.mjs warn on public presets. With any public export, ask: `--silent`, a licensed track, or audio for private use only; record it as `**Audio:**`. |
| "They said Discord first, so it's square" | The design shape follows the platform they call primary; with none named, any Reels/TikTok/Shorts means vertical. Confirm it in the write-back. |
| "Just use a CSS animation / GSAP" | Every frame must be computed in `seek(t)`. |
| "120 BPM is close enough" | Use the measured grid in song.json. |
| "The grid looks right, the sync is fine" | Claude cannot hear. Under 0.5 confidence the user checks it by ear on the sync page (`sync.mjs DIR`); never claim it is in sync. |
| "The drop is around beat 20" | Ask the user to mark it on the sync page (M) and use `at: 'drop'`; never guess a moment's time. |

Credits: the look and rules adapt the open prompt template by zero (@twoclipping); the
transitions.dev catalog is by Jakub Antalik.
