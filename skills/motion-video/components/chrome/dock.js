// dock.js -- a bottom tab bar of icons and labels; a soft pill travels to the pressed item.
import { el, frame, icon, fade, applyFade, pressesOn, edges } from '../core/helpers.js';

export const meta = {
  name: 'dock', group: 'chrome',
  useWhen: "An app's main sections sit in a bottom bar: today, plan, calendar, settings.",
  motion: 'A press on an item sends the pill there with two edges (settling in 0.22 s, no overshoot): the leading edge moves first, so the pill stretches and settles, and quick reversals stay inside the dock. The active item turns ink, the others muted. A following dock row continues from the last pressed item (write it as its `active`) and travels on arrival if `active` differs.',
  props: { items: ['string[]', ['Today', 'Plan', 'Calendar', 'Retirement', 'Settings']], active: ['string', 'Plan'], icons: ['string[]', ['home', 'trend', 'calendar', 'wallet', 'settings']] },
  hotspots: ['item:<label>'],
  unique: { items: true },
  choices: { active: 'items' },
  hotspotExample: { 'item:<label>': 'item:Calendar' },
  sounds: [],
  example: "{ at: 0, use: 'dock', active: 'Plan' }",
  edgeCases: [{ items: ['Home', 'Search', 'Profile'], icons: ['home', 'search', 'user'], active: 'Profile' }, { active: 'Nowhere' },
    { items: ['Today', 'Plan', 'Calendar', 'Retirement', 'Settings', 'Files', 'Music'], icons: ['home', 'trend', 'calendar', 'wallet', 'settings', 'file', 'music'], active: 'Music' }],
};

const SLOT = 140, PAD = 12, INSET = 6, H = 140, SETTLE = 0.22;
const index = (p, name) => Math.max(0, p.items.indexOf(name));

export function geometry(p) {
  return { w: Math.min(1400, Math.max(1, p.items.length) * SLOT + 2 * PAD), h: H, r: 44, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const f = frame(root, 'dk', ctx.geo.w, H);
  Object.assign(el(f, 'div', { class: 'dk-pill' }).style, { position: 'absolute', top: `${PAD}px`, height: `${H - 2 * PAD}px`, borderRadius: '32px',
    background: 'color-mix(in srgb, var(--accent) 14%, transparent)' });
  p.items.forEach((it, i) => {
    const d = el(f, 'div', { class: 'dk-item', 'data-item': it });
    Object.assign(d.style, { position: 'absolute', left: `${PAD + i * SLOT}px`, width: `${SLOT}px`, top: '0', height: `${H}px`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' });
    if (p.icons[i]) icon(d, p.icons[i], 36);
    Object.assign(el(d, 'span', { class: 'dk-label' }, it).style, { font: '500 22px var(--font)', lineHeight: '28px', maxWidth: `${SLOT - 24}px`,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  });
}

// Where the pill starts (the previous row's item when continuing) and every move after.
function plan(p, ctx) {
  const from = ctx.continues ? index(p, ctx.prev.active) : index(p, p.active), changes = [];
  if (ctx.continues && index(p, p.active) !== from) changes.push({ t: ctx.t0, index: index(p, p.active) });
  for (const pr of pressesOn(ctx, 'item')) {
    const i = p.items.indexOf(pr.hotspot.slice(5));
    if (i >= 0 && pr.kind !== 'up') changes.push({ t: pr.t, index: i });
  }
  changes.sort((a, b) => a.t - b.t);
  return { from, changes, to: changes.length ? changes.at(-1).index : from };
}

// The row as it stands after its presses: a following dock row continues from here.
export const endState = (p, ctx) => (p.items.length ? { ...p, active: p.items[plan(p, ctx).to] } : p);

export function render(root, p, ctx, t) {
  const f = root.firstChild, n = p.items.length, bs = ctx.beat_sec, { Springs } = ctx;
  if (!n) return;
  const { from, changes } = plan(p, ctx);
  const e = edges(ctx, from, changes, t, SETTLE, n);
  const l = PAD + e.left * SLOT + INSET, r = PAD + e.right * SLOT - INSET;
  Object.assign(f.querySelector('.dk-pill').style, { left: `${l.toFixed(2)}px`, width: `${(r - l).toFixed(2)}px` });
  const omega = Springs.fromSettle(SETTLE, 1), now = [from, ...changes.filter((c) => c.t <= t).map((c) => c.index)].at(-1);
  f.querySelectorAll('.dk-item').forEach((d, i) => {
    let k = Springs.track(t, { from: from === i ? 1 : 0, changes: changes.map((c) => ({ t: c.t, to: c.index === i ? 1 : 0 })), omega, zeta: 1 }).value;
    k = k > 0.999 ? 1 : k < 0.001 ? 0 : k;
    d.style.color = k >= 1 ? 'var(--ink)' : k <= 0 ? 'var(--muted)' : `color-mix(in srgb, var(--ink) ${(k * 100).toFixed(1)}%, var(--muted))`;
    d.classList.toggle('dk-on', now === i);
    if (!ctx.continues) applyFade(d, fade(ctx, t, ctx.t0 + (0.1 + 0.05 * i) * bs));
  });
  if (!ctx.continues) f.querySelector('.dk-pill').style.opacity = String(fade(ctx, t, ctx.t0 + 0.2 * bs).o);
}

export function hotspot(name, p, geo) {
  if (!name.startsWith('item:')) return null;
  const i = p.items.indexOf(name.slice(5));
  if (i < 0) return null;
  return { x: PAD + i * SLOT + SLOT / 2 - geo.w / 2, y: 0 };
}
