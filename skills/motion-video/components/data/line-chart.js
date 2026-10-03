// line-chart.js -- a line that draws itself on over three gridlines, with a hover dot and value tooltip.
import { el, frame, fmt, prog, drawOn, fade, applyFade, plotLine, morphLine, pathD } from '../core/helpers.js';

export const meta = {
  name: 'line-chart', group: 'data',
  useWhen: 'A value over time: a portfolio, a balance, a weekly total.',
  motion: 'The line draws on from left to right over about 1.5 beats. With `hover` set (a point index), a dot pops on that point and a tooltip shows its value 1.6 beats in. The cursor hovers too: a cursor row aimed at `point:<i>` pops the dot and tooltip of that point from its beat, and they fade out when a later cursor row aims elsewhere, including at another point (which pops in as the old one fades); a point still hovered when a following line-chart row starts stays hovered. A continuation that changes `hover` fades the old tooltip out first; a `hover` that takes over from a cursor hover fades in after it (leaving the point `hover` already shows keeps its tooltip up). A following line-chart row does not redraw: the line morphs point for point into the new points (resampled when the count changes) and its scale eases to the new range; a changed label crossfades.',
  props: { points: ['number[]', [4, 6, 5, 8, 7, 10, 9, 13]], label: ['string', 'Portfolio value'], hover: ['number', -1], format: ['object', { prefix: '', decimals: 0 }] },
  hotspots: ['point:<i>'],
  hotspotExample: { 'point:<i>': 'point:7' },
  sounds: [],
  example: "{ at: 0, use: 'line-chart', label: 'Portfolio value', points: [4, 6, 5, 8, 7, 10, 9, 13] }",
  edgeCases: [{ points: [] }, { points: [7], hover: 0 }, { points: [2, 2, 2, 2], hover: 2 }, { label: 'Balance', points: [1200, 900, 1500, 1350, 1800], hover: 4, format: { prefix: '£' } }],
};

const W = 900, H = 560, PX = 40, PW = 820, PT = 180, PH = 340;

export function geometry() {
  return { w: W, h: H, r: 36, fill: 'surface', ink: 'ink' };
}

function label(f, p, cls) {
  const l = el(f, 'div', { class: `lc-label ${cls}` }, p.label);
  Object.assign(l.style, { position: 'absolute', left: `${PX}px`, top: '52px', maxWidth: `${PW}px`, font: '500 34px var(--font)', lineHeight: '44px',
    letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' });
}

export function mount(root, p, ctx) {
  const f = frame(root, 'lc', W, H);
  for (let i = 0; i < 3; i++) {
    Object.assign(el(f, 'div', { class: 'lc-grid' }).style, { position: 'absolute', left: `${PX}px`, width: `${PW}px`, top: `${PT + (i * PH) / 2 - 1}px`, height: '2px',
      background: 'color-mix(in srgb, var(--muted) 20%, transparent)' });
  }
  if (ctx.continues && ctx.prev.label !== p.label) label(f, ctx.prev, 'lc-prev');
  label(f, p, 'lc-cur');
  const svg = el(f, 'svg:svg', { width: PW, height: PH, viewBox: `0 0 ${PW} ${PH}`, fill: 'none', overflow: 'visible' });
  Object.assign(svg.style, { position: 'absolute', left: `${PX}px`, top: `${PT}px`, overflow: 'visible' });
  el(svg, 'svg:path', { class: 'lc-line', pathLength: '1', 'stroke-dasharray': '1', stroke: 'var(--accent)', 'stroke-width': '4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  // The outgoing point (cursor moved from one point to another) fades out in its own dot and tip.
  const dot = { position: 'absolute', left: '0', top: '0', width: '20px', height: '20px', margin: '-10px 0 0 -10px',
    borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 4px var(--surface)' };
  const tip = { position: 'absolute', left: '0', top: '0', padding: '8px 14px', borderRadius: '12px',
    background: 'var(--ink)', color: 'var(--surface)', font: '500 22px var(--font)', lineHeight: '28px', fontVariantNumeric: 'tabular-nums', transformOrigin: '50% 100%' };
  for (const c of ['lc-dot-out', 'lc-dot']) Object.assign(el(f, 'div', { class: c }).style, dot);
  for (const c of ['lc-tip-out', 'lc-tip']) Object.assign(el(f, 'div', { class: c }).style, tip);
}

// A continuation morphs from the previous line (if it had one); a fresh row draws on.
const morphs = (p, ctx) => ctx.continues && ctx.prev.points.length > 0 && p.points.length > 0;

const pointOf = (target) => (target && target.startsWith('point:') ? Number(target.slice(6)) : -1);

// Which point shows its dot and tooltip at t (`cur`), how far it has popped (0..1) and the value it reads. In order:
// the cursor aimed at `point:<i>` (it pops from that cursor row's time and fades out ~0.2 beat after the
// cursor is aimed elsewhere; an aim carried over from the continued row is already popped); the row's `hover` from 1.6 beats in
// (or once a cursor hover has faded, so it fades in rather than snapping on); on a continuation that changes `hover`,
// the previous row's hovered point fading out first. `out` is the point the cursor just moved off to another point, fading out.
function hovered(p, ctx, t, n) {
  const shown = (i) => i >= 0 && i < n;
  let on = null, off = null, out = null;
  for (const e of ctx.targets) {
    if (e.t > t) break;
    const i = pointOf(e.target);
    if (shown(i)) {
      // The outgoing point fades from how far it had popped at the switch, so a quick hop never flashes it full.
      if (on && on.i !== i) out = { i: on.i, t: e.t, k0: Math.min(1, prog(ctx, e.t, on.t, 0.5, 0.8)) };
      if (!on || on.i !== i) on = { i, t: e.carried ? -Infinity : e.t };
      off = null;
    } else if (on) { off = { i: on.i, t: e.t }; on = null; }
  }
  const cur = current(p, ctx, t, shown, on, off);
  if (out) out = { i: out.i, k: out.k0 * (1 - prog(ctx, t, out.t, 0.2)), s: out.k0, v: p.points[out.i] };
  return { cur, out: out && out.k > 0.001 && out.i !== cur.i ? out : null };
}

const kept = (p, ctx, was) => ctx.continues && was === p.hover && morphs(p, ctx);

function current(p, ctx, t, shown, on, off) {
  const bs = ctx.beat_sec;
  if (on) return { i: on.i, k: prog(ctx, t, on.t, 0.5, 0.8), v: p.points[on.i] };
  const was = ctx.continues ? ctx.prev.hover : -1;
  const fadesPrev = ctx.continues && was !== p.hover && was >= 0 && was < ctx.prev.points.length && shown(was);
  // A waiting `hover` takes over once the 0.2 beat fade is done (its ~2% tail is cut) instead of after the tail.
  const waiting = !fadesPrev && shown(p.hover);
  const due = kept(p, ctx, was) ? -Infinity : ctx.t0 + (ctx.continues ? 0.4 : 1.6) * bs;
  // Leaving the very point `hover` already shows keeps its tooltip up rather than dipping it out and back in.
  const stays = waiting && off && off.i === p.hover && due <= off.t;
  const gone = off && !stays ? 1 - prog(ctx, t, off.t, 0.2) : 0;
  if (gone > 0.001 && !(waiting && t >= off.t + 0.2 * bs)) return { i: off.i, k: gone, v: p.points[off.i] };
  if (fadesPrev) {
    const k = 1 - prog(ctx, t, ctx.t0, 0.2);
    if (k > 0.001) return { i: was, k, v: ctx.prev.points[was] };
  }
  if (!shown(p.hover)) return { i: -1, k: 0 };
  const start = Math.max(due, off && !stays ? off.t + 0.2 * bs : -Infinity);
  return { i: p.hover, k: prog(ctx, t, start, 0.5, 0.8), v: p.points[p.hover] };
}

// Draws point h (or hides it) into one dot and tip; every property is set every frame, so the DOM depends on t alone.
// h.k is its opacity; h.s, when set, is a fixed scale (the outgoing point fades at the size it had popped to).
function show(dot, tip, h, pts, p) {
  if (!h || h.i < 0 || h.k <= 0.001) {
    Object.assign(dot.style, { opacity: '0', transform: 'none' });
    Object.assign(tip.style, { opacity: '0', transform: 'none' });
    tip.textContent = '';
    return;
  }
  const fadeOnly = h.s !== undefined;
  const x = PX + pts[h.i].x, y = PT + pts[h.i].y, s = Math.max(0, h.k), sc = fadeOnly ? h.s : s;
  Object.assign(dot.style, { opacity: fadeOnly ? String(Math.min(1, s)) : '1', transform: `translate(${x}px,${y}px) scale(${sc.toFixed(4)})` });
  const txt = fmt(h.v, p.format);
  tip.textContent = txt;
  const half = (txt.length * 22 * 0.56 + 28) / 2, tx = Math.max(PX + half, Math.min(PX + PW - half, x));
  Object.assign(tip.style, { opacity: String(Math.min(1, s)), transform: `translate(${tx}px,${y - 22}px) translate(-50%,-100%) scale(${(0.8 + 0.2 * sc).toFixed(4)})` });
}

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec;
  const m = morphs(p, ctx);
  const pts = m ? morphLine(ctx.prev.points, p.points, PW, PH, prog(ctx, t, ctx.t0, 0.8, 1)) : plotLine(p.points, PW, PH);
  const line = f.querySelector('.lc-line');
  line.setAttribute('d', pathD(pts));
  line.style.strokeDashoffset = (1 - (m ? 1 : drawOn(ctx, t, ctx.t0 + 0.15 * bs, 1.5))).toFixed(4);
  const pe = f.querySelector('.lc-prev');
  if (pe) {
    applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
    applyFade(f.querySelector('.lc-cur'), fade(ctx, t, ctx.t0 + 0.05 * bs));
  } else if (!ctx.continues) applyFade(f.querySelector('.lc-cur'), fade(ctx, t, ctx.t0 + 0.1 * bs));
  const { cur, out } = hovered(p, ctx, t, pts.length);
  show(f.querySelector('.lc-dot'), f.querySelector('.lc-tip'), cur, pts, p);
  show(f.querySelector('.lc-dot-out'), f.querySelector('.lc-tip-out'), out, pts, p);
}

export function hotspot(name, p) {
  if (!name.startsWith('point:')) return null;
  const i = Number(name.slice(6));
  if (!Number.isInteger(i) || i < 0 || i >= p.points.length) return null;
  const q = plotLine(p.points, PW, PH)[i];
  return { x: PX + q.x - W / 2, y: PT + q.y - H / 2 };
}
