// slider.js -- a value on a track, dragged by the thumb; past the ends the track stretches like rubber.
import { el, frame, icon, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'slider', group: 'controls',
  useWhen: 'A value is dragged: volume, brightness, an amount.',
  motion: "Between a press 'down' on the thumb and the next 'up' the thumb follows the cursor. Dragged past an end (overstretch), the track stretches with a rubber band; on release the value springs back inside. A following slider row continues from the released value (write it as its `value`) and glides to its own value if that differs. The thumb hotspot aims at the row's written value.",
  props: { value: ['number', 0.4], min: ['number', 0], max: ['number', 1], overstretch: ['boolean', true], icon: ['enum:volume|none', 'volume'] },
  hotspots: ['thumb', 'track'],
  drag: ['thumb'],
  sounds: [],
  example: "{ at: 0, use: 'slider', value: 0.6 }",
  edgeCases: [{ value: 0, icon: 'none' }, { value: 1 }, { value: 150, min: 0, max: 100, overstretch: false }],
};

const TRACK = 440, THUMB = 36;
const trackLeft = (p, w) => (p.icon === 'none' ? (w - TRACK) / 2 : 112);
// A value as px along the track (clamped to the track).
const px = (p, v) => Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min || 1))) * TRACK;
// Rubber band past the ends: 60 px at most, most of it in the first 120 px of pull.
const band = (over) => 60 * (1 - Math.exp(-over / 120));
const rubber = (p, r) => (!p.overstretch ? Math.max(0, Math.min(TRACK, r)) : r > TRACK ? TRACK + band(r - TRACK) : r < 0 ? -band(-r) : r);

export function geometry() {
  return { w: 640, h: 112, r: 56, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const { w, h } = ctx.geo;
  const f = frame(root, 'sl', w, h);
  if (p.icon !== 'none') Object.assign(icon(f, p.icon, 36).style, { position: 'absolute', left: '40px', top: `${(h - 36) / 2}px` });
  const bar = { position: 'absolute', top: `${(h - 10) / 2}px`, height: '10px', borderRadius: '5px' };
  Object.assign(el(f, 'div', { class: 'sl-track' }).style, bar, { background: 'var(--muted)' });
  Object.assign(el(f, 'div', { class: 'sl-fill' }).style, bar, { background: 'var(--accent)' });
  Object.assign(el(f, 'div', { class: 'sl-thumb' }).style, { position: 'absolute', top: `${(h - THUMB) / 2}px`, width: `${THUMB}px`, height: `${THUMB}px`,
    borderRadius: '50%', background: 'var(--ink)' });
}

// Each drag: a press 'down' on the thumb and the next 'up' routed to this row.
function drags(ctx) {
  const all = [...ctx.presses].sort((a, b) => a.t - b.t);
  return all.flatMap((d, i) => (d.kind === 'down' && d.hotspot === 'thumb' ? [{ down: d, up: all.slice(i + 1).find((u) => u.kind === 'up') ?? null }] : []));
}

// The thumb's position in px along the track (outside 0..TRACK while overstretched), at t; with
// end, where it comes to rest after the row's last drag.
function position(p, ctx, t, end = false) {
  const { Springs } = ctx, omega = Springs.fromSettle(0.6 * ctx.beat_sec, 1);
  let cur = ctx.continues ? { from: px(ctx.prev, ctx.prev.value), to: px(p, p.value), t0: ctx.t0 } : { from: px(p, p.value), to: px(p, p.value), t0: -Infinity };
  const at = (c, tt) => (tt < c.t0 ? c.from : c.from === c.to ? c.to : Springs.spring(tt, { from: c.from, to: c.to, t0: c.t0, omega, zeta: 1 }).value);
  for (const { down, up } of drags(ctx)) {
    if (t < down.t) break;
    const grab = at(cur, down.t), x0 = ctx.cursorAt(down.t).x;
    const raw = (tt) => grab + ctx.cursorAt(tt).x - x0;
    if (!up) return end ? Math.max(0, Math.min(TRACK, grab)) : rubber(p, raw(t));
    if (t < up.t) return rubber(p, raw(t));
    const r = raw(up.t);
    cur = { from: rubber(p, r), to: Math.max(0, Math.min(TRACK, r)), t0: up.t };
  }
  return end ? cur.to : at(cur, t);
}

// The row as it stands after its drags: a following slider row continues from the released value.
export const endState = (p, ctx) => ({ ...p, value: p.min + (position(p, ctx, Infinity, true) / TRACK) * (p.max - p.min) });

export function render(root, p, ctx, t) {
  const f = root.firstChild, x0 = trackLeft(p, ctx.geo.w), s = position(p, ctx, t);
  const left = x0 + Math.min(0, s), right = x0 + Math.max(TRACK, s);
  Object.assign(f.querySelector('.sl-track').style, { left: `${left}px`, width: `${right - left}px` });
  Object.assign(f.querySelector('.sl-fill').style, { left: `${left}px`, width: `${Math.max(0, s)}px` });
  const held = drags(ctx).flatMap((d) => (d.up ? [d.down, d.up] : [d.down]));
  Object.assign(f.querySelector('.sl-thumb').style, { left: `${x0 + s - THUMB / 2}px`, transform: `scale(${1 + 0.2 * pressDepth(ctx, t, held)})` });
}

export function hotspot(name, p, geo) {
  const x0 = trackLeft(p, geo.w) - geo.w / 2;
  if (name === 'thumb') return { x: x0 + px(p, p.value), y: 0 };
  if (name === 'track') return { x: x0 + TRACK / 2, y: 0 };
  return null;
}
