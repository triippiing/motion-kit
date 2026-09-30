# Demo 3: the finance app's dock pill on springs

This demo is live motion inside the real product, not a rendered promo. In Jack's Personal Finance app, the dock indicator ("pill") used to slide on a CSS `transform` transition. It now travels on two critically damped springs, one for each edge. The edge on the side the pill is heading toward settles in 0.7 of `--t-travel`, and the other edge takes the full `--t-travel` (220 ms). So the pill reaches toward where it is going and gathers up behind itself. The project's Motion Spec wins: no bounce, no overshoot, and the settle time is the `--t-travel` token. zeta 1 alone does not guarantee that. An edge still moving away when you turn back can pass its target, and the first version did exactly that on quick reversals, which briefly hid the pill. So each edge now carries its own position and velocity from one navigation to the next, and it is held between where it was at the last navigation and where it is going. If you interrupt a travel mid-flight, the pill keeps its position and its speed.

- **Branch:** `motion-demo` in `~/Documents/AUTOMATION/personal-finance` (commits `2e2820d`, then fix round 1 `ba4d793`).
  **Nothing is merged or pushed.** `main` is untouched.
- **Code:** `web/app.js` has `dockPillEdges` (pure, `(from, changes, t) -> {left, right}` in item units), `dockPillStyle(left, right)`, and `moveDockPill`/`stepDockPill` (the rAF driver). `web/springs.js` is vendored from `shared/springs.js`. With reduced motion or no `requestAnimationFrame`, the pill jumps instead of animating.
- **Tests:** `tests/test_web_dock_pill_js.py` pins these: it settles on the target, holds before a change, the leading edge leads in both directions, it never overshoots, a retarget stays continuous, the pill never collapses or leaves the dock under rapid navigation, quick reversals stay in the dock and never pass their target, the live rAF path survives a dock rebuild and settles, and `DOCK_TRAVEL_SEC` equals `--t-travel`. Three older tests that pinned the `translateX` contract were updated, not deleted.

  ```sh
  cd ~/Documents/AUTOMATION/personal-finance
  git switch motion-demo
  .venv/bin/python -m pytest tests/test_web_dock_pill_js.py -q   # the new 9
  .venv/bin/python -m pytest -q                                   # everything (~10 min)
  ```

## The video

`out/dock-springs.mp4` (960x200, about 14 s) shows `main`'s CSS-transition pill on top and the springs pill below. Both run the same sequence: Today → Retirement → Plan → Settings, then retarget to Today while the pill is still heading to Settings. The sequence plays once in real time and once 4x slower.

```sh
node demos/03-finance-inapp/capture.mjs           # -> out/dock-springs.mp4 (out/ is not committed)
node demos/03-finance-inapp/capture.mjs --serve   # open the harness in a browser; add ?slow=4
```

`capture.mjs` reads everything with `git show` at capture time. It takes `style.css`, `icons.js`, `springs.js` and the dock pill's functions (cut out of `web/app.js` by name) from `motion-demo`, plus the old `dockPillStyle(index)` and its transition from `main`. The video therefore always shows the committed code. The harness watches every style the springs pill is given, and `capture.mjs` refuses to write a video in which the pill ever hid (`display:none`), left the dock or got narrower than 0.75 of an item. Set `FIN_REF=<commit>` to capture another ref. With `FIN_REF=2e2820d`, the pre-fix commit, it fails on the retarget. The short blank between the two passes is the page reloading at the new speed. `harness.html` holds only the page around them. It uses Playwright from `skills/motion-video/node_modules` and ffmpeg at `/opt/homebrew/bin/ffmpeg`.

## If Jack keeps it

The linux port still needs its own pass after this: vendor `springs.js`, then port the script tag, packaging list and `app.js` change. Don't do that until this branch is accepted.
