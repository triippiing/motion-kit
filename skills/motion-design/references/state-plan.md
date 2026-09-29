# State plan format

One row per beat. `bar.beat` counts from 1. Time comes from song.json `beats[i].t`.

| # | bar.beat | t (s) | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|

Rules (`min_hold_beats` applies to every state, including the worked example below): something changes on every beat; a state holds at least `rules.min_hold_beats`;
no more than `rules.max_states` states; the final state equals the first and lands at
least 2 beats before the end; presses carry a click sound.

## Worked example — the reference sequence, 7 bars at 120 BPM (28 beats)

`min_hold_beats` is 2 at 120 BPM, so every state below holds at least 2 beats (13 states, 28 rows).
The change on each row is the motion inside the hold; the state name changes only every 2–3 beats.

| # | bar.beat | t | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|
| 0 | 1.1 | 0.0 | button | resting bottom-right | — |  |
| 1 | 1.2 | 0.5 | button | glides onto button | hover: fill lightens |  |
| 2 | 1.3 | 1.0 | loader | presses | shape shrinks to circle, spinner in | click |
| 3 | 1.4 | 1.5 | loader | drifts off | spinner turns |  |
| 4 | 2.1 | 2.0 | check | — | fill flips white, tick draws |  |
| 5 | 2.2 | 2.5 | check | — | tick settles, ring pulses |  |
| 6 | 2.3 | 3.0 | island | — | stretches to pill |  |
| 7 | 2.4 | 3.5 | island | — | "Now playing" text in |  |
| 8 | 3.1 | 4.0 | player | moves to play | grows to card, art + title |  |
| 9 | 3.2 | 4.5 | player | presses play | play morphs to pause | click |
| 10 | 3.3 | 5.0 | player/scrub | grabs progress knob | knob scales | click |
| 11 | 3.4 | 5.5 | player/scrub | drags right | progress follows cursor |  |
| 12 | 4.1 | 6.0 | volume | releases | bar becomes volume slider |  |
| 13 | 4.2 | 6.5 | volume | drags past max | slider stretches past end |  |
| 14 | 4.3 | 7.0 | toggle | releases, moves to toggle | springs back, slider collapses into toggle |  |
| 15 | 4.4 | 7.5 | toggle | presses | knob flips (two-edge stretch) | click |
| 16 | 5.1 | 8.0 | tabs | — | knob becomes tab indicator |  |
| 17 | 5.2 | 8.5 | tabs | presses tab 3 | indicator stretches across | click |
| 18 | 5.3 | 9.0 | chart | — | tabs open into chart frame |  |
| 19 | 5.4 | 9.5 | chart | — | line draws itself |  |
| 20 | 6.1 | 10.0 | chart | hovers a point | tooltip in |  |
| 21 | 6.2 | 10.5 | ⌘K | — | collapses to command bar |  |
| 22 | 6.3 | 11.0 | ⌘K | — | types "exp", list filters to one row | key |
| 23 | 6.4 | 11.5 | ⌘K | presses enter | row highlights | click |
| 24 | 7.1 | 12.0 | toast | — | becomes toast "Exported" |  |
| 25 | 7.2 | 12.5 | toast | moves home | toast holds |  |
| 26 | 7.3 | 13.0 | button | resting bottom-right | back to the button |  |
| 27 | 7.4 | 13.5 | button | — | settles (seam) |  |
