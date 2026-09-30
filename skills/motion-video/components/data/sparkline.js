// sparkline.js -- a label and a figure beside a small line whose last point pops.
import { el, textW, frame, prog, drawOn, fade, applyFade, plotLine, morphLine, pathD } from '../core/helpers.js';

export const meta = {
  name: 'sparkline', group: 'data',
  useWhen: 'A figure with its recent trend: this week\'s spend, a streak, a balance.',
  motion: 'The label and figure rise in, the line draws on over about a beat, then the last point\'s dot pops (a small overshoot). A following sparkline row morphs the line point for point into the new points, the dot riding the last point; a changed label or figure crossfades.',
  props: { points: ['number[]', [3, 4, 3.5, 5, 4.8, 6, 7]], label: ['string', 'This week'], value: ['string', '+£410'] },
  hotspots: ['last'],
  sounds: [],
  example: "{ at: 0, use: 'sparkline', label: 'This week', value: '+£410', points: [3, 4, 3.5, 5, 4.8, 6, 7] }",
  edgeCases: [{ points: [] }, { points: [5] }, { value: '+£12,480.55', label: 'Since you started saving in 2019' }],
};

const W = 700, H = 280, PX = 48, SX = 360, SW = 292, ST = 90, SH = 100;

export function geometry() {
  return { w: W, h: H, r: 32, fill: 'surface', ink: 'ink' };
}

// The figure's type size: 72, smaller for a figure too long for its column.
const fit = (v) => Math.min(72, Math.floor((72 * (SX - PX - 24)) / Math.max(1, textW(v, 72, 600))));

function texts(f, p, cls) {
  const box = el(f, 'div', { class: `sp-texts ${cls}` });
  Object.assign(box.style, { position: 'absolute', left: `${PX}px`, top: '82px', width: `${SX - PX - 24}px` });
  const common = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' };
  Object.assign(el(box, 'div', { class: 'sp-label' }, p.label).style, common, { font: '500 18px var(--font)', lineHeight: '24px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' });
  Object.assign(el(box, 'div', { class: 'sp-value' }, p.value).style, common, { font: `600 ${fit(p.value)}px var(--font)`, lineHeight: '92px', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' });
}

export function mount(root, p, ctx) {
  const f = frame(root, 'sp', W, H);
  const changed = ctx.continues && (ctx.prev.label !== p.label || ctx.prev.value !== p.value);
  if (changed) texts(f, ctx.prev, 'sp-prev');
  texts(f, p, 'sp-cur');
  const svg = el(f, 'svg:svg', { width: SW, height: SH, viewBox: `0 0 ${SW} ${SH}`, fill: 'none', overflow: 'visible' });
  Object.assign(svg.style, { position: 'absolute', left: `${SX}px`, top: `${ST}px`, overflow: 'visible' });
  el(svg, 'svg:path', { class: 'sp-line', pathLength: '1', 'stroke-dasharray': '1', stroke: 'var(--accent)', 'stroke-width': '4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  Object.assign(el(f, 'div', { class: 'sp-dot' }).style, { position: 'absolute', left: '0', top: '0', width: '18px', height: '18px', margin: '-9px 0 0 -9px',
    borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 4px var(--surface)' });
}

const morphs = (p, ctx) => ctx.continues && ctx.prev.points.length > 0 && p.points.length > 0;

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, m = morphs(p, ctx);
  const pts = m ? morphLine(ctx.prev.points, p.points, SW, SH, prog(ctx, t, ctx.t0, 0.8, 1)) : plotLine(p.points, SW, SH);
  const line = f.querySelector('.sp-line');
  line.setAttribute('d', pathD(pts));
  line.style.strokeDashoffset = (1 - (m ? 1 : drawOn(ctx, t, ctx.t0 + 0.15 * bs, 1))).toFixed(4);
  const pe = f.querySelector('.sp-prev');
  if (pe) applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
  if (pe || !ctx.continues) applyFade(f.querySelector('.sp-cur'), fade(ctx, t, ctx.t0 + (pe ? 0.05 : 0.1) * bs));
  // The dot pops as the line reaches it; a morphing row keeps it up, riding the last point.
  const dot = f.querySelector('.sp-dot'), last = pts.at(-1);
  const s = last ? (m ? 1 : prog(ctx, t, ctx.t0 + 0.85 * bs, 0.5, 0.8)) : 0;
  Object.assign(dot.style, { opacity: s > 0 ? '1' : '0', transform: `translate(${last ? SX + last.x : 0}px,${last ? ST + last.y : 0}px) scale(${Math.max(0, s).toFixed(4)})` });
}

export function hotspot(name, p) {
  if (name !== 'last' || !p.points.length) return null;
  const q = plotLine(p.points, SW, SH).at(-1);
  return { x: SX + q.x - W / 2, y: ST + q.y - H / 2 };
}
