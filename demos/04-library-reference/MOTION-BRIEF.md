# Motion brief: demo 4, the reference sequence from the library

## Request

A looping social-style showcase (full flow, loops): demo 1's reference sequence rebuilt with library
components only, to prove the planner and the component library end to end. No product; house theme.

## Decisions

- **Platform and size:** square 1440x1440 (a feed post, same as demo 1).
- **Length:** 15 s at 109 BPM = round(15 * 109 / 240) = 7 bars = 7 * 240 / 109 = 15.41 s (28 beats, 925 frames at 60 fps). Same as demo 1.
- **Song:** "Tints (feat. Kendrick Lamar)", Jack's own copy (~/Desktop), local viewing only: a commercial track, so social platforms would likely mute it. Measured 109.00 BPM, confidence 0.39 (alternatives 72.86, 143.9, 87.56); song.json warnings: none. Low confidence, but the grid is the one demo 1 was built and checked on by ear.
- **Sync:** checked by ear 2026-10-01 (nudge 0: the detected grid sounded right); markers: snare (1:00.02, beat 23; the Export report press lands on it, the toast one beat later).
- **Window:** `--start-bar 21` at 47.363 s, a section boundary (sections at bars 7, 16, 21, 119) at the start of the strong section, and demo 1's window.
- **Rules (song.json):** `max_states` 14, `min_hold_beats` 2, spring settle 0.33 s. Strongest accents: beat 5 (.95), 6 (.91), 15 (.88), 19 (.87), 0 (.73), 16 (.68).
- **Theme:** house theme, no product stylesheet, so every role is the default: canvas #eceae6, surface #ffffff, ink #0b0b0b, muted #8c8883, accent #0b0b0b, Geist. Nothing to remap.
- **Budget:** 13 rows = 12 states plus the return, within 14. All copy is 22 design px or larger except component captions.
- **Exports:** reels, x, discord, web, gif
- **Audio:** kept for local viewing only (commercial track); public posts would use --silent
- **Accepted:** commercial-track warning, these exports are for local viewing only and a public post would be exported with --silent

## Moments

| Moment | Component | Props |
|---|---|---|
| Call to action pressed | button | `label: 'Export report', icon: 'upload'`, filled `accent` with `surface` ink (as demo 1) |
| Working | loader | spinner, filled `ink` |
| Done | check | `label: 'Exported'` |
| Music in the background | island | `text: 'Now playing'` |
| Play, then scrub | player, then player (continuation) | `title: 'Midnight Drive', artist: 'The Placeholders', position: 0.25`; the continuation is the pressed result, `playing: true` |
| Volume overstretch | slider | `value: 0.4`, dragged past max, springs back |
| Setting flipped | toggle | `on: false, label: 'Notifications'`, pressed on |
| View switch | tabs | `items: ['Day', 'Week', 'Month'], active: 'Day'`, pressed to Month |
| Value over time, hovered | line-chart | `label: 'Balance', points: [4, 6, 5, 8, 7, 10, 9, 13]`, cursor hovers `point:5` |
| Keyboard command | command | `query: 'exp', typeAt: 0.25`, filters to Export report / Export CSV, presses row 0 |
| Confirmation | toast | `text: 'Report exported', action: 'Open'` |
| Seam | button | repeats the first row |

transitions.dev ideas (timings only, rebuilt with springs): toggle and tabs two-edge stretch, success
check, toast rise and unblur, command filtering.

## Beat table

| # | bar.beat | t | component | what changes | sound |
|---|---|---|---|---|---|
| 0 | 1.1 | 0.000 | button | "Export report" resting, cursor bottom-right | |
| 1 | 1.2 | 0.550 | button | cursor glides on and presses (1.5) | click |
| 2 | 1.3 | 1.101 | loader | shape shrinks to a circle, spinner in | |
| 3 | 1.4 | 1.651 | loader | spinner turns, cursor drifts off | |
| 4 | 2.1 | 2.202 | check | tick draws, "Exported" | |
| 5 | 2.2 | 2.752 | check | tick lands on the strong hit (.95); cursor drifts up | |
| 6 | 2.3 | 3.303 | island | stretches to a pill, "Now playing" (strong .91) | |
| 7 | 2.4 | 3.853 | island | cursor glides onto the island | |
| 8 | 3.1 | 4.404 | player | grows to a card, art and title; cursor to play (8.5) | |
| 9 | 3.2 | 4.954 | player | presses play, play morphs to pause | click |
| 10 | 3.3 | 5.504 | player (cont.) | playing; cursor grabs the thumb (10.5) | click |
| 11 | 3.4 | 6.055 | player (cont.) | drags the thumb right (11), releases there (11.5), playback resumes | |
| 12 | 4.1 | 6.605 | slider | becomes a volume slider; cursor on the thumb, grabs (12.5) | click |
| 13 | 4.2 | 7.156 | slider | drags past max (13), track stretches, releases (13.5), springs back | |
| 14 | 4.3 | 7.706 | toggle | collapses into a toggle; cursor comes back onto the knob | |
| 15 | 4.4 | 8.257 | toggle | presses, knob flips with a two-edge stretch (strong .88) | click |
| 16 | 5.1 | 8.807 | tabs | Day / Week / Month, Day active (strong .68); cursor to Month (16.5) | |
| 17 | 5.2 | 9.358 | tabs | presses Month, indicator stretches across | click |
| 18 | 5.3 | 9.908 | line-chart | opens into a chart, the line draws on | |
| 19 | 5.4 | 10.459 | line-chart | line lands (strong .87); cursor moves towards the chart | |
| 20 | 6.1 | 11.009 | line-chart | cursor hovers point 5, dot and tooltip pop | |
| 21 | 6.2 | 11.559 | command | collapses to a command bar, types "exp" (21.25 to 21.75) | key x3 |
| 22 | 6.3 | 12.110 | command | list filtered to two rows; cursor onto row 0 | |
| 23 | 6.4 | 12.660 | command | presses "Export report" on the snare marker (beat 23) | click |
| 24 | 7.1 | 13.211 | toast | becomes a toast "Report exported" with Open, one beat after the snare | |
| 25 | 7.2 | 13.761 | toast | cursor hovers Open | |
| 26 | 7.3 | 14.312 | button | back to the button (the seam), cursor home | |
| 27 | 7.4 | 14.862 | button | settles | |

```js
const states = () => [
  { at: 0,  use: 'button', label: 'Export report', icon: 'upload', fill: 'accent', ink: 'surface' },
  { at: 2,  use: 'loader', fill: 'ink', ink: 'surface' },
  { at: 4,  use: 'check', label: 'Exported' },
  { at: 6,  use: 'island', text: 'Now playing' },
  { at: 8,  use: 'player', title: 'Midnight Drive', artist: 'The Placeholders', position: 0.25 },
  { at: 10, use: 'player', title: 'Midnight Drive', artist: 'The Placeholders', position: 0.25, playing: true },
  { at: 12, use: 'slider', value: 0.4 },
  { at: 14, use: 'toggle', on: false, label: 'Notifications' },
  { at: 16, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Day' },
  { at: 18, use: 'line-chart', label: 'Balance', points: [4, 6, 5, 8, 7, 10, 9, 13] },
  { at: 21, use: 'command', query: 'exp', typeAt: 0.25 },
  { at: 'snare', offset: 1, use: 'toast', text: 'Report exported', action: 'Open' },
  { at: END - 2, use: 'button', label: 'Export report', icon: 'upload', fill: 'accent', ink: 'surface' },
];
const cursor = () => [
  { at: 0,    x: 140, y: 100 },
  { at: 1,    target: 'button' },
  { at: 1.5,  target: 'button', press: true },
  { at: 3,    x: 110, y: 60 },
  { at: 5,    x: 140, y: -40 },
  { at: 7,    target: 'island' },
  { at: 8.5,  target: 'play' },
  { at: 9,    target: 'play', press: true },
  { at: 10,   target: 'thumb' },
  { at: 10.5, target: 'thumb', press: 'down' },
  { at: 11,   target: 'thumb', dx: 200 },
  { at: 11.5, target: 'thumb', dx: 200, press: 'up' },
  { at: 12,   target: 'thumb' },
  { at: 12.5, target: 'thumb', press: 'down' },
  { at: 13,   target: 'thumb', dx: 500 },
  { at: 13.5, target: 'thumb', dx: 500, press: 'up' },
  { at: 14,   target: 'knob' },
  { at: 15,   target: 'knob', press: true },
  { at: 16.5, target: 'tab:Month' },
  { at: 17,   target: 'tab:Month', press: true },
  { at: 19,   x: 200, y: 230 },
  { at: 20,   target: 'point:5' },
  { at: 22,   target: 'row:0' },
  { at: 'snare', target: 'row:0', press: true },   // the press lands on the snare
  { at: 25,   target: 'action' },
  { at: END - 2, x: 140, y: 100 },
];
```
