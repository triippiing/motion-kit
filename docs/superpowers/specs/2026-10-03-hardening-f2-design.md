# Hardening, second pass (sub-project F2): design

Date: 2026-10-03
Status: approved in conversation, awaiting spec review
Part of: the motion-kit roadmap (A, B, C1, F1 done; then C2, D, E). F1's spec recorded the agreed F2 scope;
this spec settles it.

## Purpose

F2 makes check_brief catch what a person would see as broken before they approve a brief, fixes the six
component edge cases a normal brief can hit, and clears the tooling and test leftovers from A and F1.
Rule for new checks: an **error** when the output would be wrong, a **warning** when it would look wrong.

Success means:
1. check_brief reports a cursor leaving the frame and text overflowing its shape, measured in the real page
   (camera zoom and real font included), and the table-level checks below.
2. The six component fixes behave as described, each pinned by a test, and Jack has approved before/after
   stills of each before merge.
3. The tooling items are done; all tests green (`npm test`).
4. check_brief on demo 04 and on each of the five recipes gives no new false warnings; any real one is fixed
   or explained to Jack.
5. Merged to main and pushed.

Out of scope: pickup/anacrusis (C2), `export.mjs` on joined videos (D), F1 leftovers with no user effect
(the bash-only plan snippets, a backstop for a `setsid` grandchild holding the analyser's pipe).

## 1. Checks

### 1a. Frame check in the browser

New `scripts/framecheck.mjs`, run by check_brief whenever the tables validate (no errors), with or without an
Exports line. It opens the brief's tables at the design stage (as the safe-zone check does: `openProject` with
`tables` spliced, `loop` honoured), seeks every half beat within the loop, and measures in the page:

- **Cursor leaving the frame:** the cursor's tip and drawn arrow (the box safezones.mjs already measures,
  camera zoom and cursor scale included; a hidden cursor, opacity under 0.05, does not count) reaching 1 px or
  more past any stage edge. Warning: `beats 12-13.5: the cursor goes 40 px past the right edge`.
- **Text overflowing its shape:** any element inside `#shape` with direct text content whose words' own line boxes
  (a Range over its text nodes, not the element's box, which is often a slot as tall as the shape) reach 1 px
  or more past `#shape`'s box, or whose content is clipped inside its own box (`scrollWidth > clientWidth + 1`).
  Warning: `beat 8: button text "A very long label tha…" runs 64 px past its shape` (text cut to 24 characters).
  Elements fully transparent (computed opacity under 0.05, including ancestors' opacity) are skipped, so text
  mid-fade does not count.

Consecutive samples with the same issue (same part and edge, or same element text) are one message with a beat
range, as safezones.mjs groups them. This one generic text check covers long button labels, long dock and
chip-row lists, and long labels on vertical stages: no per-component character limits.

The safe-zone check becomes a second consumer of the same samples (presets with safe zones only; same messages
as today). The sampler moves out of safezones.mjs into framecheck.mjs; safezones.mjs keeps its CLI, preset
helpers and guides overlay, and calls the shared sampler. One browser session per stage size serves both.

If the page cannot be opened or measured, check_brief adds one warning (`the frame check did not run: ...`) as
it does for safe zones today; it never errors on the measurement itself.

### 1b. Table checks (validate.js, so they run in the engine too)

- **Typing that overruns its row** (input, command): the last character lands at or after the next row's beat
  (`row.at + typeAt + (n - 1) * perChar >= nextRow.at`, n = characters still to type). **Error**: `input at beat 4
  types 'Groceries' until beat 6.25 but the next row starts at beat 6; end typing by beat 6 (typeAt or perChar)`.
- **Drags on custom states:** a press `'down'`/`'up'` pair on a row with no component (custom states) gets the
  same rules as a component drag hotspot: it must stay inside one row (**error**, existing wording) and must move
  (**warning**, existing wording).
- **Clicks before the pointer settles:** the strict-mode "rushed" check that warns for drags also covers
  `press: true` clicks: `cursor() row 5: the cursor has only 0.25 beat to reach 'tab:Month' before the click;
  give it about 0.8 beat`. **Warning.**
- **Duplicate bar-chart labels:** **warning** `bar-chart at beat 6 has duplicate labels ("Mon"); the cursor and
  hover can only reach the first`; **error** when a cursor row targets the duplicated label's hotspot.
- **theme.json must be an object** (check_brief's theme loading): `theme.json should be an object of colour
  roles, got null`. **Error.**

### 1c. Output and tests

check_brief's output is unchanged in shape (`warning:` / `error:` lines; exit 1 only on errors). Its tests
inject a stub frame check (`opts.frameCheck`, like `opts.safeZones` today) so most stay browser-free; one real
end-to-end test covers a cursor driven off-frame and a long button label. framecheck.mjs has its own tests on
small scaffolded projects (no overflow, cursor off each edge, overflowing text, clipped text, faded text ignored,
hidden cursor ignored).

## 2. Component fixes

Each fix comes with a test pinning the new behaviour (seek-based, as the component tests do today) and an update
to the component's `meta.motion` where it describes the behaviour (CATALOG.md regenerated).

1. **line-chart, cursor point A to point B:** A's dot and tooltip fade out over 0.2 beat while B pops in, as when
   the cursor leaves the chart (today A is replaced at once).
2. **line-chart `hover` after a cursor hover:** when a row's `hover` takes over from a cursor hover that has just
   faded, the dot and tooltip fade in (as a fresh `hover` does) instead of snapping on.
3. **badge on consecutive rows:** the same count stays put across the row change (no fade out and in); a changed
   count keeps the bubble and pops the number to the new value.
4. **command continuation extending the query with `typeAt: -1`:** the rows spring to the new filter from the row's
   start, as a typed extension does, instead of snapping.
5. **goal with a tiny target:** verified no change needed: easing between two positive targets stays between the
   two rows' percentages (the planned ×10 rule was dropped); tests pin it, bar and figure in step.
6. **slider label long to short:** during the crossfade the old label fades out at its own width, clipped inside
   the shape: no stub of it shows past the new, shorter layout.

**Approval:** before merge, a before/after still sheet (main vs branch, the moments that change) for each fix is
shown to Jack; a fix he rejects is reverted or reworked before merge.

## 3. Tooling and tests

- **Purity scan** (the contract test): match `transition`/`animation` as whole CSS property or API names, not
  identifiers that start with them; catch `new Date` without parentheses. The contract test's `cursorAt` regex
  ignores comments.
- **Recipes:** all five recipes render to MP4 in tests (today only the first; about 20 s more).
- **F1 leftovers** (from docs/superpowers/deferred.md):
  - tmp.test.mjs: the SIGINT test fails rather than hangs if the child never prints (resolve on exit too, with a
    test timeout); the crash test asserts the `mk-tmptest-` name; the MK_KEEP_TMP test asserts exit status 0.
  - gallery.mjs: an `error: ...` / exit 2 wrapper around the CLI body; a failed run removes its temp root even in
    keep mode; gallery.test's first test uses its own prefix (`mk-galtest-`).
  - is_main.test: the old-guard check matches `realpathSync(process.argv` in any spelling. (No CLI test with a
    missing argv[1]: node cannot start a script from a path that does not exist, and the unit test covers isMain.)
  - sync.mjs: on SIGINT/SIGTERM/exit the server SIGTERMs any analyser process group still running; the SIGTERM test
    also checks song.json is unchanged and the message.
  - test_analyze_song: rename `test_short_song_window_choice_is_unchanged` to say what it checks; the
    components-feedback progress band tightens to 30 to 32 %.
  - export.test gap check: assert packet times and durations are finite; use the median packet duration as the
    reference; a unit test that `loudnormArgs` output ends with `asetpts=N/SR/TB`.
- Remove the matching lines from docs/superpowers/deferred.md as items land; what is left there afterwards is the
  honest remainder.

## Docs

CLAUDE.md (check_brief step and "Rules that matter" where relevant) and `skills/motion-video/SKILL.md` list the new
checks and the frame check; `skills/motion-design/references/planner.md` notes that check_brief now always opens
Chromium (a few seconds). CATALOG.md regenerated for changed `meta.motion` text.

## Verification before merge

- `npm test` green (bash; `export PATH=/opt/homebrew/bin:$PATH`).
- check_brief on demo 04 and on a project per recipe: list every warning; none is a false positive (or each is
  explained to Jack).
- The six before/after still sheets approved by Jack.
