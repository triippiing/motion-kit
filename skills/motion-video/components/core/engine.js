// engine.js -- turns the states/cursor tables into a scene whose seek(t) is pure.
// Rows with `use` are library components; rows with `name` are custom states whose
// content lives in `.layer[data-state=name]` and the page's `content` functions,
// exactly as before the library existed.
// Markers: a row's `at` may name a marker from song.json's top-level `markers` (`at: 'drop'`, optionally
// `offset` in beats, e.g. `{ at: 'drop', offset: -0.5 }`). createScene resolves both tables first (timing.js
// resolveRows), so everything after, components included, sees a numeric `at` (the marker's exact beat plus the
// offset) and `row.marker` holding the name; `offset` is gone. A bad marker throws like any validation error.
// createScene options beyond the tables: loop (default true; false for a one-off piece whose last row need not
// repeat the first) and designScale (the camera scale K; default min(W, H) / 1440, never below 1). The template
// reads both from project.json. clips: { src: clip.json object } for the footage rows' clips (the template fetches
// footage/<src>/clip.json for each before ready); default {}, so a row whose clip is missing is a validation error.
//
// Component module contract:
//   meta = { name, group, useWhen, motion, example, props: { key: [typeSpec, default] },
//            hotspots: [..], sounds: [..], edgeCases: [rowObjects],
//            hotspotExample?: { 'tab:<item>': 'tab:Month' },  // docs only; validate/engine ignore it
//            drag?: ['thumb'],   // hotspots a press 'down' drags (the component reads cursorAt); validate warns
//                                // when a drag on one never moves the cursor between 'down' and 'up'
//            choices?: { active: 'items' } }  // selection props and the list prop each picks from; strict
//                                // validation (check_brief) warns when a selection names a value not in its list
//   geometry(props, ctx) -> { w, h, r, fill, ink }; mount(el, props, ctx); render(el, props, ctx, t);
//   hotspot(name, props, geo, ctx) -> { x, y } | null (offset from shape centre; ctx is the row's own ctx).
//   hotspot is also called with ctx = {} (validation, and choosing which row a cursor row aims at, happen
//   before any row has a ctx): whether it returns null must not depend on ctx, and any ctx read is guarded
//   (ctx?.continues). A cursor row aims at the first candidate row on which its hotspot resolves.
//   optional check(props, info) -> { errors, warnings } and checkTarget(name, props, { clips, strict, row, at }) ->
//   reason | { warning } | null: rules that need data beyond the row (footage's clip), run by validate (a reason is
//   an error; a { warning } is reported as written, strict only; row and at are the aimed-at row and its beat). info = { clips, strict, at (the row's
//   beat, for messages), row, beatT (null when the caller gave none), t1 (seconds; Infinity when unknown), continues,
//   prev, seam (the last row of a loop) }; clips is undefined when the caller has none (no project), and then there is
//   nothing to check against. In validation this info is also the ctx endState gets: a partial ctx (clips, beatT,
//   row, t1, continues, prev only), so anything check, checkTarget or endState reads must be among those.
//   optional sfx(props, ctx); optional endState(props, ctx) -> props (pure: the props as they stand
//   once that row's presses have happened, e.g. a toggle flipped by a press). It may add private keys prefixed
//   `_` (e.g. player's `_written`) that only the next row of the same component reads from ctx.prev.
//   ctx = { beatT, beat_sec, Springs, spring, theme, hex, stage, loop_sec, t0, t1, presses, targets, cursorAt, geo, row,
//           prev, continues, settled, clips, wait, shapeAt }   settled: true for row 0, shown with its entrance long finished.
//   shapeAt(t) -> { w, h }: the live shape's size at t in design px (the engine's SHAPE spring tracks, what seek lays
//   #shape out at; pure). geo is the row's target; shapeAt is where the morph has got to, so a component can keep its
//   content pinned to the moving outline. For render (and anything called from it) only: validation's partial ctx has
//   none (call it as ctx.shapeAt?.(t)), and it must not be called while the scene is being built (geometry, hotspot,
//   endState), before the tracks exist.
//   clips: the createScene option (geometry gets it too, through the same base ctx).
//   targets: every cursor row aimed at one of this row's hotspots, as { t, target, press } (t in seconds,
//   press true/'down'/'up' or null), plus every other cursor row inside the row's window as { t, target: null,
//   press } (the cursor moved elsewhere), in time order. A component that reacts to where the cursor is aimed
//   (a chart point's hover) reads the latest entry at or before t. A continuation's list starts with the
//   continued row's latest entry at or before t0, re-timed to t0 as { t: t0, target, press: null, carried: true }:
//   treat a carried aim as already settled so the hover holds across the row change.
//   loop_sec: the loop's length in seconds when the piece loops, else null. Periodic motion (spinners,
//   pulses) takes its period from helpers' loopPeriod(ctx, sec) so a whole number of cycles fits the loop.
//   wait(promise): for media that must load before the frame is exact (a video frame decoding). render may call
//   it; seek(t) returns Promise.all of what was registered during that seek (a resolved promise when nothing was),
//   and callers that need the exact frame await it. Never for timing: render must still be a pure function of t.
// Continuations: a component row directly after a row with the same `use` continues it.
// Its layer does not crossfade: at t0 the previous row's layer steps out and this one
// steps in, and ctx.prev holds the previous row's END state (its endState, else its resolved
// props; ctx.continues true) so render can animate FROM where that row left off and skip its
// entrance. Otherwise prev is null and continues false. The shape's geometry still morphs
// between the rows as usual.
// A drag (press 'down' ... 'up') must not span a row change; validate rejects it.
// Cursor rows: x/y or target (+ dx/dy), press (true, 'down', 'up'), sound ('key') and hide. hide: true fades the
// cursor out from that row's beat (a quarter beat, critically damped: no overshoot, opacity clamped to [0, 1]); the
// next row without it fades it back in from its own beat. A hidden first row starts hidden. Hiding changes only
// visibility: the cursor still follows its path, so presses, targets and inspect(t).cursor x/y are unchanged. A
// hidden row cannot press (validate rejects it). inspect(t) -> { cursor: { x, y, opacity } }.
// The pointer moves on a critically damped spring that settles in 0.8 beat, except into a drag: a move that starts too
// close before a press 'down' on a meta.drag hotspot, or before its 'up', is sped up so it lands where it is aimed (to
// about 0.5 design px per move), and a drag component's thumb starts under the cursor. The speed-up is capped at 4x the
// house spring (a 0.2 beat settle): a move of a few hundred px given less than about 0.3 beat arrives a little short
// rather than snapping. Strict validation (check_brief) warns when a drag's move gets less than half a beat.
import { validate, targetRow, pressRow, lookup, rowProps, rowGeo, markerMessage, isHotspotDrag } from './validate.js';
import { resolveRows } from './timing.js';
import { el } from './helpers.js';
import { shakeOffset, mountBadges, renderBadges } from '../modifiers.js';

export function createScene(o) {
  const { extraSfx = [], content = {}, song, stage, theme, beatT, Springs, dom, registry, loop = true, designScale, clips = {} } = o;
  // Marker rows become beat numbers before anything else reads the tables.
  const rs = resolveRows(o.states, song), rc = resolveRows(o.cursor, song);
  const bad = [...rs.errors.map((e) => markerMessage(e, 'states()')), ...rc.errors.map((e) => markerMessage(e, 'cursor()'))];
  if (bad.length) throw new Error('motion-kit: ' + bad.join('\n  - '));
  const states = rs.rows, cursor = rc.rows;
  const { errors } = validate({ states, cursor, registry, song, theme, loop, clips, beatT });
  if (errors.length) throw new Error('motion-kit: ' + errors.join('\n  - '));
  const { track, fromSettle } = Springs;
  const bs = song.beat_sec;
  const sp = song.rules?.spring ?? { zeta: 0.85, settle_sec: 0.6 * bs };
  const SHAPE = { omega: fromSettle(sp.settle_sec, sp.zeta), zeta: sp.zeta };
  const CAM = { omega: fromSettle(bs, 1), zeta: 1 };
  const PTR = { omega: fromSettle(0.8 * bs, 1), zeta: 1 };
  const HIDE = { omega: fromSettle(0.25 * bs, 1), zeta: 1 };
  const v = (tr, t) => track(t, tr).value;
  const HEX = /^#[0-9a-f]{6}$/i;
  const hex = (c) => {
    const h = theme[c] ?? c;
    if (!HEX.test(h)) throw new Error(`unknown colour "${c}" (theme roles: ${Object.keys(theme).filter((k) => HEX.test(theme[k])).join(', ')}; or #rrggbb)`);
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const CX = stage.width / 2, CY = stage.height / 2;
  // Pending work registered by renders (ctx.wait) during the current seek; a fresh list each seek.
  let pending = [];
  const base = { beatT, beat_sec: bs, Springs, spring: SHAPE, theme, hex, stage, loop_sec: loop ? (song.loop?.duration_sec ?? null) : null, clips,
    wait: (p) => { pending.push(p); },
    // The live shape's size at t (the SHAPE w/h tracks below, read only once they exist: at seek, never while sizing).
    shapeAt: (t) => ({ w: v(tracks.w, t), h: v(tracks.h, t) }) };

  // ---- rows: props with defaults, geometry, time window
  const rows = states.map((row, i) => {
    const comp = row.use ? lookup(registry, row.use) : null;
    return { i, row, comp, props: comp ? rowProps(row, comp) : null, t0: beatT(row.at) };
  });
  rows.forEach((r, i) => { r.t1 = rows[i + 1] ? rows[i + 1].t0 : Infinity; });
  const custom = { geometry: () => ({}) };
  for (const r of rows) r.geo = rowGeo(r.row, r.comp ?? custom, r.props, base);

  // A component row continues the one before it when both use the same component.
  const continues = (i) => i > 0 && !!rows[i].comp && rows[i].row.use === rows[i - 1].row.use;

  // ---- presses: routed by target name alone, so every row knows its presses before any hotspot resolves
  for (const r of rows) r.presses = [];
  for (const c of cursor) {
    if (c.press === undefined) continue;
    pressRow(rows, c).presses.push({ t: beatT(c.at), kind: c.press, hotspot: c.target ?? null });
  }

  // ---- targets: each cursor row goes to the row it aims at; to every other row whose window it falls in, it
  // means the cursor is aimed elsewhere (target null).
  for (const r of rows) r.targets = [];
  for (const c of cursor) {
    const t = beatT(c.at), to = c.target ? targetRow(rows, c) : null;
    for (const r of rows) {
      if (r === to) r.targets.push({ t, target: c.target, press: c.press ?? null });
      else if (t >= r.t0 && t < r.t1) r.targets.push({ t, target: null, press: c.press ?? null });
    }
  }
  for (const r of rows) r.targets.sort((a, b) => a.t - b.t);
  // A continuation starts where the cursor was aimed in the row it continues: that row's latest entry at or
  // before t0, re-timed to t0 and marked carried (no press), so a hover holds across the row change.
  rows.forEach((r, i) => {
    if (!continues(i)) return;
    const last = rows[i - 1].targets.filter((e) => e.t <= r.t0).at(-1);
    if (last) r.targets.unshift({ t: r.t0, target: last.target, press: null, carried: true });
  });

  // ---- row contexts, built in order on first use: a continuation's prev is the previous row's end state,
  // which may depend on the cursor (a slider's release point), so the pointer is read from the cursor
  // rows resolved so far until all of them are.
  const mk = (list, get, opts) => ({ from: get(list[0]), changes: list.slice(1).map((x) => ({ t: beatT(x.at), to: get(x) })), ...opts });
  // A drag lands where it is aimed: the pointer must be on the hotspot when its press 'down' fires (a drag
  // component follows the cursor from where it was at the down) and on its release point at the 'up'. The
  // pointer spring takes 0.8 beat to settle, so a shorter approach would press short of the thumb and carry
  // that gap through the whole drag. Each pointer move that starts before a landing time is sped up just
  // enough to be within about LAND design px of its target by then, but never past MAX_SPEEDUP times the house
  // spring (a snap reads worse than a short miss); moves with time to spare keep the house spring.
  const LAND = 0.5, MAX_SPEEDUP = 4;
  const landings = cursor.flatMap((c, i) => {
    if (c.press !== 'down' || !isHotspotDrag(rows, c)) return [];
    const up = cursor.slice(i + 1).find((u) => u.press === 'up');
    return up ? [beatT(c.at), beatT(up.at)] : [beatT(c.at)];
  }).sort((a, b) => a - b);
  // Critically damped: what is left of a move of `dist` after dt is dist * (1 + u) * e^-u, u = omega * dt.
  const land = (dt, dist) => {
    if (dist <= LAND) return 0;
    let lo = 0, hi = 100;
    for (let k = 0; k < 60; k++) { const u = (lo + hi) / 2; if (dist * (1 + u) * Math.exp(-u) > LAND) lo = u; else hi = u; }
    return hi / dt;
  };
  // The pointer tracks (cx, cy) for cursor rows `list`: one omega per move, shared by x and y so the path stays straight.
  const pointer = (list) => {
    const changes = list.slice(1).map((c, k) => {
      const t = beatT(c.at), L = landings.find((l) => l > t);
      const dist = Math.max(Math.abs(c.x - list[k].x), Math.abs(c.y - list[k].y));
      return { t, x: c.x, y: c.y, omega: L === undefined ? PTR.omega : Math.min(MAX_SPEEDUP * PTR.omega, Math.max(PTR.omega, land(L - t, dist))) };
    });
    const tr = (a) => ({ from: list[0][a], changes: changes.map((c) => ({ t: c.t, to: c[a], omega: c.omega })), ...PTR });
    return { cx: tr('x'), cy: tr('y') };
  };
  const C = [];
  let ptr = null;
  const cursorLocal = (t) => {
    const src = ptr ?? (C.length ? pointer(C) : null);
    return src ? { x: v(src.cx, t), y: v(src.cy, t) } : { x: 0, y: 0 };
  };
  const endOf = (j) => { const r = rows[j]; return r.comp.endState ? r.comp.endState(r.props, ctxOf(j)) : r.props; };
  function ctxOf(i) {
    const r = rows[i];
    if (!r.ctx) {
      r.ctx = { ...base, t0: i === 0 ? -1e6 : r.t0, t1: r.t1, presses: r.presses, targets: r.targets, cursorAt: cursorLocal, geo: r.geo, row: r.row,
        prev: null, continues: continues(i), settled: i === 0 };
      if (r.ctx.continues) r.ctx.prev = endOf(i - 1);
    }
    return r.ctx;
  }

  // ---- cursor: resolve targets to shape-centre design px, once, in order
  for (const c of cursor) {
    if (!c.target) { C.push(c); continue; }
    const r = targetRow(rows, c);
    const p = r.comp.hotspot(c.target, r.props, r.geo, ctxOf(r.i));
    if (!p) throw new Error(`motion-kit: hotspot "${c.target}" did not resolve on ${r.row.use} at beat ${r.row.at}`);
    C.push({ ...c, x: p.x + (c.dx ?? 0), y: p.y + (c.dy ?? 0) });
  }

  // ---- tracks (same maths as the pre-library template)
  const down = (c) => ({ t: beatT(c.at) - 0.08 * bs, to: 0.82 });
  const up = (c, d = 0) => ({ t: beatT(c.at) + d * bs, to: 1 });
  const G = rows.map((r) => ({ ...r.geo, at: r.row.at }));
  // Design scale: components are sized for a 1440 stage. On a bigger stage K = min(W, H) / 1440 scales the camera
  // (and so the cursor) so the piece keeps its proportions, just sharper; smaller stages keep K = 1 (the zoom below
  // already fits the shape to them). project.json `designScale` overrides K.
  if (designScale !== undefined && !(typeof designScale === 'number' && Number.isFinite(designScale) && designScale > 0))
    throw new Error(`motion-kit: designScale in project.json must be a positive number, got ${typeof designScale === 'string' ? JSON.stringify(designScale) : String(designScale)}`);
  const K = designScale ?? Math.max(1, Math.min(stage.width, stage.height) / 1440);
  const zoom = (s) => K * Math.min(2.4, Math.max(1, (0.6 * Math.min(stage.width, stage.height) / K) / Math.max(s.w, s.h)));
  const tracks = {
    w: mk(G, (s) => s.w, SHAPE), h: mk(G, (s) => s.h, SHAPE), r: mk(G, (s) => s.r, SHAPE),
    fill: [0, 1, 2].map((k) => mk(G, (s) => hex(s.fill)[k], SHAPE)),
    ink: [0, 1, 2].map((k) => mk(G, (s) => hex(s.ink)[k], SHAPE)),
    zoom: mk(G, zoom, CAM),
    ...pointer(C),
    // cursor opacity: a change only where hide flips, so consecutive hidden rows stay hidden
    show: { from: C[0].hide ? 0 : 1, ...HIDE,
      changes: C.flatMap((c, i) => (i && !c.hide !== !C[i - 1].hide ? [{ t: beatT(c.at), to: c.hide ? 0 : 1 }] : [])) },
    press: { from: 1, omega: fromSettle(0.15 * bs, 1), zeta: 1,
      changes: C.filter((c) => c.press).flatMap((c) => (c.press === 'down' ? [down(c)] : c.press === 'up' ? [up(c)] : [down(c), up(c, 0.1)])) },
  };
  ptr = { cx: tracks.cx, cy: tracks.cy };
  for (const r of rows) ctxOf(r.i);

  // ---- layers: one per component row; custom layers grouped by state name as before
  const enter = fromSettle(0.5 * bs, 1), exit = fromSettle(0.2 * bs, 1);
  const step = fromSettle(0.001, 1); // continuations swap layers on t0 with no fade
  const layers = [];
  rows.forEach((r, i) => {
    if (!r.comp) return;
    const e = el(dom.shape, 'div', { class: `layer c-${r.row.use}`, 'data-row': String(i) });
    r.comp.mount(e, r.props, r.ctx);
    const changes = [];
    if (i > 0) changes.push(continues(i) ? { t: r.t0, to: 1, omega: step } : { t: r.t0 + 0.15 * bs, to: 1, omega: enter });
    if (rows[i + 1]) changes.push({ t: r.t1, to: 0, omega: continues(i + 1) ? step : exit });
    layers.push({ el: e, r, tr: { from: i === 0 ? 1 : 0, changes, omega: enter, zeta: 1 } });
  });
  for (const e of dom.shape.querySelectorAll('.layer[data-state]')) {
    const name = e.dataset.state, changes = [];
    rows.forEach((r, i) => { if (r.row.name === name && i > 0) changes.push({ t: r.t0 + 0.15 * bs, to: 1, omega: enter }); });
    rows.forEach((r, i) => { if (r.row.name === name && rows[i + 1] && rows[i + 1].row.name !== name) changes.push({ t: rows[i + 1].t0, to: 0, omega: exit }); });
    layers.push({ el: e, r: null, tr: { from: rows[0].row.name === name ? 1 : 0, changes, omega: enter, zeta: 1 } });
  }
  const badges = mountBadges(dom.camera, rows, base);

  // ---- sounds
  const sfx = [
    ...C.filter((c) => c.press === true || c.press === 'down').map((c) => ({ beat: c.at, file: 'sfx/click.wav', gain: 0.7 })),
    ...C.filter((c) => c.sound === 'key').map((c) => ({ beat: c.at, file: 'sfx/key.wav', gain: 0.6 })),
    ...rows.flatMap((r) => (r.comp?.sfx ? r.comp.sfx(r.props, r.ctx) : [])),
    ...extraSfx,
  ];

  function since(name, t) {
    let start = null;
    for (const r of rows) if (r.row.name === name && r.t0 <= t) start = r.t0;
    return start === null ? 0 : t - start;
  }

  function seek(t) {
    pending = [];
    const w = v(tracks.w, t), h = v(tracks.h, t), rr = v(tracks.r, t), z = v(tracks.zoom, t);
    const dx = shakeOffset(rows, t, base);
    const rgb = (arr) => `rgb(${arr.map((tr) => Math.round(v(tr, t))).join(',')})`;
    dom.camera.style.transform = `translate(${CX}px,${CY}px) scale(${z}) translate(${-CX}px,${-CY}px)`;
    Object.assign(dom.shape.style, { left: `${CX - w / 2 + dx}px`, top: `${CY - h / 2}px`, width: `${w}px`, height: `${h}px`,
      borderRadius: `${Math.min(rr, w / 2, h / 2)}px`, background: rgb(tracks.fill), color: rgb(tracks.ink) });
    for (const L of layers) {
      const op = Math.max(0, Math.min(1, v(L.tr, t)));
      Object.assign(L.el.style, { opacity: op, filter: op > 0.999 ? 'none' : `blur(${(1 - op) * 10}px)`, transform: `scale(${0.96 + 0.04 * op})` });
      if (L.r) L.r.comp.render(L.el, L.r.props, L.r.ctx, t);
    }
    for (const name in content) content[name](t);
    renderBadges(badges, t, { w, h, dx, CX, CY, base });
    const p = v(tracks.press, t);
    const x = CX + v(tracks.cx, t), y = CY + v(tracks.cy, t);
    dom.cursor.style.transform = `translate(${x - 7}px,${y - 4}px) scale(${(p * K) / z})`;
    dom.cursor.style.opacity = shown(t);
    return Promise.all(pending);
  }

  const shown = (t) => Math.max(0, Math.min(1, v(tracks.show, t)));
  const inspect = (t) => { const z = v(tracks.zoom, t); return { cursor: { x: CX + v(tracks.cx, t) * z, y: CY + v(tracks.cy, t) * z, opacity: shown(t) } }; };
  return { seek, inspect, since, sfx, rows, cursorRows: C };
}
