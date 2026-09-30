// tabs.js -- a segmented control; the indicator travels between tabs with two springy edges.
import { el, textW, frame, pressesOn, edges } from '../core/helpers.js';

export const meta = {
  name: 'tabs', group: 'controls',
  useWhen: 'A view switches between a few peers: day/week/month, list/grid, plans.',
  motion: 'A press on a tab sends the indicator there: the leading edge moves first, so it stretches and settles, and quick reversals stay inside the bar. The active label is shown in the indicator. A following tabs row continues from the last pressed tab (write it as its `active`) and travels on arrival if `active` differs.',
  props: { items: ['string[]', ['Day', 'Week', 'Month']], active: ['string', 'Day'] },
  hotspots: ['tab:<item>'],
  choices: { active: 'items' },
  hotspotExample: { 'tab:<item>': 'tab:Month' },
  sounds: [],
  example: "{ at: 0, use: 'tabs', items: ['Day', 'Week', 'Month'], active: 'Week' }",
  edgeCases: [{ items: ['List', 'Grid'], active: 'Grid' }, { items: ['Overview', 'Activity', 'Settings', 'Billing', 'Team'], active: 'Team' }, { items: ['Day', 'Week', 'Month'], active: 'Year' }],
};

const PAD = 8;
const widths = (p) => p.items.map((it) => textW(it, 28) + 64);
// Left edge of each slot, from 0, with the total last.
const lefts = (iw) => iw.reduce((a, x) => [...a, a.at(-1) + x], [0]);
// An unknown active tab falls back to the first.
const index = (p, name) => Math.max(0, p.items.indexOf(name));

export function geometry(p) {
  return { w: Math.min(1400, widths(p).reduce((a, b) => a + b, 0) + 2 * PAD), h: 100, r: 50, fill: 'ink', ink: 'surface' };
}

function labels(parent, p, cls, h) {
  const iw = widths(p), cum = lefts(iw);
  p.items.forEach((it, i) => {
    const s = el(parent, 'span', { class: cls, 'data-item': it }, it);
    Object.assign(s.style, { position: 'absolute', left: `${PAD + cum[i]}px`, width: `${iw[i]}px`, top: '0', font: '400 28px var(--font)', lineHeight: `${h}px`, textAlign: 'center' });
  });
}

export function mount(root, p, ctx) {
  const { w, h } = ctx.geo;
  const f = frame(root, 'tb', w, h);
  labels(f, p, 'tb-tab', h);
  Object.assign(el(f, 'div', { class: 'tb-ind' }).style, { position: 'absolute', top: `${PAD}px`, height: `${h - 2 * PAD}px`, borderRadius: `${(h - 2 * PAD) / 2}px`, background: 'var(--surface)' });
  const on = el(f, 'div', { class: 'tb-on' });
  Object.assign(on.style, { position: 'absolute', inset: '0', color: 'var(--ink)' });
  labels(on, p, 'tb-on-tab', h);
}

// Where the indicator starts (the previous row's tab when continuing) and every move after.
function plan(p, ctx) {
  const from = ctx.continues ? index(p, ctx.prev.active) : index(p, p.active), changes = [];
  if (ctx.continues && index(p, p.active) !== from) changes.push({ t: ctx.t0, index: index(p, p.active) });
  for (const pr of pressesOn(ctx, 'tab')) {
    const i = p.items.indexOf(pr.hotspot.slice(4));
    if (i >= 0 && pr.kind !== 'up') changes.push({ t: pr.t, index: i });
  }
  changes.sort((a, b) => a.t - b.t);
  return { from, changes, to: changes.length ? changes.at(-1).index : from };
}

// The row as it stands after its presses: a following tabs row continues from here.
export function endState(p, ctx) {
  return p.items.length ? { ...p, active: p.items[plan(p, ctx).to] } : p;
}

export function render(root, p, ctx, t) {
  const f = root.firstChild, W = ctx.geo.w, h = ctx.geo.h, n = p.items.length;
  if (!n) return;
  const iw = widths(p), cum = lefts(iw);
  const at = (x) => { const i = Math.min(n - 1, Math.floor(x)); return cum[i] + (x - i) * iw[i]; }; // slot units -> px
  const { from, changes } = plan(p, ctx);
  const e = edges(ctx, from, changes, t, 0.35 * ctx.beat_sec, n);
  const l = PAD + at(e.left), r = PAD + at(e.right);
  Object.assign(f.querySelector('.tb-ind').style, { left: `${l}px`, width: `${r - l}px` });
  f.querySelector('.tb-on').style.clipPath = `inset(${PAD}px ${W - r}px ${PAD}px ${l}px round ${(h - 2 * PAD) / 2}px)`;
}

export function hotspot(name, p, geo) {
  if (!name.startsWith('tab:')) return null;
  const i = p.items.indexOf(name.slice(4));
  if (i < 0) return null;
  const iw = widths(p), cum = lefts(iw);
  return { x: PAD + cum[i] + iw[i] / 2 - geo.w / 2, y: 0 };
}
