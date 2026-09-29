---
name: motion-ui
description: Use when adding or changing animation in a real product UI (web app, rendered HTML page, game menu) — indicators, toggles, progress bars, drag interactions, interruptible transitions, "make this feel smoother/springier". Uses the shared closed-form springs. Not for rendered videos (use motion-design / motion-video).
---

# Motion in product UI

## Step 1 — the project's motion rules win
Before proposing anything, look for existing motion rules and treat them as the spec:
- docs/design folders named like `motion`, `animation`, `handoff` (e.g. personal-finance
  `design-system/design_handoff_motion/`);
- CSS tokens: `grep -nE -- '--(t|dur|ease|motion)[-a-z]*:' **/*.css`;
- existing `transition:` / `@keyframes` / `prefersReducedMotion`.
Quote the rules that apply in your plan. If the spec bans bounce/overshoot, every spring
is ζ = 1. Durations come from the tokens: `Springs.fromSettle(tokenSeconds, zeta)`.
If there is no spec, default to ζ 1 for position, ≤ 0.85 only for playful scale pops.

## Step 2 — pick the pattern
See `references/patterns.md`: retargetable value, two-edge indicator, drag + release,
content swap, reduced motion. Use springs where interruption or velocity matters
(indicators, drags, values that update mid-flight). A one-shot colour fade stays a
CSS transition.

## Step 3 — build it testably
- Vendor `assets/springs.js` into the project with its header intact; add it to script
  tags and any packaging/asset lists; keep it before the code that uses it.
- Put the motion maths in a pure function of `(state, changes, t)` and unit-test it with
  the project's own JS test harness (no clock needed); the rAF driver stays thin.
- Respect reduced motion (jump, don't animate) and missing `requestAnimationFrame`.
- Run the project's full test suite; update tests that pinned the old CSS/transform
  contract rather than deleting them.

## Red flags
| Thought | Reality |
|---|---|
| "Springs are nicer, I'll add a little bounce" | Only if the project's spec allows overshoot. |
| "I'll hard-code 300ms" | Use the project's token. |
| "I'll animate width on a control" | Controls keep their box unless the spec says otherwise. |
