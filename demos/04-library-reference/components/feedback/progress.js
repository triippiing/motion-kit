// progress.js -- a labelled bar that fills to a value, with the percentage counting alongside.
import { el, frame, prog, fmt, fade, applyFade } from '../core/helpers.js';

export const meta = {
  name: 'progress', group: 'feedback',
  useWhen: 'Something advances towards done: an upload, an import, a goal.',
  motion: 'The fill grows from empty to the value over about a beat (no overshoot) and the percentage counts with it. A following progress row carries on from the previous value, so a chain of rows reads as one bar filling in steps; a changed label crossfades.',
  props: { value: ['number', 0.62], label: ['string', 'Uploading'] },
  hotspots: [],
  sounds: [],
  example: "{ at: 0, use: 'progress', value: 0.62, label: 'Uploading' }",
  edgeCases: [{ value: 0, label: 'Waiting' }, { value: 1, label: 'Done' }, { value: 0.35, label: 'Importing 1,284 transactions from your bank' }],
};

const W = 640, H = 120, BAR = 560, BAR_H = 12, X = (W - BAR) / 2, TOP = 30, BAR_Y = 74;
const clamp = (v) => Math.max(0, Math.min(1, v));

export function geometry() {
  return { w: W, h: H, r: 28, fill: 'surface', ink: 'ink' };
}

function label(parent, p, cls) {
  const l = el(parent, 'span', { class: `pg-label ${cls}` }, p.label);
  Object.assign(l.style, { position: 'absolute', left: `${X}px`, top: `${TOP - 14}px`, font: '500 22px var(--font)', lineHeight: '28px',
    maxWidth: `${BAR - 110}px`, overflow: 'hidden', textOverflow: 'ellipsis' });
}

export function mount(root, p, ctx) {
  const f = frame(root, 'pg', W, H);
  if (ctx.continues && ctx.prev.label !== p.label) label(f, ctx.prev, 'pg-prev');
  label(f, p, 'pg-cur');
  const pct = el(f, 'span', { class: 'pg-pct' });
  Object.assign(pct.style, { position: 'absolute', right: `${X}px`, top: `${TOP - 14}px`, font: '500 22px var(--font)', lineHeight: '28px',
    fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' });
  const bar = el(f, 'div', { class: 'pg-bar' });
  Object.assign(bar.style, { position: 'absolute', left: `${X}px`, top: `${BAR_Y}px`, width: `${BAR}px`, height: `${BAR_H}px`, borderRadius: `${BAR_H / 2}px`,
    overflow: 'hidden', background: 'color-mix(in srgb, var(--muted) 30%, transparent)' });
  Object.assign(el(bar, 'div', { class: 'pg-fill' }).style, { position: 'absolute', left: '0', top: '0', height: '100%', borderRadius: `${BAR_H / 2}px`, background: 'var(--accent)' });
}

// The fill fraction at t: a fresh row fills from empty as it arrives; a continuation from the previous value.
function level(p, ctx, t) {
  const from = ctx.continues ? clamp(ctx.prev.value) : 0, to = clamp(p.value);
  const k = prog(ctx, t, ctx.t0 + (ctx.continues ? 0 : 0.15 * ctx.beat_sec), 1, 1);
  return from + (to - from) * k;
}

export function render(root, p, ctx, t) {
  const f = root.firstChild, v = level(p, ctx, t);
  f.querySelector('.pg-fill').style.width = `${(v * BAR).toFixed(2)}px`;
  f.querySelector('.pg-pct').textContent = fmt(v * 100, { suffix: '%' });
  const prev = f.querySelector('.pg-prev');
  if (prev) {
    applyFade(prev, fade(ctx, t, -Infinity, ctx.t0));
    applyFade(f.querySelector('.pg-cur'), fade(ctx, t, ctx.t0 + 0.05 * ctx.beat_sec));
  }
}

export function hotspot() {
  return null;
}
