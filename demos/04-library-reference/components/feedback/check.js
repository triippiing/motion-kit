// check.js -- success: a tick draws on, with an optional label beside it.
import { el, textW, fade, applyFade, drawOn, cssRole, ICONS } from '../core/helpers.js';

export const meta = {
  name: 'check', group: 'feedback',
  useWhen: 'Something succeeded: paid, saved, sent, done.',
  motion: 'The tick draws on over 0.8 beat from 0.15 beat after the row starts, then the label rises in beside it. The tick sits at the left end of the shape, so it stays put while the shape morphs to fit a label. A following check row keeps the tick drawn and crossfades a changed label.',
  props: { label: ['string', ''] },
  hotspots: [],
  sounds: [],
  example: "{ at: 0, use: 'check', label: 'Payment sent' }",
  edgeCases: [{ label: '' }, { label: 'Your statement has been exported to the shared folder' }],
};

const SIZE = 112, TICK = 52, PAD_R = 56;

export function geometry(p) {
  if (!p.label) return { w: SIZE, h: SIZE, r: SIZE / 2, fill: 'surface', ink: 'ink' };
  return { w: Math.min(1200, SIZE + textW(p.label, 30) + PAD_R), h: SIZE, r: SIZE / 2, fill: 'surface', ink: 'ink' };
}

// The label for one set of props, anchored to the shape's left beside the tick.
function label(parent, p, cls, w) {
  const l = el(parent, 'span', { class: `ck-label ${cls}` }, p.label);
  Object.assign(l.style, { position: 'absolute', left: `${SIZE - 8}px`, top: '0', font: '400 28px var(--font)', lineHeight: `${SIZE}px`,
    maxWidth: `${Math.max(0, w - SIZE - PAD_R + 16)}px`, overflow: 'hidden', textOverflow: 'ellipsis' });
}

// Children sit in the layer (which fills the morphing shape), pinned to its left, so the tick is
// centred in a bare check and stays put while the shape grows to fit a label.
export function mount(root, p, ctx) {
  const slot = el(root, 'div', { class: 'ck-slot' });
  Object.assign(slot.style, { position: 'absolute', left: '0', top: '0', width: `${SIZE}px`, height: `${SIZE}px`, display: 'grid', placeItems: 'center',
    color: cssRole(ctx, 'pos', 'ink') });
  const tick = el(el(slot, 'svg:svg', { width: TICK, height: TICK, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), 'svg:path', { class: 'ck-tick', d: ICONS.check, pathLength: '1', 'stroke-dasharray': '1' });
  tick.style.strokeDashoffset = '1';
  if (ctx.continues && ctx.prev.label && ctx.prev.label !== p.label) label(root, ctx.prev, 'ck-prev', ctx.geo.w);
  if (p.label) label(root, p, 'ck-cur', ctx.geo.w);
}

export function render(root, p, ctx, t) {
  const bs = ctx.beat_sec, tick = root.querySelector('.ck-tick');
  // A continuation arrives with the tick already drawn.
  const draw = ctx.continues ? 1 : drawOn(ctx, t, ctx.t0 + 0.15 * bs, 0.8);
  tick.style.strokeDashoffset = (1 - draw).toFixed(4);
  const prev = root.querySelector('.ck-prev'), cur = root.querySelector('.ck-cur');
  if (prev) applyFade(prev, fade(ctx, t, -Infinity, ctx.t0));
  if (cur) {
    const same = ctx.continues && ctx.prev.label === p.label;
    applyFade(cur, fade(ctx, t, same ? -Infinity : ctx.t0 + (ctx.continues ? 0.05 : 0.55) * bs));
  }
}

export function hotspot() {
  return null;
}
