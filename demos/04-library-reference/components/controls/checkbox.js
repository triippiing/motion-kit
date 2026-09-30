// checkbox.js -- a labelled checkbox; checking fills the box and draws the tick on.
import { el, textW, frame, icon, prog, drawOn, pressesOn, pressDepth } from '../core/helpers.js';

export const meta = {
  name: 'checkbox', group: 'controls',
  useWhen: 'An option is ticked: remember me, agree to terms, a to-do done.',
  motion: 'Checking fills the box with the accent and draws the tick on; a press on the box dips it and checks it at the press. A checked row draws its tick as it arrives. A following checkbox row continues from where the presses left it (write the pressed result as its `checked`); a continuation to unchecked empties the box.',
  props: { checked: ['boolean', false], label: ['string', 'Remember me'] },
  hotspots: ['box'],
  sounds: [],
  example: "{ at: 0, use: 'checkbox', checked: true, label: 'Remember me' }",
  edgeCases: [{ checked: false }, { checked: true, label: 'I agree to the terms of service and the privacy policy' }, { label: '' }],
};

const PAD = 28, BOX = 56, GAP = 24;

export function geometry(p) {
  return { w: Math.min(1200, 72 + 24 + textW(p.label, 30) + 72), h: 112, r: 28, fill: 'surface', ink: 'ink' };
}

export function mount(root, p, ctx) {
  const { w, h } = ctx.geo;
  const f = frame(root, 'cb', w, h);
  const box = el(f, 'div', { class: 'cb-box' });
  Object.assign(box.style, { position: 'absolute', left: `${PAD}px`, top: `${(h - BOX) / 2}px`, width: `${BOX}px`, height: `${BOX}px`,
    boxSizing: 'border-box', borderRadius: '14px', borderStyle: 'solid', borderWidth: '2px', display: 'grid', placeItems: 'center', color: 'var(--surface)' });
  const tick = icon(box, 'check', 36).firstChild;
  tick.setAttribute('class', 'cb-tick');
  tick.setAttribute('pathLength', '1');
  tick.setAttribute('stroke-dasharray', '1');
  const l = el(f, 'span', { class: 'cb-label' }, p.label);
  Object.assign(l.style, { position: 'absolute', left: `${PAD + BOX + GAP}px`, top: '0', font: '400 28px var(--font)', lineHeight: `${h}px`,
    maxWidth: `${w - PAD - BOX - GAP - PAD}px`, overflow: 'hidden', textOverflow: 'ellipsis' });
}

// Check/uncheck moments. A fresh row starts empty and, if checked, checks as it arrives (row 0 is
// long settled); a continuation starts where the previous row was. A press on the box checks it.
function plan(p, ctx) {
  const bs = ctx.beat_sec, ev = [];
  const start = ctx.continues ? ctx.prev.checked : false;
  let on = start;
  if (p.checked !== on) { on = p.checked; ev.push({ t: ctx.t0 + (ctx.continues ? 0 : 0.15 * bs), on }); }
  for (const pr of pressesOn(ctx, 'box').filter((x) => x.kind !== 'up').sort((a, b) => a.t - b.t)) {
    if (!on) { on = true; ev.push({ t: pr.t, on }); }
  }
  return { start, ev, on };
}

// The row as it stands after its presses: a following checkbox row continues from here.
export const endState = (p, ctx) => ({ ...p, checked: plan(p, ctx).on });

export function render(root, p, ctx, t) {
  const { Springs, beat_sec: bs } = ctx;
  const { start, ev } = plan(p, ctx);
  const level = Math.max(0, Math.min(1, Springs.track(t, { from: start ? 1 : 0, changes: ev.map((e) => ({ t: e.t, to: e.on ? 1 : 0 })),
    omega: Springs.fromSettle(0.3 * bs, 1), zeta: 1 }).value));
  let draw = start ? 1 : 0, op = 1;
  for (const e of ev) if (e.t <= t) { if (e.on) { draw = drawOn(ctx, t, e.t); op = 1; } else op = 1 - prog(ctx, t, e.t, 0.2); }
  const box = root.querySelector('.cb-box'), tick = box.querySelector('.cb-tick');
  const pct = (level * 100).toFixed(1);
  Object.assign(box.style, {
    background: level > 0.999 ? 'var(--accent)' : `color-mix(in srgb, var(--accent) ${pct}%, transparent)`,
    borderColor: level > 0.999 ? 'var(--accent)' : level < 0.001 ? 'var(--muted)' : `color-mix(in srgb, var(--accent) ${pct}%, var(--muted))`,
    transform: `scale(${1 - 0.08 * pressDepth(ctx, t, pressesOn(ctx, 'box'))})`,
  });
  tick.style.strokeDashoffset = String(1 - draw);
  tick.style.opacity = String(op);
}

export function hotspot(name, p, geo) {
  return name === 'box' ? { x: PAD + BOX / 2 - geo.w / 2, y: 0 } : null;
}
