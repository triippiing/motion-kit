// island.js -- a dark pill at the top of an app showing live activity: an icon, a short text and a waveform.
import { el, textW, frame, icon, fade, applyFade, loopPeriod } from '../core/helpers.js';

export const meta = {
  name: 'island', group: 'chrome',
  useWhen: 'Something runs in the background and stays glanceable: music playing, a timer, a call.',
  motion: 'Four waveform bars on the right bounce continuously, each at its own rate (about 0.5 to 0.8 s a bounce, trimmed so whole bounces fit the loop), off the clock, so they run on unbroken through a following island row. The content fades in after the shape arrives; a following island row crossfades a changed icon or text while the shape resizes.',
  props: { text: ['string', 'Now playing'], icon: ['enum:music|timer|none', 'music'] },
  hotspots: ['island'],
  sounds: [],
  example: "{ at: 0, use: 'island', text: 'Now playing' }",
  edgeCases: [{ icon: 'timer', text: '12:04' }, { icon: 'none', text: 'Recording' }, { text: 'A very long status line that keeps on going' }],
};

const H = 88, DOT = 44, GAP = 16, BARS = 48, BAR_W = 6, FONT = 26;
// Nominal bounce periods (seconds, per bar): |sin| repeats every half of these.
const PERIODS = [1.1, 1.5, 1.3, 1.7];
const iconW = (p) => (p.icon === 'none' ? 0 : DOT + GAP);

export function geometry(p) {
  return { w: Math.min(1300, 88 + iconW(p) + textW(p.text, FONT) + GAP + BARS), h: H, r: H / 2, fill: 'ink', ink: 'surface' };
}

// The icon disc is accent, unless the theme's accent is the pill's own colour (the house theme), where a soft
// tint of the text colour keeps it visible.
const disc = (ctx) => (String(ctx.hex('accent')) === String(ctx.hex(ctx.geo.fill)) ? 'color-mix(in srgb, var(--surface) 16%, transparent)' : 'var(--accent)');

// Icon and text for one set of props, centred in a frame of that row's width (bars excluded).
function content(root, p, cls, ctx) {
  const f = frame(root, `is-row ${cls}`, ctx.geo.w, H);
  Object.assign(f.style, { display: 'flex', alignItems: 'center', padding: '0 44px', boxSizing: 'border-box' });
  if (p.icon !== 'none') {
    const d = el(f, 'div', { class: 'is-icon' });
    Object.assign(d.style, { flex: 'none', width: `${DOT}px`, height: `${DOT}px`, marginRight: `${GAP}px`, borderRadius: '50%', display: 'grid', placeItems: 'center',
      background: disc(ctx), color: 'var(--surface)' });
    icon(d, p.icon, 24);
  }
  Object.assign(el(f, 'span', { class: 'is-text' }, p.text).style, { minWidth: '0', flex: '1', font: `500 ${FONT}px var(--font)`, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', marginRight: `${GAP + BARS}px`, fontVariantNumeric: 'tabular-nums' });
}

export function mount(root, p, ctx) {
  if (ctx.continues && (ctx.prev.text !== p.text || ctx.prev.icon !== p.icon)) content(root, ctx.prev, 'is-prev', ctx);
  content(root, p, 'is-cur', ctx);
  const bars = frame(root, 'is-bars', ctx.geo.w, H);
  Object.assign(bars.style, { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: `${(BARS - 4 * BAR_W) / 3}px`, padding: '0 44px', boxSizing: 'border-box' });
  for (let k = 0; k < 4; k++) Object.assign(el(bars, 'div', { class: 'is-bar' }).style, { width: `${BAR_W}px`, borderRadius: `${BAR_W / 2}px`, background: 'currentColor' });
}

// Bars run off the absolute clock with loop-fitted periods, so they never jump and the seam matches.
export function render(root, p, ctx, t) {
  root.querySelectorAll('.is-bar').forEach((b, k) => {
    const h = 10 + 18 * Math.abs(Math.sin((2 * Math.PI * t) / loopPeriod(ctx, PERIODS[k])));
    b.style.height = `${h.toFixed(3)}px`;
  });
  const rows = root.querySelectorAll('.is-row'), bs = ctx.beat_sec, bars = root.querySelector('.is-bars');
  if (rows.length === 2) {
    applyFade(rows[0], fade(ctx, t, -Infinity, ctx.t0));
    applyFade(rows[1], fade(ctx, t, ctx.t0 + 0.05 * bs));
  } else if (!ctx.continues) {
    applyFade(rows[0], fade(ctx, t, ctx.t0 + 0.15 * bs));
    applyFade(bars, fade(ctx, t, ctx.t0 + 0.2 * bs));
  }
}

export function hotspot(name) {
  return name === 'island' ? { x: 0, y: 0 } : null;
}
