# State plan format

One row per beat. `bar.beat` counts from 1. Time comes from song.json `beats[i].t`.

| # | bar.beat | t (s) | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|

Rules: something changes on every beat; a state holds at least `rules.min_hold_beats`;
no more than `rules.max_states` states; the final state equals the first and lands at
least 2 beats before the end; presses carry a click sound.

## Worked example — the reference sequence, 7 bars at 120 BPM (28 beats)

| # | bar.beat | t | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|
| 0 | 1.1 | 0.0 | button | resting bottom-right | — | |
| 1 | 1.2 | 0.5 | button | glides onto button | hover: fill lightens | |
| 2 | 1.3 | 1.0 | loader | presses | shape shrinks to circle, spinner in | click |
| 3 | 1.4 | 1.5 | loader | drifts off | spinner turns | |
| 4 | 2.1 | 2.0 | check | — | fill flips white, tick draws | |
| 5 | 2.2 | 2.5 | island | — | stretches to pill, "Now playing" | |
| 6 | 2.3 | 3.0 | player | moves to play | grows to card, art + title | |
| 7 | 2.4 | 3.5 | player | presses play | play morphs to pause | click |
| 8 | 3.1 | 4.0 | player/scrub | grabs progress knob | knob scales | click |
| 9 | 3.2 | 4.5 | player/scrub | drags right | progress follows cursor | |
| 10 | 3.3 | 5.0 | volume | releases | bar becomes volume slider | |
| 11 | 3.4 | 5.5 | volume | drags past max | slider stretches past end | |
| 12 | 4.1 | 6.0 | volume | releases | springs back from overstretch | |
| 13 | 4.2 | 6.5 | toggle | moves to toggle | slider collapses into toggle | |
| 14 | 4.3 | 7.0 | toggle | presses | knob flips (two-edge stretch) | click |
| 15 | 4.4 | 7.5 | tabs | — | knob becomes tab indicator | |
| 16 | 5.1 | 8.0 | tabs | presses tab 3 | indicator stretches across | click |
| 17 | 5.2 | 8.5 | chart | — | tabs open into chart frame | |
| 18 | 5.3 | 9.0 | chart | — | line draws itself | |
| 19 | 5.4 | 9.5 | chart | hovers a point | tooltip in | |
| 20 | 6.1 | 10.0 | ⌘K | — | collapses to command bar | |
| 21 | 6.2 | 10.5 | ⌘K | — | types "exp" | key |
| 22 | 6.3 | 11.0 | ⌘K | — | list filters to one row | |
| 23 | 6.4 | 11.5 | ⌘K | presses enter | row highlights | click |
| 24 | 7.1 | 12.0 | toast | — | becomes toast "Exported" | |
| 25 | 7.2 | 12.5 | toast | moves home | toast holds | |
| 26 | 7.3 | 13.0 | button | resting bottom-right | back to the button | |
| 27 | 7.4 | 13.5 | button | — | settles (seam) | |
