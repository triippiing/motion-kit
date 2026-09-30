// bar-chart.js -- labelled bars that grow from the baseline in turn; one can be highlighted.
import { el, frame, prog, fade, applyFade, pressesOn } from '../core/helpers.js';

export const meta = {
  name: 'bar-chart', group: 'data',
  useWhen: 'A few amounts side by side: sessions per day, spending per category.',
  motion: 'Bars grow from the baseline 0.08 beat apart (no overshoot). With `highlight` set to a bar\'s label that bar is accent and the rest muted; a press on `bar:<label>` moves the highlight there, and a following bar-chart row continues from it (write it as its `highlight`). A following row also morphs: bars with the same label slide and grow to their new place and height, new bars grow in, missing ones shrink away.',
  props: { bars: ['object[]', [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 5 }, { label: 'Wed', value: 4 }, { label: 'Thu', value: 7 }]], label: ['string', 'Sessions'], highlight: ['string', ''] },
  hotspots: ['bar:<label>'],
  hotspotExample: { 'bar:<label>': 'bar:Thu' },
  sounds: [],
  example: "{ at: 0, use: 'bar-chart', label: 'Sessions', highlight: 'Thu' }",
  edgeCases: [{ bars: [] }, { bars: [{ label: 'Jan', value: 0 }, { label: 'Feb', value: 0 }] },
    { bars: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label, i) => ({ label, value: 3 + ((i * 5) % 7) })), highlight: 'Dec' },
    { label: 'Spending by category this month', bars: [{ label: 'Groceries', value: 420 }, { label: 'Transport', value: 160 }, { label: 'Eating out', value: 210 }] }],
};

const W = 900, H = 560, PX = 40, PW = 820, BASE = 470, BH = 280, LT = 486;
const MUTED = 'color-mix(in srgb, var(--muted) 35%, transparent)';

export function geometry() {
  return { w: W, h: H, r: 36, fill: 'surface', ink: 'ink' };
}

// Each bar's centre x, width and settled height for one set of props.
function layout(p) {
  const n = p.bars.length, slot = n ? PW / n : PW, bw = Math.min(96, slot * 0.62);
  const vals = p.bars.map((b) => Math.max(0, Number(b.value) || 0)), max = Math.max(0, ...vals);
  return p.bars.map((b, i) => ({ label: String(b.label), x: PX + slot * (i + 0.5), w: bw, h: max > 0 ? (vals[i] / max) * BH : 0, slot }));
}

function title(f, p, cls) {
  const l = el(f, 'div', { class: `bc-title ${cls}` }, p.label);
  Object.assign(l.style, { position: 'absolute', left: `${PX}px`, top: '52px', maxWidth: `${PW}px`, font: '500 34px var(--font)', lineHeight: '44px',
    letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' });
}

function bar(f, b, cls) {
  const e = el(f, 'div', { class: cls, 'data-label': b.label });
  Object.assign(e.style, { position: 'absolute', left: '0', top: '0', borderRadius: '12px' });
  const l = el(f, 'div', { class: `${cls}-label`, 'data-label': b.label }, b.label);
  Object.assign(l.style, { position: 'absolute', top: `${LT}px`, left: '0', width: `${b.slot - 8}px`, textAlign: 'center', font: '500 22px var(--font)', lineHeight: '28px',
    color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' });
  return [e, l];
}

// Bars of the previous row that this one no longer has: they shrink away where they stood.
const gone = (p, ctx) => (ctx.continues ? layout(ctx.prev).filter((b) => !p.bars.some((c) => String(c.label) === b.label)) : []);

export function mount(root, p, ctx) {
  const f = frame(root, 'bc', W, H);
  Object.assign(el(f, 'div', { class: 'bc-base' }).style, { position: 'absolute', left: `${PX}px`, width: `${PW}px`, top: `${BASE}px`, height: '2px',
    background: 'color-mix(in srgb, var(--muted) 30%, transparent)' });
  if (ctx.continues && ctx.prev.label !== p.label) title(f, ctx.prev, 'bc-prev');
  title(f, p, 'bc-cur');
  for (const b of gone(p, ctx)) bar(f, b, 'bc-gone');
  for (const b of layout(p)) bar(f, b, 'bc-bar');
}

// The highlighted label over time: where the previous row left it (continuing) or the row's own, the row's
// own on arrival, then each press on a bar. '' highlights nothing (every bar is accent).
function choices(p, ctx) {
  const list = [{ t: -Infinity, name: ctx.continues ? ctx.prev.highlight : p.highlight }];
  const later = pressesOn(ctx, 'bar').filter((x) => x.kind !== 'up').map((x) => ({ t: x.t, name: x.hotspot.slice(4) }));
  if (list[0].name !== p.highlight) later.push({ t: ctx.t0, name: p.highlight });
  return [...list, ...later.sort((a, b) => a.t - b.t)];
}

// The row as it stands after its presses: a following bar-chart row continues from here.
export const endState = (p, ctx) => ({ ...p, highlight: choices(p, ctx).at(-1).name });

const place = (bar, lab, b, x, h) => {
  Object.assign(bar.style, { transform: `translate(${(x - b.w / 2).toFixed(2)}px,${(BASE - h).toFixed(2)}px)`, width: `${b.w}px`, height: `${h.toFixed(2)}px` });
  lab.style.left = `${(x - (b.slot - 8) / 2).toFixed(2)}px`; // left, not transform: the label's fade owns its transform
};

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec;
  const pe = f.querySelector('.bc-prev');
  if (pe) {
    applyFade(pe, fade(ctx, t, -Infinity, ctx.t0));
    applyFade(f.querySelector('.bc-cur'), fade(ctx, t, ctx.t0 + 0.05 * bs));
  } else if (!ctx.continues) applyFade(f.querySelector('.bc-cur'), fade(ctx, t, ctx.t0 + 0.1 * bs));
  const was = ctx.continues ? layout(ctx.prev) : [];
  const move = prog(ctx, t, ctx.t0, 0.6, 1);
  const bars = f.querySelectorAll('.bc-bar'), labs = f.querySelectorAll('.bc-bar-label');
  const olds = f.querySelectorAll('.bc-gone'), oldLabs = f.querySelectorAll('.bc-gone-label');
  gone(p, ctx).forEach((b, j) => {
    place(olds[j], oldLabs[j], b, b.x, b.h * (1 - move));
    applyFade(oldLabs[j], fade(ctx, t, -Infinity, ctx.t0));
    olds[j].style.background = MUTED;
  });
  const list = choices(p, ctx);
  const now = list.filter((c) => c.t <= t).at(-1).name;
  const on = (name, label) => (name === '' || name === label ? 1 : 0);
  layout(p).forEach((b, i) => {
    const from = was.find((o) => o.label === b.label);
    if (from) place(bars[i], labs[i], b, from.x + (b.x - from.x) * move, from.h + (b.h - from.h) * move);
    else {
      const start = ctx.t0 + ((ctx.continues ? 0.1 : 0.15) + 0.08 * i) * bs;
      place(bars[i], labs[i], b, b.x, b.h * prog(ctx, t, start, 0.8, 1));
      applyFade(labs[i], fade(ctx, t, start));
    }
    const k = Math.max(0, Math.min(1, ctx.Springs.track(t, { from: on(list[0].name, b.label), changes: list.slice(1).map((c) => ({ t: c.t, to: on(c.name, b.label) })),
      omega: ctx.Springs.fromSettle(0.3 * bs, 1), zeta: 1 }).value));
    bars[i].classList.toggle('bc-hl', now !== '' && now === b.label);
    bars[i].style.background = k > 0.999 ? 'var(--accent)' : k < 0.001 ? MUTED : `color-mix(in srgb, var(--accent) ${(k * 100).toFixed(1)}%, ${MUTED})`;
  });
}

export function hotspot(name, p) {
  if (!name.startsWith('bar:')) return null;
  const b = layout(p).find((x) => x.label === name.slice(4));
  return b ? { x: b.x - W / 2, y: BASE - Math.max(b.h / 2, 24) - H / 2 } : null;
}
