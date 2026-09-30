// list.js -- rows of title, detail and value (bills, transactions, goals) that stagger in; one can be highlighted.
import { el, textW, frame, fade, applyFade, pressesOn } from '../core/helpers.js';

export const meta = {
  name: 'list', group: 'data',
  useWhen: 'A short list of items with amounts: upcoming bills, recent transactions, goals.',
  motion: 'Rows rise in one after another (0.06 beat apart). `highlight` (a row index) or a press on `row:<i>` gives that row a soft accent background; a following list row continues from the pressed row (write it as its `highlight`). A following row keeps rows that are unchanged, crossfades changed ones, and the shape grows or shrinks for added or removed rows. At most 8 rows show.',
  props: { rows: ['object[]', [{ title: 'Rent', detail: 'Tomorrow', value: '£850' }, { title: 'Holiday fund', detail: 'Weekly', value: '£120' }, { title: 'Coffee', detail: 'Today', value: '£3.40' }]], highlight: ['number', -1] },
  hotspots: ['row:<i>'],
  hotspotExample: { 'row:<i>': 'row:1' },
  sounds: [],
  example: "{ at: 0, use: 'list', highlight: 1 }",
  edgeCases: [{ rows: [] },
    { rows: Array.from({ length: 10 }, (_, i) => ({ title: `Payment ${i + 1}`, detail: 'Monthly', value: `£${(i + 1) * 25}` })), highlight: 7 },
    { rows: [{ title: 'A very long payee name that keeps going and going', detail: 'Monthly on the first working day', value: '£1,284.00' }], highlight: 0 }],
};

const W = 760, TOP = 24, ROW = 96, MAX = 8;
const shown = (p) => p.rows.slice(0, MAX);
const txt = (r, k) => String(r?.[k] ?? '');
const same = (a, b) => !!a && !!b && ['title', 'detail', 'value'].every((k) => txt(a, k) === txt(b, k));

export function geometry(p) {
  return { w: W, h: 2 * TOP + shown(p).length * ROW, r: 32, fill: 'surface', ink: 'ink' };
}

// One row's content: title and detail stacked on the left, the value on the right, in a pill that takes the highlight.
function row(f, r, i, cls) {
  const e = el(f, 'div', { class: cls, 'data-i': String(i) });
  Object.assign(e.style, { position: 'absolute', left: '12px', width: `${W - 24}px`, top: `${TOP + i * ROW + 6}px`, height: `${ROW - 12}px`, borderRadius: '20px' });
  const value = txt(r, 'value'), vw = textW(value, 28) + 24;
  const left = { position: 'absolute', left: '24px', maxWidth: `${W - 24 - 48 - vw}px`, overflow: 'hidden', textOverflow: 'ellipsis' };
  Object.assign(el(e, 'div', { class: 'ls-title' }, txt(r, 'title')).style, left, { top: '10px', font: '400 28px var(--font)', lineHeight: '36px' });
  Object.assign(el(e, 'div', { class: 'ls-detail' }, txt(r, 'detail')).style, left, { top: '46px', font: '500 22px var(--font)', lineHeight: '28px', color: 'var(--muted)' });
  Object.assign(el(e, 'div', { class: 'ls-value' }, value).style, { position: 'absolute', right: '24px', top: '0', font: '500 28px var(--font)', lineHeight: `${ROW - 12}px`,
    fontVariantNumeric: 'tabular-nums' });
}

export function mount(root, p, ctx) {
  const prev = ctx.continues ? shown(ctx.prev) : [];
  const f = frame(root, 'ls', W, Math.max(ctx.geo.h, 2 * TOP + prev.length * ROW), true);
  prev.forEach((r, i) => { if (!same(r, shown(p)[i])) row(f, r, i, 'ls-prev'); });
  shown(p).forEach((r, i) => row(f, r, i, 'ls-row'));
}

// The highlighted row over time: where the previous row left it (continuing) or the row's own, the row's
// own on arrival, then each press on a row.
function choices(p, ctx) {
  const list = [{ t: -Infinity, i: ctx.continues ? ctx.prev.highlight : p.highlight }];
  const later = pressesOn(ctx, 'row').filter((x) => x.kind !== 'up').map((x) => ({ t: x.t, i: Number(x.hotspot.slice(4)) }));
  if (list[0].i !== p.highlight) later.push({ t: ctx.t0, i: p.highlight });
  return [...list, ...later.sort((a, b) => a.t - b.t)];
}

// The row as it stands after its presses: a following list row continues from here.
export const endState = (p, ctx) => ({ ...p, highlight: choices(p, ctx).at(-1).i });

const soft = (k) => `color-mix(in srgb, var(--accent) ${(14 * k).toFixed(2)}%, transparent)`;

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec;
  const prev = ctx.continues ? shown(ctx.prev) : null;
  for (const e of f.querySelectorAll('.ls-prev')) applyFade(e, fade(ctx, t, -Infinity, ctx.t0));
  const list = choices(p, ctx);
  const now = list.filter((c) => c.t <= t).at(-1).i;
  f.querySelectorAll('.ls-row').forEach((e, i) => {
    const start = prev ? (same(prev[i], shown(p)[i]) ? -Infinity : ctx.t0 + (0.05 + 0.06 * i) * bs) : ctx.t0 + (0.1 + 0.06 * i) * bs;
    applyFade(e, fade(ctx, t, start));
    const k = Math.max(0, Math.min(1, ctx.Springs.track(t, { from: list[0].i === i ? 1 : 0, changes: list.slice(1).map((c) => ({ t: c.t, to: c.i === i ? 1 : 0 })),
      omega: ctx.Springs.fromSettle(0.25 * bs, 1), zeta: 1 }).value));
    e.classList.toggle('ls-hl', now === i);
    e.style.background = k > 0.001 ? soft(k) : 'transparent';
  });
}

export function hotspot(name, p, geo) {
  if (!name.startsWith('row:')) return null;
  const i = Number(name.slice(4));
  if (!Number.isInteger(i) || i < 0 || i >= shown(p).length) return null;
  return { x: 12 + 24 + 90 - W / 2, y: TOP + i * ROW + ROW / 2 - geo.h / 2 };
}
