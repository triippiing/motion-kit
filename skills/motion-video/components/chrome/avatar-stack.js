// avatar-stack.js -- overlapping initials circles with a "+n" chip; the hovered avatar lifts.
import { el, frame, prog } from '../core/helpers.js';

export const meta = {
  name: 'avatar-stack', group: 'chrome',
  useWhen: 'A few people share something: a goal, a document, a household budget.',
  motion: 'The avatars pop in left to right (0.06 beat apart), then the +n chip. While a cursor row is aimed at `avatar:<i>` that avatar lifts 10px and the others spread 8px away from it (no overshoot); aiming elsewhere settles them back. The hover carries into a following avatar-stack row, which pops in only avatars whose initials changed. At most 16 avatars show.',
  props: { people: ['string[]', ['JW', 'AK', 'MS', 'LT']], extra: ['number', 3] },
  hotspots: ['avatar:<i>'],
  hotspotExample: { 'avatar:<i>': 'avatar:1' },
  sounds: [],
  example: "{ at: 0, use: 'avatar-stack', people: ['JW', 'AK', 'MS', 'LT'], extra: 3 }",
  edgeCases: [{ people: ['JW'], extra: 0 }, { people: ['JW', 'AK', 'MS', 'LT', 'RB', 'CD', 'EF', 'GH'], extra: 12 }, { people: [], extra: 5 }],
};

const SIZE = 88, STEP = 64, H = 120, MAX = 16, LIFT = 10, SPREAD = 8;
const FILLS = ['accent', 'ink', 'muted'];
const shown = (p) => p.people.slice(0, MAX);
const count = (p) => shown(p).length + (p.extra > 0 ? 1 : 0);
// Left edge of the first circle: the circles and chip are centred in the pill.
const left0 = (p, w) => (w - (SIZE - STEP + count(p) * STEP)) / 2;

export function geometry(p) {
  return { w: 40 + shown(p).length * STEP + 56 + (p.extra > 0 ? 72 : 0), h: H, r: H / 2, fill: 'surface', ink: 'ink' };
}

function circle(f, cls, x, z, text, bg, color) {
  const c = el(f, 'div', { class: cls }, text);
  Object.assign(c.style, { position: 'absolute', left: `${x}px`, top: `${(H - SIZE) / 2}px`, width: `${SIZE}px`, height: `${SIZE}px`, borderRadius: '50%',
    boxSizing: 'border-box', border: '4px solid var(--canvas)', background: bg, color, zIndex: String(z), textAlign: 'center',
    font: '500 28px var(--font)', lineHeight: `${SIZE - 8}px`, letterSpacing: '0.02em' });
  return c;
}

export function mount(root, p, ctx) {
  const w = ctx.geo.w, f = frame(root, 'as', w, H), x0 = left0(p, w), n = shown(p).length;
  shown(p).forEach((who, i) => circle(f, 'as-av', x0 + i * STEP, n - i + 1, who.slice(0, 2), `var(--${FILLS[i % 3]})`, 'var(--surface)').setAttribute('data-i', String(i)));
  if (p.extra > 0) circle(f, 'as-more', x0 + n * STEP, 0, `+${p.extra}`, 'color-mix(in srgb, var(--muted) 22%, var(--surface))', 'var(--ink)');
}

const hoverOf = (target, n) => {
  const i = target && target.startsWith('avatar:') ? Number(target.slice(7)) : -1;
  return Number.isInteger(i) && i >= 0 && i < n ? i : -1;
};

// The hovered avatar over time: none at first (or the aim carried from the continued row), then each cursor row.
function hovers(p, ctx) {
  const n = shown(p).length, list = ctx.targets.map((e) => ({ t: e.t, h: hoverOf(e.target, n), carried: e.carried }));
  const from = list[0]?.carried ? list.shift().h : -1;
  return { from, changes: list };
}

export function render(root, p, ctx, t) {
  const f = root.firstChild, bs = ctx.beat_sec, { Springs } = ctx, n = shown(p).length;
  const { from, changes } = hovers(p, ctx), omega = Springs.fromSettle(0.3 * bs, 1);
  const dx = (j, h) => (h < 0 || j === h ? 0 : j < h ? -SPREAD : SPREAD), dy = (j, h) => (j === h ? -LIFT : 0);
  const move = (get, j) => Springs.track(t, { from: get(j, from), changes: changes.map((c) => ({ t: c.t, to: get(j, c.h) })), omega, zeta: 1 }).value;
  const prev = ctx.continues ? ctx.prev : null;
  const els = [...f.querySelectorAll('.as-av'), ...f.querySelectorAll('.as-more')];
  els.forEach((e, j) => {
    const same = prev && (j < n ? prev.people[j] === p.people[j] : prev.extra === p.extra && prev.people.slice(0, MAX).length === n);
    const s = same ? 1 : prog(ctx, t, ctx.t0 + (prev ? 0.05 : 0.1 + 0.06 * j) * bs, 0.5, 0.8);
    Object.assign(e.style, { opacity: String(Math.max(0, Math.min(1, s))),
      transform: `translate(${move(dx, j).toFixed(3)}px, ${move(dy, j).toFixed(3)}px) scale(${Math.max(0, 0.6 + 0.4 * s).toFixed(4)})` });
  });
}

export function hotspot(name, p, geo) {
  if (!name.startsWith('avatar:')) return null;
  const i = hoverOf(name, shown(p).length);
  if (i < 0) return null;
  return { x: left0(p, geo.w) + i * STEP + SIZE / 2 - geo.w / 2, y: 0 };
}
