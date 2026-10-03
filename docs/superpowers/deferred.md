# Deferred items (after sub-project A)

F1 (2026-10-03) fixed temp-dir leaks, the gallery's test import, the entry guard, the Save timeout and
the analyser's last-bar overrun. Pickup/anacrusis support moved to C2. F1 also found and fixed an export
audio gap: loudnorm's EOF frame left a timestamp hole of up to 100 ms, so audio drifted late (131c5d6).

Known, non-blocking follow-ups from the component library build (2026-09-30). Candidates for
sub-project F (hardening) unless noted.

## Lints the planner / check_brief could add (F)
- Cursor leaving the frame (must account for camera zoom; demo 04 hit this at the toggle).
- Long labels on vertical stages (1080 wide): some components overflow; no zoom-out below 1.
- Typing (input/command) that overruns its row: key sounds are clipped at the next row but the
  text endState assumes the full text.
- Drag rows on custom states are not checked (only meta.drag hotspots are).

## Behaviour edge cases
- command: a continuation that extends the query with typeAt -1 (e.g. '' then 'exp') snaps rows at t0.
- line-chart: moving the cursor from point A to point B pop-replaces rather than fading A; a `hover`
  prop snaps in after a cursor hover fades out.
- goal: text for a target easing up from 0 (guarded, but a very small target still shows briefly).
- badge on two consecutive rows fades out and back in at the row change.
- Button labels over ~57 characters overflow (no ellipsis); dock/chip-row width caps overflow for
  very long lists.
- Duplicate bar-chart labels resolve to the first bar.

## Tooling
- check_brief accepts a theme.json containing `null` (only if hand-corrupted); it should require an object.
- A row with a prop error defers its hotspot typo to the next check (two-pass by design).
- Hotspot listing in errors tries prop strings plus integers 0 to 99 (all 28 components covered).
- Purity scan over-matches identifiers starting with transition/animation; the contract test's
  cursorAt regex also matches comments.
- `new Date` without parentheses is not caught by the purity scan.
- Recipes: only the first recipe renders to MP4 in tests (all five are seeked in Chromium).

## Left over from F1's reviews (2026-10-03; for F2)
- tmp.test.mjs: the SIGINT test hangs (rather than fails) if the child never prints; the crash test is vacuous
  when no dir is made (assert the `mk-tmptest-` name); the MK_KEEP_TMP test does not check exit status.
- gallery.mjs: no `error:` / exit 2 wrapper around `gallery()` (a failure prints a stack trace and, in keep mode,
  leaves its `mk-gallery-` dir); gallery.test's first test shares the `mk-gallery-` prefix with the leak test.
- is_main.test: the old-guard regex matches one spelling only; no CLI test with a missing argv[1].
- sync.mjs Save: Ctrl+C on the server orphans a running analyser (own process group; a hung one then has no
  limit; track live groups and SIGTERM them on exit); no backstop if a setsid grandchild holds the pipe; a kill
  between the analyser's two replaces can leave a new clip.wav and hidden `.clip.wav.*` temp files; the SIGTERM
  test does not check song.json or the message.
- test_analyze_song: rename `test_short_song_window_choice_is_unchanged`; the components-feedback progress band
  (30 to 35%) could be 30 to 32%; no fade where the song really ends on an overrun; sub-ms overrun boundary untested.
- export.test gap check: assert packet durations are finite (N/A would pass silently); use the median packet as
  the reference; a unit test pinning `asetpts` in loudnormArgs.
- Plan snippets in docs/superpowers/plans/2026-10-03-hardening-f1.md are bash-only (zsh mis-splits them).
