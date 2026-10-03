// chip-row.js -- a row of filter chips; selected chips fill with the accent.
import { el, textW, frame, fade, applyFade, pressesOn, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'chip-row', group: 'chrome',
  useWhen: 'A list is filtered by category: all, bills, savings, fun.',
  motion: 'A press on a chip selects it: single-select moves the selection there, `multi` toggles the pressed chip. Selected chips fill with the accent and their text turns surface with a quick colour spring; the pressed chip dips with the cursor. A following chip-row row continues from the selection after the presses (write it as its `selected`) and blends to its own `selected` on arrival if it differs.',
  props: { chips: ['string[]', ['All', 'Bills', 'Savings', 'Fun']], selected: ['string[]', ['All']], multi: ['boolean', false] },
  hotspots: ['chip:<label>'],
  unique: { chips: true },
  choices: { selected: 'chips' },
  hotspotExample: { 'chip:<label>': 'chip:Bills' },
  sounds: [],
  example: "{ at: 0, use: 'chip-row', chips: ['All', 'Bills', 'Savings', 'Fun'], selected: ['All'] }",
  edgeCases: [{ selected: [] }, { multi: true, selected: ['Bills', 'Fun'] }, { chips: ['Groceries', 'Eating out', 'Transport', 'Subscriptions', 'Holidays', 'Gifts'], selected: ['Transport'] }],
};

const H = 104, CH = 72, GAP = 16, PAD = 16, FONT = 26;
const widths = (p) => p.chips.map((c) => textW(c, FONT) + 56);
const lefts = (p) => widths(p).reduce((a, w) => [...a, a.at(-1) + w + GAP], [PAD]);

export function geometry(p) {
  const iw = widths(p);
  return { w: Math.min(1400, Math.max(H, iw.reduce((a, b) => a + b, 0) + GAP * Math.max(0, iw.length - 1) + 2 * PAD)), h: H, r: H / 2, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const f = frame(root, 'cr', ctx.geo.w, H), iw = widths(p), xs = lefts(p);
  p.chips.forEach((c, i) => {
    const e = el(f, 'div', { class: 'cr-chip', 'data-label': c }, c);
    Object.assign(e.style, { position: 'absolute', left: `${xs[i]}px`, top: `${(H - CH) / 2}px`, width: `${iw[i]}px`, height: `${CH}px`, borderRadius: `${CH / 2}px`,
      boxSizing: 'border-box', borderWidth: '2px', borderStyle: 'solid', textAlign: 'center', font: `500 ${FONT}px var(--font)`, lineHeight: `${CH - 4}px`, whiteSpace: 'nowrap' });
  });
}

// The selection over time: the start (the previous row's end state when continuing), arriving with a different
// `selected`, then each press on a chip.
function plan(p, ctx) {
  const start = ctx.continues ? ctx.prev.selected : p.selected, steps = [{ t: -Infinity, sel: start }];
  const later = pressesOn(ctx, 'chip').filter((x) => x.kind !== 'up').map((x) => ({ t: x.t, chip: x.hotspot.slice(5) }));
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (ctx.continues && !same(start, p.selected)) later.push({ t: ctx.t0, set: p.selected });
  for (const e of later.sort((a, b) => a.t - b.t)) {
    const cur = steps.at(-1).sel;
    const sel = e.set ?? (!p.multi ? [e.chip] : cur.includes(e.chip) ? cur.filter((x) => x !== e.chip) : [...cur, e.chip]);
    steps.push({ t: e.t, sel });
  }
  return steps;
}

// The row as it stands after its presses: a following chip-row row continues from here.
export const endState = (p, ctx) => ({ ...p, selected: plan(p, ctx).at(-1).sel });

const mix = (a, b, k) => (k >= 1 ? a : k <= 0 ? b : `color-mix(in srgb, ${a} ${(k * 100).toFixed(1)}%, ${b})`);

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, { Springs } = ctx, steps = plan(p, ctx), omega = Springs.fromSettle(0.25 * bs, 1);
  const now = steps.filter((s) => s.t <= t).at(-1).sel;
  f.querySelectorAll('.cr-chip').forEach((e, i) => {
    const c = p.chips[i];
    let k = Springs.track(t, { from: steps[0].sel.includes(c) ? 1 : 0, changes: steps.slice(1).map((s) => ({ t: s.t, to: s.sel.includes(c) ? 1 : 0 })), omega, zeta: 1 }).value;
    k = k > 0.999 ? 1 : k < 0.001 ? 0 : k;
    Object.assign(e.style, { background: k <= 0 ? 'transparent' : mix('var(--accent)', 'transparent', k), borderColor: mix('var(--accent)', 'var(--muted)', k),
      color: mix('var(--surface)', 'var(--ink)', k) });
    e.classList.toggle('cr-on', now.includes(c));
    const dip = 1 - 0.04 * pressDepth(ctx, t, pressesOn(ctx, `chip:${c}`));
    if (!ctx.continues) {
      const fa = fade(ctx, t, ctx.t0 + (0.1 + 0.05 * i) * bs);
      applyFade(e, fa);
      e.style.transform = `translateY(${fa.y}px) scale(${dip})`;
    } else e.style.transform = `scale(${dip})`;
  });
}

export function hotspot(name, p, geo) {
  if (!name.startsWith('chip:')) return null;
  const i = p.chips.indexOf(name.slice(5));
  if (i < 0) return null;
  return { x: lefts(p)[i] + widths(p)[i] / 2 - geo.w / 2, y: 0 };
}
