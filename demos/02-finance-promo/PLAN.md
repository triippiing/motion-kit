# Demo 2 - finance-app promo ("Personal Finance" light theme) to "Tints (feat. Kendrick Lamar)"

- Song: Tints (commercial track, local viewing only). BPM 109.00 (confidence 0.39; alternatives 72.86, 143.9, 87.56). Beat 0.5504 s, 4 beats per bar.
- Loop window: bar 7 at 16.538 s (start of the song.json section at bar 7; demo 1 uses bar 21 at 47.363 s), 7 bars = bars 7-13 = 28 beats = 15.413 s = 925 frames at 60 fps. Beats 0-27 span t 0.000 to 14.862; END = 28. The whole loop sits inside the 7-16 section.
- Size: square 1440x1440. Theme from web/style.css: canvas #eef0f3, surface #ffffff, ink #161a21, muted #697082, accent #0c7d74, font "Geist, system-ui, sans-serif" (extractor warned: no font-family found; the app uses the `font:` shorthand -apple-system / SF Pro Text, so the house font is used as a fallback).
- rules: max_states 14, min_hold_beats 2, spring zeta 0.85 / settle 0.3303 s. Warnings: none. (Low BPM confidence 0.39: check the grid by ear in --serve.)
- 12 states: button, dropzone, chip, goal, surplus, calendar, statuspill, dock, spark, goalmet, inflight, button (return = first state). Starts (beat): 0, 2, 4, 6, 8, 11, 14, 16, 19, 22, 24, 26 (= END-2). Every hold >= 2 beats.
- Colours: theme.json has only canvas/surface/ink/muted/accent. The goal-met state wants the app's --pos green (#067647, soft #e8f5ee) and there is no role for it; the build either adds a `pos` role to the template/extractor or keeps goal-met in accent. Flagged for the controller.
- Every on-screen figure is invented (Net pay £3,200, Holiday fund £2,450 of £4,000, Monthly surplus £900 = £540 goals / £360 spare, Rent £850, portfolio £12,650, Laptop fund £1,500). Nothing is read from the app's database or fixtures. Design-handoff screenshots contain the app's mock figures and were looked at only for layout.
- Sources read (read-only): web/style.css tokens, web/index.html structure (#payslip-drop, #tile-surplus-bar, #pots, #calendar-grid, #status-pill, #dock, #curve), design_handoff_motion/README.md (§2 dropzone, §3 in flight, §5 bars, §6 status, §11 sparkline, §12 goal met) and screenshots 02-05.

| # | bar.beat | t (s) | state | cursor | what changes | real UI recreated | sound (cue_t) |
|---|---|---|---|---|---|---|---|
| 0 | 1.1 | 0.000 | button | rests bottom-right | primary button 'Import payslip' (accent fill, white label) | btn btn-primary (Plan page) |  |
| 1 | 1.2 | 0.550 | button | glides onto button | hover: fill deepens one step | btn hover, --t-hover 140ms |  |
| 2 | 1.3 | 1.101 | dropzone | drags a PDF chip in, arrives (strong hit 1.0) | button grows to dashed well, 'Release to read this payslip' / 'PDF only'; border turns accent | #payslip-drop .dropzone.dragover | click @ 1.086 |
| 3 | 1.4 | 1.651 | dropzone | releases file | dashed border firms up, well waits | dropzone drop |  |
| 4 | 2.1 | 2.202 | chip | - (strong hit 1.0) | well becomes solid; check chip pops; 'payslip-march.pdf read.' / 'Net pay £3,200 · imported 28 Mar' | dropzone outcome 'read' (--pos, chip-pop) | click @ 2.201 |
| 5 | 2.2 | 2.752 | chip | drifts to next card | outcome holds, chip settles | dropzone outcome |  |
| 6 | 2.3 | 3.303 | goal | - | card 'Holiday fund'; bar starts filling in accent | #pots goal card, .bar i width, --t-figure |  |
| 7 | 2.4 | 3.853 | goal | - | bar lands at 61%; '£2,450 of £4,000 · 61%' | goal bar + figure line |  |
| 8 | 3.1 | 4.404 | surplus | - (strong hit 1.0) | card 'Monthly surplus £900'; bar splits 60/40 with a seam | #tile-surplus + #tile-surplus-bar (.bar-split) |  |
| 9 | 3.2 | 4.954 | surplus | - | legend in: '£540 to goals', '£360 spare' | surplus sub-line + split legend |  |
| 10 | 3.3 | 5.504 | surplus | moves toward the calendar | split bar holds; seam glints | bar-split |  |
| 11 | 3.4 | 6.055 | calendar | - | surplus shrinks to a 7-col month strip; one day cell 'Fri 28' lit with 'Payday' chip | #calendar-grid .calendar-day |  |
| 12 | 4.1 | 6.605 | calendar | hovers day 5 | cell 'Wed 5' lifts, chip 'Rent £850' | calendar day + category chip |  |
| 13 | 4.2 | 7.156 | calendar | presses day 5 | cell selects, accent-soft fill | calendar day selected | click @ 7.135 |
| 14 | 4.3 | 7.706 | statuspill | - | calendar collapses to a 26px circle; dot in --pos | #status-pill collapsed (--h-pill 26px) |  |
| 15 | 4.4 | 8.257 | statuspill | - | pill extends: 'Connected. Everything is working.' | #status-pill level change / extend (--ease-pill) |  |
| 16 | 5.1 | 8.807 | dock | moves to dock | pill collapses; shape becomes bottom dock with five labelled items | #dock (Today, Plan, Retirement, Settings, Calendar; verify against PAGES in app.js) |  |
| 17 | 5.2 | 9.358 | dock | presses Calendar | selection pill stretches across from Plan (two-edge) | dock indicator travel (--t-travel) | click @ 9.353 |
| 18 | 5.3 | 9.908 | dock | - | indicator lands on Calendar; label ink flips | dock indicator settle |  |
| 19 | 5.4 | 10.459 | spark | hovers newest point (strong hit 1.0) | dock opens into 'Portfolio value' line; last segment draws, dot pops | #curve sparkline, draw + point-in (curve.js) |  |
| 20 | 6.1 | 11.009 | spark | - | tooltip '£12,650' (strong hit 0.98) | curve last-point label |  |
| 21 | 6.2 | 11.559 | spark | - | dot settles, previous dot shrinks 3.4 to 2px | point-in tail |  |
| 22 | 6.3 | 12.110 | goalmet | - | card 'Laptop fund'; bar fills 100%, accent turns --pos | goal met, bar accent to --pos |  |
| 23 | 6.4 | 12.660 | goalmet | - | check chip pops, sheen sweeps, halo fades; '£1,500 of £1,500 · target met, 2 months early' | goal met chip + sheen + met-halo | click @ 12.661 |
| 24 | 7.1 | 13.211 | inflight | moves to 'Add goal' | card collapses to submit button; spinner in, label 'Adding…' | #form-pot .btn[disabled] in flight |  |
| 25 | 7.2 | 13.761 | inflight | - | spinner turns | in-flight spin 900ms |  |
| 26 | 7.3 | 14.312 | button | moves home, rests bottom-right | label returns 'Import payslip' (first state) | btn btn-primary |  |
| 27 | 7.4 | 14.862 | button | - | settles (seam; cursor identical to beat 0) |  |  |
