// button.js -- the reference component: every other component follows this shape.
import { el, textW, icon, pressesOn, pressDepth, fade, applyFade } from '../core/helpers.js';

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

const PAD = 56, ICON = 36, GAP = 16, CAP = 1200;
// The width the label asks for, before the cap.
const want = (p) => PAD * 2 + textW(p.label, 34) + (p.icon !== 'none' ? ICON + GAP : 0);
export function geometry(p) {
  return { w: Math.min(Math.max(220, want(p)), CAP), h: 112, r: 56, fill: 'accent', ink: 'surface' };
}

// The label (with its icon) for one set of props. A label past the cap starts at the left padding (its start reads,
// the shape cuts the rest) instead of overflowing both sides evenly; every other label is centred. Decided from the
// props, not measured: textW is only an estimate, so a label that fits may spill a few px into the padding, evenly.
function content(parent, p, cls) {
  const row = el(parent, 'div', { class: `btn-row ${cls}` }), capped = want(p) > CAP;
  Object.assign(row.style, { gridArea: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: capped ? 'flex-start' : 'center',
    paddingLeft: capped ? `${PAD}px` : '0', gap: `${GAP}px`, font: '500 34px var(--font)', letterSpacing: '-0.01em' });
  if (p.icon !== 'none') icon(row, p.icon, ICON);
  el(row, 'span', { class: 'btn-label' }, p.label);
}
const changed = (a, b) => a.label !== b.label || a.icon !== b.icon;

// Continuations (copy this pattern): when ctx.continues, ctx.prev holds the previous row's props and
// this layer replaces that row's layer at ctx.t0 with no fade of its own. Build the previous content
// too (only if it differs), then in render take it out with fade(..., tOut = ctx.t0) and bring the new
// content in with fade(ctx, t, ctx.t0 + ...), so the swap blurs with its own exit/enter timing.
// Skip the component's own entrance when continuing: the shape is already there.
// Stack the two in one grid cell exactly the layer's size (the shape's), not one as wide as the widest content:
// a cell sized by its content stays as wide as a long old label and pushes a shorter new one off the shape.
// Each row centres itself in that cell (or, past the cap, starts at the padding), so the shape clips the old label
// as it fades.
export function mount(root, p, ctx) {
  const box = el(root, 'div', { class: 'btn' });
  Object.assign(box.style, { position: 'absolute', inset: '0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' });
  if (ctx.continues && changed(ctx.prev, p)) content(box, ctx.prev, 'btn-prev');
  content(box, p, 'btn-cur');
}

export function render(root, p, ctx, t) {
  // Dip to 0.97 while pressed: a tap dips and recovers, 'down' holds the dip until 'up'.
  const box = root.firstChild;
  box.style.transform = `scale(${1 - 0.03 * pressDepth(ctx, t, pressesOn(ctx, 'button'))})`;
  if (box.children.length === 2) {
    applyFade(box.children[0], fade(ctx, t, -Infinity, ctx.t0));
    applyFade(box.children[1], fade(ctx, t, ctx.t0 + 0.05 * ctx.beat_sec));
  }
}

export function hotspot(name, p, geo) {
  return name === 'button' ? { x: Math.min(geo.w * 0.18, 90), y: 14 } : null;
}
