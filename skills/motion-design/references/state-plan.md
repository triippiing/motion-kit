# Beat table format

The `## Beat table` section of MOTION-BRIEF.md has two parts: a readable table (one row per beat)
and ONE `js` code block holding the real `states()` and `cursor()` tables, written with library
components (`use:`) and hotspots (`target:`) from `~/.claude/skills/motion-video/components/CATALOG.md`.
motion-video pastes that block into `index.html`, and `check_brief.mjs` validates it.

| # | bar.beat | t | component | what changes | sound |
|---|---|---|---|---|---|

`bar.beat` counts from 1; `t` comes from song.json `beats[i].t`; `END` is the number of beats.

Rules (checked by `check_brief.mjs`): something changes on every beat; every row holds at least
`rules.min_hold_beats`; no more than `rules.max_states` states; the last row repeats the first
(same component and props) and sits at least 2 beats before `END`; the last cursor row repeats the
first. Presses click on their own; typing components play their key sounds.

Consecutive rows with the same `use` are one component changing, not a cut: the second row
continues from where the first left off and animates the difference (tabs `active: 'Day'` then
`active: 'Month'` slides the indicator). After a press, write the pressed result into the next row
(a toggle pressed on is written `on: true`).

## Worked example: the reference sequence, 7 bars at 120 BPM (28 beats)

`min_hold_beats` is 2 at 120 BPM, so every row holds 2 beats (14 rows, 12 components). The change
on the odd beats is the motion inside the hold: a press, a drag, a hover, typing.

| # | bar.beat | t | component | what changes | sound |
|---|---|---|---|---|---|
| 0 | 1.1 | 0.0 | button | "Export report" resting, cursor bottom-right | |
| 1 | 1.2 | 0.5 | button | cursor glides on and presses | click |
| 2 | 1.3 | 1.0 | loader | shape shrinks to a circle, spinner in | |
| 3 | 1.4 | 1.5 | loader | spinner turns, cursor drifts off | |
| 4 | 2.1 | 2.0 | check | tick draws, "Exported" | |
| 5 | 2.2 | 2.5 | check | tick settles | |
| 6 | 2.3 | 3.0 | island | stretches to a pill, "Now playing" | |
| 7 | 2.4 | 3.5 | island | holds | |
| 8 | 3.1 | 4.0 | player | grows to a card, art and title; cursor to play | |
| 9 | 3.2 | 4.5 | player | presses play, play morphs to pause | click |
| 10 | 3.3 | 5.0 | slider | becomes a volume slider; cursor grabs the thumb | click |
| 11 | 3.4 | 5.5 | slider | drags past max, track stretches, springs back on release | |
| 12 | 4.1 | 6.0 | toggle | collapses into a toggle; cursor to the knob | |
| 13 | 4.2 | 6.5 | toggle | presses, knob flips with a two-edge stretch | click |
| 14 | 4.3 | 7.0 | tabs | Day / Week / Month, Day active | |
| 15 | 4.4 | 7.5 | tabs | presses Month, indicator stretches across | click |
| 16 | 5.1 | 8.0 | tabs | continuation: holds on Month | |
| 17 | 5.2 | 8.5 | tabs | indicator settles | |
| 18 | 5.3 | 9.0 | line-chart | opens into a chart, the line draws on | |
| 19 | 5.4 | 9.5 | line-chart | cursor hovers a point, tooltip in | |
| 20 | 6.1 | 10.0 | command | collapses to a command bar, types "exp" | key |
| 21 | 6.2 | 10.5 | command | list filters to two rows; presses "Export report" | click |
| 22 | 6.3 | 11.0 | progress | becomes a bar, "Exporting" | |
| 23 | 6.4 | 11.5 | progress | fills to 100% | |
| 24 | 7.1 | 12.0 | toast | becomes a toast "Report exported"; cursor heads home | |
| 25 | 7.2 | 12.5 | toast | holds | |
| 26 | 7.3 | 13.0 | button | back to the button (the seam) | |
| 27 | 7.4 | 13.5 | button | settles | |

```js
const states = () => [
  { at: 0,  use: 'button', label: 'Export report', icon: 'upload', fill: 'accent', ink: 'surface' },
  { at: 2,  use: 'loader', fill: 'ink', ink: 'surface' },
  { at: 4,  use: 'check', label: 'Exported' },
  { at: 6,  use: 'island', text: 'Now playing' },
  { at: 8,  use: 'player', title: 'Midnight Drive', artist: 'The Placeholders' },
  { at: 10, use: 'slider', value: 0.4 },
  { at: 12, use: 'toggle', on: false, label: 'Notifications' },
  { at: 14, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Day' },
  { at: 16, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Month' },
  { at: 18, use: 'line-chart', label: 'Balance', points: [4, 6, 5, 8, 7, 10, 9, 13] },
  { at: 20, use: 'command', query: 'exp', typeAt: 0.25 },
  { at: 22, use: 'progress', value: 1, label: 'Exporting' },
  { at: 24, use: 'toast', text: 'Report exported' },
  { at: END - 2, use: 'button', label: 'Export report', icon: 'upload', fill: 'accent', ink: 'surface' },
];
const cursor = () => [
  { at: 0,    x: 240, y: 280 },
  { at: 1,    target: 'button' },
  { at: 1.5,  target: 'button', press: true },
  { at: 3,    x: 200, y: 230 },
  { at: 8.5,  target: 'play' },
  { at: 9,    target: 'play', press: true },
  { at: 10,   target: 'thumb' },
  { at: 10.5, target: 'thumb', press: 'down' },
  { at: 11.5, target: 'thumb', dx: 320, press: 'up' },
  { at: 12.5, target: 'knob' },
  { at: 13,   target: 'knob', press: true },
  { at: 14.5, target: 'tab:Month' },
  { at: 15,   target: 'tab:Month', press: true },
  { at: 19,   target: 'point:5' },
  { at: 21,   target: 'row:0' },
  { at: 21.5, target: 'row:0', press: true },
  { at: 24.5, x: 240, y: 280 },
  { at: END - 2, x: 240, y: 280 },
];
```
