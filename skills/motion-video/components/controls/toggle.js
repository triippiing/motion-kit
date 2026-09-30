// toggle.js -- an on/off switch; presses on the knob flip it, the knob stretches across as it travels.
import { el, textW, frame, pressesOn, edges } from '../core/helpers.js';

export const meta = {
  name: 'toggle', group: 'controls',
  useWhen: 'A setting switches on or off: notifications, dark mode, auto-save.',
  motion: 'Each press on the knob flips it: the leading edge moves first, so the knob stretches across and settles; the track fades from muted to accent. A continuation from the opposite state flips on arrival.',
  props: { on: ['boolean', false], label: ['string', ''] },
  hotspots: ['knob'],
  sounds: [],
  example: "{ at: 0, use: 'toggle', on: true, label: 'Notifications' }",
  edgeCases: [{ label: '' }, { on: true, label: '' }, { label: 'Automatically back up every photo and video' }],
};

const PAD_L = 36, PAD_R = 18;
// Switch sizes: the bare switch is the whole shape; inside a labelled row it is smaller.
const sw = (p) => (p.label ? { tw: 132, th: 76, k: 60, pad: 8 } : { tw: 172, th: 96, k: 76, pad: 10 });
const trackLeft = (p, w) => (p.label ? w - PAD_R - 132 : 0);

export function geometry(p) {
  if (!p.label) return { w: 172, h: 96, r: 48, fill: 'surface', ink: 'ink' };
  return { w: Math.min(1200, 172 + 36 + textW(p.label, 30)), h: 112, r: 56, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const { w, h } = ctx.geo, s = sw(p);
  const f = frame(root, 'tg', w, h);
  if (p.label) {
    const l = el(f, 'span', { class: 'tg-label' }, p.label);
    Object.assign(l.style, { position: 'absolute', left: `${PAD_L}px`, top: '0', font: '400 28px var(--font)', lineHeight: `${h}px`,
      maxWidth: `${trackLeft(p, w) - PAD_L - 16}px`, overflow: 'hidden', textOverflow: 'ellipsis' });
  }
  const track = el(f, 'div', { class: 'tg-track' });
  Object.assign(track.style, { position: 'absolute', left: `${trackLeft(p, w)}px`, top: `${(h - s.th) / 2}px`, width: `${s.tw}px`, height: `${s.th}px`, borderRadius: `${s.th / 2}px` });
  const knob = el(track, 'div', { class: 'tg-knob' });
  Object.assign(knob.style, { position: 'absolute', top: `${s.pad}px`, height: `${s.k}px`, borderRadius: `${s.k / 2}px`, background: 'var(--surface)' });
}

// Where the knob is headed and when: the row's starting side, a flip on arrival when continuing from
// the other side, then one flip per press on the knob (a drag's 'up' is not a new press).
function plan(p, ctx) {
  let on = ctx.continues ? ctx.prev.on : p.on;
  const from = on ? 1 : 0, changes = [];
  if (on !== p.on) { on = p.on; changes.push({ t: ctx.t0, index: on ? 1 : 0 }); }
  for (const pr of pressesOn(ctx, 'knob').filter((x) => x.kind !== 'up').sort((a, b) => a.t - b.t)) {
    on = !on;
    changes.push({ t: pr.t, index: on ? 1 : 0 });
  }
  return { from, changes };
}

export function render(root, p, ctx, t) {
  const s = sw(p), travel = s.tw - 2 * s.pad - s.k;
  const { from, changes } = plan(p, ctx);
  // n = 2: positions 0 (off) and 1 (on); the right edge reaches 2.
  const e = edges(ctx, from, changes, t, 0.45 * ctx.beat_sec, 2);
  const left = s.pad + e.left * travel, right = s.pad + s.k + (e.right - 1) * travel;
  const track = root.querySelector('.tg-track'), knob = track.firstChild;
  Object.assign(knob.style, { left: `${left}px`, width: `${right - left}px` });
  const c = Math.max(0, Math.min(1, (e.left + e.right - 1) / 2));
  track.style.background = c > 0.999 ? 'var(--accent)' : c < 0.001 ? 'var(--muted)' : `color-mix(in srgb, var(--accent) ${(c * 100).toFixed(1)}%, var(--muted))`;
}

export function hotspot(name, p, geo) {
  if (name !== 'knob') return null;
  const s = sw(p), travel = s.tw - 2 * s.pad - s.k;
  return { x: trackLeft(p, geo.w) + s.pad + s.k / 2 + (p.on ? travel : 0) - geo.w / 2, y: 0 };
}
