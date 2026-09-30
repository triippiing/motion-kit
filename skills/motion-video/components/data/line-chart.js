// line-chart.js -- a line that draws itself on over three gridlines, with a hover dot and value tooltip.
import { el, frame, fmt, prog, drawOn, fade, applyFade, plotLine, morphLine, pathD } from '../core/helpers.js';

export const meta = {
  name: 'line-chart', group: 'data',
  useWhen: 'A value over time: a portfolio, a balance, a weekly total.',
  motion: 'The line draws on from left to right over about 1.5 beats. With `hover` set (a point index), a dot pops on that point and a tooltip shows its value 1.6 beats in. The cursor hovers too: a cursor row aimed at `point:<i>` pops the dot and tooltip of that point from its beat, and they fade out when a later cursor row aims elsewhere; a point still hovered when a following line-chart row starts stays hovered. A continuation that changes `hover` fades the old tooltip out first. A following line-chart row does not redraw: the line morphs point for point into the new points (resampled when the count changes) and its scale eases to the new range; a changed label crossfades.',
  props: { points: ['number[]', [4, 6, 5, 8, 7, 10, 9, 13]], label: ['string', 'Portfolio value'], hover: ['number', -1], format: ['object', { prefix: '£', decimals: 0 }] },
  hotspots: ['point:<i>'],
  hotspotExample: { 'point:<i>': 'point:7' },
  sounds: [],
  example: "{ at: 0, use: 'line-chart', label: 'Portfolio value', points: [4, 6, 5, 8, 7, 10, 9, 13] }",
  edgeCases: [{ points: [] }, { points: [7], hover: 0 }, { points: [2, 2, 2, 2], hover: 2 }, { label: 'Balance', points: [1200, 900, 1500, 1350, 1800], hover: 4 }],
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
  Object.assign(el(f, 'div', { class: 'lc-dot' }).style, { position: 'absolute', left: '0', top: '0', width: '20px', height: '20px', margin: '-10px 0 0 -10px',
    borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 4px var(--surface)' });
  Object.assign(el(f, 'div', { class: 'lc-tip' }).style, { position: 'absolute', left: '0', top: '0', padding: '8px 14px', borderRadius: '12px',
    background: 'var(--ink)', color: 'var(--surface)', font: '500 22px var(--font)', lineHeight: '28px', fontVariantNumeric: 'tabular-nums', transformOrigin: '50% 100%' });
}

// A continuation morphs from the previous line (if it had one); a fresh row draws on.
const morphs = (p, ctx) => ctx.continues && ctx.prev.points.length > 0 && p.points.length > 0;

const pointOf = (target) => (target && target.startsWith('point:') ? Number(target.slice(6)) : -1);

// Which point shows its dot and tooltip at t, how far it has popped (0..1) and the value it reads. In order:
// the cursor aimed at `point:<i>` (it pops from that cursor row's time and fades out ~0.2 beat after the
// cursor is aimed elsewhere; an aim carried over from the continued row is already popped); the row's `hover` from 1.6 beats in; on a continuation that changes `hover`,
// the previous row's hovered point fading out first.
function hovered(p, ctx, t, n) {
  const bs = ctx.beat_sec, shown = (i) => i >= 0 && i < n;
  let on = null, off = null;
  for (const e of ctx.targets) {
    if (e.t > t) break;
    const i = pointOf(e.target);
    if (shown(i)) { if (!on || on.i !== i) on = { i, t: e.carried ? -Infinity : e.t }; off = null; }
    else if (on) { off = { i: on.i, t: e.t }; on = null; }
  }
  if (on) return { i: on.i, k: prog(ctx, t, on.t, 0.5, 0.8), v: p.points[on.i] };
  const out = off ? 1 - prog(ctx, t, off.t, 0.2) : 0;
  if (out > 0.001) return { i: off.i, k: out, v: p.points[off.i] };
  const was = ctx.continues ? ctx.prev.hover : -1;
  if (ctx.continues && was !== p.hover && was >= 0 && was < ctx.prev.points.length && shown(was)) {
    const k = 1 - prog(ctx, t, ctx.t0, 0.2);
    if (k > 0.001) return { i: was, k, v: ctx.prev.points[was] };
  }
  if (!shown(p.hover)) return { i: -1, k: 0 };
  const kept = ctx.continues && was === p.hover && morphs(p, ctx);
  return { i: p.hover, k: prog(ctx, t, kept ? -Infinity : ctx.t0 + (ctx.continues ? 0.4 : 1.6) * bs, 0.5, 0.8), v: p.points[p.hover] };
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
  const { i, k, v } = hovered(p, ctx, t, pts.length);
  const dot = f.querySelector('.lc-dot'), tip = f.querySelector('.lc-tip');
  if (i < 0 || k <= 0.001) { // hidden: every property is still set, so the DOM depends on t alone
    Object.assign(dot.style, { opacity: '0', transform: 'none' });
    Object.assign(tip.style, { opacity: '0', transform: 'none' });
    tip.textContent = '';
    return;
  }
  const x = PX + pts[i].x, y = PT + pts[i].y, s = Math.max(0, k);
  Object.assign(dot.style, { opacity: '1', transform: `translate(${x}px,${y}px) scale(${s.toFixed(4)})` });
  const txt = fmt(v, p.format);
  tip.textContent = txt;
  const half = (txt.length * 22 * 0.56 + 28) / 2, tx = Math.max(PX + half, Math.min(PX + PW - half, x));
  Object.assign(tip.style, { opacity: String(Math.min(1, s)), transform: `translate(${tx}px,${y - 22}px) translate(-50%,-100%) scale(${(0.8 + 0.2 * s).toFixed(4)})` });
}

export function hotspot(name, p) {
  if (!name.startsWith('point:')) return null;
  const i = Number(name.slice(6));
  if (!Number.isInteger(i) || i < 0 || i >= p.points.length) return null;
  const q = plotLine(p.points, PW, PH)[i];
  return { x: PX + q.x - W / 2, y: PT + q.y - H / 2 };
}
