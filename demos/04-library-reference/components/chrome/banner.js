// banner.js -- a push notification: an icon disc, the app name, a title and a line of body.
import { el, frame, icon, prog, landed, pressesOn, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'banner', group: 'chrome',
  useWhen: 'Something arrives from outside the app: payday, a reminder, a shared goal, a sign-in.',
  motion: 'The content slides down 16px and unblurs as it fades in after the shape arrives (icon first, then the text). A press on the banner dips it. A following banner row slides changed content in the same way while the old content fades out.',
  props: { app: ['string', 'Personal Finance'], title: ['string', 'Payday'], body: ['string', '£3,200 landed in Current account'], icon: ['enum:bell|wallet|info|sparkle', 'bell'] },
  hotspots: ['banner'],
  sounds: [],
  example: "{ at: 0, use: 'banner', title: 'Payday', body: '£3,200 landed in Current account', icon: 'wallet' }",
  edgeCases: [{ icon: 'sparkle', title: 'Goal reached', body: 'Holiday fund hit £4,000' }, { app: 'A very long app name indeed', title: 'A title that is far too long to fit on one line of the banner', body: 'And a body that is also much too long to fit in the space it has' }, { icon: 'info', body: '' }],
};

const W = 900, H = 150, PAD = 40, DOT = 64, COL = PAD + DOT + 24;

export function geometry() {
  return { w: W, h: H, r: 36, fill: 'surface', ink: 'ink' };
}

function content(root, p, cls) {
  const f = frame(root, `bn-row ${cls}`, W, H);
  const d = el(f, 'div', { class: 'bn-icon' });
  Object.assign(d.style, { position: 'absolute', left: `${PAD}px`, top: `${(H - DOT) / 2}px`, width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%',
    display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--surface)' });
  icon(d, p.icon, 32);
  const txt = el(f, 'div', { class: 'bn-text' });
  Object.assign(txt.style, { position: 'absolute', left: `${COL}px`, right: `${PAD}px`, top: '0', height: `${H}px` });
  const line = { position: 'absolute', left: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  Object.assign(el(txt, 'div', { class: 'bn-app' }, p.app).style, line, { right: '80px', top: '24px', font: '500 18px var(--font)', lineHeight: '22px', textTransform: 'uppercase',
    letterSpacing: '.08em', color: 'var(--muted)' });
  Object.assign(el(txt, 'div', { class: 'bn-now' }, 'now').style, { position: 'absolute', right: '0', top: '24px', font: '500 18px var(--font)', lineHeight: '22px',
    textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' });
  Object.assign(el(txt, 'div', { class: 'bn-title' }, p.title).style, line, { right: '0', top: '48px', font: '500 34px var(--font)', lineHeight: '42px', letterSpacing: '-0.01em' });
  Object.assign(el(txt, 'div', { class: 'bn-body' }, p.body).style, line, { right: '0', top: '94px', font: '500 22px var(--font)', lineHeight: '28px', color: 'var(--muted)' });
}
const changed = (a, b) => ['app', 'title', 'body', 'icon'].some((k) => a[k] !== b[k]);

export function mount(root, p, ctx) {
  if (ctx.continues && changed(ctx.prev, p)) content(root, ctx.prev, 'bn-prev');
  content(root, p, 'bn-cur');
}

// Slides down 16px into place and unblurs; lands exactly (landed) so the text is fully opaque once settled.
function slide(e, ctx, t, t0) {
  const i = t0 === -Infinity ? 1 : prog(ctx, t, t0, 0.5), o = landed(i);
  Object.assign(e.style, { opacity: String(o), transform: `translateY(${(-16 * (1 - i)).toFixed(3)}px)`, filter: o < 0.99 ? `blur(${((1 - o) * 6).toFixed(3)}px)` : 'none' });
}

export function render(root, p, ctx, t) {
  const bs = ctx.beat_sec, prev = root.querySelector('.bn-prev'), cur = root.querySelector('.bn-cur');
  if (prev) {
    const o = 1 - prog(ctx, t, ctx.t0, 0.2);
    Object.assign(prev.style, { opacity: String(Math.max(0, o)), filter: o < 0.99 ? `blur(${((1 - o) * 6).toFixed(3)}px)` : 'none' });
  }
  const start = !ctx.continues ? ctx.t0 + 0.1 * bs : prev ? ctx.t0 + 0.05 * bs : -Infinity;
  slide(cur.querySelector('.bn-icon'), ctx, t, start);
  for (const [k, s] of ['.bn-app', '.bn-now', '.bn-title', '.bn-body'].entries()) slide(cur.querySelector(s), ctx, t, start === -Infinity ? start : start + (0.06 + 0.03 * k) * bs);
  cur.style.transform = `scale(${1 - 0.02 * pressDepth(ctx, t, pressesOn(ctx, 'banner'))})`;
}

export function hotspot(name) {
  return name === 'banner' ? { x: 0, y: 0 } : null;
}
