# Demo 1 - reference sequence to "Tints (feat. Kendrick Lamar)"

- Song: Tints (commercial track, local viewing only). BPM 109.00 (confidence 0.39; alternatives 72.86, 143.9, 87.56). Beat 0.5504 s, 4 beats per bar.
- Loop window: bar 21 at 47.363 s (song.json sections: bars 7, 16, 21, 119), 7 bars = 28 beats = 15.413 s = 925 frames at 60 fps. Beats 0-27 span t 0.000 to 14.862; END = 28 (15.413 s).
- Size: square 1440x1440, house theme (canvas #eceae6, ink #0b0b0b, Geist).
- rules: max_states 14, min_hold_beats 2, spring zeta 0.85 / settle 0.3303 s. Warnings: none.
- Low BPM confidence (0.39): the beat grid is uniform (109 BPM) but check by ear in --serve before trusting it.
- 12 states: button, loader, check, island, player (incl. scrub), volume, toggle, tabs, chart, cmdk, toast, button (return = first state).
- State starts (beat): button 0, loader 2, check 4, island 6, player 8, volume 12, toggle 14, tabs 16, chart 18, cmdk 21, toast 24, button 26 (= END-2). Every hold >= 2 beats.
- Differences from the 120 BPM worked example: it changes state on consecutive beats (check 1 beat) which breaks min_hold 2, so states here are re-split; strong accents (beats 5, 6, 15, 19) are used for tick, island, toggle flip and tooltip. Sound column shows the measured cue_t (not t).

| # | bar.beat | t (s) | state | cursor | what changes | sound |
|---|---|---|---|---|---|---|
| 0 | 1.1 | 0.000 | button | resting bottom-right | - |  |
| 1 | 1.2 | 0.550 | button | glides onto button | hover: fill lightens |  |
| 2 | 1.3 | 1.101 | loader | presses | shape shrinks to circle, spinner in | click @ 1.109 |
| 3 | 1.4 | 1.651 | loader | drifts off | spinner turns |  |
| 4 | 2.1 | 2.202 | check | - | fill flips white, tick starts drawing |  |
| 5 | 2.2 | 2.752 | check | - | tick lands (strong hit .95) |  |
| 6 | 2.3 | 3.303 | island | - | stretches to pill, 'Now playing' (strong hit .91) |  |
| 7 | 2.4 | 3.853 | island | moves toward pill | pill holds, cursor arrives |  |
| 8 | 3.1 | 4.404 | player | moves to play | grows to card, art + title |  |
| 9 | 3.2 | 4.954 | player | presses play | play morphs to pause | click @ 4.952 |
| 10 | 3.3 | 5.504 | player | grabs progress knob | knob scales | click @ 5.497 |
| 11 | 3.4 | 6.055 | player | drags right | progress follows cursor |  |
| 12 | 4.1 | 6.605 | volume | releases | bar becomes volume slider |  |
| 13 | 4.2 | 7.156 | volume | drags past max, releases | overstretch, spring back |  |
| 14 | 4.3 | 7.706 | toggle | moves to toggle | slider collapses into toggle |  |
| 15 | 4.4 | 8.257 | toggle | presses | knob flips, two-edge stretch (strong hit .88) | click @ 8.249 |
| 16 | 5.1 | 8.807 | tabs | - | knob becomes tab indicator |  |
| 17 | 5.2 | 9.358 | tabs | presses tab 3 | indicator stretches across (.68) | click @ 9.352 |
| 18 | 5.3 | 9.908 | chart | - | tabs open into chart frame |  |
| 19 | 5.4 | 10.459 | chart | - | line draws itself |  |
| 20 | 6.1 | 11.009 | chart | hovers a point | tooltip in (strong hit .87) |  |
| 21 | 6.2 | 11.559 | cmdk | - | collapses to command bar |  |
| 22 | 6.3 | 12.110 | cmdk | - | types 'exp' | key @ 12.110 |
| 23 | 6.4 | 12.660 | cmdk | - | list filters to one row |  |
| 24 | 7.1 | 13.211 | toast | presses enter | row highlights, becomes toast 'Exported' | click @ 13.206 |
| 25 | 7.2 | 13.761 | toast | - | toast holds |  |
| 26 | 7.3 | 14.312 | button | moves home, rests bottom-right | toast collapses back to the button (first state) |  |
| 27 | 7.4 | 14.862 | button | - | settles (seam; cursor identical to beat 0) |  |
