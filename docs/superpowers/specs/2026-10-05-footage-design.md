# Real-app footage (sub-project E): design

Date: 2026-10-05
Status: approved by Jack in chat (2026-10-05: capture mode C, design as presented); built (parts that changed in the build are marked *as built*)
Part of: the motion-kit roadmap (A, B, C1, C2a, C2b, F1, F2 done; D built on branch `sequence`, unmerged).

## Purpose

Today every piece is drawn by the kit's components. E lets a piece show **real footage of a real app** (one of Jack's
apps, or any HTML page, or any screen recording) inside the kit's one shape, cut to the beat like everything else.

Decisions (Jack): HTML apps are captured by rendering them in Playwright's WebKit (Safari's engine) or Chromium;
capture is **stepped** (frame-exact) by default with a **real-time** fallback (`--realtime`) for apps that will not
step (Jack, 2026-10-05: option C). A screen recording skips capture and goes straight to the component.

Success means:
1. `capture.mjs` turns a URL or local HTML file plus a list of steps (click, type, scroll, hover, wait) into a clip:
   frames + `clip.json`, frame-exact at 60 fps in WebKit and Chromium; `--realtime` records any app.
2. `footage.mjs` turns any .mov/.mp4 into the same clip format.
3. A `footage` component plays a clip inside the shape; its frame is a pure function of `t`; the promo's cursor can aim
   at the captured steps (`step:NAME`).
4. Render, beat_stills, the frame check and export show the exact frame for each `t`; watch and the sync page play it.
5. install.sh and doctor.sh cover Playwright WebKit.
6. Tests green with local test pages only (never Jack's private apps without asking); not merged before Jack's review.

Out of scope: capturing during render (a clip is a fixed file), stepping an embedded `<video>` or WebGL that runs on
its own clock (use `--realtime`), the app's audio, editing or trimming clips beyond `from`/`speed`.

## 1. The clip format

A clip is a directory, conventionally `DIR/footage/NAME/` in the project that uses it:

```
frame-00001.jpg ... frame-NNNNN.jpg   (JPEG, quality ~90; frame 1 is clip time 0)
clip.json
```

```json
{
  "fps": 60, "width": 1280, "height": 800, "frames": 240, "duration": 4.0,
  "mode": "stepped",
  "source": "file:///.../app.html",
  "browser": "webkit",
  "steps": [ { "name": "pay", "action": "click", "t": 1.52, "box": { "x": 900, "y": 640, "w": 160, "h": 44 } } ]
}
```

`mode` is `stepped`, `realtime` or `video` (from footage.mjs). `steps` lists only named steps (`t` in clip seconds,
`box` in clip pixels at that time). `source` is a URL or the file's basename (never a private absolute path in a
committed file). Frames are large; `footage/` is git-ignored in this repo. Projects made by new_project.sh have no
`.gitignore` of their own, so the docs tell users to keep `footage/` out of their repos.

## 2. `scripts/capture.mjs`

```
node capture.mjs URL|FILE --steps steps.json --out CLIPDIR [--browser webkit|chromium] [--size WxH] [--fps N]
                 [--scale N] [--realtime]
```

(*as built:* the flag order is the usage line's: `--scale` before `--realtime`.)

- Defaults: webkit, 1280x800, 60 fps, device scale 1 (`--scale 2` for retina-sharp frames). *As built:* with
  `--realtime` the browser defaults to chromium; `--realtime --browser webkit` works but warns (`warning: webkit
  realtime recordings on macOS are smaller and colour-shifted; chromium is the realtime default`).
- `steps.json`: a list of `{ "wait": SEC }`, `{ "click": SEL }`, `{ "type": SEL, "text": STR }`,
  `{ "scroll": PX }` (or `{ "scroll": PX, "in": SEL }`), `{ "hover": SEL }`, each optionally with `"name"`. Selectors
  are Playwright selectors (CSS). Pointer moves to a target take a fixed eased time (0.4 s, overridable per step
  `"move"`); typing is 12 characters a second (`"cps"`). A short hold (0.5 s) is captured before the first step and
  after the last. Unknown keys, a selector Playwright cannot parse, or an unreadable steps file: `error: ...` exit 2
  (*as built:* every selector is parsed before the first frame). A selector that matches nothing at its step is
  exit 1 naming the step (*as built:* `error: step 2 (click "#missing"): no element matches (waited 5 s)`).
- **Stepped (default).** Before the page's scripts run: Playwright's `page.clock.install()` (fake `Date`, timers and
  `requestAnimationFrame`), and an init script that pauses every CSS animation and transition as it starts
  (`document.getAnimations()`, re-scanned each frame) and sets each one's `currentTime` from the fake clock. Each
  frame: advance the clock by 1/fps (`clock.runFor`), sync the animations, wait for the page's next paint, screenshot
  the viewport. Pointer and keyboard actions are dispatched at their frame. The result is frame-exact: the same page
  and steps give the same frames on every run.
- **`--realtime`.** Playwright's `recordVideo` at the size, the steps run on the real clock, then ffmpeg extracts the
  frames at `--fps` into the same layout; `mode: "realtime"` and a warning that timing is approximate.
- Opens only what it is given: a file path, `file://`, `http(s)://` URLs on the command line. No network
  interception, no uploads. A file is served from its own directory on 127.0.0.1 (as render.mjs `serve()` does) so
  relative assets load.
- Prints `capture: 240 frames, 4 s, 1280x800 (stepped, webkit) -> CLIPDIR` (*as built:* the duration to at most
  three decimals with trailing zeros dropped, e.g. `4 s`, `2.567 s`).

## 3. `scripts/footage.mjs`

`node footage.mjs VIDEO --out CLIPDIR [--fps N] [--max-width PX]` extracts frames with ffmpeg (default 60 fps, the
video's size capped at 1600 px wide, even dimensions) and writes clip.json with `mode: "video"` and no steps. A
missing or unreadable video: `error: ...` exit 2.

## 4. The `footage` component

A fifth component group, **media** (build_catalog's GROUPS gains it).

```js
{ at: 4, use: 'footage', src: 'checkout', from: 0, speed: 1, fit: 'cover', width: 900 }
```

- `src`: a clip directory under the project's `footage/`. `from` (seconds into the clip, default 0), `speed`
  (default 1), `fit` (`cover` | `contain`, default `cover`), `width` (the shape's width in design px; default fits the
  clip's aspect inside the stage with a margin; height follows the clip's aspect).
- Clip time = `from + (t − t0) × speed`, clamped to [0, duration]: it holds the last frame. A continuation (the next
  row with the same `src`) continues from where the previous row's clip time ended unless it sets `from`. The frame
  index is `round(clipT × fps)`: a pure function of `t`.
- Hotspots: `step:NAME` (the step's box centre in clip pixels, mapped through fit and the shape's size; the cursor
  aims where the capture clicked) and `point:X,Y` (fractions of the frame, 0..1). Geometry: the shape's radius is the
  house radius; the clip is clipped by the shape.
- The component reads clip.json synchronously at mount (the page fetches each used clip's clip.json before `ready`
  resolves).
- **Frame loading.** Frames are not all decoded up front (a minute of 1080p would not fit in memory). The engine gains
  a pending-work hook: a component's render may register a promise (`ctx.wait(promise)`); `scene.seek(t)` returns
  `Promise.all` of them (resolved immediately when none), and the template's `seek` returns it. The footage
  component sets its `<img>` to the frame and registers `img.decode()`. A small cache keeps recently used frames.
  Callers that need the exact frame await `window.seek(t)`: render.mjs already does (`page.evaluate` awaits a
  returned promise); framecheck.mjs, beat_stills.mjs and safezones/export (where they seek) are changed to await it.
  The watch and sync pages call `seek` each animation frame and do not await: they show the frame as soon as it
  decodes (playback only; never a render). Every existing component registers nothing, so their behaviour and the
  timing parity tests are unchanged.
- check_brief / validate: a `footage` row whose `src` has no clip.json is an error naming the path; `step:NAME` not in
  the clip's steps is an error; a row whose window needs more clip than there is (clip time clamps before the row
  ends) is a warning (`checkout holds its last frame for 1.2 s`). Validation in Node reads clip.json from the project.

## 5. Install, doctor, docs

- install.sh: `npx playwright install chromium webkit`; doctor.sh checks the WebKit executable like Chromium.
- CLAUDE.md (a "Footage" section; code map; workflow step), SKILL.md (capture, footage, the component),
  CATALOG.md via build_catalog (the media group), RECIPES.md unchanged, planner.md (a moment can be real-app footage:
  capture it first; never capture a private app without the user's say-so), CREDITS.md (nothing new: Playwright and
  ffmpeg are already credited; check).

## Testing

- A local fixture page (in tests) with a CSS transition, a CSS keyframe animation, a `setTimeout` that changes text at
  1.0 s and a `requestAnimationFrame` counter; captured stepped in **both** browsers: frame n's pixels at known probe
  points match the expected state at n/fps (transition midpoint colour, text before/after 1.0 s), and two runs give
  identical frames (hash).
- Steps: click/type/scroll/hover act at their frame (the page records event times through the fake clock; a named
  click's `t` and `box` are in clip.json); errors (unknown key, missing selector, bad steps file) exit 2.
- `--realtime` makes frames and clip.json with `mode: "realtime"` (duration within 10% of the steps' total).
- footage.mjs on a synthetic ffmpeg `testsrc` clip: frame count, size cap, clip.json.
- Component: frame index for t (incl. from, speed, clamp, continuation); shuffled-order seek renders identical pixels
  to in-order (purity); `step:` and `point:` hotspots; check_brief errors and the hold warning; a render of a short
  piece using footage shows the right frame at sampled times; existing render/engine tests unchanged.
- No test opens a non-local URL or any of Jack's apps.
