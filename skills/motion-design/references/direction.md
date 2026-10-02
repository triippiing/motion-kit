# Direction

Adapted from the open prompt template by zero ([@twoclipping](https://x.com/twoclipping)).
The look, build rules and gotchas below are theirs, lightly generalised. Credit them when you share work made this way.

## Look
- Dribbble-level UI motion. **One shape, never cut**: every state is the same element
  morphing its size, radius and colour while its content swaps with a short blur.
- A cursor drives every change with real clicks and drags.
- Light warm-gray canvas (#ECEAE6), black and white components, one UI font (Geist).
  Project promos swap in the project's own palette and font.
- Springs everywhere, a tiny overshoot at most (ζ 0.85 from song.json; ζ 1 for camera and cursor).
- The camera zooms so each state fills the frame.
- The last frame is the first frame, so it loops.

## Banned
Bouncy easing, particle bursts, glows, gradients on UI chrome, mismatched icon strokes
(use one stroke width throughout), dead time (a beat where nothing happens), anything
that looks like a template.

## Build rules (enforced by motion-video)
1. One HTML file, every style computed from time inside `seek(t)`: no CSS transitions,
   no timers, no state carried between frames.
2. Springs are closed-form step responses; a value that retargets is the sum of one
   spring per change (`Springs.track`), so it stays a pure function of time.
3. Two-edge indicators (tabs, toggle knobs): each edge rides its own spring, the leading
   edge faster, so it stretches ahead of the trailing one.
4. Drags are direct manipulation: while held, the value comes from the cursor position;
   on release it springs back from wherever it was.
5. Every UI sound sits on its beat's measured `cue_t`.
6. Render 4 subframes per frame blended with tmix; 60fps.
7. Review one still per beat (contact sheet) before the full render.

## Gotchas
- Never put `will-change` on anything the camera scales: text renders blurry.
- Text that swaps inside a morphing container needs its own enter and exit timing, or it overlaps.
- Make the last frame identical to the first, cursor position and speed included, or the loop stutters.
