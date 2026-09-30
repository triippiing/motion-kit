// card.js -- a stat card: a caption title, a big figure and a line of body text, staggered in.
import { el, textW, fade, applyFade } from '../core/helpers.js';

export const meta = {
  name: 'card', group: 'data',
  useWhen: 'A headline number with a line of context: a monthly surplus, a balance, a score.',
  motion: 'Title, figure and body rise in 0.08 beat apart. A following card row keeps what is unchanged and crossfades what changed (a new figure blurs out and back in) while the shape morphs to the new size.',
  props: { title: ['string', 'Monthly surplus'], figure: ['string', '£900'], body: ['string', '£540 to goals, £360 spare'] },
  hotspots: [],
  sounds: [],
  example: "{ at: 0, use: 'card', title: 'Monthly surplus', figure: '£900', body: '£540 to goals, £360 spare' }",
  edgeCases: [{ figure: '' }, { body: '' }, { title: 'Net worth', figure: '£1,284,905', body: 'Up £12,400 since last month, mostly from the pension and the ISA' }],
};

const PAD = 48, FIG = 96, BODY = 44;

export function geometry(p) {
  const w = Math.min(1000, Math.max(560, textW(p.body, 26) + 2 * PAD, textW(p.figure, 72, 600) + 2 * PAD));
  return { w, h: 2 * PAD + (p.figure ? FIG : 0) + (p.body ? BODY : 0) + PAD, r: 32, fill: 'surface', ink: 'ink' };
}

// Each piece's text, style and top edge for one set of props (pinned to the shape's top-left, so pieces
// that stay put across a continuation move with the morphing shape).
function pieces(p) {
  return [
    { k: 'title', text: p.title, top: PAD, style: { font: '500 18px var(--font)', lineHeight: '24px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' } },
    { k: 'figure', text: p.figure, top: 2 * PAD, style: { font: '600 72px var(--font)', lineHeight: `${FIG}px`, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' } },
    { k: 'body', text: p.body, top: 2 * PAD + (p.figure ? FIG : 0), style: { font: '400 28px var(--font)', lineHeight: `${BODY}px` } },
  ];
}
const same = (a, b) => a.text === b.text && a.top === b.top;

function piece(root, q, cls, w) {
  const e = el(root, 'div', { class: cls }, q.text);
  Object.assign(e.style, { position: 'absolute', left: `${PAD}px`, top: `${q.top}px`, maxWidth: `${w - 2 * PAD}px`, overflow: 'hidden', textOverflow: 'ellipsis' }, q.style);
}

export function mount(root, p, ctx) {
  const cur = pieces(p), prev = ctx.continues ? pieces(ctx.prev) : null;
  if (prev) prev.forEach((q, i) => { if (q.text && !same(q, cur[i])) piece(root, q, `cd-prev cd-prev-${q.k}`, geometry(ctx.prev).w); });
  for (const q of cur) piece(root, q, `cd-${q.k}`, ctx.geo.w);
}

export function render(root, p, ctx, t) {
  const bs = ctx.beat_sec, cur = pieces(p), prev = ctx.continues ? pieces(ctx.prev) : null;
  for (const e of root.querySelectorAll('.cd-prev')) applyFade(e, fade(ctx, t, -Infinity, ctx.t0));
  cur.forEach((q, i) => {
    const start = prev ? (same(prev[i], q) ? -Infinity : ctx.t0 + (0.05 + 0.08 * i) * bs) : ctx.t0 + (0.15 + 0.08 * i) * bs;
    applyFade(root.querySelector(`.cd-${q.k}`), fade(ctx, t, start));
  });
}

export function hotspot() {
  return null;
}
