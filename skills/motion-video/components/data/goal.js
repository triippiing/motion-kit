// goal.js -- a savings goal: a name, a bar filling towards the target and "saved of target · percent".
import { el, frame, fmt, prog, landed, fade, applyFade, icon, cssRole } from '../core/helpers.js';

export const meta = {
  name: 'goal', group: 'data',
  useWhen: 'Progress towards a target amount: a savings pot, a fundraiser, a budget.',
  motion: 'The bar fills to saved / target over about 1.2 beats (no overshoot) while the amount and percentage count with it. Once met (`met`, or saved reaches the target) the bar turns `pos` (accent when the theme has none) and a check chip pops. A following goal row fills on from the previous amount (a changed target eases with it; from or to a zero target, or a change of more than ten times, the new target shows at once); a changed label crossfades.',
  props: { label: ['string', 'Holiday fund'], saved: ['number', 2450], target: ['number', 4000], prefix: ['string', '£'], met: ['boolean', false] },
  hotspots: ['bar'],
  sounds: [],
  example: "{ at: 0, use: 'goal', label: 'Holiday fund', saved: 2450, target: 4000 }",
  edgeCases: [{ saved: 0 }, { saved: 5200, target: 4000 }, { label: 'Emergency fund for the boiler, the car and anything else', met: true }, { saved: 150, target: 0 }],
};

const W = 760, H = 240, PX = 48, BAR_Y = 118, BAR_H = 20, BW = W - 2 * PX, CHIP = 48;
const ratio = (saved, target) => (target > 0 ? saved / target : saved > 0 ? 1 : 0);
const isMet = (p) => p.met || (p.target > 0 && p.saved >= p.target);
const clamp = (v) => Math.max(0, Math.min(1, v));

export function geometry() {
  return { w: W, h: H, r: 32, fill: 'surface', ink: 'ink' };
}

function label(f, p, cls) {
  const l = el(f, 'div', { class: `gl-label ${cls}` }, p.label);
  Object.assign(l.style, { position: 'absolute', left: `${PX}px`, top: '38px', maxWidth: `${BW - CHIP - 24}px`, font: '500 34px var(--font)', lineHeight: '44px',
    letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' });
}

export function mount(root, p, ctx) {
  const f = frame(root, 'gl', W, H);
  if (ctx.continues && ctx.prev.label !== p.label) label(f, ctx.prev, 'gl-prev');
  label(f, p, 'gl-cur');
  const chip = el(f, 'div', { class: 'gl-chip' });
  Object.assign(chip.style, { position: 'absolute', right: `${PX}px`, top: '36px', width: `${CHIP}px`, height: `${CHIP}px`, borderRadius: '50%',
    display: 'grid', placeItems: 'center', background: cssRole(ctx, 'pos', 'accent'), color: 'var(--surface)' });
  icon(chip, 'check', 28);
  const bar = el(f, 'div', { class: 'gl-bar' });
  Object.assign(bar.style, { position: 'absolute', left: `${PX}px`, top: `${BAR_Y}px`, width: `${BW}px`, height: `${BAR_H}px`, borderRadius: `${BAR_H / 2}px`,
    overflow: 'hidden', background: 'color-mix(in srgb, var(--muted) 25%, transparent)' });
  Object.assign(el(bar, 'div', { class: 'gl-fill' }).style, { position: 'absolute', left: '0', top: '0', height: '100%', borderRadius: `${BAR_H / 2}px` });
  Object.assign(el(f, 'div', { class: 'gl-text' }).style, { position: 'absolute', left: `${PX}px`, top: `${BAR_Y + BAR_H + 20}px`, font: '500 22px var(--font)',
    lineHeight: '28px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' });
}

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, prev = ctx.continues ? ctx.prev : null;
  // A fresh row fills from nothing; a continuation from the previous amount and target. Bar and text read the
  // same eased saved/target, so they agree throughout (landed: the count ends exactly on the final figures).
  const q = landed(prog(ctx, t, ctx.t0 + (prev ? 0 : 0.15) * bs, 1.2, 1));
  // The target eases only between two real targets within ten times of each other; from or to no target, or
  // across a bigger jump, the new one shows at once (easing from a tiny target reads thousands of percent).
  const ease = prev && prev.target > 0 && p.target > 0 && p.target / prev.target <= 10 && prev.target / p.target <= 10;
  const s0 = prev ? prev.saved : 0, t0 = ease ? prev.target : p.target;
  const saved = s0 + (p.saved - s0) * q, target = t0 + (p.target - t0) * q;
  const fill = clamp(ratio(saved, target)), pct = Math.round(ratio(saved, target) * 100);
  const amount = fmt(saved, { prefix: p.prefix });
  f.querySelector('.gl-text').textContent = p.target > 0 ? `${amount} of ${fmt(target, { prefix: p.prefix })} · ${pct}%` : `${amount} saved`;
  // Met: the chip pops as the fill arrives and the bar blends to pos (the same colour on a theme without pos).
  const was = prev && isMet(prev), met = isMet(p);
  const c = met ? (was ? 1 : prog(ctx, t, ctx.t0 + (prev ? 0.8 : 1.0) * bs, 0.5, 0.8)) : 0;
  const on = cssRole(ctx, 'pos', 'accent');
  const bg = on === 'var(--accent)' || c >= 1 ? (met ? on : 'var(--accent)') : c <= 0 ? 'var(--accent)' : `color-mix(in srgb, ${on} ${(c * 100).toFixed(1)}%, var(--accent))`;
  Object.assign(f.querySelector('.gl-fill').style, { width: `${(fill * BW).toFixed(2)}px`, background: bg });
  Object.assign(f.querySelector('.gl-chip').style, { opacity: String(clamp(c)), transform: `scale(${Math.max(0, 0.6 + 0.4 * c).toFixed(4)})` });
  const pe = f.querySelector('.gl-prev');
  if (pe) applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
  if (pe || !prev) applyFade(f.querySelector('.gl-cur'), fade(ctx, t, ctx.t0 + (pe ? 0.05 : 0.1) * bs));
  if (!prev) applyFade(f.querySelector('.gl-text'), fade(ctx, t, ctx.t0 + 0.2 * bs));
}

export function hotspot(name) {
  return name === 'bar' ? { x: 0, y: BAR_Y + BAR_H / 2 - H / 2 } : null;
}
