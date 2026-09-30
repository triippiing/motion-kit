// status.js -- a status pill: a coloured dot and a short text; collapses to just the dot.
import { el, fade, applyFade, prog, textW, cssRole, loopPeriod } from '../core/helpers.js';

export const meta = {
  name: 'status', group: 'feedback',
  useWhen: 'A live state is shown: connected, syncing, offline, a build passing or failing.',
  motion: 'Warn and error dots pulse (1 to 1.25 and back about every 1.2 s, trimmed so whole pulses fit the loop); ok holds still. A following status row morphs: collapsing or expanding folds the text away or brings it in, a new level blends the dot colour and eases the pulse in or out, and new text crossfades.',
  props: { level: ['enum:ok|warn|error', 'ok'], text: ['string', 'Connected'], collapsed: ['boolean', false] },
  hotspots: [],
  sounds: [],
  example: "{ at: 0, use: 'status', level: 'ok', text: 'Connected' }",
  edgeCases: [{ level: 'warn', text: 'Reconnecting' }, { level: 'error', collapsed: true }, { level: 'error', text: 'Payment failed: your card was declined by the bank' }],
};

const DOT = 16, TEXT_X = 64;
const colour = (ctx, level) => (level === 'ok' ? cssRole(ctx, 'pos', 'accent') : level === 'warn' ? 'var(--accent)' : cssRole(ctx, 'neg', 'ink'));
const pulses = (level) => (level === 'ok' ? 0 : 1);

export function geometry(p) {
  if (p.collapsed) return { w: 56, h: 56, r: 28, fill: 'surface', ink: 'ink' };
  return { w: Math.min(1200, 56 + 20 + textW(p.text, 26) + 32), h: 64, r: 32, fill: 'surface', ink: 'ink' };
}

function text(parent, p, cls, w) {
  const s = el(parent, 'span', { class: `st-text ${cls}` }, p.text);
  Object.assign(s.style, { position: 'absolute', left: `${TEXT_X}px`, top: '0', height: '100%', display: 'flex', alignItems: 'center',
    font: '500 22px var(--font)', maxWidth: `${Math.max(0, w - TEXT_X - 24)}px`, overflow: 'hidden', textOverflow: 'ellipsis' });
}

// Children are pinned to the left of the layer (which fills the morphing shape): the dot sits in a
// square slot as tall as the shape, so it stays centred in the round end while the pill folds.
export function mount(root, p, ctx) {
  const slot = el(root, 'div', { class: 'st-slot' });
  Object.assign(slot.style, { position: 'absolute', left: '0', top: '0', height: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center' });
  Object.assign(el(slot, 'div', { class: 'st-dot' }).style, { width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%' });
  const prev = ctx.continues ? ctx.prev : null;
  const w = Math.max(ctx.geo.w, prev ? geometry(prev).w : 0);
  if (prev && !prev.collapsed && (p.collapsed || prev.text !== p.text)) text(root, prev, 'st-prev', w);
  if (!p.collapsed) text(root, p, 'st-cur', ctx.geo.w);
}

export function render(root, p, ctx, t) {
  const bs = ctx.beat_sec, prev = ctx.continues ? ctx.prev : null;
  // Level changes blend over ~0.4 beat from the row's start.
  const k = prev && prev.level !== p.level ? prog(ctx, t, ctx.t0, 0.4) : 1;
  const c = colour(ctx, p.level);
  const amp = prev ? pulses(prev.level) + (pulses(p.level) - pulses(prev.level)) * k : pulses(p.level);
  const pulse = amp * 0.25 * (1 - Math.cos((2 * Math.PI * t) / loopPeriod(ctx, 1.2))) / 2;
  Object.assign(root.querySelector('.st-dot').style, {
    background: k > 0.999 ? c : `color-mix(in srgb, ${c} ${(k * 100).toFixed(1)}%, ${colour(ctx, prev.level)})`,
    transform: `scale(${(1 + pulse).toFixed(4)})`,
  });
  const pe = root.querySelector('.st-prev'), ce = root.querySelector('.st-cur');
  if (pe) applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
  if (ce) {
    const kept = prev && !prev.collapsed && prev.text === p.text;
    applyFade(ce, fade(ctx, t, kept ? -Infinity : ctx.t0 + (prev ? 0.1 : 0.15) * bs));
  }
}

export function hotspot() {
  return null;
}
