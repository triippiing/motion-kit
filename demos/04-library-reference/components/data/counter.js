// counter.js -- a big number that rolls from one value to another, with an optional label under it.
import { el, textW, fmt, prog, landed, fade, applyFade } from '../core/helpers.js';

export const meta = {
  name: 'counter', group: 'data',
  useWhen: 'A number changes and the change is the story: a balance growing, a count going down.',
  motion: 'The value rolls from `from` to `to` over about 1.2 beats (no overshoot), in tabular figures so the width never jitters. A following counter row rolls on from the previous row\'s `to` (its own `from` is ignored); a changed label crossfades.',
  props: { from: ['number', 0], to: ['number', 2450], prefix: ['string', ''], suffix: ['string', ''], decimals: ['number', 0], label: ['string', ''] },
  hotspots: [],
  sounds: [],
  example: "{ at: 0, use: 'counter', from: 0, to: 2450, prefix: '£', label: 'Saved this year' }",
  edgeCases: [{ from: 0, to: -1250, prefix: '£' }, { to: 1284905.5, decimals: 2, prefix: '£', label: 'Net worth' }, { from: 0, to: 98, suffix: '%', label: 'Complete' }],
};

const VALUE = 120, LABEL = 40;
const opts = (p) => ({ decimals: Math.max(0, Math.min(6, Math.round(p.decimals))), prefix: p.prefix, suffix: p.suffix });

export function geometry(p) {
  const widest = fmt(Math.max(Math.abs(p.from), Math.abs(p.to)), opts(p)) + (p.from < 0 || p.to < 0 ? '-' : '');
  return { w: Math.min(1400, Math.max(360, textW(widest, 96, 600) + 120)), h: 200 + (p.label ? LABEL : 0), r: 40, fill: 'surface', ink: 'ink' };
}

// Value and label sit centred in the shape; with a label the pair is centred together.
const valueTop = (p, h) => (h - VALUE - (p.label ? LABEL : 0)) / 2;

function label(root, p, cls, h) {
  const l = el(root, 'div', { class: `ct-label ${cls}` }, p.label);
  Object.assign(l.style, { position: 'absolute', left: '24px', right: '24px', top: `${valueTop(p, h) + VALUE}px`, textAlign: 'center',
    font: '500 22px var(--font)', lineHeight: '28px', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' });
}

export function mount(root, p, ctx) {
  const { h } = ctx.geo;
  const v = el(root, 'div', { class: 'ct-value' });
  Object.assign(v.style, { position: 'absolute', left: '0', right: '0', top: `${valueTop(p, h)}px`, textAlign: 'center',
    font: '600 96px var(--font)', lineHeight: `${VALUE}px`, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' });
  if (ctx.continues && ctx.prev.label && ctx.prev.label !== p.label) label(root, ctx.prev, 'ct-prev', geometry(ctx.prev).h);
  if (p.label) label(root, p, 'ct-cur', h);
}

// A fresh row rolls from `from`; a continuation from where the previous row ended.
export function render(root, p, ctx, t) {
  const bs = ctx.beat_sec, from = ctx.continues ? ctx.prev.to : p.from;
  const k = landed(prog(ctx, t, ctx.t0 + 0.1 * bs, 1.2, 1));
  const v = root.querySelector('.ct-value');
  const text = fmt(from + (p.to - from) * k, opts(p));
  v.textContent = text;
  // Sized for this row's own values; rolling on from a wider previous value shrinks the type to fit.
  v.style.fontSize = `${(96 * Math.min(1, (ctx.geo.w - 80) / textW(text, 96, 600))).toFixed(2)}px`;
  if (!ctx.continues) applyFade(v, fade(ctx, t, ctx.t0 + 0.05 * bs));
  const pe = root.querySelector('.ct-prev'), ce = root.querySelector('.ct-cur');
  if (pe) applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
  if (ce) applyFade(ce, fade(ctx, t, ctx.continues && ctx.prev.label === p.label ? -Infinity : ctx.t0 + (ctx.continues ? 0.05 : 0.2) * bs));
}

export function hotspot() {
  return null;
}
