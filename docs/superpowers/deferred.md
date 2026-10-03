# Deferred items

F1 (2026-10-03) fixed temp-dir leaks, the gallery's test import, the entry guard, the Save timeout and
the analyser's last-bar overrun. Pickup/anacrusis support moved to C2. F1 also found and fixed an export
audio gap: loudnorm's EOF frame left a timestamp hole of up to 100 ms, so audio drifted late (131c5d6).

F2 (2026-10-03) added the frame check (cursor past the stage, text past or cut off in its shape) and the table
checks (typing past its row, drags on custom states, rushed clicks, duplicate keyed entries, theme.json must be
an object), fixed the line-chart, badge, command, slider and button behaviours listed here before, tightened the
purity scan, renders every recipe in tests, and closed most of F1's review leftovers. What is left:

## Behaviour edge cases
- Long text still overflows: button labels over ~57 characters, long dock and chip-row lists, long labels on
  1080-wide stages (no zoom-out below 1). The frame check now reports each one; nothing fits it automatically.

## Tooling
- A row with a prop error defers its hotspot typo to the next check (two-pass by design).
- Hotspot listing in errors tries prop strings plus integers 0 to 99 (all 28 components covered).

## Left over from F1's reviews (2026-10-03)
- sync.mjs Save: no backstop if a setsid grandchild holds the pipe; a kill between the analyser's two replaces can
  leave a new clip.wav and hidden `.clip.wav.*` temp files.
- test_analyze_song: no fade where the song really ends on an overrun; sub-ms overrun boundary untested.
- Plan snippets in docs/superpowers/plans/2026-10-03-hardening-f1.md are bash-only (zsh mis-splits them).

## Left over from F2's reviews (2026-10-03)
- framecheck: the "how" of a grouped issue comes from its first sample, not its worst; `got.stage` is unused; the
  clipped, `data-overhang` and opacity paths have no tests of their own; `closest()` can match above `#shape`.
- framecheck: importing frameIssueText loads Playwright even when the frame check is stubbed; a thrown non-Error
  would crash check_brief's catch (it reads `e.message`).
- framecheck: a pill whose overhang is padding only is now silent (intended); text clipped by an ancestor other
  than `#shape` is not seen; demo 04 is clean by a manual audit only; `data-overhang` may be moot because `#shape`
  clips its overflow anyway.
- validate: the rushed-click rule compares target names, not positions; input's cut-off guard is untested now;
  the "duplicate bars labels" wording reads awkwardly; a custom press-and-hold now warns (as the spec intends).
- line-chart: a `hover` prop point is still replaced at once when the cursor aims at another point; a dip on the
  same point could stay up.
- line-chart: the tooltip drops when the hover prop is due under half a beat before the cursor leaves; the leave
  fade starts at full whatever the pop reached; aiming back at the hovered point re-pops from zero (A to B to A);
  a third switch within 0.2 beat drops the earlier outgoing tooltip abruptly; the hop test's 0.02 slack is tight.
- badge: the same-count test reads the highest opacity (it cannot catch two bubbles at once); no tests for badge 0
  between rows, three rows in a row, or badge to no badge; a popped bubble with no next row does not shrink as it
  fades; a short first row jumps at the hand-over.
- button: over-long labels (past the 1200 px cap) now clip evenly on both sides instead of off the right (a visible
  change); no short-to-long label test; the guide's tag example is not rendered; an over-long dropdown label runs
  past its fixed-width shape (older than F2).
- purity scan: `transitionend`/`animationend` are no longer flagged; a redundant `\b(?!\w)`; readsCursor misses a
  destructured cursorAt; `el.animate(` is never caught.
- gallery exits 2 for runtime failures too (the spec says bad input); the orphan test needs pgrep/pkill; cp's own
  stderr line prints above `error:`.
- sync.mjs: narrow signal windows remain (the analyser exited 0 before close; the analyser not yet dead at the
  restore; a signal during the `.bak` rename).
