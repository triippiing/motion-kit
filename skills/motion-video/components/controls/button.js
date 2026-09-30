// button.js -- the reference component: every other component follows this shape.
import { el, textW, icon, pressesOn, prog } from '../core/helpers.js';

export const meta = {
  name: 'button', group: 'controls',
  useWhen: 'A call to action is pressed: start, import, buy, sign up.',
  motion: 'Presses dip the label slightly with the cursor; the shape morphs in from the previous state.',
  props: { label: ['string', 'Get started'], icon: ['enum:none|upload|plus|play|check|sparkle|chevron', 'none'] },
  hotspots: ['button'],
  sounds: [],
  example: "{ at: 0, use: 'button', label: 'Import payslip', icon: 'upload' }",
  edgeCases: [{ label: 'A very long call to action that keeps going and going' }, { label: '' }, { icon: 'plus', label: 'Add' }],
};

const PAD = 56, ICON = 36, GAP = 16;
export function geometry(p) {
  const w = Math.max(220, PAD * 2 + textW(p.label, 34) + (p.icon !== 'none' ? ICON + GAP : 0));
  return { w: Math.min(w, 1200), h: 112, r: 56, fill: 'accent', ink: 'surface' };
}

export function mount(root, p) {
  const row = el(root, 'div', { class: 'btn-row' });
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: `${GAP}px`, font: '500 34px var(--font)', letterSpacing: '-0.01em' });
  if (p.icon !== 'none') icon(row, p.icon, ICON);
  el(row, 'span', { class: 'btn-label' }, p.label);
}

// No entrance of its own (the engine's layer fade is it), so a continuation needs nothing
// special: the new row's label simply replaces the old one.
export function render(root, p, ctx, t) {
  // Dip to 0.97 on each press aimed at this button, recovering with the press spring.
  let s = 1;
  for (const pr of pressesOn(ctx, 'button')) {
    if (t < pr.t - 0.08 * ctx.beat_sec) continue;
    const d = prog(ctx, t, pr.t - 0.08 * ctx.beat_sec, 0.15), u = prog(ctx, t, pr.t + 0.1 * ctx.beat_sec, 0.15);
    s = Math.min(s, 1 - 0.03 * d * (1 - u));
  }
  root.firstChild.style.transform = `scale(${s})`;
}

export function hotspot(name, p, geo) {
  return name === 'button' ? { x: Math.min(geo.w * 0.18, 90), y: 14 } : null;
}
