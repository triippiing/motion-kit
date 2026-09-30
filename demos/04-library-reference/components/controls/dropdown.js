// dropdown.js -- a select: a closed trigger row, and an open row whose shape grows to show the items.
import { el, frame, icon, prog, fade, applyFade, pressesOn } from '../core/helpers.js';

export const meta = {
  name: 'dropdown', group: 'controls',
  useWhen: 'A menu opens and an option is chosen: sort order, a filter, an account.',
  motion: 'Write the closed and open states as consecutive rows: the shape grows to open, the chevron turns, and the items stagger in. A press on an item highlights it and moves the check there, and a following dropdown row continues from that choice (write it as its `selected`). A closed row after an open one fades the items out as the shape closes and shows the choice in the trigger.',
  props: { label: ['string', 'Sort by'], items: ['string[]', ['Newest', 'Oldest', 'Popular']], open: ['boolean', false], selected: ['string', ''] },
  hotspots: ['trigger', 'item:<item>'],
  hotspotExample: { 'item:<item>': 'item:Oldest' },
  sounds: [],
  example: "{ at: 0, use: 'dropdown', label: 'Sort by', open: true, selected: 'Newest' }",
  edgeCases: [{ open: false }, { open: false, selected: 'Popular' }, { open: true, items: ['Today', 'This week', 'This month', 'This year', 'All time'] }],
};

const W = 420, TRIGGER = 96, SLOT = 72, TOP = 104, PAD = 32;
const itemTop = (i) => TOP + i * SLOT;

export function geometry(p) {
  return p.open ? { w: W, h: TRIGGER + p.items.length * SLOT + 16, r: 24, fill: 'surface', ink: 'ink' } : { w: W, h: TRIGGER, r: 20, fill: 'surface', ink: 'ink' };
}

// The trigger's text for one set of props: the label, then the choice once there is one.
function triggerText(parent, p, cls) {
  const row = el(parent, 'div', { class: `dd-text ${cls}` });
  Object.assign(row.style, { gridArea: '1 / 1', display: 'flex', alignItems: 'center', gap: '12px' });
  Object.assign(el(row, 'span', { class: 'dd-label' }, p.label).style, { color: p.selected ? 'var(--muted)' : 'inherit' });
  if (p.selected) Object.assign(el(row, 'span', { class: 'dd-value' }, p.selected).style, { fontWeight: '500' });
}

function items(parent, list, w, cls) {
  list.forEach((it, i) => {
    const e = el(parent, 'div', { class: cls, 'data-item': it });
    Object.assign(e.style, { position: 'absolute', left: '12px', width: `${w - 24}px`, top: `${itemTop(i)}px`, height: '64px', borderRadius: '14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${PAD - 12}px`, boxSizing: 'border-box', font: '400 28px var(--font)' });
    el(e, 'span', {}, it);
    Object.assign(icon(e, 'check', 28).style, { color: 'var(--accent)' });
  });
}

const soft = (k) => `color-mix(in srgb, var(--accent) ${(14 * k).toFixed(2)}%, transparent)`;
// Items leaving with the previous (open) row: gone before the shape has closed round them.
const closing = (p, ctx) => ctx.continues && ctx.prev.open && !p.open;
const changed = (a, b) => a.label !== b.label || a.selected !== b.selected;

export function mount(root, p, ctx) {
  const { w, h } = ctx.geo;
  const f = frame(root, 'dd', w, Math.max(h, closing(p, ctx) ? geometry(ctx.prev).h : 0), true);
  const trig = el(f, 'div', { class: 'dd-trigger' });
  Object.assign(trig.style, { position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${TRIGGER}px`, font: '400 28px var(--font)' });
  const txt = el(trig, 'div', { class: 'dd-texts' });
  Object.assign(txt.style, { position: 'absolute', left: `${PAD}px`, top: '0', height: `${TRIGGER}px`, display: 'grid', alignItems: 'center' });
  if (ctx.continues && changed(ctx.prev, p)) triggerText(txt, ctx.prev, 'dd-prev');
  triggerText(txt, p, 'dd-cur');
  Object.assign(icon(trig, 'chevron-down', 28).style, { position: 'absolute', right: `${PAD}px`, top: `${(TRIGGER - 28) / 2}px` });
  const rule = el(f, 'div', { class: 'dd-rule' });
  Object.assign(rule.style, { position: 'absolute', left: '0', width: `${w}px`, top: `${TRIGGER - 1}px`, height: '1px', background: 'color-mix(in srgb, var(--muted) 30%, transparent)' });
  if (p.open) items(f, p.items, w, 'dd-item');
  else if (closing(p, ctx)) items(f, ctx.prev.items, w, 'dd-item dd-leaving');
}

// The current choice over time: where the previous row left it (continuing) or the row's `selected`,
// the row's `selected` on arrival, then each press on an item.
function choices(p, ctx) {
  const list = [{ t: -Infinity, name: ctx.continues ? ctx.prev.selected : p.selected }];
  const later = pressesOn(ctx, 'item').filter((x) => x.kind !== 'up').map((x) => ({ t: x.t, name: x.hotspot.slice(5) }));
  if (list[0].name !== p.selected) later.push({ t: ctx.t0, name: p.selected });
  return [...list, ...later.sort((a, b) => a.t - b.t)];
}

// The row as it stands after its presses: a following dropdown row continues from here.
export const endState = (p, ctx) => ({ ...p, selected: choices(p, ctx).at(-1).name });

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec;
  const texts = f.querySelectorAll('.dd-text');
  if (texts.length === 2) {
    applyFade(texts[0], fade(ctx, t, -Infinity, ctx.t0));
    applyFade(texts[1], fade(ctx, t, ctx.t0 + 0.05 * bs));
  }
  const wasOpen = ctx.continues ? ctx.prev.open : p.open;
  const turn = wasOpen === p.open ? 1 : prog(ctx, t, ctx.t0, 0.4);
  const deg = (wasOpen ? 180 : 0) + ((p.open ? 180 : 0) - (wasOpen ? 180 : 0)) * turn;
  f.querySelector('.dd-trigger .ico').style.transform = `rotate(${deg}deg)`;
  const leaving = closing(p, ctx);
  f.querySelector('.dd-rule').style.opacity = String(p.open ? (wasOpen ? 1 : prog(ctx, t, ctx.t0, 0.3)) : leaving ? 1 - prog(ctx, t, ctx.t0, 0.2) : 0);
  const list = choices(p, ctx);
  const now = list.filter((c) => c.t <= t).at(-1).name;
  f.querySelectorAll('.dd-item').forEach((e, i) => {
    const name = e.dataset.item;
    if (leaving) {
      applyFade(e, fade(ctx, t, -Infinity, ctx.t0));
      e.style.background = name === (p.selected || ctx.prev.selected) ? soft(1) : 'transparent';
      e.lastChild.style.opacity = name === (p.selected || ctx.prev.selected) ? '1' : '0';
      return;
    }
    // Stagger in when the row opens; already open (a continuation of an open row) shows them at once.
    applyFade(e, fade(ctx, t, ctx.continues && ctx.prev.open ? -Infinity : ctx.t0 + (0.1 + 0.06 * i) * bs));
    // Highlight level: in at each moment this item becomes the choice, out when another does.
    const k = Math.max(0, Math.min(1, ctx.Springs.track(t, { from: list[0].name === name ? 1 : 0, changes: list.slice(1).map((c) => ({ t: c.t, to: c.name === name ? 1 : 0 })),
      omega: ctx.Springs.fromSettle(0.25 * bs, 1), zeta: 1 }).value));
    e.classList.toggle('dd-hl', now === name);
    e.style.background = k > 0.001 ? soft(k) : 'transparent';
    Object.assign(e.lastChild.style, { opacity: String(k), transform: `scale(${0.6 + 0.4 * k})` });
  });
}

export function hotspot(name, p, geo) {
  if (name === 'trigger') return { x: geo.w / 2 - PAD - 14, y: TRIGGER / 2 - geo.h / 2 };
  if (!p.open || !name.startsWith('item:')) return null;
  const i = p.items.indexOf(name.slice(5));
  return i < 0 ? null : { x: PAD + 70 - geo.w / 2, y: itemTop(i) + 32 - geo.h / 2 };
}
