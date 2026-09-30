# Deferred items (after sub-project A)

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
- Script entry guards throw ENOENT if argv[1] names a missing file (latent; an isMain helper).
- gallery.mjs imports tests/harness.mjs (layering); makeProject temp dirs are not cleaned up.
- Purity scan over-matches identifiers starting with transition/animation; the contract test's
  cursorAt regex also matches comments.
- `new Date` without parentheses is not caught by the purity scan.
- Recipes: only the first recipe renders to MP4 in tests (all five are seeked in Chromium).
