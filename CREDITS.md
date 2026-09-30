# Credits

motion-kit stands on other people's work. Thank you to all of them.

## Ideas and design

- **zero ([@twoclipping](https://x.com/twoclipping))**: the open "motion design" prompt template
  ([post](https://x.com/twoclipping/status/2103273003555402193)) this whole kit is built around:
  one shape that never cuts, a cursor that drives every change, springs everywhere, the
  beat grid, subframe motion blur and a looping last frame. `skills/motion-design/references/direction.md`
  adapts its direction, build rules and gotchas, and `demos/01-reference` recreates its sequence.
- **Jakub Antalik, [transitions.dev](https://transitions.dev)**: the catalog of ready-made UI
  transitions and its free Claude Code skills (`transitions-dev`, `transitions-polish`), which
  `install.sh` installs from [Jakubantalik/transitions.dev](https://github.com/Jakubantalik/transitions.dev)
  and which `motion-ui` and `motion-design` suggest from. None of its transitions are copied into this
  repo: its [terms](https://transitions.dev/terms.html) allow using and modifying them in your own
  projects but not republishing the collection. Pro transitions are sold on its site.
- **Component names**: the components in `skills/motion-video/components/` are named after common UI
  patterns (button, toggle, tabs, toast, dock, command palette...), and some share names with entries
  in the transitions.dev catalog, so they are easy to find and match to a plan. They are original
  implementations written for this kit (closed-form springs, a pure function of time); no code or
  asset was copied from anywhere.
- **Jesse Vincent, [Superpowers](https://github.com/obra/superpowers)** (MIT): the Claude Code skills
  workflow used to design, plan, build and review this kit (brainstorming, writing plans,
  subagent-driven development, code review). `docs/superpowers/` holds the resulting spec and plan.

## Music in the demos

- **"Tints" by Anderson .Paak featuring Kendrick Lamar**, from the album *Oxnard* (2018). The demo
  videos were cut to a personally owned copy for local viewing and documentation. The audio is not
  in this repo, and all rights belong to the artists and rights holders. Use a track you have the
  rights to for anything you publish.

## Fonts

- **[Geist](https://vercel.com/font)** by Vercel (SIL Open Font License 1.1), the template's house
  font, loaded from Google Fonts.

## Tools the kit runs on (installed separately, not bundled)

- [Playwright](https://playwright.dev) by Microsoft (Apache 2.0): drives Chromium to capture frames.
- [FFmpeg](https://ffmpeg.org) (LGPL/GPL): motion blur, encoding and audio mixing.
- [NumPy](https://numpy.org) (BSD): beat analysis.
- [Homebrew](https://brew.sh) and [Node.js](https://nodejs.org) for installation.
- [Claude Code](https://claude.com/claude-code) by Anthropic: the kit is a set of Claude Code skills,
  and it was built with Claude Code (see the `Co-Authored-By` lines in the history).

If anything here is missing or wrong, please open an issue so it can be put right.
